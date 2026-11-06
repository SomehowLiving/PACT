import { ethUsdReference } from "./oracle";
import { seedDemo, snapshot } from "./store";

/** Today's WETH price from Chainlink on Base, or undefined within 4 s (then DEMO levels are fixed). */
export async function demoPrice() {
  return Promise.race([
    ethUsdReference().then((r) => r.price).catch(() => undefined),
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 4000)),
  ]);
}

let seeding: Promise<unknown> | undefined;

/**
 * Hosted deployments start with an empty store. With PACT_AUTOSEED=1 the first read seeds the
 * live-priced DEMO desks once, so a visitor never lands on an empty Discover.
 */
export async function autoseedIfEmpty() {
  if (process.env.PACT_AUTOSEED !== "1" || snapshot().strategies.length) return;
  seeding ??= demoPrice()
    .then((price) => seedDemo({ price }))
    .finally(() => {
      seeding = undefined;
    });
  await seeding;
}
