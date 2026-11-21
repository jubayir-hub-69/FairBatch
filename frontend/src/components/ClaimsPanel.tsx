import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Coins,
  Layers,
  Lock,
  Sparkles,
  Wallet,
} from 'lucide-react';
import type { ClaimableDto } from '../types';
import type { RuntimeConfig } from '../onchain/config';
import { formatPrice, formatToken, shortenAddress } from '../lib/format';
import { PRO_TOOLTIPS } from '../lib/glossary';
import { InfoTooltip } from './InfoTooltip';

interface ClaimsPanelProps {
  claimable: ClaimableDto[];
  config: RuntimeConfig;
  account: string | null;
  busyAction: string | null;
  onClaimSingle: (item: ClaimableDto) => Promise<void>;
  onClaimMany: (items: ClaimableDto[]) => Promise<void>;
  onConnect: () => Promise<void>;
}

function sameAddress(a: string, b: string | null): boolean {
  return Boolean(b) && a.toLowerCase() === b?.toLowerCase();
}

export const ClaimsPanel: React.FC<ClaimsPanelProps> = ({
  claimable,
  config,
  account,
  busyAction,
  onClaimSingle,
  onClaimMany,
  onConnect,
}) => {
  const [mineOnly, setMineOnly] = useState<boolean>(false);
  const [toast, setToast] = useState<{
    kind: 'success' | 'error';
    text: string;
  } | null>(null);

  const filteredClaims = useMemo(() => {
    if (!mineOnly || !account) return claimable;
    return claimable.filter((c) => sameAddress(c.trader, account));
  }, [claimable, mineOnly, account]);

  const myUnclaimed = useMemo(
    () =>
      claimable.filter((c) => !c.claimed && sameAddress(c.trader, account)),
    [claimable, account],
  );

  const busy = busyAction !== null;

  const handleClaimSingle = async (item: ClaimableDto) => {
    setToast(null);
    try {
      await onClaimSingle(item);
      setToast({
        kind: 'success',
        text: `Claimed Batch #${item.batch_id} Order #${item.order_id} payout.`,
      });
    } catch (err) {
      setToast({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Claim failed',
      });
    }
  };

  const handleClaimMany = async () => {
    if (myUnclaimed.length === 0) return;
    setToast(null);
    try {
      await onClaimMany(myUnclaimed);
      setToast({
        kind: 'success',
        text: `Multicall claimed ${myUnclaimed.length} settled receipt(s).`,
      });
    } catch (err) {
      setToast({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Multicall claim failed',
      });
    }
  };

  return (
    <section
      aria-label="Pull-Over-Push Settlement Claims Center"
      className="ledger-panel overflow-hidden"
    >
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 border-b border-rule px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Coins className="h-3 w-3 text-pine-700" aria-hidden="true" />
            <span className="eyebrow">Claims ledger</span>
          </div>
          <h2 className="mt-1 flex items-center gap-1.5 font-display text-xl font-bold leading-tight tracking-tight text-ink">
            <span>Pull-over-push settlement claims</span>
            <InfoTooltip label="Pull-over-push claims" text={PRO_TOOLTIPS.pullOverPush} />
          </h2>
          <p className="mt-0.5 text-sm leading-relaxed text-ink-muted">
            Payouts and refunds are credited to order owners after settlement. Only the
            order owner can pull a receipt.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setMineOnly((value) => !value)}
            disabled={!account}
            title={account ? 'Filter to the connected wallet' : 'Connect a wallet to filter'}
            className={`min-h-[36px] border px-2.5 font-mono text-xs font-bold uppercase transition disabled:opacity-40 ${
              mineOnly
                ? 'border-cobalt-700 bg-cobalt-600 text-paper'
                : 'border-rule-strong bg-paper-bright text-ink-muted hover:border-ink hover:text-ink'
            }`}
          >
            {mineOnly ? 'Showing my wallet' : 'Showing all receipts'}
          </button>

          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              disabled={myUnclaimed.length === 0 || busy || !account}
              onClick={() => void handleClaimMany()}
              title={
                !account
                  ? 'Connect the wallet that owns these orders'
                  : myUnclaimed.length === 0
                    ? 'No unclaimed receipts for the connected wallet'
                    : 'Claim every unclaimed receipt for this wallet in one transaction'
              }
              className="inline-flex min-h-[36px] items-center gap-1.5 border border-pine-700 bg-pine-600 px-3 font-mono text-xs font-bold uppercase text-[#FBF8F0] transition hover:bg-pine-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Layers className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Multicall My Claims ({myUnclaimed.length})</span>
            </button>
            <InfoTooltip label="Multicall" text={PRO_TOOLTIPS.multicall} />
          </div>
        </div>
      </div>

      {toast && (
        <div
          className={`flex items-center justify-between gap-2 border-b px-4 py-2 font-mono text-[10px] ${
            toast.kind === 'error'
              ? 'border-vermilion-500/30 bg-vermilion-50 text-vermilion-800'
              : 'border-pine-600/30 bg-pine-50 text-pine-800'
          }`}
        >
          <span className="flex items-center gap-2">
            {toast.kind === 'error' ? (
              <Lock className="h-3 w-3 shrink-0" />
            ) : (
              <Sparkles className="h-3 w-3 shrink-0" />
            )}
            <span>{toast.text}</span>
          </span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="shrink-0 border border-current px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-label opacity-70 transition hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="max-h-72 divide-y divide-rule/70 overflow-y-auto">
        {filteredClaims.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
            <Lock className="mb-2 h-4 w-4 text-ink-faint" aria-hidden="true" />
            <p className="max-w-md text-[11px] leading-relaxed text-ink-muted">
              {claimable.length === 0 ? (
                <>
                  No settled receipts yet. Once a batch passes its reveal deadline a
                  connected wallet can settle it, and payouts appear here as pull claims.
                </>
              ) : (
                <>
                  No claims for the connected wallet in this view.{' '}
                  <button
                    type="button"
                    onClick={() => setMineOnly(false)}
                    className="font-bold text-ink underline decoration-dotted underline-offset-2"
                  >
                    Show all receipts
                  </button>
                  .
                </>
              )}
            </p>
            {!account && claimable.length > 0 && (
              <button
                type="button"
                onClick={() => void onConnect()}
                disabled={busy}
                className="mt-3 inline-flex items-center gap-1.5 border border-ink bg-ink px-3 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.06em] text-paper disabled:opacity-40"
              >
                <Wallet className="h-3 w-3" />
                <span>Connect wallet to claim</span>
              </button>
            )}
          </div>
        ) : (
          filteredClaims.map((item) => {
            const outUnit =
              item.side === 'SellBase' ? config.quoteSymbol : config.baseSymbol;
            const inUnit =
              item.side === 'SellBase' ? config.baseSymbol : config.quoteSymbol;
            const isMine = sameAddress(item.trader, account);
            return (
              <div
                key={`${item.batch_id}-${item.order_id}`}
                className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 text-[11px] ${
                  item.claimed ? 'bg-paper-soft/60' : 'bg-paper-bright'
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="shrink-0 border border-ink bg-ink px-1.5 py-0.5 font-mono text-[9px] font-bold text-paper tabular-nums">
                    B#{item.batch_id} · #{item.order_id}
                  </span>
                  <div className="min-w-0">
                    <div className="font-semibold text-ink">
                      {item.label}{' '}
                      <span className="font-mono text-[9px] font-normal text-ink-faint">
                        ({shortenAddress(item.trader)})
                      </span>
                      {account && isMine && (
                        <span className="ml-1.5 border border-pine-600/40 bg-pine-50 px-1 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.06em] text-pine-700">
                          you
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-ink-muted tabular-nums">
                      Payout:{' '}
                      <span className="font-bold text-pine-700">
                        {outUnit === config.quoteSymbol
                          ? formatPrice(item.payout_out, 2)
                          : formatToken(item.payout_out, 4)}{' '}
                        {outUnit}
                      </span>
                      {item.refund_in > 0 && (
                        <>
                          {' '}
                          · Refund:{' '}
                          <span className="font-bold text-brass-700">
                            {formatToken(item.refund_in, 3)} {inUnit}
                          </span>
                        </>
                      )}
                      {' · '}
                      <span className="uppercase tracking-[0.04em]">
                        {item.status === 'Filled'
                          ? 'filled'
                          : item.status === 'PartialFill'
                            ? 'pro-rata partial'
                            : 'refunded'}
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  {item.claimed ? (
                    <span
                      data-testid={`claimed-badge-${item.batch_id}-${item.order_id}`}
                      className="inline-flex items-center gap-1 border border-pine-600/40 bg-pine-50 px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.06em] text-pine-700"
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      <span>Claimed</span>
                    </span>
                  ) : !account ? (
                    <button
                      type="button"
                      onClick={() => void onConnect()}
                      disabled={busy}
                      className="border border-rule-strong bg-paper-bright px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.06em] text-ink-muted transition hover:border-ink hover:text-ink disabled:opacity-40"
                    >
                      Connect to claim
                    </button>
                  ) : !isMine ? (
                    <span
                      className="inline-flex items-center gap-1 border border-rule bg-paper-soft px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.06em] text-ink-faint"
                      title="Only the order owner can claim this receipt"
                    >
                      <Lock className="h-3 w-3" />
                      Other wallet
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleClaimSingle(item)}
                      className="border border-pine-700 bg-pine-50 px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.06em] text-pine-800 transition hover:bg-pine-600 hover:text-paper disabled:opacity-40"
                    >
                      {busyAction === 'claim' ? 'Claiming…' : 'Claim Payout'}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};
