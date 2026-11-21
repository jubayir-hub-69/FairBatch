import React from 'react';
import {
  CheckCircle2,
  Clock,
  Eye,
  Loader2,
  Plus,
  Sparkles,
} from 'lucide-react';
import type { BatchPhase, LocalSecretVaultEntry } from '../../types';
import type { ChainCommitment, ChainOrder, RawBatchInfo } from '../../onchain/state';
import { remainingSecondsForPhase } from '../../onchain/state';
import type { RuntimeConfig } from '../../onchain/config';
import { formatPrice, formatToken } from '../../lib/format';
import { simplePhaseName } from '../../lib/glossary';

interface SimpleWaitingCardProps {
  config: RuntimeConfig;
  batch: RawBatchInfo;
  livePhase: BatchPhase;
  chainNow: number;
  userOrders: ChainOrder[];
  userPendingCommits: ChainCommitment[];
  localSecrets: LocalSecretVaultEntry[];
  busyAction: string | null;
  txStatus: string | null;
  onRevealCommit: (secret: LocalSecretVaultEntry) => Promise<void>;
  onSettleRound: () => Promise<void>;
  onPlaceAnother: () => void;
}

function formatClock(totalSeconds: number): string {
  const secs = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}:${String(rem).padStart(2, '0')}`;
}

export const SimpleWaitingCard: React.FC<SimpleWaitingCardProps> = ({
  config,
  batch,
  livePhase,
  chainNow,
  userOrders,
  userPendingCommits,
  localSecrets,
  busyAction,
  txStatus,
  onRevealCommit,
  onSettleRound,
  onPlaceAnother,
}) => {
  const roundId = Number(batch.batchId);
  const remaining = remainingSecondsForPhase(batch, livePhase, chainNow);
  const busy = busyAction !== null;

  const stages: Array<{ id: 'collecting' | 'pricing' | 'collect'; label: string }> = [
    { id: 'collecting', label: 'Collecting' },
    { id: 'pricing', label: 'Pricing' },
    { id: 'collect', label: 'Ready to collect' },
  ];

  const activeStageIndex =
    livePhase === 'Open' ? 0 : livePhase === 'Reveal' ? 1 : 2;

  const unrevealedWithSecret = userPendingCommits
    .filter((c) => !c.revealed && !c.slashed)
    .map((commit) => ({
      commit,
      secret: localSecrets.find(
        (s) => s.batch_id === commit.batch_id && s.commit_id === commit.commit_id && !s.revealed,
      ),
    }));

  return (
    <section
      aria-label="Active order status"
      data-testid="simple-waiting-card"
      className="ledger-panel overflow-hidden"
    >
      <div className="border-b border-rule bg-paper-soft px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-label text-pine-700">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            <span>Order placed · Round #{roundId}</span>
          </span>
          <span className="border border-rule-strong bg-paper-bright px-2.5 py-1 font-mono text-xs font-bold text-ink">
            {simplePhaseName(livePhase)}
          </span>
        </div>

        <h2 className="mt-2 font-display text-2xl font-bold text-ink">
          {livePhase === 'Ready'
            ? 'Your round is ready to finish'
            : livePhase === 'Reveal'
              ? 'Finalizing this round'
              : 'Waiting for this round to close'}
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          {livePhase === 'Ready'
            ? 'All orders are in. Click once below to lock in the fair price and make your tokens ready to collect.'
            : livePhase === 'Reveal'
              ? 'Sealed orders are being revealed before everyone gets the same fair price.'
              : 'Other traders can join until the timer reaches zero, then everyone receives the exact same fair price.'}
        </p>
      </div>

      <div className="space-y-5 p-5">
        {/* Big countdown or ready prompt */}
        <div className="flex flex-wrap items-center justify-between gap-4 border border-rule bg-paper-soft px-4 py-4">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-vermilion-600" aria-hidden="true" />
            <div>
              <div className="text-xs font-bold uppercase tracking-label text-ink-muted">
                {livePhase === 'Open'
                  ? 'Collecting orders closes in'
                  : livePhase === 'Reveal'
                    ? 'Round finishes in'
                    : 'Timer complete'}
              </div>
              <div
                data-testid="simple-waiting-timer"
                className="font-mono text-3xl font-bold text-ink tabular-nums"
              >
                {livePhase === 'Ready' ? 'Ready now' : formatClock(remaining)}
              </div>
            </div>
          </div>

          <div className="text-right font-mono text-xs text-ink-muted tabular-nums">
            <div>
              {userOrders.length} active order{userOrders.length === 1 ? '' : 's'}
            </div>
            {unrevealedWithSecret.length > 0 && (
              <div className="font-bold text-brass-800">
                {unrevealedWithSecret.length} sealed awaiting reveal
              </div>
            )}
          </div>
        </div>

        {/* 3 plain stages: Collecting -> Pricing -> Ready to collect */}
        <ol className="grid grid-cols-3 gap-2" aria-label="Round stages">
          {stages.map((stage, idx) => {
            const done = idx < activeStageIndex;
            const current = idx === activeStageIndex;
            return (
              <li
                key={stage.id}
                className={`border px-3 py-2.5 text-center text-xs font-bold ${
                  current
                    ? 'border-vermilion-600 bg-vermilion-50 text-vermilion-800'
                    : done
                      ? 'border-pine-600/40 bg-pine-50 text-pine-800'
                      : 'border-rule bg-paper-soft text-ink-muted'
                }`}
              >
                {stage.label}
              </li>
            );
          })}
        </ol>

        {/* Your placed order summary (plain, no tables or hex) */}
        {userOrders.length > 0 && (
          <div className="space-y-2">
            <div className="eyebrow">Your swap in this round</div>
            {userOrders.map((order) => (
              <div
                key={order.order_id}
                className="flex flex-wrap items-center justify-between gap-2 border border-rule bg-paper-soft px-4 py-3 text-sm"
              >
                <span className="font-bold text-ink">
                  {order.side === 'SellBase'
                    ? `Swapping ${formatToken(order.amount_in, 4)} ${config.baseSymbol} → ${config.quoteSymbol}`
                    : `Swapping ${formatPrice(order.amount_in, 2)} ${config.quoteSymbol} → ${config.baseSymbol}`}
                </span>
                <span className="font-mono text-xs text-ink-muted">
                  Included in Round #{roundId}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Prominent Reveal Now prompt for sealed commits when Finalizing opens */}
        {unrevealedWithSecret.length > 0 && (
          <div className="space-y-2.5 border-2 border-brass-600 bg-brass-50 p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-brass-900">
              <Eye className="h-4 w-4 text-brass-700" aria-hidden="true" />
              <span>
                {livePhase === 'Reveal'
                  ? 'Reveal your sealed order now to include it and get your deposit back'
                  : 'Your sealed order is waiting for the finalizing window'}
              </span>
            </div>
            {unrevealedWithSecret.map(({ commit, secret }) => (
              <div
                key={commit.commit_id}
                className="flex flex-wrap items-center justify-between gap-3 border border-brass-600/40 bg-paper-bright px-3.5 py-3"
              >
                <div className="text-sm text-ink">
                  <div className="font-bold">
                    {secret
                      ? secret.side === 'SellBase'
                        ? `${formatToken(secret.amount_in, 4)} ${config.baseSymbol} → ${config.quoteSymbol}`
                        : `${formatPrice(secret.amount_in, 2)} ${config.quoteSymbol} → ${config.baseSymbol}`
                      : `Sealed order #${commit.commit_id}`}
                  </div>
                  <div className="text-xs text-ink-muted">
                    Deposit: {formatToken(commit.bond_eth, 4)} ETH ·{' '}
                    {secret ? 'Secret saved in this browser' : 'Secret not found in this browser'}
                  </div>
                </div>
                {secret && (
                  <button
                    type="button"
                    disabled={busy || livePhase !== 'Reveal'}
                    onClick={() => void onRevealCommit(secret)}
                    className="tap-target inline-flex items-center gap-2 bg-brass-600 px-4 font-display text-sm font-bold text-[#FBF8F0] transition hover:bg-brass-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Eye className="h-4 w-4" aria-hidden="true" />
                    <span>
                      {busyAction === 'reveal'
                        ? 'Revealing…'
                        : livePhase === 'Reveal'
                          ? 'Reveal now'
                          : `Opens in ${formatClock(remaining)}`}
                    </span>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Primary CTA when round is finished (Ready) */}
        {livePhase === 'Ready' && (
          <button
            type="button"
            data-testid="simple-finalize-round"
            disabled={busy}
            onClick={() => void onSettleRound()}
            className="tap-target inline-flex w-full items-center justify-center gap-2 bg-vermilion-500 px-5 py-3.5 font-display text-base font-bold text-[#FBF8F0] transition hover:bg-vermilion-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busyAction === 'settle' ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                <span>{txStatus ?? 'Finishing round…'}</span>
              </>
            ) : (
              <>
                <Sparkles className="h-5 w-5" aria-hidden="true" />
                <span>Finish Round #{roundId} &amp; unlock tokens</span>
              </>
            )}
          </button>
        )}

        {txStatus && busy && livePhase !== 'Ready' && (
          <p className="flex items-center gap-2 text-sm font-medium text-cobalt-700">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span>{txStatus}</span>
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-rule pt-3">
          <span className="text-xs text-ink-muted">
            Safe to refresh — your order is saved on Ethereum Sepolia.
          </span>
          <button
            type="button"
            onClick={onPlaceAnother}
            className="tap-target inline-flex items-center gap-1.5 border border-rule-strong bg-paper-soft px-3.5 text-xs font-bold text-ink transition hover:border-ink"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Place another swap</span>
          </button>
        </div>
      </div>
    </section>
  );
};
