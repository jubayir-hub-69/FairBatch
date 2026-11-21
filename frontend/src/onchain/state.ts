import { formatUnits, type Address } from 'viem';
import type {
  BatchPhase,
  BatchSettlementDto,
  ClaimableDto,
  CommitmentDto,
  ComparisonDto,
  ExecutionReceiptDto,
  FillOutcomeDto,
  FillStatus,
  HealthResponse,
  OrderDto,
  OrderSide,
  StateResponse,
} from '../types';
import {
  buildSupplyDemandCurves,
  computeBatchSettlement,
  computeSignedTraderValueDiff,
} from '../lib/clearingMath';
import { shortenAddress } from '../lib/format';
import { erc20Abi, fairBatchAbi, faucetAbi } from './abi';
import { getPublicClient } from './client';
import type { RuntimeConfig } from './config';
import { loadFairBatchEvents, type FairBatchEvent } from './events';

export interface RawBatchInfo {
  batchId: bigint;
  startTime: bigint;
  commitDeadline: bigint;
  revealDeadline: bigint;
  orderCount: bigint;
  commitCount: bigint;
  phase: number;
}

export interface RawReserves {
  reserveBase: bigint;
  reserveQuote: bigint;
  totalShares: bigint;
  spotPriceWad: bigint;
}

export interface RawReceipt {
  orderId: bigint;
  trader: Address;
  side: number;
  amountIn: bigint;
  limitPrice: bigint;
  amountFilled: bigint;
  payoutBase: bigint;
  payoutQuote: bigint;
  settled: boolean;
  claimed: boolean;
}

export interface ChainOrder extends OrderDto {
  batch_id: number;
  amount_in_raw: bigint;
  limit_price_raw: bigint;
  mode: number;
}

export interface ChainCommitment extends CommitmentDto {
  batch_id: number;
  bond_wei: bigint;
}

export interface WalletBalances {
  eth: bigint;
  base: bigint;
  quote: bigint;
  lpShares: bigint;
}

export interface WalletAllowances {
  base: bigint;
  quote: bigint;
}

export interface LiquidityLockState {
  lockedShares: bigint;
  unlockTime: bigint;
  unlockedShares: bigint;
}

export interface FaucetState {
  address: Address;
  baseBalance: bigint;
  quoteBalance: bigint;
  claimBaseAmount: bigint;
  claimQuoteAmount: bigint;
  cooldownSecs: number;
  lastClaim: bigint;
  nextClaimAt: bigint;
  canClaim: boolean;
}

export interface OnchainSnapshot {
  config: RuntimeConfig;
  health: HealthResponse;
  state: StateResponse;
  batch: RawBatchInfo;
  reserves: RawReserves;
  balances: WalletBalances;
  allowances: WalletAllowances;
  lpLock: LiquidityLockState;
  faucet: FaucetState;
  nonce: bigint;
  domainSeparator: `0x${string}`;
  minBondWei: bigint;
  orders: ChainOrder[];
  commitments: ChainCommitment[];
  allCommitments: ChainCommitment[];
  batchSettled: boolean;
  claimable: ClaimableDto[];
  settledHistory: BatchSettlementDto[];
  activeSettlement: BatchSettlementDto;
  /** Latest on-chain block timestamp (seconds) fetched with this snapshot. */
  blockTimestamp: number;
  /** Estimated `chainNow - wallNow` offset in seconds at snapshot fetch time. */
  chainTimeOffsetSecs: number;
  lastUpdated: number;
}

const receiptCache = new Map<string, RawReceipt>();

export function clearReceiptCache(): void {
  receiptCache.clear();
}

export function clearReceiptCacheForBatch(batchId: number): void {
  const prefix = `:${batchId}:`;
  for (const key of receiptCache.keys()) {
    if (key.includes(prefix)) receiptCache.delete(key);
  }
}

export function mapPhase(rawPhase: number): BatchPhase {
  switch (rawPhase) {
    case 1:
      return 'Reveal';
    case 2:
      return 'Ready';
    case 3:
      return 'Settled';
    default:
      return 'Open';
  }
}

/**
 * Mirrors `evaluate_batch_phase` in `src/lib.fe` so the UI never freezes on
 * `00:00` when the commit or reveal deadline passes between RPC polls:
 *   - `settled` (phase === 3) -> 'Settled'
 *   - `now <= commitDeadline` -> 'Open'
 *   - `now <= revealDeadline` -> 'Reveal'
 *   - `now >  revealDeadline` -> 'Ready'
 */
export function deriveLivePhase(batch: RawBatchInfo, nowSecs: number): BatchPhase {
  if (batch.phase === 3) return 'Settled';
  const commitDl = Number(batch.commitDeadline);
  const revealDl = Number(batch.revealDeadline);
  const start = Number(batch.startTime);
  if (commitDl === start && revealDl === start) {
    return mapPhase(batch.phase);
  }
  if (nowSecs <= commitDl) return 'Open';
  if (nowSecs <= revealDl) return 'Reveal';
  return 'Ready';
}

export function remainingSecondsForPhase(
  batch: RawBatchInfo,
  phase: BatchPhase,
  nowSecs: number,
): number {
  if (phase === 'Open') return Math.max(0, Number(batch.commitDeadline) - nowSecs);
  if (phase === 'Reveal') return Math.max(0, Number(batch.revealDeadline) - nowSecs);
  return 0;
}

export function phaseLabel(phase: BatchPhase): string {
  switch (phase) {
    case 'Open':
      return 'Open / Collect';
    case 'Reveal':
      return 'Reveal / Intent';
    case 'Ready':
      return 'Ready to settle';
    default:
      return 'Settled';
  }
}

export function sideToU8(side: OrderSide): number {
  return side === 'SellBase' ? 0 : 1;
}

export function u8ToSide(side: number): OrderSide {
  return side === 0 ? 'SellBase' : 'BuyBase';
}

export function modeToSubmission(mode: number): OrderDto['submission_type'] {
  if (mode === 1) return 'CommitReveal';
  if (mode === 2) return 'Eip712Intent';
  return 'Direct';
}

function modeLabel(mode: number): string {
  if (mode === 1) return 'sealed';
  if (mode === 2) return 'signed';
  return 'direct';
}

function toHuman(raw: bigint, decimals: number): number {
  return Number(formatUnits(raw, decimals));
}

function wadToHuman(raw: bigint): number {
  return Number(formatUnits(raw, 18));
}

function hex32(value: bigint): `0x${string}` {
  return `0x${value.toString(16).padStart(64, '0')}`;
}

function asBig(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'string') return BigInt(value);
  return 0n;
}

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') return Number(value);
  return 0;
}

function asAddress(value: unknown): Address {
  return (typeof value === 'string' ? value : '0x0000000000000000000000000000000000000000') as Address;
}

function sideFromContract(value: unknown): OrderSide {
  return u8ToSide(asNumber(value));
}

function orderLabel(trader: Address, mode: number): string {
  return `${shortenAddress(trader)} · ${modeLabel(mode)}`;
}

function buildOrder(
  config: RuntimeConfig,
  event: FairBatchEvent,
  mode: number,
): ChainOrder {
  const args = event.args;
  const side = sideFromContract(args.side);
  const amountIn = asBig(args.amountIn);
  const limitPrice = asBig(args.limitPrice);
  const trader = asAddress(args.trader);
  const decimals = side === 'SellBase' ? config.baseDecimals : config.quoteDecimals;
  return {
    batch_id: Number(asBig(args.batchId)),
    order_id: Number(asBig(args.orderId)),
    trader,
    label: orderLabel(trader, mode),
    side,
    amount_in: toHuman(amountIn, decimals),
    limit_price: wadToHuman(limitPrice),
    submission_type: modeToSubmission(mode),
    is_attacker: false,
    amount_in_raw: amountIn,
    limit_price_raw: limitPrice,
    mode,
  };
}

function receiptKey(config: RuntimeConfig, batchId: number, orderId: number): string {
  return `${config.chainId}:${config.fairBatch}:${batchId}:${orderId}`;
}

async function fetchReceipt(
  config: RuntimeConfig,
  batchId: number,
  orderId: number,
): Promise<RawReceipt> {
  const key = receiptKey(config, batchId, orderId);
  const cached = receiptCache.get(key);
  if (cached?.settled) return cached;

  const client = getPublicClient(config);
  const readOnce = async () =>
    (await client.readContract({
      address: config.fairBatch,
      abi: fairBatchAbi,
      functionName: 'getOrderReceipt',
      args: [BigInt(batchId), BigInt(orderId)],
    })) as unknown as RawReceipt;

  let raw = await readOnce();
  // Guard against load-balanced RPC replicas lagging 1 block behind `BatchSettled`:
  // retry briefly and NEVER cache an unsettled receipt for a settled batch.
  if (!raw.settled) {
    await new Promise((resolve) => setTimeout(resolve, 650));
    raw = await readOnce();
  }
  if (raw.settled) {
    receiptCache.set(key, raw);
  }
  return raw;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

function fillStatus(receipt: RawReceipt): FillStatus {
  if (receipt.amountFilled === 0n) return 'OutOfMoneyRefund';
  if (receipt.amountFilled >= receipt.amountIn) return 'Filled';
  return 'PartialFill';
}

function effectivePrice(receipt: RawReceipt, config: RuntimeConfig): number {
  if (receipt.amountFilled === 0n) return 0;
  if (receipt.side === 0) {
    const base = toHuman(receipt.amountFilled, config.baseDecimals);
    const quote = toHuman(receipt.payoutQuote, config.quoteDecimals);
    return base > 0 ? quote / base : 0;
  }
  const base = toHuman(receipt.payoutBase, config.baseDecimals);
  const quote = toHuman(receipt.amountFilled, config.quoteDecimals);
  return base > 0 ? quote / base : 0;
}

function receiptPayout(receipt: RawReceipt, side: OrderSide, config: RuntimeConfig): {
  payoutOut: number;
  refundIn: number;
} {
  if (side === 'SellBase') {
    return {
      payoutOut: toHuman(receipt.payoutQuote, config.quoteDecimals),
      refundIn: toHuman(receipt.payoutBase, config.baseDecimals),
    };
  }
  return {
    payoutOut: toHuman(receipt.payoutBase, config.baseDecimals),
    refundIn: toHuman(receipt.payoutQuote, config.quoteDecimals),
  };
}

function receiptToExecution(
  receipt: RawReceipt,
  order: ChainOrder | undefined,
  config: RuntimeConfig,
): ExecutionReceiptDto {
  const side = u8ToSide(receipt.side);
  const payout = receiptPayout(receipt, side, config);
  const status = fillStatus(receipt);
  return {
    order_id: Number(receipt.orderId),
    trader: receipt.trader,
    label: order?.label ?? shortenAddress(receipt.trader),
    side,
    amount_in:
      order?.amount_in ??
      toHuman(
        receipt.amountIn,
        side === 'SellBase' ? config.baseDecimals : config.quoteDecimals,
      ),
    amount_filled: toHuman(
      receipt.amountFilled,
      side === 'SellBase' ? config.baseDecimals : config.quoteDecimals,
    ),
    amount_out: payout.payoutOut,
    refund_in: payout.refundIn,
    effective_price: effectivePrice(receipt, config),
    status:
      status === 'Filled'
        ? '100% Filled'
        : status === 'PartialFill'
          ? 'Pro-Rata Partial'
          : 'Refunded (OTM)',
    is_attacker: false,
  };
}

function receiptToFill(
  receipt: RawReceipt,
  order: ChainOrder | undefined,
  config: RuntimeConfig,
): FillOutcomeDto {
  const side = u8ToSide(receipt.side);
  const payout = receiptPayout(receipt, side, config);
  return {
    order_id: Number(receipt.orderId),
    trader: receipt.trader,
    label: order?.label ?? shortenAddress(receipt.trader),
    side,
    status: fillStatus(receipt),
    amount_in:
      order?.amount_in ??
      toHuman(
        receipt.amountIn,
        side === 'SellBase' ? config.baseDecimals : config.quoteDecimals,
      ),
    amount_filled: toHuman(
      receipt.amountFilled,
      side === 'SellBase' ? config.baseDecimals : config.quoteDecimals,
    ),
    payout_out: payout.payoutOut,
    refund_in: payout.refundIn,
    limit_price:
      order?.limit_price ??
      wadToHuman(receipt.limitPrice),
    effective_price: effectivePrice(receipt, config),
    is_attacker: false,
  };
}

function emptyComparison(clearingPrice: number): ComparisonDto {
  return {
    fee_bps: 0,
    amm_victim_avg_price: 0,
    fairbatch_uniform_price: clearingPrice,
    user_value_saved_quote: 0,
    amm_sandwich_profit_quote: 0,
    fairbatch_sandwich_profit_quote: 0,
    amm_lvr_loss_quote: 0,
    amm_receipts: [],
    fairbatch_receipts: [],
  };
}

export interface IndexedEvents {
  ordersByBatch: Map<number, ChainOrder[]>;
  commitmentsByBatch: Map<number, ChainCommitment[]>;
  revealedCommits: Set<string>;
  slashedCommits: Set<string>;
  claimedOrders: Set<string>;
  settledEvents: FairBatchEvent[];
}

/**
 * Indexes and deduplicates FairBatch logs by canonical on-chain IDs:
 *   - orders: `(batch_id, order_id)`
 *   - commitments: `(batch_id, commit_id)`
 *   - settlements: `batch_id`
 */
export function indexFairBatchEvents(
  events: FairBatchEvent[],
  config: RuntimeConfig,
): IndexedEvents {
  const orderMapsByBatch = new Map<number, Map<number, ChainOrder>>();
  const commitMapsByBatch = new Map<number, Map<number, ChainCommitment>>();
  const revealedCommits = new Set<string>();
  const slashedCommits = new Set<string>();
  const claimedOrders = new Set<string>();
  const settledByBatch = new Map<number, FairBatchEvent>();

  for (const event of events) {
    if (event.eventName === 'OrderSubmitted') {
      const order = buildOrder(config, event, asNumber(event.args.mode));
      const map = orderMapsByBatch.get(order.batch_id) ?? new Map<number, ChainOrder>();
      if (!map.has(order.order_id)) map.set(order.order_id, order);
      orderMapsByBatch.set(order.batch_id, map);
    } else if (event.eventName === 'OrderRevealed') {
      const order = buildOrder(config, event, 1);
      const map = orderMapsByBatch.get(order.batch_id) ?? new Map<number, ChainOrder>();
      if (!map.has(order.order_id)) map.set(order.order_id, order);
      orderMapsByBatch.set(order.batch_id, map);
      const commitId = asBig(event.args.commitId);
      revealedCommits.add(`${order.batch_id}:${commitId}`);
    } else if (event.eventName === 'OrderCommitted') {
      const batchId = Number(asBig(event.args.batchId));
      const commitId = Number(asBig(event.args.commitId));
      const trader = asAddress(event.args.trader);
      const bond = asBig(event.args.bond);
      const map = commitMapsByBatch.get(batchId) ?? new Map<number, ChainCommitment>();
      if (!map.has(commitId)) {
        map.set(commitId, {
          batch_id: batchId,
          commit_id: commitId,
          trader,
          commitment_hash: hex32(asBig(event.args.commitmentHash)),
          bond_eth: toHuman(bond, 18),
          bond_wei: bond,
          revealed: false,
          slashed: false,
        });
      }
      commitMapsByBatch.set(batchId, map);
    } else if (event.eventName === 'CommitmentSlashed') {
      const batchId = Number(asBig(event.args.batchId));
      const commitId = asBig(event.args.commitId);
      slashedCommits.add(`${batchId}:${commitId}`);
    } else if (event.eventName === 'OrderClaimed') {
      claimedOrders.add(
        `${Number(asBig(event.args.batchId))}:${Number(asBig(event.args.orderId))}`,
      );
    } else if (event.eventName === 'BatchSettled') {
      const batchId = Number(asBig(event.args.batchId));
      if (!settledByBatch.has(batchId)) {
        settledByBatch.set(batchId, event);
      }
    }
  }

  const ordersByBatch = new Map<number, ChainOrder[]>();
  for (const [batchId, map] of orderMapsByBatch.entries()) {
    ordersByBatch.set(
      batchId,
      Array.from(map.values()).sort((a, b) => a.order_id - b.order_id),
    );
  }

  const commitmentsByBatch = new Map<number, ChainCommitment[]>();
  for (const [batchId, map] of commitMapsByBatch.entries()) {
    const list = Array.from(map.values()).sort((a, b) => a.commit_id - b.commit_id);
    for (const commit of list) {
      const key = `${batchId}:${commit.commit_id}`;
      if (revealedCommits.has(key)) commit.revealed = true;
      if (slashedCommits.has(key)) commit.slashed = true;
    }
    commitmentsByBatch.set(batchId, list);
  }

  const settledEvents = Array.from(settledByBatch.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, ev]) => ev);

  return {
    ordersByBatch,
    commitmentsByBatch,
    revealedCommits,
    slashedCommits,
    claimedOrders,
    settledEvents,
  };
}

/**
 * Reconstructs pre-settlement `(base, quote)` reserves for each settled batch.
 * The deployed FairBatch constructor initializes pool reserves to `(0, 0)` and
 * `seedReserves` emits `LiquidityAdded`, so tracking starts from `(0, 0)` to
 * avoid double-counting the seed deposit. If no liquidity event preceded the
 * first settlement (partial event range), falls back to `config.initialReserve*`.
 */
export function reconstructReserveHistory(
  events: FairBatchEvent[],
  config: Pick<RuntimeConfig, 'initialReserveBase' | 'initialReserveQuote'>,
): Map<number, { base: bigint; quote: bigint }> {
  let trackedBase = 0n;
  let trackedQuote = 0n;
  let sawLiquidityEvent = false;
  const seenSettled = new Set<number>();
  const beforeByBatch = new Map<number, { base: bigint; quote: bigint }>();

  for (const event of events) {
    if (event.eventName === 'LiquidityAdded') {
      sawLiquidityEvent = true;
      trackedBase += asBig(event.args.amountBase);
      trackedQuote += asBig(event.args.amountQuote);
    } else if (event.eventName === 'LiquidityRemoved') {
      sawLiquidityEvent = true;
      const base = asBig(event.args.amountBase);
      const quote = asBig(event.args.amountQuote);
      trackedBase = trackedBase > base ? trackedBase - base : 0n;
      trackedQuote = trackedQuote > quote ? trackedQuote - quote : 0n;
    } else if (event.eventName === 'BatchSettled') {
      const batchId = Number(asBig(event.args.batchId));
      if (seenSettled.has(batchId)) continue;
      seenSettled.add(batchId);
      if (!sawLiquidityEvent && trackedBase === 0n && trackedQuote === 0n) {
        trackedBase = config.initialReserveBase;
        trackedQuote = config.initialReserveQuote;
      }
      beforeByBatch.set(batchId, { base: trackedBase, quote: trackedQuote });
      trackedBase = asBig(event.args.reserveBaseAfter);
      trackedQuote = asBig(event.args.reserveQuoteAfter);
    }
  }

  return beforeByBatch;
}

export async function loadOnchainSnapshot(
  config: RuntimeConfig,
  account: Address | null,
): Promise<OnchainSnapshot> {
  const client = getPublicClient(config);
  const [batchRaw, reservesRaw, domainRaw, latestBlock, events] = await Promise.all([
    client.readContract({
      address: config.fairBatch,
      abi: fairBatchAbi,
      functionName: 'currentBatch',
    }),
    client.readContract({
      address: config.fairBatch,
      abi: fairBatchAbi,
      functionName: 'getReserves',
    }),
    client.readContract({
      address: config.fairBatch,
      abi: fairBatchAbi,
      functionName: 'domainSeparator',
    }),
    client.getBlock({ blockTag: 'latest' }).catch(() => null),
    loadFairBatchEvents(client, config),
  ]);

  const wallNowSecs = Math.floor(Date.now() / 1000);
  const blockTimestamp = latestBlock?.timestamp ? Number(latestBlock.timestamp) : wallNowSecs;
  const chainTimeOffsetSecs = blockTimestamp - wallNowSecs;

  const batch = batchRaw as unknown as RawBatchInfo;
  const reserves = reservesRaw as unknown as RawReserves;
  const domainSeparator = hex32(domainRaw as bigint);

  let balances: WalletBalances = { eth: 0n, base: 0n, quote: 0n, lpShares: 0n };
  let allowances: WalletAllowances = { base: 0n, quote: 0n };
  let lpLock: LiquidityLockState = { lockedShares: 0n, unlockTime: 0n, unlockedShares: 0n };
  let nonce = 0n;

  const [faucetBaseBal, faucetQuoteBal] = config.tokenFaucetEnabled
    ? await Promise.all([
        client
          .readContract({
            address: config.baseToken,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [config.faucet],
          })
          .catch(() => 0n),
        client
          .readContract({
            address: config.quoteToken,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [config.faucet],
          })
          .catch(() => 0n),
      ])
    : [0n, 0n];

  let faucet: FaucetState = {
    address: config.faucet,
    baseBalance: faucetBaseBal,
    quoteBalance: faucetQuoteBal,
    claimBaseAmount: config.faucetClaimBase,
    claimQuoteAmount: config.faucetClaimQuote,
    cooldownSecs: config.faucetCooldownSecs,
    lastClaim: 0n,
    nextClaimAt: 0n,
    canClaim: config.tokenFaucetEnabled,
  };

  if (account) {
    const [
      eth,
      base,
      quote,
      lpShares,
      baseAllowance,
      quoteAllowance,
      accountNonce,
      lockRaw,
      faucetStatusRaw,
    ] = await Promise.all([
      client.getBalance({ address: account }).catch(() => 0n),
      client
        .readContract({
          address: config.baseToken,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [account],
        })
        .catch(() => 0n),
      client
        .readContract({
          address: config.quoteToken,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [account],
        })
        .catch(() => 0n),
      client
        .readContract({
          address: config.fairBatch,
          abi: fairBatchAbi,
          functionName: 'getLpShares',
          args: [account],
        })
        .catch(() => 0n),
      client
        .readContract({
          address: config.baseToken,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [account, config.fairBatch],
        })
        .catch(() => 0n),
      client
        .readContract({
          address: config.quoteToken,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [account, config.fairBatch],
        })
        .catch(() => 0n),
      client
        .readContract({
          address: config.fairBatch,
          abi: fairBatchAbi,
          functionName: 'getNonce',
          args: [account],
        })
        .catch(() => 0n),
      client
        .readContract({
          address: config.fairBatch,
          abi: fairBatchAbi,
          functionName: 'getLiquidityLock',
          args: [account],
        })
        .catch(() => null),
      config.tokenFaucetEnabled
        ? client
            .readContract({
              address: config.faucet,
              abi: faucetAbi,
              functionName: 'getUserStatus',
              args: [account],
            })
            .catch(() => null)
        : Promise.resolve(null),
    ]);
    balances = { eth, base, quote, lpShares };
    allowances = { base: baseAllowance, quote: quoteAllowance };
    nonce = accountNonce;
    if (lockRaw) {
      const parsedLock = lockRaw as unknown as {
        lockedShares: bigint;
        unlockTime: bigint;
        unlockedShares: bigint;
      };
      lpLock = {
        lockedShares: asBig(parsedLock.lockedShares),
        unlockTime: asBig(parsedLock.unlockTime),
        unlockedShares: asBig(parsedLock.unlockedShares),
      };
    } else {
      lpLock = { lockedShares: 0n, unlockTime: 0n, unlockedShares: lpShares };
    }
    if (faucetStatusRaw) {
      const parsedStatus = faucetStatusRaw as unknown as {
        lastClaim: bigint;
        nextClaimAt: bigint;
        canClaim: boolean;
      };
      faucet = {
        ...faucet,
        lastClaim: asBig(parsedStatus.lastClaim),
        nextClaimAt: asBig(parsedStatus.nextClaimAt),
        canClaim: Boolean(parsedStatus.canClaim),
      };
    }
  }

  const {
    ordersByBatch,
    commitmentsByBatch,
    slashedCommits,
    claimedOrders,
    settledEvents,
  } = indexFairBatchEvents(events, config);

  // Resolve receipts for every settled batch (cached across refreshes).
  const receiptEntries = new Map<string, RawReceipt>();
  for (const settled of settledEvents) {
    const batchId = Number(asBig(settled.args.batchId));
    const orders = ordersByBatch.get(batchId) ?? [];
    const missing = orders.filter(
      (order) => !receiptCache.has(receiptKey(config, batchId, order.order_id)),
    );
    if (missing.length > 0) {
      await mapLimit(missing, 8, (order) => fetchReceipt(config, batchId, order.order_id));
    }
    for (const order of orders) {
      const receipt = await fetchReceipt(config, batchId, order.order_id);
      receiptEntries.set(`${batchId}:${order.order_id}`, receipt);
    }
  }

  const activeBatchId = Number(batch.batchId);
  const activeOrders = ordersByBatch.get(activeBatchId) ?? [];
  const activeCommitments = commitmentsByBatch.get(activeBatchId) ?? [];
  const allCommitments = Array.from(commitmentsByBatch.values())
    .flat()
    .sort((a, b) => b.batch_id - a.batch_id || b.commit_id - a.commit_id);

  // Reconcile header counts if getLogs is slightly ahead/behind a load-balanced RPC node.
  const reconciledBatch: RawBatchInfo = {
    ...batch,
    orderCount:
      activeOrders.length > Number(batch.orderCount)
        ? BigInt(activeOrders.length)
        : batch.orderCount,
    commitCount:
      activeCommitments.length > Number(batch.commitCount)
        ? BigInt(activeCommitments.length)
        : batch.commitCount,
  };

  const claimable: ClaimableDto[] = [];
  for (const [key, receipt] of receiptEntries.entries()) {
    if (!receipt.settled) continue;
    const [batchIdStr, orderIdStr] = key.split(':');
    const batchId = Number(batchIdStr);
    const orderId = Number(orderIdStr);
    const order = (ordersByBatch.get(batchId) ?? []).find((o) => o.order_id === orderId);
    const side = u8ToSide(receipt.side);
    const payout = receiptPayout(receipt, side, config);
    claimable.push({
      batch_id: batchId,
      order_id: orderId,
      trader: receipt.trader,
      label: order?.label ?? shortenAddress(receipt.trader),
      side,
      status: fillStatus(receipt),
      amount_in:
        order?.amount_in ??
        toHuman(
          receipt.amountIn,
          side === 'SellBase' ? config.baseDecimals : config.quoteDecimals,
        ),
      amount_filled: toHuman(
        receipt.amountFilled,
        side === 'SellBase' ? config.baseDecimals : config.quoteDecimals,
      ),
      payout_out: payout.payoutOut,
      refund_in: payout.refundIn,
      effective_price: effectivePrice(receipt, config),
      claimed: receipt.claimed || claimedOrders.has(key),
    });
  }
  claimable.sort((a, b) => b.batch_id - a.batch_id || b.order_id - a.order_id);

  const beforeByBatch = reconstructReserveHistory(events, config);

  const settledHistory: BatchSettlementDto[] = [];
  for (const settled of settledEvents) {
    const batchId = Number(asBig(settled.args.batchId));
    const orders = ordersByBatch.get(batchId) ?? [];
    const receipts = orders
      .map((order) => receiptEntries.get(`${batchId}:${order.order_id}`))
      .filter((receipt): receipt is RawReceipt => Boolean(receipt?.settled));

    const clearingPrice = wadToHuman(asBig(settled.args.clearingPrice));
    const reserveBaseAfter = asBig(settled.args.reserveBaseAfter);
    const reserveQuoteAfter = asBig(settled.args.reserveQuoteAfter);
    const before = beforeByBatch.get(batchId) ?? {
      base: reserveBaseAfter,
      quote: reserveQuoteAfter,
    };
    const rxBefore = toHuman(before.base, config.baseDecimals);
    const ryBefore = toHuman(before.quote, config.quoteDecimals);
    const rxAfter = toHuman(reserveBaseAfter, config.baseDecimals);
    const ryAfter = toHuman(reserveQuoteAfter, config.quoteDecimals);

    const orderMap = new Map(orders.map((order) => [order.order_id, order]));
    const fills = receipts.map((receipt) =>
      receiptToFill(receipt, orderMap.get(Number(receipt.orderId)), config),
    );
    const executionReceipts = receipts.map((receipt) =>
      receiptToExecution(receipt, orderMap.get(Number(receipt.orderId)), config),
    );

    let comparison = emptyComparison(clearingPrice);
    try {
      const settledOrders =
        receipts.length === orders.length
          ? orders
          : orders.filter((o) =>
              receipts.some((r) => Number(r.orderId) === o.order_id),
            );
      const simulated = computeBatchSettlement(batchId, rxBefore, ryBefore, settledOrders);
      const signedDiff = computeSignedTraderValueDiff(
        executionReceipts,
        simulated.comparison.amm_receipts,
        clearingPrice,
      );
      comparison = {
        ...simulated.comparison,
        fairbatch_uniform_price: clearingPrice,
        fairbatch_receipts: executionReceipts,
        user_value_saved_quote: signedDiff,
      };
    } catch {
      comparison = {
        ...comparison,
        fairbatch_receipts: executionReceipts,
      };
    }

    const { supply_curve, demand_curve } = buildSupplyDemandCurves(
      orders,
      rxBefore > 0 ? ryBefore / rxBefore : clearingPrice,
    );

    const totalSellBase = toHuman(asBig(settled.args.totalSellBase), config.baseDecimals);
    const totalBuyQuote = toHuman(asBig(settled.args.totalBuyQuote), config.quoteDecimals);
    const cowBase = toHuman(asBig(settled.args.cowMatchedBase), config.baseDecimals);
    const cowQuote = toHuman(asBig(settled.args.cowMatchedQuote), config.quoteDecimals);
    const grossBase = totalSellBase + (clearingPrice > 0 ? totalBuyQuote / clearingPrice : 0);
    const cowRatio = grossBase > 0 ? Math.min(100, ((2 * cowBase) / grossBase) * 100) : 0;
    const kBefore = rxBefore * ryBefore;
    const kAfter = rxAfter * ryAfter;
    const kGrowth = Math.max(0, kAfter - kBefore);

    settledHistory.push({
      batch_id: batchId,
      clearing_price: clearingPrice,
      total_sell_base_eligible: totalSellBase,
      total_buy_quote_eligible: totalBuyQuote,
      cow_matched_base: cowBase,
      cow_matched_quote: cowQuote,
      cow_ratio_pct: cowRatio,
      pool_delta_base: rxAfter - rxBefore,
      pool_delta_quote: ryAfter - ryBefore,
      reserves_before: {
        rx: rxBefore,
        ry: ryBefore,
        spot_price: rxBefore > 0 ? ryBefore / rxBefore : 0,
        k_invariant: kBefore,
      },
      reserves_after: {
        rx: rxAfter,
        ry: ryAfter,
        spot_price: rxAfter > 0 ? ryAfter / rxAfter : 0,
        k_invariant: kAfter,
      },
      k_invariant_growth: kGrowth,
      k_invariant_growth_pct: kBefore > 0 ? (kGrowth / kBefore) * 100 : 0,
      slashed_bonds_count: Array.from(slashedCommits).filter((key) =>
        key.startsWith(`${batchId}:`),
      ).length,
      fills,
      supply_curve,
      demand_curve,
      comparison,
    });
  }
  settledHistory.sort((a, b) => b.batch_id - a.batch_id);

  const phase = deriveLivePhase(reconciledBatch, blockTimestamp);
  const rx = toHuman(reserves.reserveBase, config.baseDecimals);
  const ry = toHuman(reserves.reserveQuote, config.quoteDecimals);
  const spot = wadToHuman(reserves.spotPriceWad);
  const activeSettlement = computeBatchSettlement(
    activeBatchId,
    rx,
    ry,
    activeOrders,
    activeCommitments.filter((c) => c.slashed).length,
  );

  const state: StateResponse = {
    batch_id: activeBatchId,
    phase,
    commit_duration_secs: Number(reconciledBatch.commitDeadline - reconciledBatch.startTime),
    reveal_duration_secs: Number(
      reconciledBatch.revealDeadline - reconciledBatch.commitDeadline,
    ),
    phase_remaining_secs: remainingSecondsForPhase(reconciledBatch, phase, blockTimestamp),
    reserves: {
      rx,
      ry,
      spot_price: spot,
      k_invariant: rx * ry,
      base_symbol: config.baseSymbol,
      quote_symbol: config.quoteSymbol,
      base_decimals: config.baseDecimals,
      quote_decimals: config.quoteDecimals,
    },
    commitments: activeCommitments,
    orders: activeOrders,
    claimable,
    settled_history: settledHistory,
  };

  const health: HealthResponse = {
    status: 'ok',
    execution_mode: 'rpc_connected',
    rpc_url: config.rpcUrl,
    chain_id: config.chainId,
    contracts: {
      fair_batch: config.fairBatch,
      base_token: config.baseToken,
      quote_token: config.quoteToken,
      faucet: config.faucet,
      deployed: true,
    },
    fe_artifacts_present: false,
    fe_artifacts: [],
  };

  return {
    config,
    health,
    state,
    batch: reconciledBatch,
    reserves,
    balances,
    allowances,
    lpLock,
    faucet,
    nonce,
    domainSeparator,
    minBondWei: config.minBondWei,
    orders: activeOrders,
    commitments: activeCommitments,
    allCommitments,
    batchSettled: settledEvents.some(
      (event) => Number(asBig(event.args.batchId)) === activeBatchId,
    ),
    claimable,
    settledHistory,
    activeSettlement,
    blockTimestamp,
    chainTimeOffsetSecs,
    lastUpdated: Date.now(),
  };
}
