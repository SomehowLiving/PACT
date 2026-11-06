import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestClient, createWalletClient, http, publicActions, serializeSignature, type Hex } from "viem";
import { privateKeyToAccount, sign } from "viem/accounts";
import { foundry } from "viem/chains";
import { CHAINS, FLASH_SPENDER, PERMIT2 } from "./chains";
import {
  ACCOUNT_ABI,
  digestOf,
  encodeSessionSignature,
  FACTORY_ABI,
  flashOrderPayload,
  KIND_FLASH_ORDER,
  KIND_PERMIT2,
  permitPayload,
  predictAccount,
  scopeFor,
  scopeViolations,
} from "./session-account";

/*
 * TypeScript encoders against the compiled Solidity, on a local anvil chain.
 * Opt-in:  (cd contracts && forge build) && PACT_ANVIL=1 npx vitest run lib/session-account.anvil.test.ts
 */
const RUN = process.env.PACT_ANVIL === "1";
const PORT = 8547;
const MAGIC = "0x1626ba7e";

describe.skipIf(!RUN)("PactSessionAccount ↔ PACT encoders (anvil)", () => {
  let anvil: ChildProcess;
  // anvil's first two dev keys
  const owner = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
  const sessionPk = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
  const sessionKey = privateKeyToAccount(sessionPk).address;
  const transport = http(`http://127.0.0.1:${PORT}`);
  // Anvil runs as chain 8453 so the EIP-712 domains match Base.
  const chain = { ...foundry, id: 8453 } as const;
  const client = createTestClient({ chain, mode: "anvil", transport }).extend(publicActions);
  const wallet = createWalletClient({ chain, transport, account: owner });
  let factory: `0x${string}`;
  let implementation: `0x${string}`;
  let account: `0x${string}`;

  beforeAll(async () => {
    anvil = spawn(join(homedir(), ".foundry/bin/anvil"), ["--port", String(PORT), "--chain-id", "8453", "--hardfork", "prague"], { stdio: "ignore" });
    for (let i = 0; i < 50; i++) {
      try {
        await client.getBlockNumber();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    const artifact = JSON.parse(readFileSync(join(process.cwd(), "contracts/out/PactSessionAccount.sol/PactAccountFactory.json"), "utf8"));
    const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object as Hex, args: [FLASH_SPENDER, PERMIT2] });
    factory = (await client.waitForTransactionReceipt({ hash })).contractAddress!;
    implementation = await client.readContract({ address: factory, abi: FACTORY_ABI, functionName: "IMPLEMENTATION" });
    await client.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: factory, abi: FACTORY_ABI, functionName: "create", args: [owner.address] }) });
    account = await client.readContract({ address: factory, abi: FACTORY_ABI, functionName: "accountOf", args: [owner.address] });
  }, 30_000);

  afterAll(() => {
    anvil?.kill();
  });

  it("predicts the PACT wallet address the factory creates", () => {
    expect(predictAccount(factory, implementation, owner.address).toLowerCase()).toBe(account.toLowerCase());
  });

  it("accepts a TypeScript-made session signature on a Flash order in scope, and rejects outside it", async () => {
    const now = Number((await client.getBlock()).timestamp);
    const scope = scopeFor("base", { expiresAt: now + 86_400, maxPerOrderUsd: 50, maxPermitUsd: 200, ethPriceUsd: 2240 });
    await client.waitForTransactionReceipt({
      hash: await wallet.writeContract({ address: account, abi: ACCOUNT_ABI, functionName: "grantSession", args: [sessionKey, scope] }),
    });
    const [id] = await client.readContract({ address: account, abi: ACCOUNT_ABI, functionName: "sessionOf", args: [sessionKey] });
    expect(id).not.toBe(`0x${"0".repeat(64)}`);

    // Flash's real typed-data shape (DefinitiveFlashAllowance v1), funded by the PACT wallet.
    const typed = {
      domain: { name: "DefinitiveFlashAllowance", version: "1", chainId: 8453, verifyingContract: FLASH_SPENDER },
      types: {
        FlashOrder: [
          { name: "swapper", type: "address" },
          { name: "vault", type: "address" },
          { name: "recipient", type: "address" },
          { name: "fromToken", type: "address" },
          { name: "toToken", type: "address" },
          { name: "fromAmount", type: "uint256" },
          { name: "salt", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "FlashOrder",
      message: {
        swapper: account,
        vault: "0x1074393effFCf1A15e306cD3931F48eDA9ABcd55",
        recipient: account,
        fromToken: CHAINS.base.usdc,
        toToken: CHAINS.base.weth,
        fromAmount: "25000000",
        salt: "2168777390218388372292388557091935032106",
        deadline: String(now + 3600),
      },
    };
    const verify = async (t: typeof typed, pk: Hex = sessionPk) => {
      const digest = digestOf(t as never);
      const sig = serializeSignature(await sign({ hash: digest, privateKey: pk }));
      const blob = encodeSessionSignature(KIND_FLASH_ORDER, sessionKey, flashOrderPayload(t.message), sig);
      return client.readContract({ address: account, abi: ACCOUNT_ABI, functionName: "isValidSignature", args: [digest, blob] });
    };
    expect(scopeViolations(typed as never, account, scope, now)).toEqual([]);
    expect(await verify(typed)).toBe(MAGIC);

    const theft = { ...typed, message: { ...typed.message, recipient: owner.address } };
    expect(scopeViolations(theft as never, account, scope, now)).toContain("swapper or recipient is not the PACT wallet");
    expect(await verify(theft)).not.toBe(MAGIC);

    const big = { ...typed, message: { ...typed.message, fromAmount: "60000000" } };
    expect(scopeViolations(big as never, account, scope, now)).toContain("over the per-order cap");
    expect(await verify(big)).not.toBe(MAGIC);

    expect(await verify(typed, "0x" + "11".repeat(32) as Hex)).not.toBe(MAGIC);

    // The owner's own wallet signature still works (review mode).
    const digest = digestOf(typed as never);
    const ownerSig = await owner.sign({ hash: digest });
    expect(await client.readContract({ address: account, abi: ACCOUNT_ABI, functionName: "isValidSignature", args: [digest, ownerSig] })).toBe(MAGIC);
  });

  it("accepts a session-signed Permit2 permit for Flash within the cap", async () => {
    const now = Number((await client.getBlock()).timestamp);
    const scope = scopeFor("base", { expiresAt: now + 86_400, maxPerOrderUsd: 50, maxPermitUsd: 200, ethPriceUsd: 2240 });
    const permit = {
      domain: { name: "Permit2", chainId: 8453, verifyingContract: PERMIT2 },
      types: {
        PermitSingle: [
          { name: "details", type: "PermitDetails" },
          { name: "spender", type: "address" },
          { name: "sigDeadline", type: "uint256" },
        ],
        PermitDetails: [
          { name: "token", type: "address" },
          { name: "amount", type: "uint160" },
          { name: "expiration", type: "uint48" },
          { name: "nonce", type: "uint48" },
        ],
      },
      primaryType: "PermitSingle",
      message: {
        details: { token: CHAINS.base.usdc, amount: "100000000", expiration: String(now + 3600), nonce: "0" },
        spender: FLASH_SPENDER,
        sigDeadline: String(now + 3600),
      },
    };
    expect(scopeViolations(permit as never, account, scope, now)).toEqual([]);
    const digest = digestOf(permit as never);
    const sig = serializeSignature(await sign({ hash: digest, privateKey: sessionPk }));
    const blob = encodeSessionSignature(KIND_PERMIT2, sessionKey, permitPayload(permit.message), sig);
    expect(await client.readContract({ address: account, abi: ACCOUNT_ABI, functionName: "isValidSignature", args: [digest, blob] })).toBe(MAGIC);
  });
});
