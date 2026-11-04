export type ParsedTyped = {
  domain: Record<string, unknown>;
  types: Record<string, { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
};

export function parseOrderTypedData(raw: string): ParsedTyped {
  const typed = JSON.parse(raw) as ParsedTyped;
  const types = { ...typed.types };
  delete types.EIP712Domain;
  return {
    domain: typed.domain,
    types,
    primaryType: typed.primaryType,
    message: typed.message,
  };
}

// Cancel signs a plaintext EIP-191 message with the funder wallet (gasless). The em dash and
// the single newline are validated byte-for-byte by Flash.
export function cancelMessage(orderId: string) {
  return `Definitive Flash v1 \u2014 Cancel Order\nOrder: ${orderId}`;
}
