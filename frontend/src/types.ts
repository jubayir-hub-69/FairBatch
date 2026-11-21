export type ExecutionMode = 'rpc_connected';

export type BatchPhase = 'Open' | 'Reveal' | 'Ready' | 'Settled';

export type OrderSide = 'SellBase' | 'BuyBase';

export type SubmissionType = 'Direct' | 'CommitReveal' | 'Eip712Intent';

export type FillStatus = 'Filled' | 'PartialFill' | 'OutOfMoneyRefund';

export interface ContractAddressesDto {
  fair_batch: string;
  base_token: string;
  quote_token: string;
  faucet?: string;
  deployed: boolean;
}

export interface HealthResponse {
  status: string;
  execution_mode: ExecutionMode;
  rpc_url: string | null;
  chain_id: number;
  contracts: ContractAddressesDto;
  fe_artifacts_present: boolean;
  fe_artifacts: string[];
}

export interface ReservesDto {
  rx: number;
  ry: number;
  spot_price: number;
  k_invariant: number;
  base_symbol: string;
  quote_symbol: string;
  base_decimals: number;
  quote_decimals: number;
}

export interface CommitmentDto {
  commit_id: number;
  trader: string;
  commitment_hash: string;
  bond_eth: number;
  revealed: boolean;
  slashed: boolean;
}

export interface OrderDto {
  order_id: number;
  trader: string;
  label: string;
  side: OrderSide;
  amount_in: number;
  limit_price: number;
  submission_type: SubmissionType;
  is_attacker: boolean;
}

export interface ClaimableDto {
  batch_id: number;
  order_id: number;
  trader: string;
  label: string;
  side: OrderSide;
  status: FillStatus;
  amount_in: number;
  amount_filled: number;
  payout_out: number;
  refund_in: number;
  effective_price: number;
  claimed: boolean;
}

export interface CurvePointDto {
  price: number;
  cumulative_base: number;
  cumulative_quote?: number;
  label?: string;
}

export interface FillOutcomeDto {
  order_id: number;
  trader: string;
  label: string;
  side: OrderSide;
  status: FillStatus;
  amount_in: number;
  amount_filled: number;
  payout_out: number;
  refund_in: number;
  limit_price: number;
  effective_price: number;
  is_attacker: boolean;
}

export interface ExecutionReceiptDto {
  order_id: number;
  arrival_index?: number;
  trader: string;
  label: string;
  side: OrderSide;
  amount_in: number;
  amount_filled?: number;
  amount_out: number;
  refund_in?: number;
  effective_price: number;
  price_impact_pct?: number;
  slippage_pct?: number;
  status: string;
  is_attacker: boolean;
}

export interface ComparisonDto {
  fee_bps: number;
  amm_victim_avg_price: number;
  fairbatch_uniform_price: number;
  /** Signed Quote-denominated difference: FairBatch minus Sequential AMM. */
  user_value_saved_quote: number;
  amm_sandwich_profit_quote: number;
  fairbatch_sandwich_profit_quote: number;
  amm_lvr_loss_quote: number;
  amm_receipts: ExecutionReceiptDto[];
  fairbatch_receipts: ExecutionReceiptDto[];
}

export interface ReserveSnapshotDto {
  rx: number;
  ry: number;
  spot_price: number;
  k_invariant: number;
}

export interface BatchSettlementDto {
  batch_id: number;
  clearing_price: number;
  total_sell_base_eligible: number;
  total_buy_quote_eligible: number;
  cow_matched_base: number;
  cow_matched_quote: number;
  cow_ratio_pct: number;
  pool_delta_base: number;
  pool_delta_quote: number;
  reserves_before: ReserveSnapshotDto;
  reserves_after: ReserveSnapshotDto;
  k_invariant_growth: number;
  k_invariant_growth_pct: number;
  slashed_bonds_count: number;
  fills: FillOutcomeDto[];
  supply_curve: CurvePointDto[];
  demand_curve: CurvePointDto[];
  comparison: ComparisonDto;
}

export interface StateResponse {
  batch_id: number;
  phase: BatchPhase;
  commit_duration_secs: number;
  reveal_duration_secs: number;
  phase_remaining_secs: number;
  reserves: ReservesDto;
  commitments: CommitmentDto[];
  orders: OrderDto[];
  claimable: ClaimableDto[];
  settled_history: BatchSettlementDto[];
}

export interface LocalSecretVaultEntry {
  commit_id: number;
  batch_id: number;
  trader: string;
  label: string;
  side: OrderSide;
  amount_in: number;
  limit_price: number;
  salt: string;
  commitment_hash: string;
  bond_eth: number;
  revealed: boolean;
  amount_in_raw?: string;
  limit_price_raw?: string;
  bond_wei?: string;
}

export interface SignedIntentArtifact {
  trader: string;
  label: string;
  side: OrderSide;
  amount_in: number;
  limit_price: number;
  amount_in_raw: string;
  limit_price_raw: string;
  batch_id: number;
  nonce: number;
  deadline: number;
  signature: string;
  digest: string;
}
