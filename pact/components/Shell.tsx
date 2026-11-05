"use client";

import { Connect } from "@/components/Connect";
import { Mark } from "@/components/Mark";
import { Orb } from "@/components/Orb";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "portfolio" },
  { href: "/leader", label: "publish" },
  { href: "/follower", label: "mandates" },
  { href: "/history", label: "activity" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();

  return (
    <div className="relative mx-auto flex min-h-screen max-w-[1180px] flex-col px-4 pb-8 pt-5">
      <header className="flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-3">
          <Mark size={34} />
          <div className="leading-none">
            <div className="font-[family-name:var(--font-serif)] text-[26px] italic tracking-tight">
              pact
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-[0.22em] text-mute">
              strategy execution
            </div>
          </div>
        </Link>

        <nav className="hidden items-center rounded-full bg-black/25 p-1 hairline md:flex">
          {NAV.map((n) => {
            const on = path === n.href;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`rounded-full px-4 py-1.5 text-[13px] ${
                  on ? "bg-white/10 text-ink" : "text-mute"
                }`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>

        <Connect />
      </header>

      <main className="mt-8 flex-1">{children}</main>

      <nav className="mx-auto mt-8 mb-3 flex w-full max-w-[420px] items-center justify-between rounded-full bg-black/55 px-5 py-2.5 hairline backdrop-blur-xl md:hidden">
        <Link href="/" className={path === "/" ? "text-ink" : "text-mute"}>
          home
        </Link>
        <Link
          href="/leader"
          className={path === "/leader" ? "text-ink" : "text-mute"}
        >
          lead
        </Link>
        <Link href="/follower" className="-my-3">
          <Orb size={46} />
        </Link>
        <Link
          href="/follower"
          className={path === "/follower" ? "text-ink" : "text-mute"}
        >
          copy
        </Link>
        <Link
          href="/history"
          className={path === "/history" ? "text-ink" : "text-mute"}
        >
          activity
        </Link>
      </nav>
    </div>
  );
}
