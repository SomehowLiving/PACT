export function shortAddr(addr?: string) {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function usd(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n >= 100 ? 0 : 2,
  });
}

export function reasonLabel(code: string) {
  return code.replaceAll("_", " ").toLowerCase();
}
