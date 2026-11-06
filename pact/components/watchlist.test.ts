import { describe, expect, it } from "vitest";
import { parseWatchlist } from "@/components/watchlist";

const A = "0x1111111111111111111111111111111111111111";
const B = "0xAbCdEf0000000000000000000000000000000001";

describe("parseWatchlist", () => {
  it("keeps valid addresses, lowercased and deduplicated", () => {
    expect(parseWatchlist(JSON.stringify([A, B, B.toLowerCase()]))).toEqual([A, B.toLowerCase()]);
  });

  it("drops anything that is not an address", () => {
    expect(parseWatchlist(JSON.stringify([A, "0x12", 42, null, { a: 1 }]))).toEqual([A]);
  });

  it("treats corrupt or non-array storage as empty", () => {
    expect(parseWatchlist("not json")).toEqual([]);
    expect(parseWatchlist(JSON.stringify({ list: [A] }))).toEqual([]);
  });
});
