import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decide } from "./policy";
import type { Policy, OrderType, Proposal, Side } from "./types";

const root = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(
  readFileSync(join(root, "../specs/policy-cases.json"), "utf8"),
) as {
  policy: Omit<Policy, "follower">;
  cases: {
    name: string;
    dailySpentUsd: number;
    proposal: {
      chain: "base";
      targetAsset: string;
      contraAsset: string;
      side: Side;
      orderType: OrderType;
      qty: string;
      notionalUsd: number;
      maxSlippage?: string;
      maxPriceImpact?: string;
      durationSeconds?: number;
      limitNotionalPrice?: string;
    };
    expect: {
      verdict: "ALLOW" | "MODIFY" | "BLOCK";
      reasons?: string[];
      reasonsInclude?: string[];
      modifiedQty?: string;
    };
  }[];
};

const policy = { ...raw.policy, follower: "0x0000000000000000000000000000000000000001" as const };

describe("decide", () => {
  for (const c of raw.cases) {
    it(c.name, () => {
      const proposal = c.proposal as Pick<
        Proposal,
        | "chain"
        | "targetAsset"
        | "contraAsset"
        | "side"
        | "orderType"
        | "qty"
        | "notionalUsd"
        | "maxSlippage"
        | "maxPriceImpact"
      >;
      const got = decide(proposal, policy, c.dailySpentUsd);
      expect(got.verdict).toBe(c.expect.verdict);
      if (c.expect.reasons) {
        expect(got.reasons).toEqual(c.expect.reasons);
      }
      if (c.expect.reasonsInclude) {
        for (const code of c.expect.reasonsInclude) {
          expect(got.reasons).toContain(code);
        }
      }
      if (c.expect.modifiedQty) {
        expect(got.modifiedQty).toBe(c.expect.modifiedQty);
      }
    });
  }
});
