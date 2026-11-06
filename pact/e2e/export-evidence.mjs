// Saves the evidence bundle for one submitted Flash order to evidence/<orderId>.json.
// Usage (with `npm run dev` running): npm run evidence -- <flashOrderId> [baseUrl]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [orderId, base = "http://localhost:3000"] = process.argv.slice(2);
if (!orderId) {
  console.error("usage: npm run evidence -- <flashOrderId> [baseUrl]");
  process.exit(1);
}

const res = await fetch(`${base}/api/orders/${encodeURIComponent(orderId)}/evidence`);
const bundle = await res.json();
if (!res.ok) {
  console.error(`evidence export failed (${res.status}):`, bundle.error ?? bundle);
  process.exit(1);
}

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "evidence");
mkdirSync(dir, { recursive: true });
const file = join(dir, `${orderId}.json`);
writeFileSync(file, `${JSON.stringify(bundle, null, 2)}\n`);

const f = bundle.fidelity;
console.log(`saved ${file}`);
console.log(`flash live: ${bundle.flash.live}${bundle.flash.error ? ` (${bundle.flash.error})` : ""}`);
console.log(`status: ${bundle.pact.receipt.status ?? "?"} · close: ${bundle.pact.receipt.closeReason ?? "-"}`);
console.log(`fills: ${f.fillCount}${f.twapBucketCount ? ` / ${f.twapBucketCount} buckets` : ""}`);
console.log(
  `declared ${f.declaredEntryPrice ?? "-"} · quoted ${f.quotedExecutionPrice ?? "-"} · avg fill ${f.averageFillPrice ?? "-"} · drift ${f.entryDriftBps === undefined ? "-" : `${f.entryDriftBps.toFixed(1)} bps`}`,
);
for (const tx of bundle.transactions) console.log(`tx ${tx.explorer}`);
