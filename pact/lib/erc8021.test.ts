import { Attribution } from "ox/erc8021";
import { describe, expect, it } from "vitest";
import { builderCode, decodeAttribution, txAttribution } from "./erc8021";

// Some settlement calldata, then the ERC-8021 Schema-0 suffix Flash appends (Definitive's code first).
const CALL = "0xa9059cbb000000000000000000000000000000000000000000000000000000000000dead";
const stamped = (codes: string[]) => (CALL + Attribution.toDataSuffix({ codes }).slice(2)) as `0x${string}`;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

describe("ERC-8021 attribution on Flash settlements", () => {
  it("decodes the builder codes appended to a transaction's calldata", () => {
    expect(decodeAttribution(stamped(["definitive", "pactfi"]))).toEqual({ codes: ["definitive", "pactfi"], schema: 0 });
  });

  it("finds nothing on calldata without the ERC-8021 marker", () => {
    expect(decodeAttribution(CALL)).toBeNull();
    expect(decodeAttribution("0x")).toBeNull();
    expect(decodeAttribution("not hex")).toBeNull();
  });

  it("accepts only codes Flash accepts: 1–32 of [a-zA-Z0-9_.-], no commas", () => {
    expect(builderCode("pactfi")).toBe("pactfi");
    expect(builderCode(" pact.fi ")).toBe("pact.fi");
    expect(builderCode("a,b")).toBeUndefined();
    expect(builderCode("")).toBeUndefined();
    expect(builderCode("x".repeat(33))).toBeUndefined();
  });

  it("marks a settlement as PACT's only when PACT's own code is in it", async () => {
    const read = async () => stamped(["definitive", "pactfi"]);
    expect(await txAttribution(hash(1), "pactfi", read)).toMatchObject({ status: "STAMPED", codes: ["definitive", "pactfi"], pact: true });
    expect(await txAttribution(hash(2), "someoneelse", async () => stamped(["definitive"]))).toMatchObject({ status: "STAMPED", pact: false });
    expect(await txAttribution(hash(3), "pactfi", async () => CALL)).toMatchObject({ status: "NONE", pact: false });
  });

  it("reports a failed read as UNAVAILABLE, never as 'not attributed'", async () => {
    const failing = async (): Promise<string> => {
      throw new Error("rpc down");
    };
    expect(await txAttribution(hash(4), "pactfi", failing)).toMatchObject({ status: "UNAVAILABLE", pact: false });
    expect((await txAttribution("0x123", "pactfi")).status).toBe("UNAVAILABLE");
  });
});
