import {
  encodeFunctionData,
  getAddress,
  hashTypedData,
  maxUint256,
  parseEventLogs,
  parseUnits,
  type Address,
  type Hash,
  type TransactionReceipt,
} from 'viem';
import type { LocalSecretVaultEntry, OrderSide, SignedIntentArtifact } from '../types';
import { keccak256Utf8 } from '../lib/keccak';
import { erc20Abi, fairBatchAbi, fairBatchEvents, faucetAbi, faucetEvents } from './abi';
import { ensureWalletReady, getPublicClient } from './client';
import { getChain, type RuntimeConfig } from './config';

export type StatusReporter = (status: string) => void;

export interface TxResult {
  hash: Hash;
  receipt: TransactionReceipt;
}

export interface FaucetClaimResult extends TxResult {
  baseAmount: bigint;
  quoteAmount: bigint;
  nextClaimAt: bigint;
}

export interface DirectOrderResult extends TxResult {
  orderId: number;
  settledPreviousBatchId?: number;
}

export interface CommitResult extends TxResult {
  commitId: number;
  commitmentHash: `0x${string}`;
  bondWei: bigint;
  amountInRaw: bigint;
  limitPriceRaw: bigint;
  salt: string;
}

export interface RevealResult extends TxResult {
  orderId: number;
}

export interface IntentResult extends SignedIntentArtifact {
  digest: `0x${string}`;
}

export interface LiquidityResult extends TxResult {
  sharesMinted?: bigint;
  amountBase?: bigint;
  amountQuote?: bigint;
  unlockTime?: bigint;
}

function decimalString(value: string | number): string {
  const raw = typeof value === 'number' ? String(value) : value.trim();
  if (!raw) throw new Error('Amount is required.');
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      throw new Error(`Invalid positive amount: ${raw}`);
    }
    return numeric.toFixed(18).replace(/0+$/, '').replace(/\.$/, '');
  }
  return raw;
}

export function toRawAmount(value: string | number, decimals: number): bigint {
  const clean = decimalString(value);
  const parsed = parseUnits(clean, decimals);
  if (parsed <= 0n) throw new Error('Amount must be greater than zero.');
  return parsed;
}

export function toWadPrice(value: string | number): bigint {
  const parsed = parseUnits(decimalString(value), 18);
  if (parsed <= 0n) throw new Error('Limit price must be greater than zero.');
  return parsed;
}

export function saltToBigInt(salt: string): bigint {
  const trimmed = salt.trim();
  if (/^0x[0-9a-fA-F]{1,64}$/.test(trimmed)) {
    return BigInt(trimmed);
  }
  return BigInt(keccak256Utf8(trimmed));
}

function inputToken(config: RuntimeConfig, side: OrderSide): Address {
  return side === 'SellBase' ? config.baseToken : config.quoteToken;
}

function inputSymbol(config: RuntimeConfig, side: OrderSide): string {
  return side === 'SellBase' ? config.baseSymbol : config.quoteSymbol;
}

function inputDecimals(config: RuntimeConfig, side: OrderSide): number {
  return side === 'SellBase' ? config.baseDecimals : config.quoteDecimals;
}

function sideU8(side: OrderSide): number {
  return side === 'SellBase' ? 0 : 1;
}

function eventBig(args: Record<string, unknown>, key: string): bigint {
  const value = args[key];
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'string') return BigInt(value);
  return 0n;
}

function decodeEvents(
  receipt: TransactionReceipt,
  eventName: string,
): Array<Record<string, unknown>> {
  try {
    const parsed = parseEventLogs({
      abi: fairBatchEvents,
      logs: receipt.logs,
      eventName: eventName as never,
    }) as unknown as Array<{ args: Record<string, unknown> }>;
    return parsed.map((event) => event.args);
  } catch {
    return [];
  }
}

async function waitForSuccess(
  config: RuntimeConfig,
  hash: Hash,
  onStatus?: StatusReporter,
): Promise<TransactionReceipt> {
  const client = getPublicClient(config);
  const slowTimer =
    typeof globalThis.setTimeout === 'function'
      ? globalThis.setTimeout(() => {
          onStatus?.('Still confirming on Sepolia — network is taking a bit longer than usual…');
        }, 18_000)
      : null;

  try {
    const receipt = await client.waitForTransactionReceipt({
      hash,
      confirmations: 1,
      timeout: 180_000,
    });
    if (receipt.status !== 'success') {
      throw new Error(`Transaction reverted on-chain: ${hash}`);
    }
    return receipt;
  } finally {
    if (slowTimer !== null && typeof globalThis.clearTimeout === 'function') {
      globalThis.clearTimeout(slowTimer);
    }
  }
}

async function approveToken(
  config: RuntimeConfig,
  account: Address,
  token: Address,
  spender: Address,
  amount: bigint = maxUint256,
  symbol?: string,
  onStatus?: StatusReporter,
): Promise<Hash | null> {
  const client = getPublicClient(config);
  const current = await client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [account, spender],
  });
  if (current >= amount) return null;

  onStatus?.(`Approving ${symbol ?? 'token'}…`);
  const wallet = await ensureWalletReady(config, account);
  const hash = await wallet.writeContract({
    address: token,
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, maxUint256],
    account,
    chain: getChain(config),
  });
  onStatus?.(`Waiting for ${symbol ?? 'token'} approval…`);
  await waitForSuccess(config, hash, onStatus);
  return hash;
}

/**
 * Retries `fn` briefly if a wallet's RPC replica lags 1 block behind a just-mined
 * `approve()` transaction and throws a transient `Insufficient allowance` during gas estimation.
 */
async function withPostApproveRetry<T>(
  justApproved: boolean,
  fn: () => Promise<T>,
  onStatus?: StatusReporter,
): Promise<T> {
  if (!justApproved) return fn();
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Insufficient allowance') && attempt < 2) {
        onStatus?.('Syncing token approval across Sepolia nodes…');
        await new Promise((resolve) => setTimeout(resolve, 2_500));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

export async function ensureInputAllowance(
  config: RuntimeConfig,
  account: Address,
  side: OrderSide,
  amount: bigint,
  onStatus?: StatusReporter,
): Promise<Hash | null> {
  return approveToken(
    config,
    account,
    inputToken(config, side),
    config.fairBatch,
    amount,
    inputSymbol(config, side),
    onStatus,
  );
}

export async function claimFaucet(
  config: RuntimeConfig,
  account: Address,
  onStatus?: StatusReporter,
): Promise<FaucetClaimResult> {
  if (!config.tokenFaucetEnabled) {
    throw new Error('Sepolia faucet contract is not configured.');
  }
  onStatus?.('Confirm faucet claim in your wallet…');
  const wallet = await ensureWalletReady(config, account);
  const hash = await wallet.writeContract({
    address: config.faucet,
    abi: faucetAbi,
    functionName: 'claim',
    args: [],
    account,
    chain: getChain(config),
  });
  onStatus?.('Claiming free test tokens on Sepolia…');
  const receipt = await waitForSuccess(config, hash, onStatus);
  let baseAmount = config.faucetClaimBase;
  let quoteAmount = config.faucetClaimQuote;
  let nextClaimAt = 0n;
  try {
    const parsed = parseEventLogs({
      abi: faucetEvents,
      logs: receipt.logs,
      eventName: 'FaucetClaimed',
    }) as unknown as Array<{ args: Record<string, unknown> }>;
    if (parsed[0]) {
      baseAmount = eventBig(parsed[0].args, 'baseAmount');
      quoteAmount = eventBig(parsed[0].args, 'quoteAmount');
      nextClaimAt = eventBig(parsed[0].args, 'nextClaimAt');
    }
  } catch {
    // fallback to configured faucet amounts
  }
  return { hash, receipt, baseAmount, quoteAmount, nextClaimAt };
}

export async function submitDirectOrder(
  config: RuntimeConfig,
  account: Address,
  params: { side: OrderSide; amountIn: string; limitPrice: string },
  onStatus?: StatusReporter,
): Promise<DirectOrderResult> {
  const amountRaw = toRawAmount(params.amountIn, inputDecimals(config, params.side));
  const limitRaw = toWadPrice(params.limitPrice);
  const symbol = inputSymbol(config, params.side);
  const approved = await ensureInputAllowance(config, account, params.side, amountRaw, onStatus);

  onStatus?.(
    approved
      ? `Approved ${symbol} → Sending your order…`
      : 'Sending your order…',
  );
  const wallet = await ensureWalletReady(config, account);
  const hash = await withPostApproveRetry(
    Boolean(approved),
    () =>
      wallet.writeContract({
        address: config.fairBatch,
        abi: fairBatchAbi,
        functionName: 'submitDirectOrder',
        args: [sideU8(params.side), amountRaw, limitRaw],
        account,
        chain: getChain(config),
      }),
    onStatus,
  );
  onStatus?.('Confirming your order on Sepolia…');
  const receipt = await waitForSuccess(config, hash, onStatus);
  const events = decodeEvents(receipt, 'OrderSubmitted');
  const orderId = events[0] ? Number(eventBig(events[0], 'orderId')) : -1;
  return { hash, receipt, orderId };
}

/**
 * When the current round is finished (Ready), combines `settleBatch()` +
 * `submitDirectOrder(...)` into a single atomic `multicall` transaction so the
 * user never gets stuck on a dead end. If another wallet already settled while
 * the approval confirmed, falls back transparently to `submitDirectOrder`.
 */
export async function settleAndSubmitDirect(
  config: RuntimeConfig,
  account: Address,
  params: { side: OrderSide; amountIn: string; limitPrice: string },
  onStatus?: StatusReporter,
): Promise<DirectOrderResult> {
  const amountRaw = toRawAmount(params.amountIn, inputDecimals(config, params.side));
  const limitRaw = toWadPrice(params.limitPrice);
  const symbol = inputSymbol(config, params.side);
  const approved = await ensureInputAllowance(config, account, params.side, amountRaw, onStatus);

  const calls: `0x${string}`[] = [
    encodeFunctionData({
      abi: fairBatchAbi,
      functionName: 'settleBatch',
      args: [],
    }),
    encodeFunctionData({
      abi: fairBatchAbi,
      functionName: 'submitDirectOrder',
      args: [sideU8(params.side), amountRaw, limitRaw],
    }),
  ];

  const client = getPublicClient(config);

  // Only skip `settleBatch()` if another caller already settled this round into `Open`.
  let stillNeedsSettle = true;
  try {
    const freshBatch = (await client.readContract({
      address: config.fairBatch,
      abi: fairBatchAbi,
      functionName: 'currentBatch',
    })) as { phase: number };
    if (freshBatch.phase === 0) {
      stillNeedsSettle = false;
    }
  } catch {
    // Keep multicall path if read fails
  }

  if (!stillNeedsSettle) {
    return submitDirectOrder(config, account, params, onStatus);
  }

  onStatus?.(
    approved
      ? `Approved ${symbol} → Starting next round & sending your order…`
      : 'Starting next round & sending your order in one transaction…',
  );
  const wallet = await ensureWalletReady(config, account);
  const hash = await withPostApproveRetry(
    Boolean(approved),
    () =>
      wallet.writeContract({
        address: config.fairBatch,
        abi: fairBatchAbi,
        functionName: 'multicall',
        args: [calls],
        account,
        chain: getChain(config),
      }),
    onStatus,
  );
  onStatus?.('Confirming new round & order on Sepolia…');
  const receipt = await waitForSuccess(config, hash, onStatus);
  const orderEvents = decodeEvents(receipt, 'OrderSubmitted');
  const settledEvents = decodeEvents(receipt, 'BatchSettled');
  return {
    hash,
    receipt,
    orderId: orderEvents[0] ? Number(eventBig(orderEvents[0], 'orderId')) : -1,
    settledPreviousBatchId: settledEvents[0]
      ? Number(eventBig(settledEvents[0], 'batchId'))
      : undefined,
  };
}

export async function commitOrder(
  config: RuntimeConfig,
  account: Address,
  params: {
    side: OrderSide;
    amountIn: string;
    limitPrice: string;
    salt: string;
    bondEth: string;
    batchId: number;
  },
  onStatus?: StatusReporter,
): Promise<CommitResult> {
  const amountRaw = toRawAmount(params.amountIn, inputDecimals(config, params.side));
  const limitRaw = toWadPrice(params.limitPrice);
  const bondWei = toRawAmount(params.bondEth, 18);
  if (bondWei < config.minBondWei) {
    throw new Error(
      `Deposit must be at least ${Number(config.minBondWei) / 1e18} ETH.`,
    );
  }
  const client = getPublicClient(config);
  const ethBalance = await client.getBalance({ address: account });
  if (ethBalance < bondWei) {
    throw new Error(
      `Insufficient Sepolia ETH for the deposit. Need ${Number(bondWei) / 1e18} ETH plus gas.`,
    );
  }

  onStatus?.('Sealing your order hash…');
  const saltBig = saltToBigInt(params.salt);
  const commitmentHash = (await client.readContract({
    address: config.fairBatch,
    abi: fairBatchAbi,
    functionName: 'computeCommitmentHash',
    args: [
      BigInt(params.batchId),
      account,
      sideU8(params.side),
      amountRaw,
      limitRaw,
      saltBig,
    ],
  })) as bigint;

  onStatus?.('Confirm sealed order & refundable deposit in your wallet…');
  const wallet = await ensureWalletReady(config, account);
  const hash = await wallet.writeContract({
    address: config.fairBatch,
    abi: fairBatchAbi,
    functionName: 'commitOrder',
    args: [commitmentHash],
    value: bondWei,
    account,
    chain: getChain(config),
  });
  onStatus?.('Confirming sealed order on Sepolia…');
  const receipt = await waitForSuccess(config, hash, onStatus);
  const events = decodeEvents(receipt, 'OrderCommitted');
  const commitId = events[0] ? Number(eventBig(events[0], 'commitId')) : -1;
  return {
    hash,
    receipt,
    commitId,
    commitmentHash: `0x${commitmentHash.toString(16).padStart(64, '0')}`,
    bondWei,
    amountInRaw: amountRaw,
    limitPriceRaw: limitRaw,
    salt: params.salt,
  };
}

export async function revealOrder(
  config: RuntimeConfig,
  account: Address,
  secret: LocalSecretVaultEntry,
  onStatus?: StatusReporter,
): Promise<RevealResult> {
  const amountRaw = secret.amount_in_raw
    ? BigInt(secret.amount_in_raw)
    : toRawAmount(secret.amount_in, inputDecimals(config, secret.side));
  const limitRaw = secret.limit_price_raw
    ? BigInt(secret.limit_price_raw)
    : toWadPrice(secret.limit_price);
  const saltBig = saltToBigInt(secret.salt);
  const symbol = inputSymbol(config, secret.side);
  const approved = await ensureInputAllowance(config, account, secret.side, amountRaw, onStatus);

  onStatus?.(
    approved
      ? `Approved ${symbol} → Revealing your sealed order…`
      : 'Revealing your sealed order & returning deposit…',
  );
  const wallet = await ensureWalletReady(config, account);
  const hash = await wallet.writeContract({
    address: config.fairBatch,
    abi: fairBatchAbi,
    functionName: 'revealOrder',
    args: [BigInt(secret.commit_id), sideU8(secret.side), amountRaw, limitRaw, saltBig],
    account,
    chain: getChain(config),
  });
  onStatus?.('Confirming reveal on Sepolia…');
  const receipt = await waitForSuccess(config, hash, onStatus);
  const events = decodeEvents(receipt, 'OrderRevealed');
  const orderId = events[0] ? Number(eventBig(events[0], 'orderId')) : -1;
  return { hash, receipt, orderId };
}

export async function signIntent(
  config: RuntimeConfig,
  account: Address,
  params: { side: OrderSide; amountIn: string; limitPrice: string; label: string },
  onStatus?: StatusReporter,
): Promise<IntentResult> {
  const client = getPublicClient(config);
  const [nonce, currentBatch] = await Promise.all([
    client.readContract({
      address: config.fairBatch,
      abi: fairBatchAbi,
      functionName: 'getNonce',
      args: [account],
    }),
    client.readContract({
      address: config.fairBatch,
      abi: fairBatchAbi,
      functionName: 'currentBatch',
    }),
  ]);
  const amountRaw = toRawAmount(params.amountIn, inputDecimals(config, params.side));
  const limitRaw = toWadPrice(params.limitPrice);
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const domain = {
    name: 'FairBatch',
    version: '1',
    chainId: config.chainId,
    verifyingContract: config.fairBatch,
  } as const;
  const types = {
    SignedOrder: [
      { name: 'trader', type: 'address' },
      { name: 'side', type: 'uint8' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'limitPrice', type: 'uint256' },
      { name: 'batchId', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  } as const;
  const message = {
    trader: account,
    side: sideU8(params.side),
    amountIn: amountRaw,
    limitPrice: limitRaw,
    batchId: currentBatch.batchId,
    nonce,
    deadline: BigInt(deadline),
  } as const;

  onStatus?.('Sign your order message in your wallet…');
  const wallet = await ensureWalletReady(config, account);
  const signature = await wallet.signTypedData({
    account,
    domain,
    types,
    primaryType: 'SignedOrder',
    message,
  });
  const digest = hashTypedData({
    domain,
    types,
    primaryType: 'SignedOrder',
    message,
  });

  return {
    trader: account,
    label: params.label,
    side: params.side,
    amount_in: Number(params.amountIn),
    limit_price: Number(params.limitPrice),
    amount_in_raw: amountRaw.toString(),
    limit_price_raw: limitRaw.toString(),
    batch_id: Number(currentBatch.batchId),
    nonce: Number(nonce),
    deadline,
    signature,
    digest,
  };
}

export async function submitSignedIntent(
  config: RuntimeConfig,
  account: Address,
  artifact: SignedIntentArtifact,
  onStatus?: StatusReporter,
): Promise<DirectOrderResult> {
  if (getAddress(artifact.trader) !== getAddress(account)) {
    throw new Error('The connected wallet must be the signed order owner.');
  }
  const amountRaw = BigInt(artifact.amount_in_raw);
  const limitRaw = BigInt(artifact.limit_price_raw);
  const symbol = inputSymbol(config, artifact.side);
  const approved = await ensureInputAllowance(config, account, artifact.side, amountRaw, onStatus);

  onStatus?.(
    approved
      ? `Approved ${symbol} → Submitting signed order…`
      : 'Submitting signed order to the current round…',
  );
  const wallet = await ensureWalletReady(config, account);
  const hash = await withPostApproveRetry(
    Boolean(approved),
    () =>
      wallet.writeContract({
        address: config.fairBatch,
        abi: fairBatchAbi,
        functionName: 'submitSignedIntent',
        args: [
          {
            trader: getAddress(artifact.trader),
            side: sideU8(artifact.side),
            amountIn: amountRaw,
            limitPrice: limitRaw,
            batchId: BigInt(artifact.batch_id),
            nonce: BigInt(artifact.nonce),
            deadline: BigInt(artifact.deadline),
          },
          artifact.signature as `0x${string}`,
        ],
        account,
        chain: getChain(config),
      }),
    onStatus,
  );
  onStatus?.('Confirming signed order on Sepolia…');
  const receipt = await waitForSuccess(config, hash, onStatus);
  const events = decodeEvents(receipt, 'OrderSubmitted');
  const orderId = events[0] ? Number(eventBig(events[0], 'orderId')) : -1;
  return { hash, receipt, orderId };
}

/**
 * Single-button signed order flow used automatically in Simple mode during the
 * Finalizing (`Reveal`) window so users can trade without waiting for the next round.
 */
export async function signAndSubmitIntent(
  config: RuntimeConfig,
  account: Address,
  params: { side: OrderSide; amountIn: string; limitPrice: string; label: string },
  onStatus?: StatusReporter,
): Promise<DirectOrderResult> {
  const amountRaw = toRawAmount(params.amountIn, inputDecimals(config, params.side));
  await ensureInputAllowance(config, account, params.side, amountRaw, onStatus);
  onStatus?.('Step 1/2: Sign your order in your wallet…');
  const artifact = await signIntent(config, account, params, onStatus);
  onStatus?.('Step 2/2: Submitting your order to this round…');
  return submitSignedIntent(config, account, artifact, onStatus);
}

export async function settleBatch(
  config: RuntimeConfig,
  account: Address,
  onStatus?: StatusReporter,
): Promise<{ hash: Hash; batchId: number }> {
  onStatus?.('Starting next round & pricing finished orders…');
  const wallet = await ensureWalletReady(config, account);
  const hash = await wallet.writeContract({
    address: config.fairBatch,
    abi: fairBatchAbi,
    functionName: 'settleBatch',
    args: [],
    account,
    chain: getChain(config),
  });
  onStatus?.('Confirming round settlement on Sepolia…');
  const receipt = await waitForSuccess(config, hash, onStatus);
  const events = decodeEvents(receipt, 'BatchSettled');
  return {
    hash,
    batchId: events[0] ? Number(eventBig(events[0], 'batchId')) : -1,
  };
}

export async function slashUnrevealed(
  config: RuntimeConfig,
  account: Address,
  batchId: number,
  commitId: number,
  onStatus?: StatusReporter,
): Promise<{ hash: Hash; forfeitedBond: bigint }> {
  onStatus?.('Slashing expired unrevealed commitment…');
  const wallet = await ensureWalletReady(config, account);
  const hash = await wallet.writeContract({
    address: config.fairBatch,
    abi: fairBatchAbi,
    functionName: 'slashUnrevealed',
    args: [BigInt(batchId), BigInt(commitId)],
    account,
    chain: getChain(config),
  });
  onStatus?.('Confirming slash bounty on Sepolia…');
  const receipt = await waitForSuccess(config, hash, onStatus);
  const events = decodeEvents(receipt, 'CommitmentSlashed');
  return {
    hash,
    forfeitedBond: events[0] ? eventBig(events[0], 'forfeitedBond') : 0n,
  };
}

export async function claimOrder(
  config: RuntimeConfig,
  account: Address,
  batchId: number,
  orderId: number,
  onStatus?: StatusReporter,
): Promise<{ hash: Hash; payoutBase: bigint; payoutQuote: bigint }> {
  onStatus?.('Confirm token collection in your wallet…');
  const wallet = await ensureWalletReady(config, account);
  const hash = await wallet.writeContract({
    address: config.fairBatch,
    abi: fairBatchAbi,
    functionName: 'claim',
    args: [BigInt(batchId), BigInt(orderId)],
    account,
    chain: getChain(config),
  });
  onStatus?.('Collecting your tokens on Sepolia…');
  const receipt = await waitForSuccess(config, hash, onStatus);
  const events = decodeEvents(receipt, 'OrderClaimed');
  const claimed = events[0];
  return {
    hash,
    payoutBase: claimed ? eventBig(claimed, 'payoutBase') : 0n,
    payoutQuote: claimed ? eventBig(claimed, 'payoutQuote') : 0n,
  };
}

export async function claimMany(
  config: RuntimeConfig,
  account: Address,
  items: Array<{ batchId: number; orderId: number }>,
  onStatus?: StatusReporter,
): Promise<{ hash: Hash; claimed: number }> {
  if (items.length === 0) throw new Error('No claims selected.');
  onStatus?.(`Confirm collecting ${items.length} completed orders in your wallet…`);
  const calls = items.map((item) =>
    encodeFunctionData({
      abi: fairBatchAbi,
      functionName: 'claim',
      args: [BigInt(item.batchId), BigInt(item.orderId)],
    }),
  );
  const wallet = await ensureWalletReady(config, account);
  const hash = await wallet.writeContract({
    address: config.fairBatch,
    abi: fairBatchAbi,
    functionName: 'multicall',
    args: [calls],
    account,
    chain: getChain(config),
  });
  onStatus?.(`Collecting ${items.length} payouts in one transaction…`);
  const receipt = await waitForSuccess(config, hash, onStatus);
  const events = decodeEvents(receipt, 'OrderClaimed');
  return { hash, claimed: events.length };
}

export async function addLiquidity(
  config: RuntimeConfig,
  account: Address,
  amountBase: string,
  amountQuote: string,
  lockDurationSecs = 0,
  minShares = 0n,
  onStatus?: StatusReporter,
): Promise<LiquidityResult> {
  const baseRaw = toRawAmount(amountBase, config.baseDecimals);
  const quoteRaw = toRawAmount(amountQuote, config.quoteDecimals);
  const lockSecs = Math.max(0, Math.floor(lockDurationSecs));
  await approveToken(
    config,
    account,
    config.baseToken,
    config.fairBatch,
    baseRaw,
    config.baseSymbol,
    onStatus,
  );
  await approveToken(
    config,
    account,
    config.quoteToken,
    config.fairBatch,
    quoteRaw,
    config.quoteSymbol,
    onStatus,
  );

  onStatus?.(lockSecs > 0 ? 'Adding & locking liquidity…' : 'Adding liquidity to the pool…');
  const wallet = await ensureWalletReady(config, account);
  const hash =
    lockSecs > 0
      ? await wallet.writeContract({
          address: config.fairBatch,
          abi: fairBatchAbi,
          functionName: 'addLiquidityLocked',
          args: [baseRaw, quoteRaw, BigInt(lockSecs), minShares],
          account,
          chain: getChain(config),
        })
      : await wallet.writeContract({
          address: config.fairBatch,
          abi: fairBatchAbi,
          functionName: 'addLiquidity',
          args: [baseRaw, quoteRaw, minShares],
          account,
          chain: getChain(config),
        });
  onStatus?.('Confirming liquidity deposit on Sepolia…');
  const receipt = await waitForSuccess(config, hash, onStatus);
  const addedEvents = decodeEvents(receipt, 'LiquidityAdded');
  const lockedEvents = lockSecs > 0 ? decodeEvents(receipt, 'LiquidityLocked') : [];
  return {
    hash,
    receipt,
    sharesMinted: addedEvents[0] ? eventBig(addedEvents[0], 'sharesMinted') : undefined,
    amountBase: addedEvents[0] ? eventBig(addedEvents[0], 'amountBase') : baseRaw,
    amountQuote: addedEvents[0] ? eventBig(addedEvents[0], 'amountQuote') : quoteRaw,
    unlockTime: lockedEvents[0] ? eventBig(lockedEvents[0], 'unlockTime') : undefined,
  };
}

export async function removeLiquidity(
  config: RuntimeConfig,
  account: Address,
  shares: string,
  minBase = 0n,
  minQuote = 0n,
  onStatus?: StatusReporter,
): Promise<LiquidityResult> {
  const sharesRaw = toRawAmount(shares, 18);
  onStatus?.('Withdrawing liquidity from the pool…');
  const wallet = await ensureWalletReady(config, account);
  const hash = await wallet.writeContract({
    address: config.fairBatch,
    abi: fairBatchAbi,
    functionName: 'removeLiquidity',
    args: [sharesRaw, minBase, minQuote],
    account,
    chain: getChain(config),
  });
  onStatus?.('Confirming withdrawal on Sepolia…');
  const receipt = await waitForSuccess(config, hash, onStatus);
  const events = decodeEvents(receipt, 'LiquidityRemoved');
  return {
    hash,
    receipt,
    amountBase: events[0] ? eventBig(events[0], 'amountBase') : undefined,
    amountQuote: events[0] ? eventBig(events[0], 'amountQuote') : undefined,
  };
}

export async function approveFairBatch(
  config: RuntimeConfig,
  account: Address,
  token: 'base' | 'quote',
  onStatus?: StatusReporter,
): Promise<Hash | null> {
  const tokenAddress = token === 'base' ? config.baseToken : config.quoteToken;
  const symbol = token === 'base' ? config.baseSymbol : config.quoteSymbol;
  return approveToken(
    config,
    account,
    tokenAddress,
    config.fairBatch,
    maxUint256,
    symbol,
    onStatus,
  );
}

export interface ErrorMappingContext {
  lockUnlockTimeSecs?: number;
}

/**
 * Maps contract reverts, wallet rejections, and RPC failures into plain-language messages.
 */
export function describeTxError(error: unknown, context?: ErrorMappingContext): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';

  if (raw) {
    if (raw.includes('Faucet cooldown active')) {
      return 'Faucet cooldown active — you can claim free test tokens once every 12 hours.';
    }
    if (raw.includes('LP shares locked')) {
      if (context?.lockUnlockTimeSecs && context.lockUnlockTimeSecs > 0) {
        const unlockStr = new Date(context.lockUnlockTimeSecs * 1000).toLocaleString();
        return `Your liquidity is locked until ${unlockStr}.`;
      }
      return 'Your liquidity is locked until the lock period ends.';
    }
    if (
      raw.includes('Slippage: insufficient LP shares') ||
      raw.includes('Slippage: insufficient base output') ||
      raw.includes('Slippage: insufficient quote output')
    ) {
      return 'Price moved too much, try again.';
    }
    if (
      raw.includes('Commit window closed') ||
      raw.includes('Intent window closed') ||
      raw.includes('Batch already settled')
    ) {
      return 'This round closed, try the next one.';
    }
    if (raw.includes('Reveal window closed') || raw.includes('Commitment slashed')) {
      return 'Sealed order not revealed in time.';
    }

    const known: Array<[string, string]> = [
      ['Reveal window not open yet', 'Wait until this round enters Finalizing before revealing your sealed order.'],
      ['Reveal window still active', 'This round is still finalizing — wait a few seconds for the countdown to finish.'],
      ['Insufficient allowance', 'Token approval is too low. Approve the token and try again.'],
      ['Insufficient balance', 'Wallet balance is too low for this amount.'],
      ['Insufficient reveal bond', 'The refundable deposit is below the contract minimum.'],
      ['Insufficient Sepolia ETH', 'You need a little Sepolia ETH for gas (and any sealed deposit).'],
      ['insufficient funds for gas', 'Not enough Sepolia ETH to cover transaction gas.'],
      ['Commitment hash mismatch', 'The reveal details do not match your sealed order.'],
      ['Already revealed', 'This sealed order has already been revealed.'],
      ['Not commitment owner', 'Only the wallet that placed this sealed order can reveal it.'],
      ['Not order owner', 'Only the wallet that placed this order can collect it.'],
      ['Order already claimed', 'You already collected this order.'],
      ['Invalid EIP-712 signed intent', 'Order signature could not be verified. Please sign again.'],
      ['Reveal window not expired', 'This sealed order still has time left to reveal and cannot be slashed yet.'],
      ['Commitment was revealed', 'This sealed order was already revealed and cannot be slashed.'],
      ['Already slashed', 'This expired deposit has already been slashed.'],
      ['user rejected', 'You canceled the request in your wallet.'],
      ['User rejected', 'You canceled the request in your wallet.'],
      ['ACTION_REJECTED', 'You canceled the request in your wallet.'],
      ['429', 'Sepolia RPC is busy right now — retrying automatically.'],
      ['Too Many Requests', 'Sepolia RPC is busy right now — retrying automatically.'],
      ['HTTP request failed', 'Network hiccup reaching Sepolia RPC. Try refreshing in a moment.'],
      ['timed out', 'Sepolia confirmation is taking longer than expected. Check Etherscan or refresh.'],
    ];
    for (const [needle, message] of known) {
      if (raw.includes(needle)) return message;
    }
    if (raw.includes('returned no data') || raw.includes('is not a contract')) {
      return 'Unable to reach the FairBatch contract on Ethereum Sepolia.';
    }
    const short = (error as { shortMessage?: string } | null)?.shortMessage;
    if (short) return short;
    return raw.split('\n')[0].slice(0, 220);
  }
  return 'Transaction failed. Please try again.';
}
