import { Attribution } from "ox/erc8021";
import { baseClient } from "./base-rpc";

/**
 * ERC-8021 builder attribution on Flash settlements.
 *
 * PACT sends its builder code on every copy (`erc8021AttributionCode` on `POST /order`). Flash
 * appends it to the settlement transaction's calldata as an ERC-8021 suffix, after Definitive's
 * own code: `codes ∥ codesLength ∥ schemaId ∥ 0x8021…8021`. Reading the suffix back from Base
 * proves, from the chain alone, that a fill was settled by Flash for a PACT copy.
 */

const CODE = /^[a-zA-Z0-9_.-]{1,32}$/;

/** PACT's registered builder code (env `FLASH_BUILDER_CODE`), if valid. */
export function builderCode(raw: string | undefined = process.env.FLASH_BUILDER_CODE): string | undefined {
  const code = raw?.trim();
  return code && CODE.test(code) ? code : undefined;
}

/** The attribution codes at the end of a transaction's calldata, or null when it has none. */
export function decodeAttribution(calldata: string): { codes: string[]; schema: number } | null {
  if (!/^0x[0-9a-fA-F]*$/.test(calldata)) return null;
  try {
    const found = Attribution.fromData(calldata as `0x${string}`);
    if (!found) return null;
    const codes = "codes" in found && Array.isArray(found.codes) ? found.codes.filter(Boolean) : [];
    return { codes, schema: found.id ?? 0 };
  } catch {
    return null;
  }
}

export type TxAttribution = {
  transactionId: string;
  /** STAMPED: the calldata carries ERC-8021 codes. NONE: it carries none. UNAVAILABLE: not read. */
  status: "STAMPED" | "NONE" | "UNAVAILABLE";
  codes: string[];
  /** PACT's own code is among them. */
  pact: boolean;
  error?: string;
};

// A settled transaction's calldata never changes: cache what was read.
const cache = new Map<string, TxAttribution>();

export async function txAttribution(
  transactionId: string,
  expectedCode = builderCode(),
  readInput: (hash: `0x${string}`) => Promise<string> = async (hash) => (await baseClient.getTransaction({ hash })).input,
): Promise<TxAttribution> {
  const key = transactionId.toLowerCase();
  const hit = cache.get(key);
  const withPact = (a: TxAttribution): TxAttribution => ({
    ...a,
    pact: !!expectedCode && a.codes.some((c) => c.toLowerCase() === expectedCode.toLowerCase()),
  });
  if (hit) return withPact(hit);
  if (!/^0x[0-9a-fA-F]{64}$/.test(transactionId)) {
    return { transactionId, status: "UNAVAILABLE", codes: [], pact: false, error: "not a transaction hash" };
  }
  try {
    const decoded = decodeAttribution(await readInput(transactionId as `0x${string}`));
    const result: TxAttribution = decoded
      ? { transactionId, status: "STAMPED", codes: decoded.codes, pact: false }
      : { transactionId, status: "NONE", codes: [], pact: false };
    cache.set(key, result);
    return withPact(result);
  } catch (e) {
    return { transactionId, status: "UNAVAILABLE", codes: [], pact: false, error: e instanceof Error ? e.message.slice(0, 160) : "read failed" };
  }
}
