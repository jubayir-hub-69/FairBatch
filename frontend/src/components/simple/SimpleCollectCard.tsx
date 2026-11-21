import React from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Coins,
  ExternalLink,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import type { BatchSettlementDto, ClaimableDto } from '../../types';
import { explorerTxUrl, type RuntimeConfig } from '../../onchain/config';
import { formatPrice, formatToken, formatUsd } from '../../lib/format';

export interface CollectedReceiptSummary {
  hash: string;
  items: ClaimableDto[];
}

interface SimpleCollectCardProps {
  config: RuntimeConfig;
  unclaimed: ClaimableDto[];
  settledHistory: BatchSettlementDto[];
  lastCollected: CollectedReceiptSummary | null;
  busyAction: string | null;
  txStatus: string | null;
  onCollectOne: (item: ClaimableDto) => Promise<void>;
  onCollectAll: (items: ClaimableDto[]) => Promise<void>;
  onSwapAgain: () => void;
}

function summarizeReceipt(item: ClaimableDto, config: RuntimeConfig): string {
  if (item.status === 'OutOfMoneyRefund') {
    const inSym = item.side === 'SellBase' ? config.baseSymbol : config.quoteSymbol;
    const refunded =
      item.side === 'SellBase'
        ? formatToken(item.refund_in, 4)
        : formatPrice(item.refund_in, 2);
    return `Round #${item.batch_id} cleared outside your price limit, so your full ${refunded} ${inSym} is ready to collect back.`;
  }

  if (item.side === 'SellBase') {
    return `You sold ${formatToken(item.amount_filled, 4)} ${config.baseSymbol}, received ${formatPrice(
      item.payout_out,
      2,
    )} ${config.quoteSymbol} at fair price $${formatPrice(
      item.effective_price,
      2,
    )}. Everyone in this round got the same price.`;
  }

  return `You spent ${formatPrice(item.amount_filled, 2)} ${config.quoteSymbol}, received ${formatToken(
    item.payout_out,
    4,
  )} ${config.baseSymbol} at fair price $${formatPrice(
    item.effective_price,
    2,
  )}. Everyone in this round got the same price.`;
}

export const SimpleCollectCard: React.FC<SimpleCollectCardProps> = ({
  config,
  unclaimed,
  settledHistory,
  lastCollected,
  busyAction,
  txStatus,
  onCollectOne,
  onCollectAll,
  onSwapAgain,
}) => {
  const busy = busyAction !== null;

  if (unclaimed.length === 0 && lastCollected) {
    const txUrl = explorerTxUrl(config, lastCollected.hash);
    const totalBase = lastCollected.items.reduce(
      (acc, i) => acc + (i.side === 'BuyBase' ? i.payout_out : i.refund_in),
      0,
    );
    const totalQuote = lastCollected.items.reduce(
      (acc, i) => acc + (i.side === 'SellBase' ? i.payout_out : i.refund_in),
      0,
    );

    return (
      <section
        aria-label="Swap complete"
        data-testid="simple-collect-success"
        className="ledger-panel overflow-hidden"
      >
        <div className="border-b border-rule bg-pine-50 px-5 py-5">
          <div className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-label text-pine-800">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            <span>Swap complete</span>
          </div>
          <h2 className="mt-2 font-display text-2xl font-bold text-ink">
            Your tokens are in your wallet
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            {totalBase > 0 && totalQuote > 0
              ? `Collected ${formatToken(totalBase, 4)} ${config.baseSymbol} and ${formatPrice(totalQuote, 2)} ${config.quoteSymbol}.`
              : totalQuote > 0
                ? `Collected ${formatPrice(totalQuote, 2)} ${config.quoteSymbol}.`
                : `Collected ${formatToken(totalBase, 4)} ${config.baseSymbol}.`}
          </p>
        </div>

        <div className="space-y-4 p-5">
          {txUrl && (
            <a
              href={txUrl}
              target="_blank"
              rel="noreferrer"
              className="tap-target inline-flex w-full items-center justify-center gap-2 border border-rule-strong bg-paper-soft px-4 font-sans text-sm font-bold text-ink transition hover:border-ink"
            >
              <span>View transaction on Sepolia Etherscan</span>
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          )}

          <button
            type="button"
            data-testid="simple-swap-again-button"
            onClick={onSwapAgain}
            className="tap-target inline-flex w-full items-center justify-center gap-2 bg-ink px-5 py-3.5 font-display text-base font-bold text-paper transition hover:bg-ink-soft"
          >
            <span>Swap again</span>
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </section>
    );
  }

  if (unclaimed.length === 0) return null;

  const primary = unclaimed[0];
  const primaryBatch = settledHistory.find((s) => s.batch_id === primary.batch_id);
  // Show savings line ONLY when the corrected signed comparison math shows a real positive saving (> $0.01).
  const realSavingsQuote =
    primaryBatch && primaryBatch.comparison.user_value_saved_quote > 0.01
      ? primaryBatch.comparison.user_value_saved_quote
      : null;

  const handleCollect = async () => {
    if (unclaimed.length === 1) {
      await onCollectOne(unclaimed[0]);
    } else {
      await onCollectAll(unclaimed);
    }
  };

  return (
    <section
      aria-label="Collect completed swap"
      data-testid="simple-collect-card"
      className="ledger-panel overflow-hidden"
    >
      <div className="border-b border-rule bg-pine-50 px-5 py-4">
        <div className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-label text-pine-800">
          <Coins className="h-4 w-4" aria-hidden="true" />
          <span>
            Ready to collect · {unclaimed.length} completed order
            {unclaimed.length === 1 ? '' : 's'}
          </span>
        </div>
        <h2 className="mt-2 font-display text-2xl font-bold text-ink">
          Round #{primary.batch_id} finished!
        </h2>
        <p className="mt-1.5 text-base leading-relaxed text-ink">
          {summarizeReceipt(primary, config)}
        </p>

        {realSavingsQuote !== null && (
          <div className="mt-3 inline-flex items-center gap-2 border border-pine-600/50 bg-paper-bright px-3 py-1.5 text-sm font-bold text-pine-800">
            <ShieldCheck className="h-4 w-4 text-pine-700" aria-hidden="true" />
            <span>
              Round saved {formatUsd(realSavingsQuote)} vs a normal swap
            </span>
          </div>
        )}
      </div>

      <div className="space-y-4 p-5">
        {unclaimed.length > 1 && (
          <div className="space-y-2">
            <div className="eyebrow">All ready orders</div>
            {unclaimed.map((item) => {
              const outSym =
                item.side === 'SellBase' ? config.quoteSymbol : config.baseSymbol;
              const inSym =
                item.side === 'SellBase' ? config.baseSymbol : config.quoteSymbol;
              return (
                <div
                  key={`${item.batch_id}-${item.order_id}`}
                  className="flex flex-wrap items-center justify-between gap-2 border border-rule bg-paper-soft px-3.5 py-2.5 text-sm"
                >
                  <span className="font-bold text-ink">Round #{item.batch_id}</span>
                  <span className="font-mono text-sm font-bold text-pine-800 tabular-nums">
                    {item.payout_out > 0
                      ? `${
                          outSym === config.quoteSymbol
                            ? formatPrice(item.payout_out, 2)
                            : formatToken(item.payout_out, 4)
                        } ${outSym}`
                      : ''}
                    {item.refund_in > 0
                      ? `${item.payout_out > 0 ? ' + ' : ''}${
                          inSym === config.quoteSymbol
                            ? formatPrice(item.refund_in, 2)
                            : formatToken(item.refund_in, 4)
                        } ${inSym} refund`
                      : ''}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <button
          type="button"
          data-testid="simple-collect-button"
          disabled={busy}
          onClick={() => void handleCollect()}
          className="tap-target inline-flex w-full items-center justify-center gap-2 bg-pine-600 px-5 py-3.5 font-display text-base font-bold text-[#FBF8F0] transition hover:bg-pine-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              <span>{txStatus ?? 'Collecting tokens…'}</span>
            </>
          ) : (
            <>
              <Coins className="h-5 w-5" aria-hidden="true" />
              <span>
                {unclaimed.length === 1
                  ? 'Collect tokens'
                  : `Collect all ${unclaimed.length} orders (one click)`}
              </span>
            </>
          )}
        </button>
      </div>
    </section>
  );
};
