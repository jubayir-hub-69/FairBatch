import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Flame,
  FlaskConical,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { OrderSide } from '../types';
import { runSandwichSimulation } from '../lib/clearingMath';
import { formatPrice, formatToken, formatUsd } from '../lib/format';

interface SandwichSimulationModalProps {
  isOpen: boolean;
  rx: number;
  ry: number;
  baseSymbol: string;
  quoteSymbol: string;
  onClose: () => void;
}

export const SandwichSimulationModal: React.FC<SandwichSimulationModalProps> = ({
  isOpen,
  rx,
  ry,
  baseSymbol,
  quoteSymbol,
  onClose,
}) => {
  const [side, setSide] = useState<OrderSide>('SellBase');
  const [amountInput, setAmountInput] = useState<string>('2');

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const parsedAmount = Number(amountInput);
  const safeAmount =
    Number.isFinite(parsedAmount) && parsedAmount > 0
      ? parsedAmount
      : side === 'SellBase'
        ? 2
        : 6000;

  const sim = useMemo(
    () =>
      runSandwichSimulation({
        rx: Math.max(1, rx),
        ry: Math.max(1, ry),
        side,
        amountIn: safeAmount,
      }),
    [rx, ry, side, safeAmount],
  );

  if (!isOpen) return null;

  const outSym = side === 'SellBase' ? quoteSymbol : baseSymbol;
  const inSym = side === 'SellBase' ? baseSymbol : quoteSymbol;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sandwich-sim-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto border border-ink bg-paper-bright shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b-2 border-ink bg-paper px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-ink bg-plum-600 text-[#FBF8F0]">
              <FlaskConical className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <div className="eyebrow text-plum-700">Client-side simulation</div>
              <h2
                id="sandwich-sim-title"
                className="mt-1 font-display text-xl font-bold leading-tight text-ink"
              >
                Sandwich attack simulation
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sandwich simulation modal"
            className="tap-target inline-flex w-11 items-center justify-center border border-rule-strong text-ink-muted transition hover:border-ink hover:text-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {/* Honest disclosure banner */}
          <div className="flex items-start gap-2.5 border-l-2 border-brass-600 bg-brass-50 px-3.5 py-2.5 text-sm text-brass-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-brass-700" />
            <div>
              <strong>Client-side simulation — not an on-chain result.</strong> Uses live
              Sepolia pool reserves ({formatToken(rx, 2)} {baseSymbol} / {formatPrice(ry, 0)}{' '}
              {quoteSymbol}, spot ${formatPrice(sim.spot, 2)}) to illustrate how a sandwich bot
              behaves on a normal sequential AMM (0.30% fee) vs. FairBatch uniform clearing.
            </div>
          </div>

          {/* Controls */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="border border-rule bg-paper-soft p-3">
              <span className="eyebrow block">Trade direction</span>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  aria-pressed={side === 'SellBase'}
                  onClick={() => {
                    setSide('SellBase');
                    setAmountInput('2');
                  }}
                  className={`tap-target border font-sans text-xs font-bold transition ${
                    side === 'SellBase'
                      ? 'border-vermilion-600 bg-vermilion-500 text-[#FBF8F0]'
                      : 'border-rule-strong bg-paper-bright text-ink-soft'
                  }`}
                >
                  Sell {baseSymbol}
                </button>
                <button
                  type="button"
                  aria-pressed={side === 'BuyBase'}
                  onClick={() => {
                    setSide('BuyBase');
                    setAmountInput('6000');
                  }}
                  className={`tap-target border font-sans text-xs font-bold transition ${
                    side === 'BuyBase'
                      ? 'border-pine-700 bg-pine-600 text-[#FBF8F0]'
                      : 'border-rule-strong bg-paper-bright text-ink-soft'
                  }`}
                >
                  Buy {baseSymbol}
                </button>
              </div>
            </div>

            <div className="border border-rule bg-paper-soft p-3">
              <label htmlFor="sim-amount-input" className="eyebrow block">
                Simulated trade size ({inSym})
              </label>
              <input
                id="sim-amount-input"
                type="number"
                step="any"
                min="0"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                className="tap-target mt-1.5 w-full border border-rule-strong bg-paper-bright px-3 font-mono text-base font-bold text-ink tabular-nums"
              />
            </div>
          </div>

          {/* Side-by-side comparison */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="border-2 border-vermilion-500/60 bg-vermilion-50 p-4">
              <div className="flex items-center gap-2 font-mono text-xs font-bold uppercase text-vermilion-800">
                <Flame className="h-4 w-4 text-vermilion-600" />
                <span>Normal AMM + sandwich bot</span>
              </div>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-muted">Your effective price</dt>
                  <dd className="font-mono font-bold text-ink tabular-nums">
                    ${formatPrice(sim.ammSandwichedPrice, 2)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-muted">You receive</dt>
                  <dd className="font-mono font-bold text-ink tabular-nums">
                    {outSym === quoteSymbol
                      ? formatPrice(sim.ammSandwichedOut, 2)
                      : formatToken(sim.ammSandwichedOut, 4)}{' '}
                    {outSym}
                  </dd>
                </div>
                <div className="flex justify-between gap-2 border-t border-vermilion-500/30 pt-2">
                  <dt className="font-bold text-vermilion-800">Bot extracted profit</dt>
                  <dd className="font-mono font-bold text-vermilion-700 tabular-nums">
                    {formatUsd(sim.ammBotProfitQuote, 2)}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="border-2 border-pine-600/60 bg-pine-50 p-4">
              <div className="flex items-center gap-2 font-mono text-xs font-bold uppercase text-pine-800">
                <ShieldCheck className="h-4 w-4 text-pine-700" />
                <span>FairBatch uniform round</span>
              </div>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-muted">Uniform fair price</dt>
                  <dd className="font-mono font-bold text-pine-800 tabular-nums">
                    ${formatPrice(sim.fairbatchPrice, 2)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-muted">You receive</dt>
                  <dd className="font-mono font-bold text-pine-800 tabular-nums">
                    {outSym === quoteSymbol
                      ? formatPrice(sim.fairbatchOut, 2)
                      : formatToken(sim.fairbatchOut, 4)}{' '}
                    {outSym}
                  </dd>
                </div>
                <div className="flex justify-between gap-2 border-t border-pine-600/30 pt-2">
                  <dt className="font-bold text-pine-800">Bot extracted profit</dt>
                  <dd className="font-mono font-bold text-pine-800 tabular-nums">$0.00</dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="border border-rule bg-paper-soft px-4 py-3 text-sm text-ink">
            {sim.userSavedQuote > 0.01 ? (
              <>
                Simulated protection against this sandwich attack:{' '}
                <strong className="font-mono text-pine-700">
                  +{formatUsd(sim.userSavedQuote, 2)}
                </strong>{' '}
                kept in your pocket instead of going to a front-running bot.
              </>
            ) : (
              <>
                In FairBatch, even if a bot submits both a front-run and a back-run leg in the
                same round, both execute at the exact same fair price — leaving{' '}
                <strong>$0.00</strong> arbitrage profit before gas.
              </>
            )}
          </div>

          <div className="flex justify-end border-t border-rule pt-3">
            <button
              type="button"
              onClick={onClose}
              className="tap-target border border-ink bg-ink px-5 font-display text-sm font-bold text-paper transition hover:bg-ink-soft"
            >
              Close simulation
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
