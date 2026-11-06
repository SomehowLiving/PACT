# PACT — UI Audit and Structure Research

Status date: November 6, 2026 · Step 1 of the UI restructure · No code or backend changes

**Goal of this step:** understand every panel and tag in the current UI, what each one does
when clicked, where the same information repeats, and how the reference products solve
the same problem, before deciding anything.

**Method**

- Every route was loaded in a browser (1440px, demo desk `portfolio`) and a script listed
  each panel, table, tag, link and button, plus where each link actually goes.
- The reference screens you shared (Binance Copy Trading, Kraken Pro, Axiom Vision, GMGN,
  Tread.fi, the portfolio-exposure dashboard, and the PACT Trade mockup) were compared,
  and GMGN, Tread.fi and Binance documentation was read for how their pages link together.

---

## 1. The finding in one paragraph

PACT has six kinds of things (leaders, plans, your decisions on plans, orders, your mandate,
the market), but **none of them has its own page** except a proposal's review. So every
screen re-draws its own copy of the same lists and facts, and almost nothing links to
anything: across the app, **leader addresses appear about 45 times and not one is
clickable**; plan titles are mostly plain text; orders have no page; status tags do nothing
when clicked. The reference products all do the opposite: **one canonical page per thing,
and every mention of that thing elsewhere is a link to it.**

---

## 2. What the references teach

| Reference | What it shows | Structural rule to take |
| --- | --- | --- |
| **Binance Copy Trading** (cards) | Lead trader cards in rows (High PNL, High ROI, High copier PNL); tabs Recommended / All portfolios / My favorites | A card is a *summary*. Clicking the trader opens their **profile page** (`/copy-trading/lead-details/<id>`). "Copy" opens **copy settings**. |
| **GMGN Rank** (dense table) | Sortable wallet table, category chips, timeframe toggle; row actions ✦ analyse and Copy | Clicking a wallet opens the **wallet detail page** (stats, PnL, distribution, risk checks, Follow, Wallet Copy). "Copy" opens the **copy configuration**. Each running copy strategy has its own **detail page** with positions, activity and a **"failed / filtered" list explaining skipped copies**. |
| **GMGN WalletCopy drawer** | Copy-from address, stats strip, sizing tabs, sell method, advanced settings, Confirm | A drawer is for **one action** (configure and confirm), not for browsing. |
| **Axiom Vision** | Leaderboard table, category dropdown, search by trader address, "Analyse wallet" | Search and analyse both resolve to **one wallet page**. |
| **Kraken Pro** | One terminal: order form, order book, chart as panels; bottom blotter tabs (Balances, Positions, Open orders, Conditional, Closed, Trades) | A terminal is a **workspace**, and its blotter rows link out to the full record. Panels are tabs inside one screen, not separate copies on other screens. |
| **Tread.fi** | Order header (pair, side, target, strategy, status), executed notional, avg price, fill %, maker/taker, actions (Resubmit, Amend, Pause, Cancel), placements table, fill and markout charts | "Orders" in the top nav is an **order history table with filters** (date, pair, side, strategy, status). Every row has **View order details**, which opens **one page per order**. |
| **Exposure dashboard** | Exposure by classification and by venue, distribution charts | Portfolio is **one analysis page**; other screens show a single headline number and link to it. |
| **PACT Trade mockup** | Top tabs, sidebar with counts, chart, Incoming plans blotter, plan rail with mandate check, Review & Sign | The terminal is the **working screen**; the rail summarises one plan and hands off to Review. |

**Rules common to all of them**

1. **One canonical page per entity** (trader, wallet, order). Everything else links to it.
2. **Lists are summaries.** A table or card shows a few columns and links to the entity page.
3. **Drawers and modals are for actions only** (copy, confirm, cancel), never the only place to see information.
4. **One name per page**, used the same way in every navigation element.
5. **Filters live in the URL** (`?status=`, `?leader=`), so a tag or count can link straight to a filtered list.

---

## 3. The entities PACT has, and where they appear today

| Entity | Has its own page? | Appears on | Clickable there? |
| --- | --- | --- | --- |
| **Leader** (address) | **No** | Discover (cards, table, side panel, copy drawer) · Following (table, sleeves, evidence) · Proposals (queue, verdict) · Trade (blotter, rail, Leader tab) · Overview (incoming plans) · Portfolio (open positions) · Publish (published plans) · Review (header, comparison) · Mandate (per-leader cards) | **Never** as a link. Discover rows select a side panel; elsewhere plain text. |
| **Plan** (published intent) | **No** | Discover (featured cards, plan list) · Publish (table) · copy drawer (plan results) · and, as proposals, everywhere below | Discover plan rows switch the chart; nowhere opens the plan |
| **Proposal** (your decision on a plan) | **Yes**: `/review/[id]` | Overview · Trade blotter and rail · Proposals queue and verdict · Following (recent proposals) · Portfolio (open positions) · Assist queue | Sometimes: Overview "Review", Trade "Review", Following rows, Portfolio "review". **Proposals page has zero links**; its rows only select the side panel. |
| **Order / receipt** | **No** | Execution (table + receipt panel) · Trade (Open positions, Recent executions) · Overview (execution health) · Portfolio (live exposure) · Review (order card) | Execution rows select its panel; Trade execution rows are dead text; `evidence.json` is the only order link |
| **Mandate** (your limits) | Yes: `/settings/mandate` | Mandate page · copy drawer (per-leader) · Following (sizing, sleeves) · Overview (summary + meters) · Portfolio (capacity) · Classic desk editor | Overview "Edit →" and Following "Edit mandate" link to it; others are their own copies |
| **Market** (WETH/USDC) | No (chart only) | Trade (main) · Overview · Discover (plan levels) · Publish (preview) · Review | No |

---

## 4. Page-by-page inventory

Click results are from the crawl. "Selects" means it changes a panel on the same page.

### Overview `/`
- **Job today:** four metrics, incoming plans, mandate and exposure, chart, execution health.
- **Panels:** Incoming plans · Mandate & exposure · Market chart · Execution health.
- **Tags:** decision badges (COPY…DECLINE), source dots (Policy, Flash, Market), status (ONLINE).
- **Clicks:** decision counts → `/proposals?action=…` ✓ · "Review" → review ✓ · "All proposals", "Edit", "Full exposure and capacity" ✓ · leader addresses ✗ · plan titles ✗ · chart ✗.
- **Overlaps:** incoming plans = Trade blotter = Proposals queue; mandate meters = Portfolio capacity; chart = Trade chart.

### Trade `/trade`
- **Job today:** the terminal from your mockup.
- **Panels:** pair header · chart · blotter (Incoming plans / Open positions / Recent executions) · plan rail (PACT Plan / Leader / Activity).
- **Clicks:** row → selects rail ✓ · "Review", "Review & Sign" → review ✓ · leader ✗ · Open positions and Recent executions rows ✗ (no order page) · rail Leader tab "Copyability check" → `/discover` (not to that leader) · "Manage leader" → `/following` (not to that leader).
- **Overlaps:** the blotter duplicates Proposals and Execution; the Leader tab duplicates the Discover side panel and the copy drawer.

### Discover `/discover` (top tab says "Leaders")
- **Panels:** featured plan cards · leader table · selected-leader panel · plan levels chart · published plans · planned notes.
- **Clicks:** row → selects side panel · ✦ → copy drawer (Copyability tab) · Copy/Edit → copy drawer (settings) · "Inspect" → selects side panel · "Mandate & sleeve" → `/following` · leader addresses ✗ · plan rows → change chart only.
- **Overlaps:** side panel + drawer + Trade Leader tab + Following evidence are four versions of "about this leader".

### Following `/following`
- **Panels:** selected leaders table · risk sleeves · per-leader evidence (+ recent proposals) · planned notes.
- **Clicks:** recent proposal rows → review ✓ · "Edit mandate", "Discover leaders" ✓ · Pause ✓ · leader ✗.
- **Overlaps:** sleeves = Portfolio capacity = Mandate per-leader cards; evidence = Discover side panel.

### Proposals `/proposals` (top tab says "Plans")
- **Panels:** decision filter · queue table · policy verdict · Autopilot note.
- **Clicks:** row → selects verdict panel · "Open review" → review (disabled when blocked) · **no other links**; filter is not reflected in the URL after load.
- **Overlaps:** same rows as Trade blotter and Overview.

### Portfolio `/portfolio`
- **Panels:** asset exposure (bar + table) · open positions · remaining capacity · same-asset concentration · wallet balances · planned PnL.
- **Clicks:** "review" → review ✓ · leader ✗ · order ✗.

### Execution `/execution` (top tab says "Receipts")
- **Panels:** orders table · receipt panel (Tread.fi-style) · cumulative fills · fills table · planned notes.
- **Clicks:** row → selects receipt panel · `evidence.json`, "Review · cancel", tx links ✓ · there is no URL for one order, so an order cannot be linked from anywhere else.

### Review `/review/[id]` — the only entity page
- **Panels:** plan vs your order · policy checks · chart + execution levels · leader declaration · Flash quote and wallet signing.
- **Clicks:** breadcrumb → `/proposals` ✓ · leader ✗ · plan ✗ · order (after submit) ✗.

### Others
- **Mandate** `/settings/mandate`: section anchors ✓; per-leader cards show addresses ✗.
- **Assist** `/assist`: queue rows "Review" ✓; leader ✗.
- **Publish** `/leader`: published plans table; plan and leader ✗.
- **Wallet**, **Preferences**: settings only.
- **Demo lab, Activity log, Classic desk, Classic leader ticket:** the original screens, now under More; they repeat most of the above.

---

## 5. Tag and badge catalogue

| Tag | Meaning | Shown on | Click today | What click should do |
| --- | --- | --- | --- | --- |
| COPY / SCALE / WAIT / REVIEW / DECLINE | PACT's decision for this follower | Everywhere proposals appear | Overview counts only | Open the proposal (row) or the filtered queue (count) |
| DISCIPLINED / CAUTION / INCOMPLETE | Plan quality grade | Discover, Trade rail, Publish | Nothing | Open the plan; tooltip with the reward:risk reason |
| UNVERIFIED / ORDER_FOUND | Leader's Flash order evidence | Discover, Proposals, Review, Publish | Nothing | Open the leader's evidence on the plan page |
| PAUSED / ACTIVE | Your pause on a leader | Discover, Following, Trade rail | Nothing (separate Pause button) | Open the leader page with the pause control |
| Order status (FILLED, PARTIALLY FILLED…) | Flash order state | Execution, Trade, Overview | Nothing | Open the order page |
| Source dots (Policy, Flash, Market, Wallet) | Which layer a number comes from | Panel headers | Tooltip only | Stay non-clickable (they label, not navigate) |
| Demo | Seeded data | Banner, cards, rows | Nothing | Stay a label; banner keeps "Back to my desk" |
| Coming later | Not built | Many panels | Nothing | Keep, but consolidate (see §6.5) |

---

## 6. Problems, ranked

1. **No entity pages, so dead ends everywhere.** You can't click a leader, a plan or an
   order and arrive somewhere. Each screen compensates by showing its own partial copy.
2. **The same list is rebuilt six times.** Incoming proposals appear on Overview, Trade,
   Proposals, Following, Portfolio and Assist, each with different columns and actions.
   Orders appear on four screens. "About this leader" exists in four versions.
3. **Two navigation systems with different names for the same page.** Top tabs say
   Leaders / Plans / Receipts; the sidebar says Discover / Proposals / Execution. Trade is
   only in the top tabs, Overview only in the sidebar.
4. **Five different "detail" mechanisms.** Side panel (Discover, Proposals), drawer
   (Discover), rail (Trade), receipt panel (Execution), full page (Review). The same kind
   of click does different things on different screens.
5. **Tags are inert.** Decisions, grades, evidence and order status look interactive but do
   nothing, except the Overview counts.
6. **Placeholders dilute pages.** About 20 "Coming later" notes are spread across pages.

---

## 7. Proposed structure (for discussion — nothing built)

### 7.1 Canonical pages

| Page | Route | One job | Main links out |
| --- | --- | --- | --- |
| Trade (terminal) | `/trade` | Work the incoming queue: chart, blotter, plan rail, Review & Sign | Leader, Plan, Proposal, Order |
| Leaders (list) | `/leaders` | Find and compare leaders | Leader |
| **Leader** (new) | `/leaders/[address]` | Everything about one leader: plans, copyability for you, your mandate and pause, your fills with them, skipped-copy reasons (GMGN "filter list") | Plan, Proposal, Order; actions: Copy / Edit (drawer), Pause |
| **Plan** (new) | `/plans/[id]` | One published plan: declared levels on the chart, thesis, grade, evidence, and your decision on it | Leader, Proposal |
| Proposals (list) | `/proposals` | The decision queue with URL filters | Proposal |
| Proposal / Review | `/review/[id]` (existing) | Your adjusted order, policy checks, quote, sign | Leader, Plan, Order |
| Orders (list) | `/orders` | Order history with filters (status, leader, side) — Tread.fi | Order |
| **Order** (new) | `/orders/[id]` | One receipt: fills, TWAP slices, drift, tx links, evidence, cancel | Proposal, Leader |
| Portfolio | `/portfolio` | Exposure, concentration, capacity, balances | filtered Orders / Proposals |
| Mandate | `/settings/mandate` | Edit limits | Leader |

### 7.2 Link rules

- Every leader address or avatar → `/leaders/[address]`.
- Every plan title → `/plans/[id]` (or the follower's proposal, if one exists, from queue contexts).
- Every proposal row → `/review/[id]`.
- Every order id or order status → `/orders/[id]`.
- Every decision count or tag in a summary → the list with that filter in the URL.
- Source dots and Demo stay labels.
- Drawers only for actions: copy settings, confirm, cancel.

### 7.3 What each current duplicate becomes

| Today | Becomes |
| --- | --- |
| Discover side panel, Trade Leader tab, Following evidence, copy drawer facts | Leader page; others keep one line and a link |
| Overview incoming plans, Proposals queue, Trade blotter, Assist queue | Proposals list is the full one; Trade blotter is the working view; Overview shows counts and the top few rows with "View all" |
| Execution panel, Trade executions, Overview health | Orders list + Order page; Trade and Overview show a summary and link |
| Following sleeves, Portfolio capacity, Overview meters | Portfolio holds capacity; Following shows per-leader sleeves linking to the Leader page |
| Five charts | Trade, Plan and Review keep a chart; Overview and Discover drop theirs |

### 7.4 Navigation

One vocabulary, used in both the top tabs and the sidebar (or keep only one of them).
Example: **Trade · Leaders · Proposals · Orders · Portfolio**, with Overview, Mandate and
Assist in the sidebar.

### 7.5 Placeholders

Move every "Coming later" note to one Roadmap view, linked from the footer, and keep at
most one inline note where a feature will actually appear.

---

## 8. Decisions needed before step 2

1. **Navigation names:** adopt one vocabulary (e.g. Leaders / Proposals / Orders) for both
   bars, or drop the top tabs or the sidebar?
2. **Overview vs Trade:** keep both (Overview = status summary, Trade = working terminal),
   or make Trade the home screen?
3. **New entity pages:** build Leader, Plan and Order pages first, then rewire links?
4. **Classic screens:** keep them under More for now, or retire them once the new pages
   cover their content?
