import type { CopyAction, Verdict } from "@/lib/types";

const TONE: Record<CopyAction, string> = {
  COPY: "bg-[#e8c9a0]/15 text-[#e8c9a0]",
  SCALE: "bg-[#c084fc]/15 text-[#e9d5ff]",
  WAIT: "bg-sky-300/15 text-sky-200",
  DECLINE: "bg-[#fb7185]/15 text-[#fb7185]",
  REVIEW: "bg-amber-300/15 text-amber-100",
};

function fallback(verdict?: Verdict): CopyAction {
  if (verdict === "MODIFY") return "SCALE";
  if (verdict === "BLOCK") return "DECLINE";
  return "COPY";
}

export function CopyActionPill({
  action,
  verdict,
}: {
  action?: CopyAction;
  verdict?: Verdict;
}) {
  const value = action ?? fallback(verdict);
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-wide ${TONE[value]}`}
    >
      {value}
    </span>
  );
}
