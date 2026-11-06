import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { beforeAll, describe, expect, it } from "vitest";

process.env.PACT_STORE_FILE = join(tmpdir(), `pact-session-test-${process.pid}`, "store.json");
process.env.PACT_SESSION_SECRET = "test-secret-not-for-production";

type SessionModule = typeof import("./session");
let s: SessionModule;
beforeAll(async () => {
  s = await import("./session");
});

const site = "http://localhost:3000";
const req = (init: { cookie?: string; host?: string } = {}) =>
  new Request(`${site}/api/session`, {
    headers: { host: init.host ?? "localhost:3000", ...(init.cookie ? { cookie: init.cookie } : {}) },
  });

describe("session tokens", () => {
  it("round-trips an address and rejects tampering and expiry", () => {
    const now = Date.parse("2026-11-06T10:00:00Z");
    const { token, session } = s.issueToken("0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD", now);
    expect(session.address).toBe("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
    expect(s.readToken(token, now)?.address).toBe(session.address);
    expect(s.readToken(token, now + s.SESSION_TTL_MS + 1)).toBeNull();
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ a: "0x" + "1".repeat(40), e: now + 1e9 })).toString("base64url");
    expect(s.readToken(`${forged}.${sig}`, now)).toBeNull();
    expect(s.readToken(`${payload}.${sig.slice(0, -2)}AA`, now)).toBeNull();
    expect(s.readToken("garbage", now)).toBeNull();
  });
});

describe("sign-in", () => {
  it("accepts a wallet's signature over the message it was issued, once", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const message = s.signInMessage(req(), account.address);
    expect(message).toContain("localhost:3000 wants you to sign in");
    expect(message).toContain("Chain ID: 8453");
    expect(message).toContain("cannot move funds");
    const signature = await account.signMessage({ message });

    const first = await s.completeSignIn(req(), message, signature);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.session.address).toBe(account.address.toLowerCase());

    const replay = await s.completeSignIn(req(), message, signature);
    expect(replay).toMatchObject({ ok: false });
  });

  it("refuses a signature from another wallet", async () => {
    const owner = privateKeyToAccount(generatePrivateKey());
    const other = privateKeyToAccount(generatePrivateKey());
    const message = s.signInMessage(req(), owner.address);
    const result = await s.completeSignIn(req(), message, await other.signMessage({ message }));
    expect(result).toEqual({ ok: false, error: "signature does not match the address" });
  });

  it("refuses a message issued for another site", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const message = s.signInMessage(req({ host: "evil.example" }), account.address);
    const result = await s.completeSignIn(req(), message, await account.signMessage({ message }));
    expect(result).toEqual({ ok: false, error: "sign-in message does not match this site" });
  });

  it("refuses a nonce it never issued", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const message = s.signInMessage(req(), account.address).replace(/Nonce: \w+/, "Nonce: abcdefgh12345678");
    const result = await s.completeSignIn(req(), message, await account.signMessage({ message }));
    expect(result).toMatchObject({ ok: false });
  });
});

describe("requireOwner", () => {
  it("is 401 without a session, 403 for another wallet, and passes for the owner", async () => {
    const owner = "0x" + "ab".repeat(20);
    const { token } = s.issueToken(owner);
    expect(s.requireOwner(req(), owner)?.status).toBe(401);
    const cookie = `other=1; ${s.SESSION_COOKIE}=${token}`;
    const mismatch = s.requireOwner(req({ cookie }), "0x" + "cd".repeat(20));
    expect(mismatch?.status).toBe(403);
    expect(await mismatch?.json()).toMatchObject({ code: "SESSION_MISMATCH" });
    expect(s.requireOwner(req({ cookie }), owner.toUpperCase().replace("0X", "0x"))).toBeNull();
  });
});
