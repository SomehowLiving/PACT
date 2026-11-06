"use client";

import { PageHeader, Panel, Planned, Segmented, StatusBadge } from "@/components/ui";
import { useEffect, useState, type ReactNode } from "react";

/* Per-browser display preferences. Stored in localStorage only; nothing here
   changes a mandate, a policy decision, or execution. */

const KEY = "pact.prefs";

type Prefs = {
  landing: "overview" | "proposals" | "execution";
  density: "comfortable" | "compact";
  numbers: "standard" | "compact";
  showDemoDesks: boolean;
};

const DEFAULTS: Prefs = { landing: "overview", density: "comfortable", numbers: "standard", showDemoDesks: true };

function read(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function Preferences() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [storage, setStorage] = useState<"unknown" | "ok" | "unavailable">("unknown");

  useEffect(() => {
    // Load after hydration so the first render matches the server.
    const id = setTimeout(() => {
      setPrefs(read());
      try {
        localStorage.setItem(`${KEY}.probe`, "1");
        localStorage.removeItem(`${KEY}.probe`);
        setStorage("ok");
      } catch {
        setStorage("unavailable");
      }
    }, 0);
    return () => clearTimeout(id);
  }, []);

  function update(next: Partial<Prefs>) {
    const merged = { ...prefs, ...next };
    setPrefs(merged);
    try {
      localStorage.setItem(KEY, JSON.stringify(merged));
    } catch {
      setStorage("unavailable");
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Workspace settings"
        title="Preferences"
        description="Display choices for this browser only. They never change your mandate, a policy decision, or an order."
        actions={
          storage === "unavailable" ? (
            <StatusBadge tone="warn" icon="!">
              browser storage blocked
            </StatusBadge>
          ) : null
        }
      />

      <Panel title="Display" subtitle="Saved in this browser's local storage" bodyClassName="px-4">
        <Row
          title="Default landing view"
          help="Which page / opens to."
          status="stored"
          control={
            <Segmented
              value={prefs.landing}
              onChange={(landing) => update({ landing })}
              options={[
                { value: "overview", label: "Overview" },
                { value: "proposals", label: "Proposals" },
                { value: "execution", label: "Execution" },
              ]}
            />
          }
        />
        <Row
          title="Table density"
          help="Row height in Discover, Proposals and Execution tables."
          status="stored"
          control={
            <Segmented
              value={prefs.density}
              onChange={(density) => update({ density })}
              options={[
                { value: "comfortable", label: "Comfortable" },
                { value: "compact", label: "Compact" },
              ]}
            />
          }
        />
        <Row
          title="Number format"
          help="Full values ($1,234.56) or compact ($1.2K) in tables."
          status="stored"
          control={
            <Segmented
              value={prefs.numbers}
              onChange={(numbers) => update({ numbers })}
              options={[
                { value: "standard", label: "Standard" },
                { value: "compact", label: "Compact" },
              ]}
            />
          }
        />
        <Row
          title="Demo desks in the Viewing selector"
          help="Seeded demo desks are always labelled DEMO and read-only."
          status="stored"
          control={
            <label className="flex items-center gap-2 text-[12.5px] text-ink">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--accent-strong)]"
                checked={prefs.showDemoDesks}
                onChange={(e) => update({ showDemoDesks: e.target.checked })}
              />
              Show
            </label>
          }
        />
      </Panel>

      <p className="mt-3 text-[11.5px] text-mute">
        These choices are saved now; pages adopt them in a later UI pass. Until then, every page uses the defaults shown above.
      </p>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Planned title="Notifications">Browser or Telegram alerts when a plan is queued for review or an order fills. Not built.</Planned>
        <Planned title="Light theme">PACT ships a dark terminal theme only.</Planned>
      </div>
    </div>
  );
}

function Row({ title, help, control, status }: { title: string; help: string; control: ReactNode; status: "stored" }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-2 py-3.5 last:border-b-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[13px] text-ink">
          {title}
          <span className="rounded bg-panel-3 px-1.5 py-0.5 text-[10.5px] font-medium text-mute" title="Saved, not yet applied by pages">
            {status} · not yet applied
          </span>
        </div>
        <div className="mt-0.5 text-[11.5px] text-mute">{help}</div>
      </div>
      <div className="max-w-full overflow-x-auto">{control}</div>
    </div>
  );
}
