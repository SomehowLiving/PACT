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

export type Trigger = {
  notionalPrice: string;
  triggerType: "lower" | "upper";
};

export type Strategy = {
  id: string;
  leader: `0x${string}`;
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
  askHumanUsd?: number;
  /** Leaders this follower copies. Empty or missing means every leader. */
  follows?: `0x${string}`[];
};

export type Proposal = {
  id: string;
  strategyId: string;
  follower: `0x${string}`;
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
