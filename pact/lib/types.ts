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
export type LeaderEvidenceStatus = "UNVERIFIED" | "VERIFIED";
export type CopySizingMode = "PROPORTIONAL" | "FIXED";
export type FollowerExitMode = "FOLLOWER_BRACKET" | "MANUAL";

export type LeaderMandate = {
  leader: `0x${string}`;
  sizingMode: CopySizingMode;
  /** Used when sizingMode is PROPORTIONAL. */
  copyRatio: number;
  /** Used when sizingMode is FIXED. */
  fixedNotionalUsd: number;
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
  chain: Chain;
  targetAsset: `0x${string}`;
  contraAsset: `0x${string}`;
  side: Side;
  orderType: OrderType;
  qty: string;
  durationSeconds?: number;
  limitNotionalPrice?: string;
  triggers?: Trigger[];
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
  /** Require a leader to publish an exit/invalidation before this follower can copy. */
  requirePlanProtection?: boolean;
  /** Require a valid entry, stop, target, and reward:risk before copying. */
  requireLeaderPlanQuality?: boolean;
  /** Only copy leaders that supplied a Flash order owned by their publishing wallet. */
  requireLeaderExecutionEvidence?: boolean;
  minRewardRisk: number;
  askHumanUsd?: number;
  /** Explicitly selected leaders this follower copies. */
  follows?: `0x${string}`[];
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
  limitNotionalPrice?: string;
  triggers?: Trigger[];
  createdAt: string;
};

export type Decision = {
  verdict: Verdict;
  action: CopyAction;
  reasons: string[];
  modifiedQty?: string;
};

export type Fill = { transactionId?: string; fillPrice?: string; notional?: string };

export type Receipt = {
  id: string;
  proposalId: string;
  chain?: Chain;
  fills?: Fill[];
  completedFillCount?: number;
  twapBucketCount?: number;
  follower: `0x${string}`;
  decision: Decision;
  quoteId?: string;
  flashOrderId?: string;
  status?: string;
  transactionId?: string;
  closeReason?: string;
  /** Realized P&L from a completed PACT position when an evidence source supplies it. */
  realizedPnlUsd?: number;
  notionalUsd: number;
  createdAt: string;
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
};
