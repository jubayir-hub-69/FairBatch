import React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Droplets,
  ExternalLink,
  Link2,
  LogOut,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { formatUnits } from 'viem';
import type { RuntimeConfig } from '../onchain/config';
import type { FaucetState, WalletAllowances, WalletBalances } from '../onchain/state';
import { formatDuration, formatPrice, formatToken, getChainLabel, shortenAddress } from '../lib/format';
import { useNow } from '../lib/useNow';

interface AccountPanelProps {
  config: RuntimeConfig;
  account: string | null;
  walletChainId: number | null;
  wrongNetwork: boolean;
  balances: WalletBalances | null;
  allowances: WalletAllowances | null;
  faucet: FaucetState | null;
  busyAction: string | null;
  faucetEnabled: boolean;
  onConnect: () => Promise<void>;
  onDisconnect: () => void;
  onClaimFaucet: () => Promise<void>;
  onApprove: (token: 'base' | 'quote') => Promise<void>;
}

function human(raw: bigint | undefined, decimals: number): number {
  if (raw === undefined) return 0;
  return Number(formatUnits(raw, decimals));
}

export const AccountPanel: React.FC<AccountPanelProps> = ({
  config,
  account,
  walletChainId,
  wrongNetwork,
  balances,
  allowances,
  faucet,
  busyAction,
  faucetEnabled,
  onConnect,
  onDisconnect,
  onClaimFaucet,
  onApprove,
}) => {
  const busy = busyAction !== null;
  const connected = Boolean(account);
  const nowSecs = useNow();

  const claimBaseHuman = human(faucet?.claimBaseAmount ?? config.faucetClaimBase, config.baseDecimals);
  const claimQuoteHuman = human(
    faucet?.claimQuoteAmount ?? config.faucetClaimQuote,
    config.quoteDecimals,
  );
  const faucetBaseReserve = human(faucet?.baseBalance, config.baseDecimals);
  const faucetQuoteReserve = human(faucet?.quoteBalance, config.quoteDecimals);
  const nextClaimSecs = Number(faucet?.nextClaimAt ?? 0n);
  const cooldownRemaining = nextClaimSecs > nowSecs ? nextClaimSecs - nowSecs : 0;
  const faucetReady =
    faucetEnabled &&
    cooldownRemaining === 0 &&
    (faucet ? faucet.canClaim || nextClaimSecs <= nowSecs : true);

  return (
    <section aria-label="Connected wallet and balances" className="ledger-panel overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-rule px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Wallet className="h-3 w-3 text-cobalt-700" aria-hidden="true" />
            <span className="eyebrow">Settlement account</span>
          </div>
          <h2 className="mt-1 font-display text-xl font-bold leading-tight tracking-tight text-ink">
            {connected ? 'On-chain wallet' : 'Connect a wallet'}
          </h2>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 border px-2 py-1 font-mono text-xs font-bold uppercase ${
            connected
              ? 'border-pine-600/40 bg-pine-50 text-pine-700'
              : 'border-brass-600/50 bg-brass-50 text-brass-700'
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${connected ? 'bg-pine-500' : 'bg-brass-500'}`} />
          {connected ? 'Connected' : 'Read-only'}
        </span>
      </div>

      <div className="space-y-3 p-4">
        {!connected ? (
          <>
            <p className="text-sm leading-relaxed text-ink-muted">
              Every order, reveal, settlement and claim is a signed transaction. Connect an
              injected EIP-1193 wallet on{' '}
              <strong className="text-ink">{getChainLabel(config.chainId)}</strong> to trade
              against the deployed FairBatch contract.
            </p>
            <button
              type="button"
              data-testid="account-connect-button"
              disabled={busy}
              onClick={() => void onConnect()}
              className="tap-target inline-flex w-full items-center justify-center gap-2 border border-ink bg-ink px-3 py-2.5 font-display text-sm font-bold text-paper transition hover:bg-ink-soft disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Link2 className="h-4 w-4" aria-hidden="true" />
              <span>{busyAction === 'connect' ? 'Connecting…' : 'Connect injected wallet'}</span>
            </button>
            <p className="border-t border-rule pt-2 font-mono text-xs leading-relaxed text-ink-muted">
              Sepolia · {shortenAddress(config.fairBatch)} · Faucet {shortenAddress(config.faucet)}
            </p>
          </>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-mono text-sm font-bold text-ink">
                  {shortenAddress(account ?? '')}
                </div>
                <div className="mt-0.5 font-mono text-xs text-ink-muted">
                  {getChainLabel(config.chainId)}
                  {walletChainId !== null && walletChainId !== config.chainId
                    ? ` · wallet on ${getChainLabel(walletChainId)}`
                    : ''}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <a
                  href={`${config.explorerUrl}/address/${account}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open wallet on explorer"
                  className="inline-flex h-9 w-9 items-center justify-center border border-rule text-ink-muted transition hover:border-ink hover:text-ink"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
                <button
                  type="button"
                  onClick={onDisconnect}
                  aria-label="Disconnect wallet"
                  className="inline-flex h-9 w-9 items-center justify-center border border-rule text-ink-muted transition hover:border-ink hover:text-ink"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            </div>

            {wrongNetwork && (
              <div className="flex items-start gap-2 border-l-2 border-vermilion-500 bg-vermilion-50 px-3 py-2.5 text-sm leading-snug text-vermilion-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  Wallet network mismatch. Reconnect to switch the wallet to{' '}
                  {getChainLabel(config.chainId)}.
                  <button
                    type="button"
                    onClick={() => void onConnect()}
                    className="ml-1 font-bold underline decoration-dotted underline-offset-2"
                  >
                    Switch
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-px border border-rule bg-rule">
              <div className="bg-paper-bright p-2.5">
                <div className="font-mono text-xs uppercase tracking-label text-ink-muted">
                  Sepolia ETH
                </div>
                <div className="mt-1 font-mono text-sm font-bold text-ink tabular-nums">
                  {formatToken(human(balances?.eth, 18), 4)}
                </div>
              </div>
              <div className="bg-paper-bright p-2.5">
                <div className="font-mono text-xs uppercase tracking-label text-ink-muted">
                  LP shares
                </div>
                <div className="mt-1 font-mono text-sm font-bold text-plum-700 tabular-nums">
                  {formatToken(human(balances?.lpShares, 18), 2)}
                </div>
              </div>
              <div className="bg-paper-bright p-2.5">
                <div className="font-mono text-xs uppercase tracking-label text-ink-muted">
                  {config.baseSymbol}
                </div>
                <div
                  data-testid="account-balance-base"
                  className="mt-1 font-mono text-sm font-bold text-ink tabular-nums"
                >
                  {formatToken(human(balances?.base, config.baseDecimals), 3)}
                </div>
                <div className="mt-1 flex items-center gap-1 font-mono text-xs text-ink-muted">
                  {allowances && allowances.base > 0n ? (
                    <>
                      <CheckCircle2 className="h-3 w-3 text-pine-600" />
                      approved
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="h-3 w-3 text-brass-600" />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onApprove('base')}
                        className="underline decoration-dotted underline-offset-2 hover:text-ink"
                      >
                        approve
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="bg-paper-bright p-2.5">
                <div className="font-mono text-xs uppercase tracking-label text-ink-muted">
                  {config.quoteSymbol}
                </div>
                <div
                  data-testid="account-balance-quote"
                  className="mt-1 font-mono text-sm font-bold text-ink tabular-nums"
                >
                  {formatToken(human(balances?.quote, config.quoteDecimals), 2)}
                </div>
                <div className="mt-1 flex items-center gap-1 font-mono text-xs text-ink-muted">
                  {allowances && allowances.quote > 0n ? (
                    <>
                      <CheckCircle2 className="h-3 w-3 text-pine-600" />
                      approved
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="h-3 w-3 text-brass-600" />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onApprove('quote')}
                        className="underline decoration-dotted underline-offset-2 hover:text-ink"
                      >
                        approve
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {faucetEnabled && (
              <div className="border border-brass-500/40 bg-brass-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-mono text-xs font-bold uppercase tracking-label text-brass-800">
                    <Droplets className="h-3.5 w-3.5" />
                    Sepolia faucet
                  </div>
                  <a
                    href={`${config.explorerUrl}/address/${config.faucet}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-xs text-brass-800 underline decoration-dotted underline-offset-2 hover:text-ink"
                  >
                    <span>{shortenAddress(config.faucet)}</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <button
                  type="button"
                  data-testid="faucet-claim-button"
                  disabled={busy || wrongNetwork || !faucetReady}
                  onClick={() => void onClaimFaucet()}
                  className="tap-target mt-2 inline-flex w-full items-center justify-center gap-1.5 border border-brass-600/60 bg-paper-bright px-3 font-mono text-xs font-bold uppercase text-brass-900 transition hover:bg-brass-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busyAction === 'faucet' ? (
                    <span>Claiming from faucet…</span>
                  ) : cooldownRemaining > 0 ? (
                    <>
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Next claim in {formatDuration(cooldownRemaining)}</span>
                    </>
                  ) : (
                    <>
                      <Droplets className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>
                        Claim {formatToken(claimBaseHuman, 2, 0)} {config.baseSymbol} +{' '}
                        {formatPrice(claimQuoteHuman, 0)} {config.quoteSymbol}
                      </span>
                    </>
                  )}
                </button>
                <p className="mt-2 font-mono text-xs leading-relaxed text-ink-muted tabular-nums">
                  {formatDuration(faucet?.cooldownSecs ?? config.faucetCooldownSecs)} cooldown ·
                  faucet holds {formatToken(faucetBaseReserve, 1, 0)} {config.baseSymbol} &amp;{' '}
                  {formatPrice(faucetQuoteReserve, 0)} {config.quoteSymbol}.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
};
