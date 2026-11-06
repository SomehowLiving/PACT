"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/settings/wallet", label: "Wallet & Autopilot" },
  { href: "/settings/preferences", label: "Preferences" },
];

/** Local tabs of Settings (the rail's "Settings"); real links, so back and forward work. */
export function SettingsTabs() {
  const path = usePathname();
  return (
    <nav aria-label="Settings sections" className="utabs mb-6">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={path === t.href ? "page" : undefined} data-on={path === t.href}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
