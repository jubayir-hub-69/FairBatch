import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  ChevronUp,
  Coins,
  Loader2,
  Lock,
  Scale,
  Unlock,
} from 'lucide-react';
import { formatUnits, parseUnits } from 'viem';
import type { RuntimeConfig } from '../../onchain/config';
import type {
  LiquidityLockState,
  RawReserves,
  WalletBalances,
} from '../../onchain/state';
import { formatDuration, formatPrice, formatToken } from '../../lib/format';
import { SIMPLE_COPY } from '../../lib/glossary';

type LockPresetId = 'none' | '1h' | '12h' | '1d' | '7d' | 'custom';
type CustomUnit = 'minutes' | 'hours' | 'days';

const LOCK_OPTIONS: ReadonlyArray<{ id: LockPresetId; label: string; seconds: number }> = [
  { id: 'none', label: 'No lock', seconds: 0 },
  { id: '1h', label: '1h', seconds: 3_600 },
  { id: '12h', label: '12h', seconds: 43_200 },
  { id: '1d', label: '1d', seconds: 86_400 },
  { id: '7d', label: '7d', seconds: 604_800 },
  { id: 'custom', label: 'Custom', seconds: 0 },
];

const SLIPPAGE_PRESETS = [0.5, 1, 2, 5];

interface SimpleEarnProps {
  config: RuntimeConfig;
  reserves: RawReserves;
  balances: WalletBalances | null;
  lpLock: LiquidityLockState | null;
  chainNow: number;
  account: string | null;
  wrongNetwork: boolean;
  busyAction: string | null;
  txStatus: string | null;
  onConnect: () => Promise<void>;
  onSwitchNetwork: () => Promise<void>;
  onAddLiquidity: (
    amountBase: string,
    amountQuote: string,
    lockDurationSecs: number,
    minShares: bigint,
  ) => Promise<void>;
  onRemoveLiquidity: (
    shares: string,
    minBase: bigint,
    minQuote: bigint,
  ) => Promise<void>;
}

function human(raw: bigint | undefined, decimals: number): number {
  if (raw === undefined) return 0;
  return Number(formatUnits(raw, decimals));
}

function trimDecimal(value: number, maxDecimals: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  return value
    .toFixed(maxDecimals)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '');
}

export const SimpleEarn: React.FC<SimpleEarnProps> = ({
  config,
  reserves,
  balances,
  lpLock,
  chainNow,
  account,
  wrongNetwork,
  busyAction,
  txStatus,
  onConnect,
  onSwitchNetwork,
  onAddLiquidity,
  onRemoveLiquidity,
}) => {
  const [baseInput, setBaseInput] = useState<string>('0.02');
  const [quoteInput, setQuoteInput] = useState<string>('60');
  const [lockOpen, setLockOpen] = useState<boolean>(false);
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(false);
  const [lockPreset, setLockPreset] = useState<LockPresetId>('none');
  const [customValue, setCustomValue] = useState<string>('30');
  const [customUnit, setCustomUnit] = useState<CustomUnit>('minutes');
  const [slippagePct, setSlippagePct] = useState<number>(1);
  const [withdrawInput, setWithdrawInput] = useState<string>('');
  const [withdrawTouched, setWithdrawTouched] = useState<boolean>(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const rx = human(reserves.reserveBase, config.baseDecimals);
  const ry = human(reserves.reserveQuote, config.quoteDecimals);
  const totalShares = human(reserves.totalShares, 18);
  const userShares = human(balances?.lpShares, 18);
  const baseBal = human(balances?.base, config.baseDecimals);
  const quoteBal = human(balances?.quote, config.quoteDecimals);
  const spot = rx > 0 ? ry / rx : 3000;
  const poolSharePct = totalShares > 0 ? (userShares / totalShares) * 100 : 0;

  const unlockTimeSecs = Number(lpLock?.unlockTime ?? 0n);
  const lockActive = Boolean(lpLock && lpLock.lockedShares > 0n && unlockTimeSecs > chainNow);
  const lockedShares = lockActive ? human(lpLock?.lockedShares, 18) : 0;
  const unlockedShares = lockActive
    ? Math.max(0, human(lpLock?.unlockedShares, 18))
    : userShares;
  const lockRemainingSecs = lockActive ? Math.max(0, unlockTimeSecs - chainNow) : 0;

  // Pre-fill Withdraw input with max unlocked shares until user edits manually.
  useEffect(() => {
    if (!withdrawTouched) {
      setWithdrawInput(unlockedShares > 0 ? trimDecimal(unlockedShares, 6) : '');
    }
  }, [unlockedShares, withdrawTouched]);

  const effectiveLockSecs = useMemo(() => {
    if (lockPreset !== 'custom') {
      return LOCK_OPTIONS.find((o) => o.id === lockPreset)?.seconds ?? 0;
    }
    const n = Number(customValue);
    if (!Number.isFinite(n) || n <= 0) return 0;
    const mult = customUnit === 'days' ? 86_400 : customUnit === 'hours' ? 3_600 : 60;
    return Math.floor(n * mult);
  }, [lockPreset, customValue, customUnit]);

  const baseNum = Number(baseInput) || 0;
  const quoteNum = Number(quoteInput) || 0;
  const withdrawNum = Number(withdrawInput) || 0;
  const busy = busyAction !== null;

  const estimatedShares = useMemo(() => {
    if (totalShares <= 0 || rx <= 0 || ry <= 0 || baseNum <= 0 || quoteNum <= 0) return 0;
    return Math.min(baseNum / rx, quoteNum / ry) * totalShares;
  }, [baseNum, quoteNum, rx, ry, totalShares]);

  const withdrawPreview = useMemo(() => {
    if (withdrawNum <= 0 || totalShares <= 0) return null;
    const frac = Math.min(1, withdrawNum / totalShares);
    return {
      base: frac * rx,
      quote: frac * ry,
    };
  }, [withdrawNum, totalShares, rx, ry]);

  const positionUnderlying = useMemo(() => {
    if (userShares <= 0 || totalShares <= 0) return { base: 0, quote: 0 };
    const frac = Math.min(1, userShares / totalShares);
    return { base: frac * rx, quote: frac * ry };
  }, [userShares, totalShares, rx, ry]);

  const matchPoolRatio = () => {
    setLocalError(null);
    if (spot <= 0) return;
    if (baseNum > 0) {
      setQuoteInput(trimDecimal(baseNum * spot, Math.min(config.quoteDecimals, 4)));
    } else if (quoteNum > 0) {
      setBaseInput(trimDecimal(quoteNum / spot, 6));
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
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
    if (baseNum <= 0 || quoteNum <= 0) {
      setLocalError(`Enter positive ${config.baseSymbol} and ${config.quoteSymbol} amounts.`);
      return;
    }
    if (baseNum > baseBal + 1e-9 || quoteNum > quoteBal + 1e-9) {
      setLocalError('Deposit amount exceeds your wallet balance.');
      return;
    }

    const slipFactor = Math.max(0, 1 - slippagePct / 100);
    let minShares = 0n;
    if (estimatedShares > 0) {
      try {
        minShares = parseUnits(trimDecimal(estimatedShares * slipFactor, 12) || '0', 18);
      } catch {
        minShares = 0n;
      }
    }

    try {
      await onAddLiquidity(baseInput.trim(), quoteInput.trim(), effectiveLockSecs, minShares);
      setWithdrawTouched(false);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to add liquidity.');
    }
  };

  const handleWithdraw = async (e: React.FormEvent) => {
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
    if (withdrawNum <= 0) {
      setLocalError('Enter how many shares you want to withdraw.');
      return;
    }
    if (lockActive && withdrawNum > unlockedShares + 1e-9) {
      setLocalError(
        `Only ${formatToken(unlockedShares, 4)} shares are unlocked right now. Your locked shares unlock in ${formatDuration(lockRemainingSecs)}.`,
      );
      return;
    }

    const slipFactor = Math.max(0, 1 - slippagePct / 100);
    let minBase = 0n;
    let minQuote = 0n;
    if (withdrawPreview) {
      try {
        minBase = parseUnits(
          trimDecimal(withdrawPreview.base * slipFactor, Math.min(config.baseDecimals, 12)) || '0',
          config.baseDecimals,
        );
        minQuote = parseUnits(
          trimDecimal(withdrawPreview.quote * slipFactor, Math.min(config.quoteDecimals, 6)) || '0',
          config.quoteDecimals,
        );
      } catch {
        minBase = 0n;
        minQuote = 0n;
      }
    }

    try {
      await onRemoveLiquidity(withdrawInput.trim(), minBase, minQuote);
      setWithdrawTouched(false);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to withdraw liquidity.');
    }
  };

  return (
    <div className="space-y-4" data-testid="simple-earn-view">
      {/* EARN FEES CARD */}
      <section aria-label="Earn fees" className="ledger-panel overflow-hidden">
        <div className="border-b border-rule bg-paper-soft px-5 py-4">
          <div className="eyebrow text-plum-700">Pool deposits</div>
          <h2 className="mt-1 font-display text-2xl font-bold text-ink">Earn fees</h2>
          <p className="mt-1 text-sm text-ink-soft">{SIMPLE_COPY.earnTagline}</p>
        </div>

        <form onSubmit={handleAdd} className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="border border-rule-strong bg-paper-soft p-3.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="simple-earn-base"
                  className="text-xs font-bold uppercase tracking-label text-ink-muted"
                >
                  {config.baseSymbol}
                </label>
                <button
                  type="button"
                  onClick={() => {
                    if (baseBal > 0) {
                      const nextBase = trimDecimal(baseBal, 4);
                      setBaseInput(nextBase);
                      if (spot > 0) {
                        setQuoteInput(trimDecimal(Number(nextBase) * spot, 2));
                      }
                    }
                  }}
                  className="font-mono text-xs text-ink-muted underline decoration-dotted hover:text-ink"
                >
                  Bal: {formatToken(baseBal, 3)}
                </button>
              </div>
              <input
                id="simple-earn-base"
                data-testid="simple-earn-base-input"
                type="number"
                step="any"
                min="0"
                inputMode="decimal"
                value={baseInput}
                onChange={(e) => {
                  setLocalError(null);
                  setBaseInput(e.target.value);
                }}
                className="mt-2 w-full bg-transparent font-mono text-xl font-bold text-ink tabular-nums focus:outline-none"
              />
            </div>

            <div className="border border-rule-strong bg-paper-soft p-3.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="simple-earn-quote"
                  className="text-xs font-bold uppercase tracking-label text-ink-muted"
                >
                  {config.quoteSymbol}
                </label>
                <button
                  type="button"
                  onClick={() => {
                    if (quoteBal > 0) {
                      const nextQuote = trimDecimal(quoteBal, 2);
                      setQuoteInput(nextQuote);
                      if (spot > 0) {
                        setBaseInput(trimDecimal(Number(nextQuote) / spot, 6));
                      }
                    }
                  }}
                  className="font-mono text-xs text-ink-muted underline decoration-dotted hover:text-ink"
                >
                  Bal: {formatPrice(quoteBal, 2)}
                </button>
              </div>
              <input
                id="simple-earn-quote"
                data-testid="simple-earn-quote-input"
                type="number"
                step="any"
                min="0"
                inputMode="decimal"
                value={quoteInput}
                onChange={(e) => {
                  setLocalError(null);
                  setQuoteInput(e.target.value);
                }}
                className="mt-2 w-full bg-transparent font-mono text-xl font-bold text-ink tabular-nums focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              data-testid="simple-match-ratio-button"
              onClick={matchPoolRatio}
              className="tap-target inline-flex items-center gap-1.5 border border-rule-strong bg-paper-soft px-3.5 font-sans text-xs font-bold text-cobalt-700 transition hover:border-ink hover:text-ink"
            >
              <Scale className="h-4 w-4" aria-hidden="true" />
              <span>Match pool ratio</span>
            </button>

            <span className="font-mono text-xs text-ink-muted tabular-nums">
              {estimatedShares > 0
                ? `Est. ${formatToken(estimatedShares, 2)} shares`
                : `Pool rate: $${formatPrice(spot, 2)}`}
            </span>
          </div>

          {/* COLLAPSED LOCK FOR A SET TIME ACCORDION (supports custom!) */}
          <div className="border border-rule bg-paper-bright">
            <button
              type="button"
              data-testid="simple-earn-lock-toggle"
              aria-expanded={lockOpen}
              onClick={() => setLockOpen((v) => !v)}
              className="tap-target flex w-full items-center justify-between px-4 text-left text-sm font-bold text-ink-soft transition hover:text-ink"
            >
              <span className="inline-flex items-center gap-2">
                {effectiveLockSecs > 0 ? (
                  <Lock className="h-4 w-4 text-brass-700" aria-hidden="true" />
                ) : (
                  <Unlock className="h-4 w-4 text-pine-700" aria-hidden="true" />
                )}
                <span>
                  Lock for a set time ·{' '}
                  {effectiveLockSecs > 0 ? formatDuration(effectiveLockSecs) : 'No lock'}
                </span>
              </span>
              {lockOpen ? (
                <ChevronUp className="h-4 w-4 text-ink-muted" />
              ) : (
                <ChevronDown className="h-4 w-4 text-ink-muted" />
              )}
            </button>

            {lockOpen && (
              <div className="space-y-3 border-t border-rule px-4 py-3.5">
                <p className="text-xs leading-relaxed text-ink-muted">
                  Optional: lock your newly added shares on-chain so they cannot be withdrawn
                  early. Leave on &ldquo;No lock&rdquo; to withdraw anytime.
                </p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {LOCK_OPTIONS.map((opt) => {
                    const selected = lockPreset === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setLockPreset(opt.id)}
                        className={`tap-target border px-2 font-mono text-xs font-bold transition ${
                          selected
                            ? opt.id === 'none'
                              ? 'border-ink bg-ink text-paper'
                              : 'border-brass-700 bg-brass-600 text-paper'
                            : 'border-rule-strong bg-paper-soft text-ink-soft hover:border-ink'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>

                {lockPreset === 'custom' && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <label htmlFor="simple-custom-lock-val" className="text-xs font-bold text-ink">
                      Custom duration:
                    </label>
                    <input
                      id="simple-custom-lock-val"
                      data-testid="simple-custom-lock-input"
                      type="number"
                      min="1"
                      step="1"
                      value={customValue}
                      onChange={(e) => setCustomValue(e.target.value)}
                      className="tap-target w-24 border border-rule-strong bg-paper-soft px-3 font-mono text-sm font-bold text-ink"
                    />
                    <select
                      aria-label="Custom lock time unit"
                      value={customUnit}
                      onChange={(e) => setCustomUnit(e.target.value as CustomUnit)}
                      className="tap-target border border-rule-strong bg-paper-soft px-3 text-sm font-bold text-ink"
                    >
                      <option value="minutes">Minutes</option>
                      <option value="hours">Hours</option>
                      <option value="days">Days</option>
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* COLLAPSED ADVANCED (SLIPPAGE) ACCORDION */}
          <div className="border border-rule bg-paper-bright">
            <button
              type="button"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((v) => !v)}
              className="tap-target flex w-full items-center justify-between px-4 text-left text-sm font-bold text-ink-soft transition hover:text-ink"
            >
              <span>Advanced · Max slippage ({slippagePct}%)</span>
              {advancedOpen ? (
                <ChevronUp className="h-4 w-4 text-ink-muted" />
              ) : (
                <ChevronDown className="h-4 w-4 text-ink-muted" />
              )}
            </button>
            {advancedOpen && (
              <div className="space-y-2.5 border-t border-rule px-4 py-3.5">
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
                  Protects your deposit and withdrawal if the pool ratio shifts while your
                  transaction is confirming.
                </p>
              </div>
            )}
          </div>

          {localError && (
            <div
              role="alert"
              className="flex items-start gap-2 border-l-2 border-vermilion-600 bg-vermilion-50 px-3.5 py-2.5 text-sm text-vermilion-800"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{localError}</span>
            </div>
          )}

          {busy && txStatus && (
            <div
              role="status"
              className="flex items-center gap-2 border-l-2 border-plum-600 bg-plum-50 px-3.5 py-2.5 text-sm font-medium text-plum-800"
            >
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              <span>{txStatus}</span>
            </div>
          )}

          <button
            type="submit"
            data-testid="simple-earn-add-button"
            disabled={busy}
            className="tap-target inline-flex w-full items-center justify-center gap-2 bg-plum-600 px-5 py-3.5 font-display text-base font-bold text-[#FBF8F0] transition hover:bg-plum-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busyAction === 'add-liquidity' ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>{txStatus ?? 'Adding liquidity…'}</span>
              </>
            ) : !account ? (
              <span>Connect wallet to add liquidity</span>
            ) : wrongNetwork ? (
              <span>Switch to Sepolia</span>
            ) : effectiveLockSecs > 0 ? (
              <>
                <Lock className="h-5 w-5" aria-hidden="true" />
                <span>Add &amp; lock ({formatDuration(effectiveLockSecs)})</span>
              </>
            ) : (
              <>
                <ArrowDownToLine className="h-5 w-5" aria-hidden="true" />
                <span>Add liquidity</span>
              </>
            )}
          </button>
        </form>
      </section>

      {/* YOUR POSITION CARD */}
      <section aria-label="Your position" className="ledger-panel overflow-hidden">
        <div className="border-b border-rule bg-paper-soft px-5 py-3.5">
          <div className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-label text-ink-muted">
            <Coins className="h-4 w-4 text-plum-700" aria-hidden="true" />
            <span>Your position</span>
          </div>
        </div>

        <div className="space-y-4 p-5">
          {!account ? (
            <p className="text-sm text-ink-muted">
              Connect your wallet to see your pool shares and withdraw anytime.
            </p>
          ) : userShares <= 0 ? (
            <p className="text-sm text-ink-muted">
              You don&apos;t have any liquidity in this pool yet. Add {config.baseSymbol} and{' '}
              {config.quoteSymbol} above to start earning fees.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="border border-rule bg-paper-soft p-3.5">
                  <div className="text-xs font-bold uppercase tracking-label text-ink-muted">
                    Your shares
                  </div>
                  <div className="mt-1 font-mono text-lg font-bold text-plum-700 tabular-nums">
                    {formatToken(userShares, 4)}
                  </div>
                </div>
                <div className="border border-rule bg-paper-soft p-3.5">
                  <div className="text-xs font-bold uppercase tracking-label text-ink-muted">
                    Pool share
                  </div>
                  <div className="mt-1 font-mono text-lg font-bold text-ink tabular-nums">
                    {formatPrice(poolSharePct, 2)}%
                  </div>
                </div>
              </div>

              <div className="border border-rule bg-paper-soft px-4 py-3 text-sm text-ink-soft tabular-nums">
                Estimated value:{' '}
                <strong className="font-mono text-ink">
                  {formatToken(positionUnderlying.base, 4)} {config.baseSymbol} +{' '}
                  {formatPrice(positionUnderlying.quote, 2)} {config.quoteSymbol}
                </strong>
              </div>

              {lockActive && (
                <div
                  data-testid="simple-earn-lock-countdown"
                  className="flex items-start gap-2.5 border-l-2 border-brass-600 bg-brass-50 px-3.5 py-3 text-sm text-brass-900"
                >
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-brass-700" />
                  <div>
                    <strong>{formatToken(lockedShares, 4)} shares locked</strong> · unlocks in{' '}
                    <strong>{formatDuration(lockRemainingSecs)}</strong>.{' '}
                    {formatToken(unlockedShares, 4)} shares are unlocked and withdrawable now.
                  </div>
                </div>
              )}

              <form onSubmit={handleWithdraw} className="space-y-3 border-t border-rule pt-4">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="simple-withdraw-input"
                    className="text-xs font-bold uppercase tracking-label text-ink-muted"
                  >
                    Shares to withdraw
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setWithdrawTouched(true);
                      setWithdrawInput(trimDecimal(unlockedShares, 6));
                    }}
                    className="font-mono text-xs font-bold text-plum-700 underline decoration-dotted"
                  >
                    Max unlocked ({formatToken(unlockedShares, 4)})
                  </button>
                </div>

                <input
                  id="simple-withdraw-input"
                  data-testid="simple-earn-withdraw-input"
                  type="number"
                  step="any"
                  min="0"
                  inputMode="decimal"
                  value={withdrawInput}
                  onChange={(e) => {
                    setWithdrawTouched(true);
                    setLocalError(null);
                    setWithdrawInput(e.target.value);
                  }}
                  placeholder="0.0"
                  className="tap-target w-full border border-rule-strong bg-paper-soft px-3.5 font-mono text-lg font-bold text-ink tabular-nums focus:outline-none"
                />

                {withdrawPreview && (
                  <div className="text-xs text-ink-muted tabular-nums">
                    You&apos;ll receive approx.{' '}
                    <strong className="font-mono text-ink">
                      {formatToken(withdrawPreview.base, 4)} {config.baseSymbol} +{' '}
                      {formatPrice(withdrawPreview.quote, 2)} {config.quoteSymbol}
                    </strong>
                  </div>
                )}

                <button
                  type="submit"
                  data-testid="simple-earn-withdraw-button"
                  disabled={busy || (lockActive && unlockedShares <= 0) || withdrawNum <= 0}
                  className="tap-target inline-flex w-full items-center justify-center gap-2 bg-ink px-5 py-3.5 font-display text-base font-bold text-paper transition hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {busyAction === 'remove-liquidity' ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span>{txStatus ?? 'Withdrawing…'}</span>
                    </>
                  ) : lockActive && unlockedShares <= 0 ? (
                    <>
                      <Lock className="h-4 w-4" />
                      <span>Locked ({formatDuration(lockRemainingSecs)} left)</span>
                    </>
                  ) : (
                    <>
                      <ArrowUpFromLine className="h-5 w-5" aria-hidden="true" />
                      <span>Withdraw</span>
                    </>
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      </section>
    </div>
  );
};
