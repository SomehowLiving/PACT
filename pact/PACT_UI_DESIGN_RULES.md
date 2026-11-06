# PACT UI Design Rules

**Purpose:** Establish a consistent, familiar trading-terminal experience for PACT by borrowing proven interface conventions from established trading and copy-trading products.

**Scope:** Frontend structure, navigation, interaction patterns, visual hierarchy, and UI quality. This document does not authorize backend, API, database, policy-engine, or execution-flow changes.

## 1. Product design principle

> Familiar chrome, novel panels.

PACT should look and behave like a trading product users already know. Keep the global shell, market workspace, tables, filters, tabs, order details, and account controls familiar. Spend the novelty budget only on PACT-specific capabilities: follower-owned mandates, policy decisions, copyability, quote-time checks, signing safeguards, and execution-fidelity evidence.

Do not invent a new navigation metaphor or redesign common trading controls merely to make the interface look different.

## 2. Reference map: learn from whom

| Reference | Learn from it | Apply to PACT | Do not copy |
|---|---|---|---|
| Hyperliquid | Compact trading shell, chart-first workspace, persistent account context, bottom activity areas | Trade workspace and persistent application chrome | Perpetuals/leverage concepts that PACT does not support |
| Binance Spot / Bybit Trading | Instrument header, chart, order book, order-entry hierarchy, open orders and history | Familiar market and order conventions | Exchange-specific controls or unsupported order types |
| Axiom | Wallet search, leaderboard tables, filters, sorting, contextual wallet analysis | Discover Leaders and Leader Profile | Unsupported rankings or arbitrary leader scores |
| GMGN | Dense wallet tables, classification filters, separate tracking and copy actions | Leader discovery, watchlists and quick actions | Market-feed clutter, social-feed clutter and unnecessary toolbars |
| Binance Copy Trading | Leader marketplace, trader profiles, allocation setup, copy-management views | Follow configuration and leader management | Automatic copying or assumptions about custody and execution |
| Bybit Copy Trading | Separation between public discovery and private follower management | Discover vs Following vs Proposals separation | Mandatory subaccounts or application flows not required by PACT |
| Tread FI | Order detail workspace, execution trajectory, fill records and price comparisons | Flash Order Detail and Execution Receipt | Benchmarks, fee breakdowns or venue analytics Flash does not provide |

Borrow interaction patterns and information hierarchy, not logos, branding, proprietary illustrations, or pixel-perfect copies.

## 3. Global application shell

Use one persistent global navigation system. Do not repeat the same destinations in a top navigation and a sidebar.

Recommended primary navigation:

- **Trade** — market terminal and market context.
- **Discover** — leader directory, following list, and watchlist.
- **Plans** — follower proposal inbox and the user's published plans.
- **Portfolio** — positions, exposure, concentration, and capacity.
- **Orders** — working orders, order history, and execution receipts.

Keep wallet connection, active network, notifications, and account/settings controls in the global header. Make **Mandate** reachable from the account/workspace controls and from relevant risk summaries. Do not make PACT Assist a separate global destination; it belongs in the Plans/Proposals workflow.

**As built (Nov 6, 2026, with the user's mockups):** the header shows the five workspaces,
with "Plans" named **Proposals**. A left rail carries local navigation: its top group is the
current workspace's sections (Discover: Leaders · Following · Watchlist; Proposals: Proposal
inbox · PACT Assist; Portfolio: Positions & exposure · Desk overview; Orders: Orders &
receipts · Activity log). Its bottom group "You" (My Plans · Mandate · Settings) is the
account/workspace control for what belongs to the user. The account menu holds the wallet and
the tools only, so no destination appears twice. Trade has no rail (full-width terminal).

Within a workspace, use local tabs for views of the same dataset or object:

- Discover: All / Following / Watchlist.
- Plans: Proposal Inbox / My Published Plans.
- Portfolio: Positions / Exposure / By Leader.
- Orders: Working / History / Receipts.
- Leader Profile: Overview / Plans / Execution / Evidence.
- Order Detail: Summary / Fills / Policy / Raw Evidence, where data exists.

The shell stays stable when changing workspaces. Only the main workspace and its contextual panels change.

## 4. Layout conventions

### Trade workspace

Use the familiar exchange layout:

- Instrument selector and market summary at the top.
- Main chart in the largest central region.
- Right contextual panel for the selected PACT plan, mandate impact, or quote review.
- Lower tabbed workspace for Incoming Plans, Open Orders, and Recent Fills.
- Market/order-book elements only when supported by real data and useful to the selected market.

PACT's right panel should explain the leader plan and the follower-specific policy outcome. It must not pretend to be a generic buy/sell ticket if the action actually requires a proposal review and explicit wallet signing.

### Discovery workspace

Use a table-first layout inspired by Axiom and GMGN:

- Search and common filter chips above the table.
- Compact, sortable columns with stable widths.
- One row per leader.
- Quick actions in a dedicated final column.
- Optional selected-leader summary drawer for quick inspection.
- Clicking the leader identity opens its canonical profile route.

Use cards only for a small featured/curated section or when comparing a few leaders. Do not turn a large directory into a wall of identical cards.

### Proposal workspace

Use a dense decision queue, not large repeated cards. Provide filters for All, COPY, SCALE, WAIT, REVIEW, and DECLINE. Each row should show the plan, leader, asset, side, policy decision, approved size if applicable, reason, expiry, and one clear action.

### Proposal Review workspace

Keep three evidence groups visually distinct:

1. **Leader declaration** — what the leader published.
2. **Your order** — what the follower's mandate allows, including adjusted size and effective price bound.
3. **Policy checks** — rules that passed or blocked the proposal.

Market context, Flash quote data, and signing-payload checks must be visually distinguishable from the leader declaration and policy decision.

### Portfolio workspace

Separate approved-but-unsigned capacity from live Flash exposure. Use Positions / Exposure / By Leader tabs. Position rows link to the corresponding order detail; leader names link to the leader profile; risk metrics link to mandate controls.

### Order and receipt workspace

Use Tread-style order-level drilldown:

- Order summary and state.
- TWAP progress and individual fills when available.
- Declared entry vs Flash quote vs average fill.
- Entry drift and quote impact.
- Transaction hashes and explorer links.
- Exportable evidence bundle.

Only show analytics supported by Flash receipts or clearly labelled market context. Do not fabricate VWAP, markout, maker/taker, venue split, or other execution metrics.

## 5. Navigation and linking rules

Every important object has one canonical detail destination. Other screens may show a compact summary, but must link to that destination rather than duplicating the complete object UI.

| Object | Canonical destination | Link from |
|---|---|---|
| Leader | Leader Profile | Discover, Following, proposal rows, portfolio attribution |
| Plan | Plan Detail | Leader Profile, My Published Plans, proposal review |
| Proposal | Proposal Review | Proposal Inbox, dashboard queue, Assist queue |
| Flash Order | Order Detail | Orders, portfolio position, receipt |
| Receipt | Execution Evidence | Order Detail, Orders history |

Recommended frontend route model (adapt names to the existing router; do not change backend endpoints):

- `/trade`
- `/discover?view=all|following|watchlist`
- `/leaders/:walletAddress`
- `/plans?view=inbox|published`
- `/plans/:planId`
- `/proposals/:proposalId`
- `/portfolio?tab=positions|exposure|leaders`
- `/orders?view=working|history|receipts`
- `/orders/:orderId`
- `/mandate`

Search terms, filters, sorting, active tabs, and pagination should be reflected in URL query parameters when practical. Deep links must load the intended object directly. Browser Back/Forward must work. A detail drawer may provide quick inspection, but a full detail page should have a shareable URL.

## 6. Interaction taxonomy

Do not make every badge, row, tab, and button behave the same way. Each UI element has one interaction type.

| Element type | Examples | Required behaviour |
|---|---|---|
| Global navigation | Trade, Discover, Plans | Navigate to a workspace |
| Local tab | Overview, Plans, Fills | Change the current object's/workspace's view |
| Filter chip | ETH, TWAP, Following, COPY | Filter the current dataset; preserve state in URL where practical |
| Sort control | Recent, plan quality | Reorder the current dataset |
| Search | Wallet, asset, plan | Filter or locate records; never silently trigger an action |
| Object link | Leader name, plan title, order ID | Navigate to canonical detail destination |
| Action button | Follow, Publish, Request Quote, Sign, Cancel | Perform the named operation and show its resulting state |
| Status badge | LIVE, FILLED, EXPIRED | Display state; not clickable unless an explicit explanation is available |
| Evidence badge | ORDER_FOUND, UNVERIFIED | Open a factual evidence explanation |
| Decision badge | COPY, SCALE, WAIT, REVIEW, DECLINE | Show decision explanation or filter queue; never imply an order has executed |
| Overflow menu | Pause, Resume, Unfollow, Export | Show contextual actions for that object only |

Use explicit action labels: “Follow”, “Save mandate”, “Publish plan”, “Request Flash quote”, “Sign with wallet”, “Cancel order”, “Export evidence”. Avoid vague labels such as “Continue”, “Submit”, or “Manage” when the actual action is known.

## 7. Leader and follower flows

### Becoming a leader

PACT currently does not specify a separate leader application or approval process. A connected wallet address is used as the leader identity. The leader opens Plans → My Published Plans → Publish Plan, enters the structured plan, reviews validation and quality, and publishes. Do not invent a verification application, approval badge, or signed-authentication claim that is not implemented.

### Following a leader

Follow is not trade execution. Clicking Follow opens a configuration flow for sizing mode/value, daily sleeve, permitted order types, and exit mode. Show a live copyability preview using the current mandate. Confirming Follow saves the leader-specific mandate; it does not request a quote or place an order.

### Receiving and reviewing a proposal

A published plan creates an independently evaluated proposal for each follower. Only COPY and SCALE can proceed to normal review. WAIT, REVIEW, and DECLINE must explain the reason and must not show a signing action.

### Quote and signing

Keep Request Quote separate from Sign with Wallet. Re-check the actual Flash quote against entry drift and impact limits. Run the browser signature guard on the raw payload before any wallet prompt. A policy decision is not a quote, and a quote is not a signed or executed order.

### Execution and intervention

Track actual Flash order states and fills. Pause stops new copies but does not cancel live orders. Cancel requires the follower's explicit signed cancellation. Never imply that Assist can quote, sign, submit, cancel, or alter a mandate.

## 8. Data truth and status rules

- Never invent PnL, win rate, Sharpe, drawdown, correlation, ranking, or “safe leader” scores.
- Clearly label seeded/demo data as DEMO. Do not mix demo values with live data without a prominent distinction.
- Distinguish declaration, policy, market context, and execution facts.
- `ORDER_FOUND` means Flash found an order under the leader's wallet. It does not prove that all published plan fields match that order.
- `COPY` means policy allows the proposed size. `SCALE` means policy modified the size. Neither means signed, submitted, or filled.
- Keep plan quality (DISCIPLINED / CAUTION / INCOMPLETE), evidence (ORDER_FOUND / UNVERIFIED), policy decision (COPY / SCALE / WAIT / REVIEW / DECLINE), and Flash order status (pending / accepted / partially filled / filled / cancelled / rejected / terminated) as separate concepts.
- If a metric or feature is not backed by the current API/receipt data, omit it or show “Not available”; do not create a placeholder statistic that looks real.

## 9. Visual system rules

- Preserve familiar trading-terminal proportions and hierarchy; desktop-first for dense trading workspaces.
- Prefer tables for analysis, charts for time-series/market context, and cards for a small number of featured/repeated entities.
- Do not put every field inside its own card. Use grouped sections, table rows, separators, and contextual panels.
- Use consistent column widths, right-align numeric values, and use tabular numerals for prices, quantities, balances, and timestamps.
- Use semantic status colors consistently: green for allowed/success, amber for caution/review, red for blocked/error, neutral for informational states. Never communicate status through color alone; include text.
- Keep borders and surface contrast clear enough to distinguish related panels without excessive shadows, gradients, glass effects, or decorative backgrounds.
- Use compact but readable typography. Do not shrink critical financial values or table text to fit a mockup.
- Tooltips explain secondary metrics; labels and units remain visible for critical figures.
- Use motion only for meaningful state transitions, panel opening, loading, and confirmation. Respect reduced-motion preferences.

## 10. Backend-safe implementation rules

- Treat the existing backend, API contracts, persistence, policy engine, Flash integration, and signing flow as fixed.
- Frontend work may add route structure, layouts, components, URL state, and client-side presentation using existing endpoints and response fields.
- Do not rename, replace, or add API endpoints without explicit approval.
- Do not change request/response schemas, policy rules, sizing calculations, order construction, signatures, or execution sequencing.
- Do not simulate successful signing, order submission, fills, or wallet connection in production UI.
- If the backend does not expose a required field, surface the limitation rather than inventing the data.

## 11. Skills for AI-assisted implementation

Install only the skills that match the actual project stack and coding agent. Review skill instructions before use; do not install every skill in a repository.

### Recommended core set

```bash
# UI/UX patterns, structure, charts, accessibility and stack-specific guidance
npx skills add https://github.com/nextlevelbuilder/ui-ux-pro-max-skill --skill ui-ux-pro-max

# UI quality review: accessibility, interactions, navigation and visual best practices
npx skills add https://github.com/vercel-labs/agent-skills --skill web-design-guidelines

# React/Next performance rules (use if the PACT frontend is React/Next)
npx skills add https://github.com/vercel-labs/agent-skills --skill react-best-practices

# Browser automation and rendered UI verification
npx skills add https://github.com/vercel-labs/agent-browser --skill agent-browser
```

For `agent-browser`, install its CLI if it is not already installed, then load its version-matched instructions before use:

```bash
npm i -g agent-browser
agent-browser install
agent-browser skills get core
```

### Optional skills

```bash
# General frontend implementation guidance; constrain it to PACT's familiar trading-terminal references
npx skills add https://github.com/anthropics/skills --skill frontend-design

# Only if the existing project uses shadcn/ui
npx skills add https://github.com/openai/plugins/tree/main/plugins/build-web-apps/skills/shadcn-best-practices
```

`frontend-design` is useful for implementation quality, but its emphasis on distinctive art direction must not override PACT's requirement to preserve familiar exchange conventions. `ui-ux-pro-max` is a reference library, not permission to choose a generic dashboard template. `web-design-guidelines` is a review skill, not a screen generator. `agent-browser` validates the rendered result and actual interactions.

### Existing skills in the current ChatGPT environment

Figma-focused skills are available for generating composed Figma screens and building design libraries. A general frontend-design or trading-terminal implementation skill is not currently present in the installed skill catalog. The CLI commands above are for the user's local coding-agent environment.

## 12. Definition of done for each UI change

A UI change is not complete until:

1. It follows the existing global shell and does not introduce duplicate navigation.
2. Every visible interactive element has a documented and working action.
3. Every important object links to one canonical detail destination.
4. Search, filters, tabs, sort and pagination behave predictably and survive refresh when URL-backed.
5. Browser Back/Forward and direct deep links work.
6. Existing API contracts and backend execution logic remain unchanged.
7. No unsupported metrics or capabilities are displayed as real.
8. Loading, empty, error, disabled, and success states are defined.
9. Desktop and narrower layouts are checked in a real browser.
10. Keyboard navigation, focus states, contrast, and accessible labels are checked.
11. Screenshots are reviewed at realistic trading-terminal density, not just as isolated cards.
12. Console errors and broken links are resolved.
