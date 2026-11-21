import React, { useEffect, useRef } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Gavel,
  RefreshCw,
  ShieldAlert,
  Timer,
} from 'lucide-react';
import type { BatchPhase } from '../types';
import type { ChainCommitment, RawBatchInfo } from '../onchain/state';
import { phaseLabel, remainingSecondsForPhase } from '../onchain/state';
import { formatToken, shortenAddress } from '../lib/format';
import { PRO_TOOLTIPS } from '../lib/glossary';
import { InfoTooltip } from './InfoTooltip';

interface BatchConsoleProps {
  batch: RawBatchInfo;
  phase: BatchPhase;
  chainNow: number;
  orderCount: number;
  account: string | null;
  commitments: ChainCommitment[];
  busyAction: string | null;
  refreshing: boolean;
  onSettle: () => Promise<void>;
  onSlash: (batchId: number, commitId: number) => Promise<void>;
  onRefresh: () => void;
}

function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export const BatchConsole: React.FC<BatchConsoleProps> = ({
  batch,
  phase,
  chainNow,
  orderCount,
  account,
  commitments,
  busyAction,
  refreshing,
  onSettle,
  onSlash,
  onRefresh,
}) => {
  const busy = busyAction !== null;

  const deadline =
    phase === 'Open'
      ? Number(batch.commitDeadline)
      : phase === 'Reveal'
        ? Number(batch.revealDeadline)
        : null;
  const remaining = remainingSecondsForPhase(batch, phase, chainNow);
  const windowSeconds =
    phase === 'Open'
      ? Number(batch.commitDeadline - batch.startTime)
      : phase === 'Reveal'
        ? Number(batch.revealDeadline - batch.commitDeadline)
        : 1;
  const progress =
    deadline === null
      ? 1
      : Math.min(1, Math.max(0, 1 - remaining / Math.max(1, windowSeconds)));

  // Trigger a refresh right after a deadline passes (strict `>` matching src/lib.fe).
  const refreshedDeadlineRef = useRef<string>('');
  useEffect(() => {
    if (deadline === null) return;
    if (chainNow <= deadline) return;
    const key = `${batch.batchId}:${deadline}`;
    if (refreshedDeadlineRef.current === key) return;
    refreshedDeadlineRef.current = key;
    onRefresh();
  }, [batch.batchId, deadline, chainNow, onRefresh]);

  const slashable = commitments.filter(
    (commitment) =>
      !commitment.revealed &&
      !commitment.slashed &&
      (commitment.batch_id < Number(batch.batchId) || phase === 'Ready'),
  );

  const phaseTone =
    phase === 'Open'
      ? 'border-ink bg-ink text-paper'
      : phase === 'Reveal'
        ? 'border-brass-600 bg-brass-600 text-[#FBF8F0]'
        : phase === 'Ready'
          ? 'border-vermilion-600 bg-vermilion-500 text-[#FBF8F0]'
          : 'border-pine-700 bg-pine-600 text-[#FBF8F0]';

  return (
    <section aria-label="Batch clock and settlement console" className="ledger-panel overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-rule px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Timer className="h-3.5 w-3.5 text-vermilion-600" aria-hidden="true" />
            <span className="eyebrow">Auction clock</span>
          </div>
          <h2 className="mt-1 font-display text-xl font-bold leading-tight text-ink">
            Batch #{Number(batch.batchId)} · {phaseLabel(phase)}
          </h2>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex min-h-[36px] items-center gap-1.5 border border-rule-strong px-3 font-mono text-xs font-bold uppercase text-ink-muted transition hover:border-ink hover:text-ink disabled:opacity-40"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          <span>{refreshing ? 'Syncing' : 'Refresh'}</span>
        </button>
      </div>

      <div className="space-y-3 p-4">
        <div className={`border px-3.5 py-3 ${phaseTone}`}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-xs font-bold uppercase tracking-label opacity-90">
              {phase === 'Open'
                ? 'Commit window closes in'
                : phase === 'Reveal'
                  ? 'Reveal window closes in'
                  : phase === 'Ready'
                    ? 'Reveal window closed'
                    : 'Batch settled'}
            </span>
            {deadline !== null ? (
              <span className="font-mono text-xl font-bold tabular-nums">
                {formatCountdown(remaining)}
              </span>
            ) : (
              <CheckCircle2 className="h-5 w-5" />
            )}
          </div>
          <div className="mt-2 h-1.5 w-full bg-paper/25">
            <div
              className="h-1.5 bg-paper transition-[width] duration-1000"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-px border border-rule bg-rule">
          <div className="bg-paper-bright p-3">
            <div className="font-mono text-xs uppercase tracking-label text-ink-muted">
              Orders queued
            </div>
            <div className="mt-1 font-mono text-xl font-bold text-ink tabular-nums">
              {orderCount}
            </div>
          </div>
          <div className="bg-paper-bright p-3">
            <div className="flex items-center gap-1 font-mono text-xs uppercase tracking-label text-ink-muted">
              <Gavel className="h-3.5 w-3.5 text-brass-700" />
              <span>Commitments</span>
              <InfoTooltip label="Reveal bond" text={PRO_TOOLTIPS.revealBond} />
            </div>
            <div className="mt-1 font-mono text-xl font-bold text-brass-700 tabular-nums">
              {Number(batch.commitCount)}
            </div>
          </div>
        </div>

        {phase === 'Ready' ? (
          <div className="space-y-2.5 border-l-2 border-vermilion-500 bg-vermilion-50 px-3.5 py-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-vermilion-600" />
              <p className="text-sm leading-relaxed text-vermilion-800">
                The window is closed. Settlement is permissionless: any connected wallet can
                compute the uniform clearing price and open Batch #{Number(batch.batchId) + 1}.
              </p>
            </div>
            <button
              type="button"
              data-testid="settle-batch-button"
              disabled={!account || busy}
              onClick={() => void onSettle()}
              className="tap-target inline-flex w-full items-center justify-center gap-2 border border-pine-700 bg-pine-600 px-3.5 font-display text-sm font-bold text-[#FBF8F0] transition hover:bg-pine-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              <span>
                {!account
                  ? 'Connect a wallet to settle'
                  : busyAction === 'settle'
                    ? 'Settling batch…'
                    : `Settle Batch #${Number(batch.batchId)} & open next`}
              </span>
            </button>
          </div>
        ) : phase === 'Settled' ? (
          <div className="flex items-start gap-2 border-l-2 border-pine-600 bg-pine-50 px-3.5 py-3 text-sm leading-relaxed text-pine-800">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Batch #{Number(batch.batchId)} is settled. Pull claims are in the claims ledger.</span>
          </div>
        ) : (
          <div className="flex items-start gap-2 border-l-2 border-brass-500 bg-brass-50 px-3.5 py-3 text-sm leading-relaxed text-brass-900">
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {phase === 'Open'
                ? 'Submit direct orders, seal commitments, or sign an EIP-712 intent. Settlement opens after the reveal window.'
                : 'Reveal sealed commitments or submit a signed intent. Settlement opens when this window closes.'}
            </span>
          </div>
        )}

        {slashable.length > 0 && (
          <div className="border border-rule bg-paper-soft p-3">
            <div className="flex items-center gap-1.5 font-mono text-xs font-bold uppercase tracking-label text-ink-soft">
              <ShieldAlert className="h-4 w-4 text-vermilion-600" />
              <span>Unrevealed bonds · slashable</span>
              <InfoTooltip label="Slashing bounty" text={PRO_TOOLTIPS.revealBond} />
            </div>
            <div className="mt-2 divide-y divide-rule/70">
              {slashable.slice(0, 5).map((commitment) => (
                <div
                  key={`${commitment.batch_id}-${commitment.commit_id}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <span className="min-w-0 truncate font-mono text-xs text-ink-muted">
                    B#{commitment.batch_id} · #{commitment.commit_id} ·{' '}
                    {shortenAddress(commitment.trader)} · {formatToken(commitment.bond_eth, 4, 4)} ETH
                  </span>
                  <button
                    type="button"
                    disabled={!account || busy}
                    onClick={() =>
                      void onSlash(commitment.batch_id, commitment.commit_id)
                    }
                    className="min-h-[36px] shrink-0 border border-vermilion-600/50 bg-vermilion-50 px-3 font-mono text-xs font-bold uppercase text-vermilion-700 transition hover:bg-vermilion-500 hover:text-paper disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Slash &amp; claim bounty
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-2 border-t border-rule/70 pt-2 text-xs leading-relaxed text-ink-muted">
              Permissionless after the reveal deadline. The forfeited ETH bond is paid directly
              to whoever calls <code>slashUnrevealed</code> as a keeper bounty.
            </p>
          </div>
        )}
      </div>
    </section>
  );
};
