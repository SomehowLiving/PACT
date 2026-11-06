<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## PACT UI rules (mandatory for frontend work)

Read `PACT_UI_DESIGN_RULES.md` before changing any screen. In short:

- **One navigation system, nothing listed twice** (`components/AppShell.tsx` is the single
  source): the header holds the five workspaces (Trade · Discover · Proposals · Portfolio ·
  Orders); the rail's top group is the sections of the current workspace; the rail's bottom
  group "You" is My Plans · Mandate · Settings on every page; the account menu holds only the
  wallet (value, desk, disconnect) and the tools. Every route belongs to exactly one of these,
  so the header or the rail always shows where the user is. A new page is added to that
  model, never as a second menu.
- **Look** (from the user's mockups): warm near-black surfaces, cream primary buttons,
  serif page and panel titles in Title Case that match the navigation label, pill chips,
  underline tabs, `.panel` surfaces. No glass, no purple or blue gradients, no numbered
  eyebrows.
- One canonical URL per object (leader `/leaders/[address]`, plan `/plans/[id]`, proposal
  `/review/[id]`, order `/orders/[id]`); filters, tabs and selection in the URL; back and
  forward work. Every leader is shown with `LeaderTag` / `leaderName`, never a bare address.
- Tables first, honest data only (no invented PnL, win rate or rankings; DEMO data labelled),
  and no backend, API, policy, Flash or signing changes as part of UI work.
- `node e2e/ui.e2e.mjs` enforces the navigation rules; keep it green.
