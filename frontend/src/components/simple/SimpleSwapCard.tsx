import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownUp,
  ChevronDown,
  ChevronUp,
  Droplets,
  Eye,
  KeyRound,
  Loader2,
  Lock,
  Shield,
  Sparkles,
} from 'lucide-react';
import { formatUnits } from 'viem';
import type {
  BatchPhase,
  LocalSecretVaultEntry,
  OrderSide,
  StateResponse,
} from '../../types';
import type {
  ChainCommitment,
  FaucetState,
  RawBatchInfo,
  WalletBalances,
} from '../../onchain/state';
import { remainingSecondsForPhase } from '../../onchain/state';
import type { RuntimeConfig } from '../../onchain/config';
import { computeBatchSettlement } from '../../lib/clearingMath';
import { generateRandomSaltHex } from '../../lib/keccak';
import { formatPrice, formatToken } from '../../lib/format';
import { SIMPLE_COPY, SIMPLE_ORDER_MODES } from '../../lib/glossary';

type SimpleOrderMode = 'direct' | 'sealed' | 'signed';

interface SimpleSwapCardProps {
  config: RuntimeConfig;
  state: StateResponse;
  batch: RawBatchInfo;
  livePhase: BatchPhase;
  chainNow: number;
  account: string | null;
  wrongNetwork: boolean;
  balances: WalletBalances | null;
  faucet: FaucetState | null;
  minBondWei: bigint;
  userPendingCommits: ChainCommitment[];
  localSecrets: LocalSecretVaultEntry[];
  busyAction: string | null;
  txStatus: string | null;
  onConnect: () => Promise<void>;
  onSwitchNetwork: () => Promise<void>;
  onClaimFaucet: () => Promise<void>;
  onSubmitDirect: (params: {
    side: OrderSide;
    amountIn: string;
    limitPrice: string;
  }) => Promise<void>;
  onSettleAndSubmitDirect: (params: {
    side: OrderSide;
    amountIn: string;
    limitPrice: string;
  }) => Promise<void>;
  onSignAndSubmitIntent: (params: {
    side: OrderSide;
    amountIn: string;
    limitPrice: string;
  }) => Promise<void>;
  onSealCommit: (params: {
    side: OrderSide;
    amountIn: string;
    limitPrice: string;
    salt: string;
    bondEth: string;
  }) => Promise<void>;
  onRevealCommit: (secret: LocalSecretVaultEntry) => Promise<void>;
  onStartNextRound: () => Promise<void>;
}

const SLIPPAGE_PRESETS = [2, 5, 8, 12];

function human(raw: bigint | undefined, decimals: number): number {
  if (raw === undefined) return 0;
  return Number(formatUnits(raw, decimals));
}

function cleanDecimal(value: number, maxDecimals: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  return value
    .toFixed(maxDecimals)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '');
}

function formatClock(totalSeconds: number): string {
  const secs = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}:${String(rem).padStart(2, '0')}`;
}

export const SimpleSwapCard: React.FC<SimpleSwapCardProps> = ({
  config,
  state,
  batch,
  livePhase,
  chainNow,
  account,
  wrongNetwork,
  balances,
  faucet,
  minBondWei,
  userPendingCommits,
  localSecrets,
  busyAction,
  txStatus,
  onConnect,
  onSwitchNetwork,
  onClaimFaucet,
  onSubmitDirect,
  onSettleAndSubmitDirect,
  onSignAndSubmitIntent,
  onSealCommit,
  onRevealCommit,
  onStartNextRound,
}) => {
  const [side, setSide] = useState<OrderSide>('SellBase');
  const [amountInput, setAmountInput] = useState<string>('0.5');
  const [slippagePct, setSlippagePct] = useState<number>(8);
  const [orderMode, setOrderMode] = useState<SimpleOrderMode>('direct');
  const [bondEth, setBondEth] = useState<string>(() =>
    Math.max(0.001, Number(minBondWei) / 1e18).toString(),
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const busy = busyAction !== null;
  const spot = state.reserves.spot_price || 3000;
  const baseBal = human(balances?.base, config.baseDecimals);
  const quoteBal = human(balances?.quote, config.quoteDecimals);
  const paySymbol = side === 'SellBase' ? config.baseSymbol : config.quoteSymbol;
  const receiveSymbol = side === 'SellBase' ? config.quoteSymbol : config.baseSymbol;
  const payBalance = side === 'SellBase' ? baseBal : quoteBal;

  const parsedAmount = Number(amountInput);
  const validAmount = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const insufficientBalance = Boolean(account && validAmount && parsedAmount > payBalance + 1e-9);

  // Equivalent limit price derived from max slippage tolerance (keeps 8% safe default).
  const limitPriceNum = useMemo(() => {
    const tol = Math.max(0.5, Math.min(45, slippagePct)) / 100;
    const raw = side === 'SellBase' ? spot * (1 - tol) : spot * (1 + tol);
    return Math.max(1, Number(raw.toFixed(2)));
  }, [side, spot, slippagePct]);

  // Real current queue fair price vs projected fair price with user's draft order.
  const queueSettlement = useMemo(
    () =>
      computeBatchSettlement(
        state.batch_id,
        state.reserves.rx,
        state.reserves.ry,
        state.orders,
      ),
    [state.batch_id, state.reserves.rx, state.reserves.ry, state.orders],
  );

  const previewWithOrder = useMemo(() => {
    if (!validAmount) return null;
    const draftOrders =
      livePhase === 'Ready'
        ? [
            {
              order_id: 999999,
              trader: account ?? '0x0000000000000000000000000000000000000000',
              label: 'You',
              side,
              amount_in: parsedAmount,
              limit_price: limitPriceNum,
              submission_type: 'Direct' as const,
              is_attacker: false,
            },
          ]
        : [
            ...state.orders,
            {
              order_id: 999999,
              trader: account ?? '0x0000000000000000000000000000000000000000',
              label: 'You',
              side,
              amount_in: parsedAmount,
              limit_price: limitPriceNum,
              submission_type: 'Direct' as const,
              is_attacker: false,
            },
          ];

    const simulated = computeBatchSettlement(
      state.batch_id,
      state.reserves.rx,
      state.reserves.ry,
      draftOrders,
    );
    const myFill = simulated.fills.find((f) => f.order_id === 999999);
    return {
      fairPrice: simulated.clearing_price,
      estimatedOut: myFill?.payout_out ?? 0,
      status: myFill?.status ?? 'Filled',
    };
  }, [
    validAmount,
    livePhase,
    account,
    side,
    parsedAmount,
    limitPriceNum,
    state.orders,
    state.batch_id,
    state.reserves.rx,
    state.reserves.ry,
  ]);

  const remaining = remainingSecondsForPhase(batch, livePhase, chainNow);

  // Determine whether Reveal phase will auto-route via EIP-712 signed swap (Option A).
  const autoSignedInFinalizing = livePhase === 'Reveal' && orderMode === 'direct';
  const sealedBlockedInFinalizing = livePhase === 'Reveal' && orderMode === 'sealed';

  const handleFlip = () => {
    setLocalError(null);
    const nextSide: OrderSide = side === 'SellBase' ? 'BuyBase' : 'SellBase';
    setSide(nextSide);
    if (nextSide === 'SellBase') {
      setAmountInput(baseBal > 0 ? cleanDecimal(Math.min(0.5, baseBal), 4) : '0.5');
    } else {
      setAmountInput(quoteBal > 0 ? cleanDecimal(Math.min(100, quoteBal), 2) : '100');
    }
  };

  const applyQuickChip = (fraction: number) => {
    setLocalError(null);
    if (payBalance > 0) {
      const target = payBalance * fraction;
      setAmountInput(cleanDecimal(target, side === 'SellBase' ? 4 : 2));
    } else {
      const fallbackVal = side === 'SellBase' ? fraction : Math.round(fraction * 100);
      setAmountInput(String(fallbackVal));
    }
  };

  const handleSwapSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (!account) {
      await onConnect();
      return;
    }
    if (wrongNetwork) {
      await onSwitchNetwork();
      return;
    }
    if (!validAmount) {
      setLocalError('Enter an amount greater than zero.');
      return;
    }
    if (insufficientBalance) {
      setLocalError(
        `You only have ${
          side === 'SellBase' ? formatToken(payBalance, 4) : formatPrice(payBalance, 2)
        } ${paySymbol}. Lower the amount or claim free test tokens.`,
      );
      return;
    }

    const params = {
      side,
      amountIn: amountInput.trim(),
      limitPrice: String(limitPriceNum),
    };

    try {
      if (orderMode === 'sealed') {
        if (livePhase === 'Ready') {
          await onStartNextRound();
        } else if (livePhase === 'Reveal') {
          setLocalError(
            'Private sealed orders can only be placed while a round is collecting orders. Switch to Standard or wait for the next round.',
          );
          return;
        }
        await onSealCommit({
          ...params,
          salt: generateRandomSaltHex(),
          bondEth,
        });
        return;
      }

      if (orderMode === 'signed' || autoSignedInFinalizing) {
        if (livePhase === 'Ready') {
          await onStartNextRound();
        }
        await onSignAndSubmitIntent(params);
        return;
      }

      // Standard (Direct) path: if Ready, combine settleBatch + submitDirectOrder in ONE multicall tx!
      if (livePhase === 'Ready') {
        await onSettleAndSubmitDirect(params);
      } else {
        await onSubmitDirect(params);
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Swap failed. Please try again.');
    }
  };

  const unrevealedCommits = userPendingCommits.filter((c) => !c.revealed && !c.slashed);
  const canClaimFaucetNow = Boolean(
    config.tokenFaucetEnabled &&
      account &&
      !wrongNetwork &&
      (faucet ? faucet.canClaim || Number(faucet.nextClaimAt) <= chainNow : true),
  );

  const primaryButtonText = (() => {
    if (busy) return txStatus ?? 'Working on Sepolia…';
    if (!account) return 'Connect wallet to swap';
    if (wrongNetwork) return 'Switch to Sepolia';
    if (sealedBlockedInFinalizing) {
      return `Private swap opens in ${formatClock(remaining)}`;
    }
    if (orderMode === 'sealed') {
      return livePhase === 'Ready'
        ? 'Start next round & place private swap'
        : 'Place private swap';
    }
    if (orderMode === 'signed' || autoSignedInFinalizing) {
      return 'Swap now (sign & send)';
    }
    if (livePhase === 'Ready') {
      return 'Start next round & Swap';
    }
    return 'Swap';
  })();

  return (
    <section
      aria-label="Swap tokens"
      data-testid="simple-swap-card"
      className="ledger-panel overflow-hidden"
    >
      {/* Prominent Ready-round banner — never a dead end */}
      {livePhase === 'Ready' && (
        <div
          data-testid="simple-ready-banner"
          className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-vermilion-500 bg-vermilion-50 px-5 py-3.5"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 font-mono text-xs font-bold uppercase tracking-label text-vermilion-800">
              <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Round #{state.batch_id} finished</span>
            </div>
            <p className="mt-1 text-sm leading-snug text-ink">
              {SIMPLE_COPY.readyBanner}
            </p>
          </div>
          {account && !wrongNetwork && (
            <button
              type="button"
              data-testid="simple-start-next-round"
              disabled={busy}
              onClick={() => void onStartNextRound()}
              className="tap-target shrink-0 bg-vermilion-500 px-4 font-display text-sm font-bold text-[#FBF8F0] transition hover:bg-vermilion-600 disabled:opacity-50"
            >
              {busyAction === 'settle' ? 'Starting…' : SIMPLE_COPY.readyButton}
            </button>
          )}
        </div>
      )}

      {/* Prominent Reveal prompt if the user has a sealed commit ready to reveal */}
      {livePhase === 'Reveal' && unrevealedCommits.length > 0 && (
        <div
          data-testid="simple-reveal-now-banner"
          className="space-y-2.5 border-b-2 border-brass-600 bg-brass-50 px-5 py-4"
        >
          <div className="flex items-center gap-2 text-sm font-bold text-brass-900">
            <Eye className="h-4 w-4 text-brass-700" aria-hidden="true" />
            <span>
              Reveal now ({formatClock(remaining)} left) — unlock your swap and get your deposit
              back
            </span>
          </div>
          {unrevealedCommits.map((commit) => {
            const secret = localSecrets.find(
              (s) =>
                s.batch_id === commit.batch_id &&
                s.commit_id === commit.commit_id &&
                !s.revealed,
            );
            return (
              <div
                key={commit.commit_id}
                className="flex flex-wrap items-center justify-between gap-2 border border-brass-600/40 bg-paper-bright px-3.5 py-2.5"
              >
                <span className="text-sm text-ink">
                  {secret
                    ? `Private swap #${commit.commit_id} · secret saved in this browser`
                    : `Private swap #${commit.commit_id} · secret missing in this browser`}
                </span>
                {secret && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void onRevealCommit(secret)}
                    className="tap-target bg-brass-600 px-4 font-display text-sm font-bold text-[#FBF8F0] transition hover:bg-brass-700 disabled:opacity-50"
                  >
                    {busyAction === 'reveal' ? 'Revealing…' : 'Reveal now'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Finalizing phase notice (Option A: auto-route via EIP-712 signed swap) */}
      {livePhase === 'Reveal' && orderMode === 'direct' && (
        <div
          data-testid="simple-finalizing-notice"
          className="flex items-start gap-2.5 border-b border-rule bg-brass-50 px-5 py-3 text-sm text-brass-900"
        >
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-brass-700" aria-hidden="true" />
          <span>
            Round #{state.batch_id} is finalizing ({formatClock(remaining)} left). You can still
            join immediately — your wallet will ask for a quick signature before sending.
          </span>
        </div>
      )}

      <form onSubmit={handleSwapSubmit} className="space-y-4 p-5">
        {/* YOU PAY */}
        <div className="border border-rule-strong bg-paper-soft p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="simple-pay-input" className="text-xs font-bold uppercase tracking-label text-ink-muted">
              You pay
            </label>
            <div className="flex items-center gap-2 font-mono text-xs text-ink-muted tabular-nums">
              <span>
                Balance:{' '}
                <strong className="text-ink">
                  {side === 'SellBase'
                    ? formatToken(payBalance, 4)
                    : formatPrice(payBalance, 2)}{' '}
                  {paySymbol}
                </strong>
              </span>
              {payBalance > 0 && (
                <button
                  type="button"
                  onClick={() => applyQuickChip(1)}
                  className="min-h-[32px] border border-rule-strong bg-paper-bright px-2 font-mono text-xs font-bold text-vermilion-700 transition hover:border-vermilion-600"
                >
                  Max
                </button>
              )}
            </div>
          </div>

          <div className="mt-2.5 flex items-center gap-3">
            <input
              id="simple-pay-input"
              data-testid="simple-pay-input"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              value={amountInput}
              onChange={(e) => {
                setLocalError(null);
                setAmountInput(e.target.value);
              }}
              placeholder="0.0"
              className="min-w-0 flex-1 bg-transparent font-mono text-2xl font-bold text-ink tabular-nums focus:outline-none sm:text-3xl"
            />
            <select
              aria-label="Token to pay"
              value={side}
              onChange={(e) => {
                const next = e.target.value as OrderSide;
                if (next !== side) handleFlip();
              }}
              className="tap-target shrink-0 border border-ink bg-paper-bright px-3 font-display text-sm font-bold text-ink"
            >
              <option value="SellBase">{config.baseSymbol}</option>
              <option value="BuyBase">{config.quoteSymbol}</option>
            </select>
          </div>

          {/* Quick chips */}
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              { label: '25%', frac: 0.25 },
              { label: '50%', frac: 0.5 },
              { label: '75%', frac: 0.75 },
              { label: '100%', frac: 1 },
            ].map((chip) => (
              <button
                key={chip.label}
                type="button"
                onClick={() => applyQuickChip(chip.frac)}
                className="min-h-[36px] flex-1 border border-rule-strong bg-paper-bright px-2 font-mono text-xs font-bold text-ink-soft transition hover:border-ink hover:text-ink"
              >
                {chip.label}
              </button>
            ))}
          </div>
        </div>

        {/* FLIP BUTTON */}
        <div className="flex justify-center -my-1">
          <button
            type="button"
            onClick={handleFlip}
            aria-label="Flip tokens"
            className="tap-target inline-flex w-11 items-center justify-center border border-ink bg-paper-bright text-ink transition hover:bg-ink hover:text-paper"
          >
            <ArrowDownUp className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* YOU RECEIVE (ESTIMATED) */}
        <div className="border border-rule bg-paper-soft p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-label text-ink-muted">
              You receive (estimated)
            </span>
            <span className="font-mono text-xs text-ink-muted">
              Balance:{' '}
              {side === 'SellBase'
                ? `${formatPrice(quoteBal, 2)} ${config.quoteSymbol}`
                : `${formatToken(baseBal, 4)} ${config.baseSymbol}`}
            </span>
          </div>

          <div className="mt-2 flex items-baseline justify-between gap-3">
            <div
              data-testid="simple-receive-estimate"
              className="font-mono text-2xl font-bold text-pine-700 tabular-nums sm:text-3xl"
            >
              {previewWithOrder && previewWithOrder.estimatedOut > 0
                ? side === 'SellBase'
                  ? formatPrice(previewWithOrder.estimatedOut, 2)
                  : formatToken(previewWithOrder.estimatedOut, 4)
                : '0.00'}
            </div>
            <span className="border border-rule-strong bg-paper-bright px-3 py-1.5 font-display text-sm font-bold text-ink">
              {receiveSymbol}
            </span>
          </div>
        </div>

        {/* FAIR PRICE THIS ROUND (clearly labeled With your order vs Current queue — Bug 1d) */}
        <div className="space-y-1.5 border border-rule bg-paper-soft px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-ink-muted">
              Fair price this round (with your order)
            </span>
            <span className="font-mono font-bold text-ink tabular-nums">
              $
              {formatPrice(
                previewWithOrder?.fairPrice ?? queueSettlement.clearing_price,
                2,
              )}{' '}
              {config.quoteSymbol} / {config.baseSymbol}
            </span>
          </div>
          {state.orders.length > 0 && livePhase !== 'Ready' && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
              <span>Current queue (before your order)</span>
              <span className="font-mono tabular-nums">
                ${formatPrice(queueSettlement.clearing_price, 2)} {config.quoteSymbol} /{' '}
                {config.baseSymbol}
              </span>
            </div>
          )}
        </div>

        {/* COLLAPSED ADVANCED ACCORDION (Max price slippage) */}
        <div className="border border-rule bg-paper-bright">
          <button
            type="button"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((v) => !v)}
            className="tap-target flex w-full items-center justify-between px-4 text-left text-sm font-bold text-ink-soft transition hover:text-ink"
          >
            <span>Advanced · Max price slippage ({slippagePct}%)</span>
            {advancedOpen ? (
              <ChevronUp className="h-4 w-4 text-ink-muted" />
            ) : (
              <ChevronDown className="h-4 w-4 text-ink-muted" />
            )}
          </button>
          {advancedOpen && (
            <div className="space-y-3 border-t border-rule px-4 py-3.5">
              <div className="flex flex-wrap gap-2">
                {SLIPPAGE_PRESETS.map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    aria-pressed={slippagePct === pct}
                    onClick={() => setSlippagePct(pct)}
                    className={`tap-target flex-1 border px-3 font-mono text-xs font-bold transition ${
                      slippagePct === pct
                        ? 'border-ink bg-ink text-paper'
                        : 'border-rule-strong bg-paper-soft text-ink-soft hover:border-ink'
                    }`}
                  >
                    {pct}%
                  </button>
                ))}
              </div>
              <p className="text-xs text-ink-muted">
                Equivalent {side === 'SellBase' ? 'minimum' : 'maximum'} price limit:{' '}
                <strong className="font-mono text-ink">
                  ${formatPrice(limitPriceNum, 2)} {config.quoteSymbol} per {config.baseSymbol}
                </strong>
                . If the round price moves past this limit, your tokens are refunded in full.
              </p>
            </div>
          )}
        </div>

        {/* COLLAPSED MORE PRIVACY OPTIONS ACCORDION */}
        <div className="border border-rule bg-paper-bright">
          <button
            type="button"
            aria-expanded={privacyOpen}
            onClick={() => setPrivacyOpen((v) => !v)}
            className="tap-target flex w-full items-center justify-between px-4 text-left text-sm font-bold text-ink-soft transition hover:text-ink"
          >
            <span className="inline-flex items-center gap-2">
              <Shield className="h-4 w-4 text-cobalt-700" aria-hidden="true" />
              <span>
                More privacy options · {SIMPLE_ORDER_MODES[orderMode].title}
              </span>
            </span>
            {privacyOpen ? (
              <ChevronUp className="h-4 w-4 text-ink-muted" />
            ) : (
              <ChevronDown className="h-4 w-4 text-ink-muted" />
            )}
          </button>

          {privacyOpen && (
            <div className="space-y-3 border-t border-rule px-4 py-3.5">
              {(['direct', 'sealed', 'signed'] as SimpleOrderMode[]).map((modeId) => {
                const info = SIMPLE_ORDER_MODES[modeId];
                const selected = orderMode === modeId;
                return (
                  <button
                    key={modeId}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setOrderMode(modeId)}
                    className={`w-full border p-3 text-left transition ${
                      selected
                        ? 'border-ink bg-paper-soft'
                        : 'border-rule bg-paper-bright hover:border-rule-strong'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display text-sm font-bold text-ink">
                        {info.title}
                      </span>
                      {selected && (
                        <span className="bg-ink px-2 py-0.5 font-mono text-xs font-bold text-paper">
                          Selected
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                      {info.description}
                    </p>
                  </button>
                );
              })}

              {orderMode === 'sealed' && (
                <div className="space-y-2.5 border border-brass-600/50 bg-brass-50 p-3.5 text-xs text-brass-900">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-brass-700" />
                    <p className="leading-relaxed font-medium">
                      {SIMPLE_COPY.sealedStorageWarning}
                    </p>
                  </div>
                  <p className="leading-relaxed text-ink-soft">
                    {SIMPLE_COPY.sealedDepositNote}
                  </p>
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <label htmlFor="simple-deposit-eth" className="font-bold text-ink">
                      Refundable deposit (ETH)
                    </label>
                    <input
                      id="simple-deposit-eth"
                      type="number"
                      step="any"
                      min={Number(minBondWei) / 1e18}
                      value={bondEth}
                      onChange={(e) => setBondEth(e.target.value)}
                      className="w-28 border border-rule-strong bg-paper-bright px-2.5 py-1.5 text-right font-mono text-sm font-bold text-ink"
                    />
                  </div>
                </div>
              )}

              {/* Pending sealed orders list + localStorage secret status */}
              {userPendingCommits.length > 0 && (
                <div className="space-y-2 border-t border-rule pt-3">
                  <div className="eyebrow">Your pending sealed orders</div>
                  {userPendingCommits.map((commit) => {
                    const secret = localSecrets.find(
                      (s) =>
                        s.batch_id === commit.batch_id &&
                        s.commit_id === commit.commit_id,
                    );
                    return (
                      <div
                        key={`${commit.batch_id}-${commit.commit_id}`}
                        className="flex flex-wrap items-center justify-between gap-2 border border-rule bg-paper-soft px-3 py-2 text-xs"
                      >
                        <div>
                          <div className="font-bold text-ink">
                            Round #{commit.batch_id} · Deposit {formatToken(commit.bond_eth, 4)} ETH
                          </div>
                          <div className="text-ink-muted">
                            {commit.revealed
                              ? 'Revealed'
                              : commit.slashed
                                ? 'Expired'
                                : secret
                                  ? 'Secret saved in this browser'
                                  : 'Secret missing in this browser'}
                          </div>
                        </div>
                        {!commit.revealed && !commit.slashed && secret && livePhase === 'Reveal' && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void onRevealCommit(secret)}
                            className="tap-target bg-brass-600 px-3 font-bold text-paper"
                          >
                            Reveal now
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Validation / tx error */}
        {localError && (
          <div
            role="alert"
            className="flex items-start gap-2 border-l-2 border-vermilion-600 bg-vermilion-50 px-3.5 py-2.5 text-sm text-vermilion-800"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{localError}</span>
          </div>
        )}

        {/* Single status line while pending */}
        {busy && txStatus && (
          <div
            role="status"
            data-testid="simple-tx-status"
            className="flex items-center gap-2 border-l-2 border-cobalt-600 bg-cobalt-50 px-3.5 py-2.5 text-sm font-medium text-cobalt-800"
          >
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
            <span>{txStatus}</span>
          </div>
        )}

        {/* ONE PRIMARY SWAP BUTTON */}
        <button
          type="submit"
          data-testid="simple-swap-button"
          disabled={busy || sealedBlockedInFinalizing || (Boolean(account) && !wrongNetwork && (!validAmount || insufficientBalance))}
          className="tap-target inline-flex w-full items-center justify-center gap-2 bg-vermilion-500 px-5 py-3.5 font-display text-base font-bold text-[#FBF8F0] transition hover:bg-vermilion-600 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {busy ? (
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          ) : orderMode === 'sealed' ? (
            <Lock className="h-5 w-5" aria-hidden="true" />
          ) : null}
          <span>{primaryButtonText}</span>
        </button>

        {/* Plain explanation under the Swap button */}
        <p className="text-center text-sm leading-relaxed text-ink-muted">
          {SIMPLE_COPY.swapCaption}
        </p>

        {/* Subtle top-up faucet link when already funded */}
        {canClaimFaucetNow && (
          <div className="flex justify-center pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => void onClaimFaucet()}
              className="inline-flex min-h-[36px] items-center gap-1.5 text-xs font-bold text-cobalt-700 underline decoration-dotted underline-offset-4 transition hover:text-ink disabled:opacity-40"
            >
              <Droplets className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Need more free test tokens? Claim from faucet</span>
            </button>
          </div>
        )}
      </form>
    </section>
  );
};
