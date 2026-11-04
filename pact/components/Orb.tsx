export function Orb({ size = 72 }: { size?: number }) {
  return (
    <div
      className="orb"
      style={{ width: size, height: size }}
      aria-hidden
    />
  );
}
