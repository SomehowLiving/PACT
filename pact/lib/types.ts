export type Chain = "base" | "arc";
export type Side = "buy" | "sell";
export type OrderType =
  | "market"
  | "limit"
  | "twap"
  | "stop"
  | "stop-loss"
  | "take-profit";
export type Verdict = "ALLOW" | "MODIFY" | "BLOCK";
export type CopyAction = "COPY" | "SCALE" | "WAIT" | "DECLINE" | "REVIEW";
export type LeaderPlanGrade = "DISCIPLINED" | "CAUTION" | "INCOMPLETE";
/**
 * ORDER_FOUND proves Flash returned an order when queried with the publishing
 * leader as funder. It does not prove the order parameters match this plan.
 */
/**
 * How far a plan's claim is backed by the leader's own execution, weakest first:
 * UNVERIFIED, ORDER_FOUND (Flash has an order under the leader's wallet), PLAN_MATCHED (that
 * order matches the plan), ONCHAIN_VERIFIED (finalised Base transactions show the leader's
 * wallet made the declared trade near the declared price, inside the plan window).
 * MISMATCH: the leader's own execution contradicts the plan.
 */
export type LeaderEvidenceStatus = "UNVERIFIED" | "ORDER_FOUND" | "PLAN_MATCHED" | "ONCHAIN_VERIFIED" | "MISMATCH";

export type EvidenceCheck = {
  id: string;
  label: string;
  result: "MATCH" | "MISMATCH" | "PENDING" | "NOTE";
  detail: string;
};

/** L3 signal: a fact with its source. Policy decides what it means. */
export type Signal = {
  id: "STYLE_DRIFT" | "REVENGE_PATTERN" | "REFERENCE_DIVERGENCE";
  level: "info" | "caution" | "alert";
  value?: number;
  detail: string;
  source: string;
};

/** PACT's paper copy of a plan: entry from a Flash quote, outcome from market candles. */
export type ShadowCopy = {
  status: "NOT_COPYABLE" | "WAITING_ENTRY" | "OPEN" | "STOPPED" | "TARGET" | "EXPIRED";
  sizeUsd: number;
  quotedAt: string;
  enteredAt?: string;
  /** All-in USD per target unit, fees included. */
  entryPrice: number;
  marketPrice: number;
  costRatio: number;
  entryDriftBps?: number;
  /** Why the default mandate would not have copied it. */
  reasons: string[];
  exitPrice?: number;
  exitedAt?: string;
  pnlPct?: number;
  rMultiple?: number;
  markPrice?: number;
  markedAt?: string;
  settledCheckAt?: string;
  source: "flash-quote+geckoterminal-candles";
};

/** What PACT checked about a leader's execution for one plan, and when. */
export type LeaderEvidence = {
  status: LeaderEvidenceStatus;
  checkedAt: string;
  flashOrderId?: string;
  txHashes: string[];
  checks: EvidenceCheck[];
  /** Leader's own fills from chain: units, USD, volume-weighted price, drift vs declared entry. */
  onchain?: {
    targetUnits: number;
    contraUsd: number;
    averagePrice?: number;
    entryDriftBps?: number;
    firstTradeAt?: string;
    finalized: boolean;
  };
  /** True while more can change (an open Flash order, or transactions not yet final). */
  open: boolean;
};
export type CopySizingMode = "PROPORTIONAL" | "FIXED" | "STOP_RISK";
/** Review requires one signature per order; Assist may prepare recommendations but never signs. */
export type AutomationMode = "REVIEW" | "ASSIST" | "AUTOPILOT";
export type FollowerExitMode = "FOLLOWER_BRACKET" | "MANUAL";
export type DemoCase =
  | "CORE_TWAP_COPY"
  | "SLEEVE_SCALE"
  | "MARKET_REFUSAL"
  | "EXPIRED_PLAN"
  | "LOW_RR_CAUTION"
  | "EVIDENCE_REVIEW"
  | "HIGH_BETA_PAIR_REFUSAL"
  | "LEADER_DUMP";

export type LeaderMandate = {
  leader: `0x${string}`;
  sizingMode: CopySizingMode;
  /** Used when sizingMode is PROPORTIONAL. */
  copyRatio: number;
  /** Used when sizingMode is FIXED. */
  fixedNotionalUsd: number;
  /** Used when sizingMode is STOP_RISK. Maximum planned loss at the declared stop. */
  riskBudgetUsd: number;
  maxDailyUsd: number;
  allowOrderTypes: OrderType[];
  /** FOLLOWER_BRACKET attaches Flash TP/SL when the leader plan supports one. */
  exitMode: FollowerExitMode;
};

export type Trigger = {
  notionalPrice: string;
  triggerType: "lower" | "upper";
  limitPrice?: string;
};

export type AttachedBracket = {
  takeProfit: { notionalPrice: string; limitPrice?: string };
  stopLoss: { notionalPrice: string; limitPrice?: string };
  expireTime?: string;
};

export type Strategy = {
  id: string;
  leader: `0x${string}`;
  title: string;
  thesis: string;
  /** UTC ISO timestamp after which followers should not copy this plan. */
  expiresAt: string;
  /** Human-readable exit or thesis invalidation. PACT does not treat this as a guarantee. */
  invalidation?: string;
  /** Maximum combined notional a single follower may take from this plan. */
  maxFollowerNotionalUsd?: number;
  /** Leader's reference entry in USD per target asset for late-copy drift checks. */
  entryReferencePrice?: string;
  /** Planned stop price. This is plan metadata until a live Flash bracket is attached. */
  stopLossPrice?: string;
  /** Planned profit target. This is plan metadata until a live Flash bracket is attached. */
  takeProfitPrice?: string;
  /** Bracket expiry, distinct from the window in which a follower may enter the plan. */
  protectionExpiresAt?: string;
  leaderPlanGrade: LeaderPlanGrade;
  leaderPlanReasons: string[];
  /** Optional Flash order evidence that belongs to the publishing leader. */
  leaderFlashOrderId?: string;
  /** Verified only when Flash accepts the order lookup for the leader address. */
  leaderEvidenceStatus: LeaderEvidenceStatus;
  /** Transactions the leader offered as evidence (any venue). */
  leaderTxHashes?: string[];
  leaderEvidence?: LeaderEvidence;
  /** PACT's own paper copy of this plan (lib/shadow); never a real receipt. */
  shadow?: ShadowCopy;
  chain: Chain;
  targetAsset: `0x${string}`;
  contraAsset: `0x${string}`;
  side: Side;
  orderType: OrderType;
  qty: string;
  durationSeconds?: number;
  /** Optional Flash TWAP tranche count; copied unchanged into order submission. */
  twapBucketCount?: number;
  /** Optional Flash TWAP start time; copied unchanged into order submission. */
  startTime?: string;
  limitNotionalPrice?: string;
  triggers?: Trigger[];
  demoCase?: DemoCase;
  createdAt: string;
};

export type Policy = {
  follower: `0x${string}`;
  label?: string;
  chain: Chain;
  allowChains?: Chain[];
  maxNotionalUsd: number;
  maxDailyUsd: number;
  minNotionalUsd: number;
  allowModify: boolean;
  allowPairs: string[];
  allowOrderTypes: OrderType[];
  allowSides: Side[];
  maxSlippage: string;
  maxPriceImpact: string;
  /** Follower size as a fraction of the leader order's notional. */
  copyRatio: number;
  /** Maximum planned loss at the declared stop when stop-risk sizing is selected. */
  riskBudgetUsd: number;
  /** Maximum daily copied notional attributable to one leader. */
  maxLeaderDailyUsd: number;
  /** Stop accepting new copies from one leader after this much recorded realized loss today. */
  maxLeaderDailyRealizedLossUsd: number;
  /** Enable only when the product has a trusted realized-P&L evidence source. */
  enableLeaderLossCircuitBreaker?: boolean;
  /** Maximum same-asset, same-direction live copied exposure. */
  maxAssetExposureUsd: number;
  /** Maximum non-terminal copied plans across all selected leaders. */
  maxOpenPlans: number;
  /** Maximum non-terminal copied plans from one leader. */
  maxOpenPlansPerLeader: number;
  /** Maximum tolerated drift from a leader's published reference entry. */
  maxEntryDrift: string;
  /**
   * Maximum estimated execution cost (Flash platform + network + integrator fees) as a fraction
   * of order size. Kept apart from entry drift: the limit price bounds market price, not fees.
   */
  maxExecutionCost?: string;
  /** Require a leader to publish an exit/invalidation before this follower can copy. */
  requirePlanProtection?: boolean;
  /** Require a valid entry, stop, target, and reward:risk before copying. */
  requireLeaderPlanQuality?: boolean;
  /** Only copy leaders that supplied a Flash order owned by their publishing wallet. */
  requireLeaderExecutionEvidence?: boolean;
  /** With evidence required: a matching Flash order (default) or finalised onchain trades. */
  minLeaderEvidence?: "PLAN_MATCHED" | "ONCHAIN_VERIFIED";
  /** Copy only leaders whose paper copies have settled (probation, handbook R15). */
  requireGraduatedLeader?: boolean;
  /** Copy only leaders who proved with World ID that they are a unique human (never a skill signal). */
  requireVerifiedHuman?: boolean;
  /** Ask for a fresh World ID approval, bound to the limits, before an Autopilot session key is created. */
  requireHumanForAutopilot?: boolean;
  /** Largest gap allowed between Flash's quote (or the chart) and the oracle at quote time. */
  maxReferenceDivergence?: string;
  minRewardRisk: number;
  askHumanUsd?: number;
  /** Assist may prepare policy-compliant review items; it never receives signing authority. */
  automationMode?: AutomationMode;
  /** Explicitly selected leaders this follower copies. */
  follows?: `0x${string}`[];
  /**
   * Selected leaders whose new plans are held (WAIT) without dropping the leader or mandate.
   * Pausing never cancels orders already live on Flash; only the follower's signature can.
   */
  pausedLeaders?: `0x${string}`[];
  /** Optional leader-specific overrides. A missing mandate falls back to the global policy. */
  mandates?: LeaderMandate[];
};

export type Proposal = {
  id: string;
  strategyId: string;
  follower: `0x${string}`;
  leader: `0x${string}`;
  title: string;
  thesis: string;
  expiresAt: string;
  invalidation?: string;
  maxFollowerNotionalUsd?: number;
  entryReferencePrice?: string;
  stopLossPrice?: string;
  takeProfitPrice?: string;
  protectionExpiresAt?: string;
  leaderPlanGrade: LeaderPlanGrade;
  leaderPlanReasons: string[];
  leaderFlashOrderId?: string;
  leaderEvidenceStatus: LeaderEvidenceStatus;
  copySizingMode: CopySizingMode;
  riskBudgetUsd?: number;
  stopRiskPerUnitUsd?: number;
  estimatedLossAtStopUsd?: number;
  followerExitMode: FollowerExitMode;
  chain: Chain;
  targetAsset: `0x${string}`;
  contraAsset: `0x${string}`;
  side: Side;
  orderType: OrderType;
  qty: string;
  notionalUsd: number;
  maxSlippage?: string;
  maxPriceImpact?: string;
  durationSeconds?: number;
  twapBucketCount?: number;
  startTime?: string;
  limitNotionalPrice?: string;
  triggers?: Trigger[];
  demoCase?: DemoCase;
  /** Plan-time signals (style drift, revenge pattern) as they stood when the copy was decided. */
  signals?: Signal[];
  createdAt: string;
};

export type Decision = {
  verdict: Verdict;
  action: CopyAction;
  reasons: string[];
  modifiedQty?: string;
};

export type Fill = {
  transactionId?: string;
  fillPrice?: string;
  notional?: string;
  filledAt?: string;
  /** Flash's fill status (CHAIN_STATUS_FINALIZED, …). */
  status?: string;
  /** PACT's fee on this fill in USD, as Flash reports it (`integratorFeeNotional`). */
  integratorFeeUsd?: string;
};

export type Receipt = {
  id: string;
  proposalId: string;
  chain?: Chain;
  fills?: Fill[];
  completedFillCount?: number;
  twapBucketCount?: number;
  follower: `0x${string}`;
  /** The address that signed and paid when it is not the follower's EOA (their PACT wallet). */
  funder?: `0x${string}`;
  /** Who signed: the follower in their wallet, or Autopilot's scoped session key. */
  signedBy?: "WALLET" | "SESSION_KEY";
  decision: Decision;
  quoteId?: string;
  flashOrderId?: string;
  status?: string;
  transactionId?: string;
  closeReason?: string;
  quotedExecutionPrice?: string;
  declaredEntryPrice?: string;
  averageFillPrice?: string;
  /** Volume-weighted execution price before fees (what Flash's limit applies to); drift uses it. */
  executionPrice?: string;
  entryDriftBps?: number;
  /** Quoted all-in price per target unit, fees included. */
  allInPrice?: string;
  /** Quoted estimated fees in USD and as a fraction of size. */
  quotedFeeUsd?: string;
  quotedCostRatio?: string;
  /** Actual fees summed over finalised fills, in USD. */
  feesUsd?: number;
  /** Fills Flash reports as finalised vs not yet final (reorg-safe counting). */
  finalFillCount?: number;
  pendingFillCount?: number;
  /** The attached protection pair, as Flash reports it, compared with what the follower chose. */
  protection?: Protection;
  /** Realized P&L from Flash fills (see `position`). */
  realizedPnlUsd?: number;
  /** Entry and exit from Flash's own fill rows; buys only. */
  position?: Position;
  /** PACT's fee decision for this copy, as quoted and submitted (lib/fees). */
  pactFee?: import("./fees").CopyFee;
  /** PACT's fee actually collected by Flash, summed over finalised fills (`integratorFeeNotional`). */
  pactFeeUsd?: number;
  notionalUsd: number;
  createdAt: string;
};

/** A buy copy's position, computed from Flash's finalised entry and protective-order fills. */
export type Position = {
  basis: "flash-fills";
  entryUnits: number;
  entryCostUsd: number;
  averageCost: number;
  exitUnits: number;
  exitProceedsUsd: number;
  openUnits: number;
  openCostUsd: number;
  /** On units already sold by the protective order. */
  realizedPnlUsd: number;
  /** Time of the last exit fill: the day a realized loss counts toward the breaker. */
  realizedAt?: string;
  feesUsd: number;
  closed: boolean;
};

export type Protection = {
  /** pending_activation → active (on first fill) | never_activated (entry closed unfilled). */
  status?: "pending_activation" | "never_activated" | "active";
  /** The protective order's own Flash id, set once active. */
  bracketOrderId?: string;
  /** Flash status of the protective order itself. */
  orderStatus?: string;
  closeReason?: string;
  /** Levels the follower chose at review. */
  intendedTakeProfit?: string;
  intendedStopLoss?: string;
  /** Levels Flash reports on the live pair (read back after submit). */
  takeProfit?: string;
  stopLoss?: string;
  /** True when Flash's reported levels equal the chosen ones; false is a visible mismatch. */
  levelsMatch?: boolean;
  expiresAt?: string;
};

export type StoredQuote = {
  proposalId: string;
  quoteId: string;
  qty: string;
  orderTypedData?: string;
  approveTx?: { to: `0x${string}`; data: `0x${string}`; value?: string };
  permitTypedData?: string;
  notionalUsd?: number;
  estimatedPriceImpact?: string;
  executionPrice?: string;
  /** Leader-declared price bound, before a follower policy may make it stricter. */
  declaredLimitNotionalPrice?: string;
  /** Price bound actually quoted to Flash after applying follower entry-drift policy. */
  effectiveLimitNotionalPrice?: string;
  /** Which price basis the bound was sent in (limit + bracket requires the pair rate). */
  limitBasis?: "notional" | "cross";
  /** Protections sent on the quote, echoed on submit so Flash does not substitute defaults. */
  maxPriceImpact?: string;
  maxSlippage?: string;
  /** All-in price, estimated fees and cost ratio from the quote. */
  allInPrice?: string;
  feeNotional?: string;
  costRatio?: string;
  /** R11: oracle, chart and Flash prices at quote time. */
  reference?: import("./signals").ReferenceCheck;
  /** TWAP slices this quote (and the signed order) used; may be fewer than Flash's default. */
  twapBucketCount?: number;
  /** Who signs and pays: the follower's EOA (review) or their PACT wallet (Autopilot). */
  funder?: `0x${string}`;
  /** PACT's fee on this copy (lib/fees), quoted and submitted to Flash identically. */
  pactFee?: import("./fees").CopyFee;
  attachedBracket?: {
    bracket: AttachedBracket;
    salt?: string;
    deadline?: string;
    signedMaxFromAmount?: string;
    orderTypedData?: string;
    approveTx?: { to: `0x${string}`; data: `0x${string}`; value?: string };
    permitTypedData?: string;
  };
  createdAt: string;
  raw: unknown;
};

export type AuditLog = {
  at: string;
  proposalId: string;
  proposalHash: string;
  policyHash: string;
  verdict: Verdict;
  reasons: string[];
  quoteId?: string;
  flashOrderId?: string;
};

export type DeskState = {
  strategies: Strategy[];
  policies: Policy[];
  proposals: Proposal[];
  decisions: Record<string, Decision>;
  quotes: Record<string, StoredQuote>;
  receipts: Receipt[];
  logs: AuditLog[];
  /** Leader address (lowercase) → when they verified as a unique human with World ID. */
  humans?: Record<string, string>;
  /** Leader address (lowercase) → did they trade against their followers (lib/conduct). */
  conduct?: Record<string, import("./conduct").LeaderConduct>;
};
