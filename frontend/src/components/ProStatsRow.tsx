import React from 'react';
import { ExternalLink } from 'lucide-react';
import type { BatchPhase, StateResponse } from '../types';
import type { RawBatchInfo } from '../onchain/state';
import { explorerAddressUrl, type RuntimeConfig } from '../onchain/config';
import {
  formatInvariant,
  formatPrice,
  formatToken,
  getChainLabel,
  shortenAddress,
} from '../lib/format';
import { PRO_TOOLTIPS, proPhaseName } from '../lib/glossary';
import { InfoTooltip } from './InfoTooltip';

interface ProStatsRowProps {
  config: RuntimeConfig;
  state: StateResponse;
  batch: RawBatchInfo;
  livePhase: BatchPhase;
  account: string | null;
  walletChainId: number | null;
  wrongNetwork: boolean;
  loading: boolean;
}

export const ProStatsRow: React.FC<ProStatsRowProps> = ({
  config,
  state,
  batch,
  livePhase,
  account,
  walletChainId,
  wrongNetwork,
  loading,
}) => {
  const connectionLabel = loading
    ? 'Syncing on-chain ledger'
    : wrongNetwork
      ? `Wrong network · chain #${walletChainId ?? '?'}`
      : account
        ? `Connected · ${getChainLabel(config.chainId)}`
        : 'Read-only · live RPC';

  const contractUrl = explorerAddressUrl(config, config.fairBatch);

  return (
    <section
      aria-label="Pool reserves and batch overview"
      className="mb-5 border border-rule bg-paper-bright shadow-slip"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule bg-paper-soft px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid="batch-id-badge"
            className="border border-ink bg-ink px-2 py-0.5 font-mono text-xs font-bold uppercase tracking-label text-paper"
          >
            BATCH #{state.batch_id}
          </span>
          <span className="font-mono text-xs font-bold text-ink">
            {proPhaseName(livePhase)}
          </span>
          <span className="font-mono text-xs text-ink-muted tabular-nums">
            · {state.orders.length} order{state.orders.length === 1 ? '' : 's'} ·{' '}
            {Number(batch.commitCount)} commitment{Number(batch.commitCount) === 1 ? '' : 's'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            data-testid="connection-status-badge"
            className={`inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-xs font-bold ${
              wrongNetwork
                ? 'border-vermilion-500/60 bg-vermilion-50 text-vermilion-800'
                : account
                  ? 'border-pine-600/50 bg-pine-50 text-pine-800'
                  : 'border-cobalt-600/50 bg-cobalt-50 text-cobalt-800'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                wrongNetwork
                  ? 'bg-vermilion-500'
                  : account
                    ? 'bg-pine-500'
                    : 'bg-cobalt-500'
              }`}
            />
            <span>{connectionLabel}</span>
          </span>

          {contractUrl && (
            <a
              href={contractUrl}
              target="_blank"
              rel="noreferrer"
              data-testid="deployed-contract-badge"
              className="inline-flex items-center gap-1 border border-rule-strong bg-paper-bright px-2 py-0.5 font-mono text-xs font-bold text-ink-soft transition hover:border-ink hover:text-ink"
            >
              <span>Contract {shortenAddress(config.fairBatch)}</span>
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px bg-rule lg:grid-cols-4">
        <div className="bg-paper-bright px-4 py-3">
          <div className="flex items-center gap-1 font-mono text-xs font-bold uppercase tracking-label text-ink-muted">
            <span>Reserve R_x</span>
            <InfoTooltip label="Reserve R_x" text={PRO_TOOLTIPS.rx} />
          </div>
          <div
            data-testid="reserve-rx"
            className="mt-1 font-mono text-base font-bold text-ink tabular-nums"
          >
            {formatToken(state.reserves.rx, 2)} {config.baseSymbol}
          </div>
        </div>

        <div className="bg-paper-bright px-4 py-3">
          <div className="flex items-center gap-1 font-mono text-xs font-bold uppercase tracking-label text-ink-muted">
            <span>Reserve R_y</span>
            <InfoTooltip label="Reserve R_y" text={PRO_TOOLTIPS.ry} />
          </div>
          <div
            data-testid="reserve-ry"
            className="mt-1 font-mono text-base font-bold text-ink tabular-nums"
          >
            {formatPrice(state.reserves.ry, 0)} {config.quoteSymbol}
          </div>
        </div>

        <div className="bg-paper-bright px-4 py-3">
          <div className="flex items-center gap-1 font-mono text-xs font-bold uppercase tracking-label text-ink-muted">
            <span>Pool Spot</span>
            <InfoTooltip label="Pool Spot" text={PRO_TOOLTIPS.spot} />
          </div>
          <div
            data-testid="pool-spot-price"
            className="mt-1 font-mono text-base font-bold text-vermilion-700 tabular-nums"
          >
            ${formatPrice(state.reserves.spot_price, 2)}
          </div>
        </div>

        <div className="bg-paper-bright px-4 py-3">
          <div className="flex items-center gap-1 font-mono text-xs font-bold uppercase tracking-label text-ink-muted">
            <span>LP Invariant k</span>
            <InfoTooltip label="LP Invariant k" text={PRO_TOOLTIPS.k} />
          </div>
          <div className="mt-1 font-mono text-base font-bold text-plum-700 tabular-nums">
            {formatInvariant(state.reserves.k_invariant)}
          </div>
        </div>
      </div>
    </section>
  );
};
