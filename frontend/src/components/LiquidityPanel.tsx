import React, { useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Coins,
  Droplets,
  Lock,
  Scale,
  Unlock,
} from 'lucide-react';
import { formatUnits, parseUnits } from 'viem';
import type { RuntimeConfig } from '../onchain/config';
import type { LiquidityLockState, RawReserves, WalletBalances } from '../onchain/state';
import { formatDuration, formatPrice, formatToken } from '../lib/format';
import { PRO_TOOLTIPS } from '../lib/glossary';
import { useNow } from '../lib/useNow';
import { InfoTooltip } from './InfoTooltip';

type LiquidityMode = 'add' | 'remove';

const LOCK_PRESETS: Array<{ label: string; seconds: number; custom?: boolean }> = [
  { label: 'No lock', seconds: 0 },
  { label: '1 hour', seconds: 3_600 },
  { label: '12 hours', seconds: 43_200 },
  { label: '1 day', seconds: 86_400 },
  { label: '7 days', seconds: 604_800 },
  { label: 'Custom', seconds: -1, custom: true },
];

interface LiquidityPanelProps {
  config: RuntimeConfig;
  reserves: RawReserves;
  balances: WalletBalances | null;
  lpLock: LiquidityLockState | null;
  account: string | null;
  busyAction: string | null;
  onAddLiquidity: (
    amountBase: string,
    amountQuote: string,
    lockDurationSecs?: number,
    minShares?: bigint,
  ) => Promise<void>;
  onRemoveLiquidity: (
    shares: string,
    minBase?: bigint,
    minQuote?: bigint,
  ) => Promise<void>;
}

function human(raw: bigint, decimals: number): number {
  return Number(formatUnits(raw, decimals));
}

function trimAmount(value: number, decimals: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  const fixed = value.toFixed(decimals);
  return fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

export const LiquidityPanel: React.FC<LiquidityPanelProps> = ({
  config,
  reserves,
  balances,
  lpLock,
  account,
  busyAction,
  onAddLiquidity,
  onRemoveLiquidity,
}) => {
  const [mode, setMode] = useState<LiquidityMode>('add');
  const [baseInput, setBaseInput] = useState<string>('1');
  const [quoteInput, setQuoteInput] = useState<string>('3000');
  const [lockDurationSecs, setLockDurationSecs] = useState<number>(0);
  const [customLockMode, setCustomLockMode] = useState<boolean>(false);
  const [customLockHours, setCustomLockHours] = useState<string>('2');
  const [slippagePct, setSlippagePct] = useState<string>('1');
  const [sharesInput, setSharesInput] = useState<string>('');
  const [localError, setLocalError] = useState<string | null>(null);
  const nowSecs = useNow();

  const effectiveLockSecs = customLockMode
    ? Math.max(0, Math.floor((Number(customLockHours) || 0) * 3_600))
    : lockDurationSecs;
  const slipFactor = Math.max(0, 1 - Math.min(50, Math.max(0, Number(slippagePct) || 0)) / 100);

  const rx = human(reserves.reserveBase, config.baseDecimals);
  const ry = human(reserves.reserveQuote, config.quoteDecimals);
  const totalShares = human(reserves.totalShares, 18);
  const userShares = human(balances?.lpShares ?? 0n, 18);
  const spot = rx > 0 ? ry / rx : 0;
  const poolSharePct = totalShares > 0 ? (userShares / totalShares) * 100 : 0;

  const unlockTimeSecs = Number(lpLock?.unlockTime ?? 0n);
  const lockActive = Boolean(lpLock && lpLock.lockedShares > 0n && unlockTimeSecs > nowSecs);
  const lockedShares = lockActive ? human(lpLock!.lockedShares, 18) : 0;
  const unlockedShares = lockActive
    ? Math.max(0, human(lpLock!.unlockedShares, 18))
    : userShares;
  const lockRemainingSecs = lockActive ? Math.max(0, unlockTimeSecs - nowSecs) : 0;

  const baseNum = Number(baseInput) || 0;
  const quoteNum = Number(quoteInput) || 0;
  const sharesNum = Number(sharesInput) || 0;

  const estimatedShares = useMemo(() => {
    if (totalShares <= 0 || rx <= 0 || ry <= 0) return null;
    if (baseNum <= 0 || quoteNum <= 0) return null;
    return Math.min(baseNum / rx, quoteNum / ry) * totalShares;
  }, [baseNum, quoteNum, rx, ry, totalShares]);

  const removePreview = useMemo(() => {
    if (sharesNum <= 0 || totalShares <= 0) return null;
    const fraction = Math.min(1, sharesNum / totalShares);
    return {
      base: fraction * rx,
      quote: fraction * ry,
      pct: fraction * 100,
    };
  }, [sharesNum, totalShares, rx, ry]);

  const busy = busyAction !== null;

  const matchPoolRatio = () => {
    if (spot <= 0) return;
    setQuoteInput(trimAmount(baseNum * spot, config.quoteDecimals));
  };

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    if (!account) {
      setLocalError('Connect a wallet to provide liquidity.');
      return;
    }
    if (baseNum <= 0 || quoteNum <= 0) {
      setLocalError(`Both ${config.baseSymbol} and ${config.quoteSymbol} amounts must be positive.`);
      return;
    }
    try {
      let minShares: bigint | undefined;
      if (estimatedShares !== null && estimatedShares > 0 && slipFactor < 1) {
        try {
          minShares = parseUnits(trimAmount(estimatedShares * slipFactor, 12) || '0', 18);
        } catch {
          minShares = 0n;
        }
      }
      if (minShares !== undefined) {
        await onAddLiquidity(baseInput, quoteInput, effectiveLockSecs, minShares);
      } else {
        await onAddLiquidity(baseInput, quoteInput, effectiveLockSecs);
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Add liquidity failed');
    }
  };

  const handleRemove = async (event: React.FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    if (!account) {
      setLocalError('Connect a wallet to withdraw liquidity.');
      return;
    }
    if (sharesNum <= 0) {
      setLocalError('Enter a positive LP share amount.');
      return;
    }
    if (lockActive && sharesNum > unlockedShares + 1e-12) {
      setLocalError(
        `Only ${formatToken(unlockedShares, 4)} LP shares are unlocked. ${formatToken(
          lockedShares,
          4,
        )} shares unlock in ${formatDuration(lockRemainingSecs)}.`,
      );
      return;
    }
    try {
      if (removePreview && slipFactor < 1) {
        const minBase = parseUnits(
          trimAmount(removePreview.base * slipFactor, Math.min(config.baseDecimals, 12)) || '0',
          config.baseDecimals,
        );
        const minQuote = parseUnits(
          trimAmount(removePreview.quote * slipFactor, Math.min(config.quoteDecimals, 6)) || '0',
          config.quoteDecimals,
        );
        await onRemoveLiquidity(sharesInput, minBase, minQuote);
      } else {
        await onRemoveLiquidity(sharesInput);
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Remove liquidity failed');
    }
  };

  return (
    <section aria-label="Liquidity provision" className="ledger-panel overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 border-b border-rule px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Droplets className="h-3 w-3 text-plum-600" aria-hidden="true" />
            <span className="eyebrow">Passive reserves</span>
          </div>
          <h2 className="mt-1 flex items-center gap-1.5 font-display text-xl font-bold leading-tight tracking-tight text-ink">
            <span>FM-AMM liquidity desk</span>
            <InfoTooltip label="FM-AMM" text={PRO_TOOLTIPS.fmAmm} />
          </h2>
          <p className="mt-0.5 text-sm leading-relaxed text-ink-muted">
            Internal, non-transferable LP shares with optional time-locking and slippage bounds.
          </p>
        </div>
        <div className="flex border border-rule-strong bg-paper-soft p-0.5">
          <button
            type="button"
            onClick={() => setMode('add')}
            aria-pressed={mode === 'add'}
            className={`min-h-[36px] px-3 font-mono text-xs font-bold uppercase transition ${
              mode === 'add' ? 'bg-ink text-paper' : 'text-ink-muted hover:text-ink'
            }`}
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => setMode('remove')}
            aria-pressed={mode === 'remove'}
            className={`min-h-[36px] px-3 font-mono text-xs font-bold uppercase transition ${
              mode === 'remove' ? 'bg-ink text-paper' : 'text-ink-muted hover:text-ink'
            }`}
          >
            Remove
          </button>
        </div>
      </div>

      <div className="grid gap-px border-b border-rule bg-rule sm:grid-cols-4">
        <div className="bg-paper-bright p-3">
          <div className="font-mono text-xs uppercase tracking-label text-ink-muted">
            Pool {config.baseSymbol}
          </div>
          <div className="mt-1 font-mono text-sm font-bold text-ink tabular-nums">
            {formatToken(rx, 3)}
          </div>
        </div>
        <div className="bg-paper-bright p-3">
          <div className="font-mono text-xs uppercase tracking-label text-ink-muted">
            Pool {config.quoteSymbol}
          </div>
          <div className="mt-1 font-mono text-sm font-bold text-ink tabular-nums">
            {formatPrice(ry, 0)}
          </div>
        </div>
        <div className="bg-paper-bright p-3">
          <div className="font-mono text-xs uppercase tracking-label text-ink-muted">
            Spot
          </div>
          <div className="mt-1 font-mono text-sm font-bold text-vermilion-700 tabular-nums">
            ${formatPrice(spot, 2)}
          </div>
        </div>
        <div className="bg-paper-bright p-3">
          <div className="font-mono text-xs uppercase tracking-label text-ink-muted">
            Your LP share
          </div>
          <div className="mt-1 font-mono text-sm font-bold text-plum-700 tabular-nums">
            {formatToken(userShares, 2)} · {formatPrice(poolSharePct, 2)}%
          </div>
        </div>
      </div>

      {lockActive && (
        <div
          data-testid="lp-lock-banner"
          className="flex flex-wrap items-center justify-between gap-2 border-b border-rule bg-brass-50 px-4 py-2.5 font-mono text-xs text-brass-900"
        >
          <span className="inline-flex items-center gap-1.5 font-bold">
            <Lock className="h-3 w-3 text-brass-700" aria-hidden="true" />
            <span>
              {formatToken(lockedShares, 2)} shares locked · unlocks in{' '}
              {formatDuration(lockRemainingSecs)}
            </span>
          </span>
          <span className="text-brass-800 tabular-nums">
            {formatToken(unlockedShares, 2)} withdrawable now
          </span>
        </div>
      )}

      <div className="p-4">
        {mode === 'add' ? (
          <form onSubmit={handleAdd} className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="ledger-inset px-3 py-2">
                <label htmlFor="lp-base-input" className="eyebrow block">
                  {config.baseSymbol} deposit
                </label>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <input
                    id="lp-base-input"
                    type="number"
                    step="any"
                    min="0"
                    value={baseInput}
                    onChange={(e) => setBaseInput(e.target.value)}
                    className="w-full bg-transparent font-mono text-lg font-bold text-ink tabular-nums focus:outline-none"
                  />
                  <span className="font-mono text-[9px] uppercase tracking-label text-ink-muted">
                    {config.baseSymbol}
                  </span>
                </div>
              </div>
              <div className="ledger-inset px-3 py-2">
                <label htmlFor="lp-quote-input" className="eyebrow block">
                  {config.quoteSymbol} deposit
                </label>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <input
                    id="lp-quote-input"
                    type="number"
                    step="any"
                    min="0"
                    value={quoteInput}
                    onChange={(e) => setQuoteInput(e.target.value)}
                    className="w-full bg-transparent font-mono text-lg font-bold text-ink tabular-nums focus:outline-none"
                  />
                  <span className="font-mono text-[9px] uppercase tracking-label text-ink-muted">
                    {config.quoteSymbol}
                  </span>
                </div>
              </div>
            </div>

            <div className="border border-rule bg-paper-soft p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 font-mono text-xs font-bold uppercase tracking-label text-ink-soft">
                  {effectiveLockSecs > 0 ? (
                    <Lock className="h-3.5 w-3.5 text-brass-700" aria-hidden="true" />
                  ) : (
                    <Unlock className="h-3.5 w-3.5 text-pine-700" aria-hidden="true" />
                  )}
                  Liquidity lock (optional)
                </span>
                <span className="font-mono text-xs text-ink-muted">
                  {effectiveLockSecs > 0
                    ? `Locks new shares for ${formatDuration(effectiveLockSecs)}`
                    : 'Flexible · withdraw anytime'}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Optional liquidity lock duration">
                {LOCK_PRESETS.map((preset) => {
                  const selected = preset.custom
                    ? customLockMode
                    : !customLockMode && lockDurationSecs === preset.seconds;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        if (preset.custom) {
                          setCustomLockMode(true);
                        } else {
                          setCustomLockMode(false);
                          setLockDurationSecs(preset.seconds);
                        }
                      }}
                      className={`min-h-[36px] border px-2.5 font-mono text-xs font-bold uppercase transition ${
                        selected
                          ? preset.seconds !== 0
                            ? 'border-brass-700 bg-brass-600 text-paper'
                            : 'border-ink bg-ink text-paper'
                          : 'border-rule-strong bg-paper-bright text-ink-muted hover:border-ink hover:text-ink'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              {customLockMode && (
                <div className="mt-2.5 flex items-center gap-2">
                  <label htmlFor="pro-custom-lock-hours" className="font-mono text-xs text-ink-muted">
                    Lock duration (hours):
                  </label>
                  <input
                    id="pro-custom-lock-hours"
                    type="number"
                    min="0.1"
                    step="any"
                    value={customLockHours}
                    onChange={(e) => setCustomLockHours(e.target.value)}
                    className="w-24 border border-rule-strong bg-paper-bright px-2 py-1 font-mono text-sm font-bold text-ink"
                  />
                </div>
              )}
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-rule pt-2">
                <label htmlFor="pro-lp-slippage" className="font-mono text-xs text-ink-muted">
                  Max slippage tolerance (%):
                </label>
                <input
                  id="pro-lp-slippage"
                  type="number"
                  min="0"
                  max="50"
                  step="0.5"
                  value={slippagePct}
                  onChange={(e) => setSlippagePct(e.target.value)}
                  className="w-20 border border-rule-strong bg-paper-bright px-2 py-1 text-right font-mono text-xs font-bold text-ink"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={matchPoolRatio}
                className="inline-flex min-h-[36px] items-center gap-1 font-mono text-xs font-bold uppercase text-cobalt-700 underline decoration-dotted underline-offset-2 transition hover:text-cobalt-800"
              >
                <Scale className="h-3.5 w-3.5" />
                Match pool ratio
              </button>
              <span className="font-mono text-xs text-ink-muted tabular-nums">
                {estimatedShares !== null
                  ? `≈ ${formatToken(estimatedShares, 4)} LP shares`
                  : 'LP shares mint pro-rata'}
              </span>
            </div>

            <button
              type="submit"
              data-testid="lp-add-submit"
              disabled={!account || busy}
              className="tap-target inline-flex w-full items-center justify-center gap-2 bg-plum-600 px-3 py-2.5 font-display text-sm font-bold text-[#FBF8F0] transition hover:bg-plum-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {effectiveLockSecs > 0 ? (
                <Lock className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ArrowDownToLine className="h-4 w-4" aria-hidden="true" />
              )}
              <span>
                {!account
                  ? 'Connect a wallet to add liquidity'
                  : busyAction === 'add-liquidity'
                    ? 'Adding liquidity…'
                    : effectiveLockSecs > 0
                      ? `Add & lock liquidity (${formatDuration(effectiveLockSecs)})`
                      : 'Add liquidity'}
              </span>
            </button>
            <p className="text-xs leading-relaxed text-ink-muted">
              FairBatch mints min(sharesX, sharesY) guarded by minShares slippage bounds.
              Locking is optional — unlocked shares remain withdrawable anytime.
            </p>
          </form>
        ) : (
          <form onSubmit={handleRemove} className="space-y-3">
            <div className="ledger-inset px-3 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor="lp-shares-input" className="eyebrow">
                  LP shares to burn
                </label>
                <button
                  type="button"
                  onClick={() => setSharesInput(trimAmount(unlockedShares, 18))}
                  className="font-mono text-[9px] font-bold uppercase tracking-[0.06em] text-plum-700 underline decoration-dotted underline-offset-2"
                >
                  Max unlocked ({formatToken(unlockedShares, 2)})
                </button>
              </div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <input
                  id="lp-shares-input"
                  type="number"
                  step="any"
                  min="0"
                  value={sharesInput}
                  onChange={(e) => setSharesInput(e.target.value)}
                  placeholder="0.0"
                  className="w-full bg-transparent font-mono text-lg font-bold text-ink tabular-nums focus:outline-none"
                />
                <span className="font-mono text-[9px] uppercase tracking-label text-ink-muted">
                  Shares
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 border border-rule bg-paper-soft px-3 py-2 text-[10.5px]">
              <span className="flex items-center gap-1.5 font-mono text-[8.5px] uppercase tracking-label text-ink-faint">
                <Coins className="h-3 w-3" />
                Receive
              </span>
              <span className="text-right font-mono font-bold text-ink tabular-nums">
                {removePreview
                  ? `${formatToken(removePreview.base, 3)} ${config.baseSymbol} + ${formatPrice(
                      removePreview.quote,
                      2,
                    )} ${config.quoteSymbol}`
                  : '—'}
              </span>
            </div>

            <button
              type="submit"
              disabled={!account || busy || (lockActive && unlockedShares <= 0)}
              className="inline-flex w-full items-center justify-center gap-2 bg-ink px-3 py-2.5 font-display text-sm font-bold text-paper transition hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowUpFromLine className="h-4 w-4" aria-hidden="true" />
              <span>
                {!account
                  ? 'Connect a wallet to remove liquidity'
                  : lockActive && unlockedShares <= 0
                    ? `Shares locked (${formatDuration(lockRemainingSecs)} left)`
                    : busyAction === 'remove-liquidity'
                      ? 'Removing liquidity…'
                      : 'Remove liquidity'}
              </span>
            </button>
          </form>
        )}

        {localError && (
          <div className="mt-3 border-l-2 border-vermilion-500 bg-vermilion-50 px-3 py-2 text-[10.5px] text-vermilion-800">
            {localError}
          </div>
        )}
      </div>
    </section>
  );
};
