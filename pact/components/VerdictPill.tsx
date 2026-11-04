import type { Verdict } from "@/lib/types";

const TONE: Record<Verdict, string> = {
  ALLOW: "bg-[#e8c9a0]/15 text-[#e8c9a0]",
  MODIFY: "bg-[#c084fc]/15 text-[#e9d5ff]",
  BLOCK: "bg-[#fb7185]/15 text-[#fb7185]",
};

export function VerdictPill({ verdict }: { verdict: Verdict }) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-wide ${TONE[verdict]}`}
    >
      {verdict}
    </span>
  );
}
