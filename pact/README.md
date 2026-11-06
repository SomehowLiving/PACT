# PACT app

The PACT trading terminal, its API, and the Autopilot contracts. Product documentation lives in
[`../docs`](../docs/README.md).

## Run

```bash
cp .env.example .env.local   # set FLASH_API_KEY (see ../docs/operations.md)
npm install
npm run dev                  # http://localhost:3000
```

## Layout

```text
app/          routes: pages and /api handlers
components/   the terminal UI (AppShell, pages, panels)
lib/          layers L0–L6: adapters, store and evidence log, domain, signals, policy,
              execution, authority (sessions, guard, Autopilot, World ID)
contracts/    PactSessionAccount and PactAccountFactory (Foundry)
e2e/          end-to-end suites (follower flow, UI, World ID)
specs/        policy test vectors
```

See [Architecture](../docs/architecture.md) for what each layer may and may not do.

## Test

```bash
npm test && npm run lint && npx tsc --noEmit
npm run e2e          # against a running server (PACT_URL)
node e2e/ui.e2e.mjs
```

Full matrix, including live Flash, Foundry and the World ID suite:
[Operations](../docs/operations.md#tests).

## Working notes

- `AGENTS.md` and `PACT_UI_DESIGN_RULES.md`: rules for changing the code and the UI.
- `IMPLEMENTATION_STATUS.md`: the build log, step by step, with test results.
