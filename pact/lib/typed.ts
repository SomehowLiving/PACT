export type ParsedTyped = {
  domain: Record<string, unknown>;
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
};

/**
 * Flash returns typed data as a JSON string with `domain.chainId` as a string ("8453").
 * viem only folds a numeric chainId into the EIP-712 domain hash, so a string chainId yields a
 * signature Flash rejects ("signature verification failed"). Coerce it before signing.
 */
export function parseOrderTypedData(raw: string): ParsedTyped {
  const typed = JSON.parse(raw) as ParsedTyped;
  const types = { ...typed.types };
  delete types.EIP712Domain;
  const domain = { ...typed.domain };
  if (domain.chainId !== undefined && domain.chainId !== null) {
    const id = Number(domain.chainId);
    if (Number.isSafeInteger(id)) domain.chainId = id;
  }
  return {
    domain,
    types,
    primaryType: typed.primaryType,
    message: typed.message,
  };
}

// Cancel signs a plaintext EIP-191 message with the funder wallet (gasless). The em dash and
// the single newline are validated byte-for-byte by Flash.
export function cancelMessage(orderId: string) {
  return `Definitive Flash v1 — Cancel Order\nOrder: ${orderId}`;
}

/**
 * Batch cancel (up to 25 orders, one signature). Flash's format: header, "Orders:", then one
 * lowercase UUID per line in request order, no trailing newline.
 */
export function batchCancelMessage(orderIds: string[]) {
  if (orderIds.length < 1 || orderIds.length > 25) throw new Error("batch cancel takes 1–25 orders");
  return `Definitive Flash v1 — Cancel Orders\nOrders:\n${orderIds.map((id) => id.toLowerCase()).join("\n")}`;
}
