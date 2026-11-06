<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## PACT UI rules (mandatory for frontend work)

Read `PACT_UI_DESIGN_RULES.md` before changing any screen. In short: one global navigation
(Trade · Discover · Plans · Portfolio · Orders in the header; local tabs inside each
workspace; everything else in the account menu), one canonical URL per object (leader,
plan, proposal, order, receipt), tables first, honest data only (no invented PnL, win rate
or rankings; DEMO data labelled), and no backend, API, policy, Flash or signing changes as
part of UI work.
