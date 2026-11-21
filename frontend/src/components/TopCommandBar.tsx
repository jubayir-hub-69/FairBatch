import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronDown,
  Code2,
  Copy,
  ExternalLink,
  FlaskConical,
  Globe,
  LogOut,
  MoreHorizontal,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { formatUnits } from 'viem';
import type { BatchPhase } from '../types';
import type { RawBatchInfo, WalletBalances } from '../onchain/state';
import { remainingSecondsForPhase } from '../onchain/state';
import { explorerAddressUrl, type RuntimeConfig } from '../onchain/config';
import {
  formatPrice,
  formatToken,
  getChainLabel,
  shortenAddress,
} from '../lib/format';
import { proPhaseName, simplePhaseName } from '../lib/glossary';

export type UiMode = 'simple' | 'pro';

interface TopCommandBarProps {
  mode: UiMode;
  onModeChange: (mode: UiMode) => void;
  config: RuntimeConfig;
  batch: RawBatchInfo | null;
  livePhase: BatchPhase;
  chainNow: number;
  account: string | null;
  balances: WalletBalances | null;
  walletChainId: number | null;
  wrongNetwork: boolean;
  loading: boolean;
  refreshing: boolean;
  busyAction: string | null;
  onConnect: () => Promise<void>;
  onSwitchNetwork: () => Promise<void>;
  onDisconnect: () => void;
  onRefresh: () => void;
  onOpenHowItWorks: () => void;
  onOpenFeModal: () => void;
  onOpenContractModal: () => void;
  onOpenSimulationModal: () => void;
}

function formatShortClock(totalSeconds: number): string {
  const secs = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}:${String(rem).padStart(2, '0')}`;
}

function human(raw: bigint | undefined, decimals: number): number {
  if (raw === undefined) return 0;
  return Number(formatUnits(raw, decimals));
}

export const TopCommandBar: React.FC<TopCommandBarProps> = ({
  mode,
  onModeChange,
  config,
  batch,
  livePhase,
  chainNow,
  account,
  balances,
  walletChainId,
  wrongNetwork,
  loading,
  refreshing,
  busyAction,
  onConnect,
  onSwitchNetwork,
  onDisconnect,
  onRefresh,
  onOpenHowItWorks,
  onOpenFeModal,
  onOpenContractModal,
  onOpenSimulationModal,
}) => {
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const walletMenuRef = useRef<HTMLDivElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (walletMenuRef.current && !walletMenuRef.current.contains(target)) {
        setWalletMenuOpen(false);
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(target)) {
        setMoreMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setWalletMenuOpen(false);
        setMoreMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const remaining = batch
    ? remainingSecondsForPhase(batch, livePhase, chainNow)
    : 0;
  const roundNumber = batch ? Number(batch.batchId) : null;
  const phaseText =
    mode === 'simple' ? simplePhaseName(livePhase) : proPhaseName(livePhase);
  const showTimer = livePhase === 'Open' || livePhase === 'Reveal';

  const statusPillClass =
    livePhase === 'Ready'
      ? 'border-vermilion-500/60 bg-vermilion-50 text-vermilion-800'
      : livePhase === 'Reveal'
        ? 'border-brass-600/60 bg-brass-50 text-brass-900'
        : 'border-pine-600/50 bg-pine-50 text-pine-800';

  const statusDotClass =
    livePhase === 'Ready'
      ? 'bg-vermilion-500'
      : livePhase === 'Reveal'
        ? 'bg-brass-500'
        : 'bg-pine-500';

  const handleCopyAddress = async () => {
    if (!account) return;
    try {
      await navigator.clipboard.writeText(account);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard unavailable
    }
  };

  const explorerAccountUrl = account ? explorerAddressUrl(config, account) : null;

  return (
    <header className="sticky top-0 z-40 h-12 border-b border-ink bg-paper-bright sm:h-14">
      <div className="mx-auto flex h-full max-w-[1560px] items-center justify-between gap-1 px-2 sm:gap-2 sm:px-4 lg:px-8">
        {/* Left: brand + Simple | Pro toggle */}
        <div className="flex min-w-0 items-center gap-1 sm:gap-3">
          <div className="flex shrink-0 items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center border border-ink bg-ink text-paper sm:h-8 sm:w-8">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="hidden font-display text-base font-bold tracking-tight text-ink sm:inline sm:text-lg">
              FairBatch
            </span>
          </div>

          <div
            role="group"
            aria-label="Interface mode"
            className="inline-flex shrink-0 border border-rule-strong bg-paper-soft p-0.5"
          >
            <button
              type="button"
              data-testid="mode-simple-button"
              aria-pressed={mode === 'simple'}
              onClick={() => onModeChange('simple')}
              className={`min-h-[30px] px-1.5 font-sans text-xs font-bold transition sm:min-h-[34px] sm:px-3 ${
                mode === 'simple'
                  ? 'bg-ink text-paper'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              Simple
            </button>
            <button
              type="button"
              data-testid="mode-pro-button"
              aria-pressed={mode === 'pro'}
              onClick={() => onModeChange('pro')}
              className={`min-h-[30px] px-1.5 font-sans text-xs font-bold transition sm:min-h-[34px] sm:px-3 ${
                mode === 'pro'
                  ? 'bg-ink text-paper'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              Pro
            </button>
          </div>
        </div>

        {/* Center: round status pill */}
        <div
          data-testid="round-status-pill"
          className={`hidden min-w-0 items-center gap-1.5 border px-2.5 py-1 font-mono text-xs font-bold tabular-nums md:inline-flex ${statusPillClass}`}
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${statusDotClass}`} />
          <span className="truncate">
            {loading || roundNumber === null
              ? 'Syncing Sepolia…'
              : `${mode === 'simple' ? 'Round' : 'Batch'} ${roundNumber} · ${phaseText}${
                  showTimer ? ` · ${formatShortClock(remaining)}` : ''
                }`}
          </span>
        </div>

        {/* Right: compact mobile round pill + single wallet button + overflow menu */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {roundNumber !== null && (
            <span
              className={`inline-flex items-center gap-1 border px-1.5 py-0.5 font-mono text-xs font-bold tabular-nums md:hidden ${statusPillClass}`}
              title={`${mode === 'simple' ? 'Round' : 'Batch'} ${roundNumber} · ${phaseText}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass}`} />
              <span>
                #{roundNumber}
                {showTimer ? `·${formatShortClock(remaining)}` : ''}
              </span>
            </span>
          )}

          {/* Single Wallet Button + Dropdown */}
          <div ref={walletMenuRef} className="relative">
            {!account ? (
              <button
                type="button"
                data-testid="header-wallet-button"
                disabled={busyAction !== null}
                onClick={() => void onConnect()}
                className="inline-flex min-h-[34px] items-center gap-1 border border-ink bg-ink px-2 font-sans text-xs font-bold text-paper transition hover:bg-ink-soft disabled:opacity-50 sm:min-h-[38px] sm:gap-1.5 sm:px-3.5"
              >
                <Wallet className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{busyAction === 'connect' ? 'Connecting…' : 'Connect'}</span>
              </button>
            ) : (
              <button
                type="button"
                data-testid="header-wallet-button"
                aria-haspopup="menu"
                aria-expanded={walletMenuOpen}
                onClick={() => {
                  setMoreMenuOpen(false);
                  setWalletMenuOpen((v) => !v);
                }}
                className={`inline-flex min-h-[34px] items-center gap-1 border px-2 font-mono text-xs font-bold transition sm:min-h-[38px] sm:gap-1.5 sm:px-3 ${
                  wrongNetwork
                    ? 'border-vermilion-600 bg-vermilion-50 text-vermilion-800'
                    : 'border-rule-strong bg-paper-soft text-ink hover:border-ink'
                }`}
              >
                {wrongNetwork ? (
                  <AlertTriangle className="h-3.5 w-3.5 text-vermilion-600" aria-hidden="true" />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-pine-500" />
                )}
                <span className="sm:hidden">
                  {wrongNetwork ? 'Net' : `${account.slice(0, 4)}…${account.slice(-2)}`}
                </span>
                <span className="hidden sm:inline">
                  {wrongNetwork ? 'Wrong network' : shortenAddress(account)}
                </span>
                <ChevronDown className="hidden h-3.5 w-3.5 text-ink-muted sm:inline" aria-hidden="true" />
              </button>
            )}

            {walletMenuOpen && account && (
              <div
                role="menu"
                aria-label="Wallet details"
                className="absolute right-0 top-full z-50 mt-1.5 w-72 border border-ink bg-paper-bright p-3.5 shadow-xl"
              >
                <div className="flex items-center justify-between gap-2 border-b border-rule pb-2.5">
                  <div className="min-w-0">
                    <div className="font-mono text-xs font-bold text-ink">
                      {shortenAddress(account)}
                    </div>
                    <div className="mt-0.5 font-mono text-xs text-ink-muted">
                      {wrongNetwork
                        ? `Chain #${walletChainId ?? '?'} (switch required)`
                        : getChainLabel(config.chainId)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void handleCopyAddress()}
                      aria-label="Copy wallet address"
                      className="inline-flex h-9 w-9 items-center justify-center border border-rule text-ink-muted transition hover:border-ink hover:text-ink"
                    >
                      {copied ? (
                        <Check className="h-4 w-4 text-pine-700" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </button>
                    {explorerAccountUrl && (
                      <a
                        href={explorerAccountUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="View wallet on Etherscan"
                        className="inline-flex h-9 w-9 items-center justify-center border border-rule text-ink-muted transition hover:border-ink hover:text-ink"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                </div>

                {wrongNetwork && (
                  <button
                    type="button"
                    onClick={() => {
                      setWalletMenuOpen(false);
                      void onSwitchNetwork();
                    }}
                    className="tap-target mt-2.5 inline-flex w-full items-center justify-center gap-2 border border-vermilion-600 bg-vermilion-500 px-3 font-sans text-xs font-bold text-[#FBF8F0] transition hover:bg-vermilion-600"
                  >
                    <AlertTriangle className="h-4 w-4" />
                    <span>Switch to Sepolia</span>
                  </button>
                )}

                <div className="mt-2.5 space-y-1.5 border-b border-rule pb-2.5 font-mono text-xs tabular-nums">
                  <div className="flex items-center justify-between">
                    <span className="text-ink-muted">Sepolia ETH</span>
                    <span className="font-bold text-ink">
                      {formatToken(human(balances?.eth, 18), 4)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-ink-muted">{config.baseSymbol}</span>
                    <span className="font-bold text-ink">
                      {formatToken(human(balances?.base, config.baseDecimals), 3)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-ink-muted">{config.quoteSymbol}</span>
                    <span className="font-bold text-ink">
                      {formatPrice(human(balances?.quote, config.quoteDecimals), 2)}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setWalletMenuOpen(false);
                    onDisconnect();
                  }}
                  className="mt-2.5 inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 border border-rule-strong px-3 font-sans text-xs font-bold text-ink-soft transition hover:border-ink hover:text-ink"
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Disconnect</span>
                </button>
              </div>
            )}
          </div>

          {/* Overflow "⋯" menu */}
          <div ref={moreMenuRef} className="relative">
            <button
              type="button"
              data-testid="header-more-menu"
              aria-label="More options"
              aria-haspopup="menu"
              aria-expanded={moreMenuOpen}
              onClick={() => {
                setWalletMenuOpen(false);
                setMoreMenuOpen((v) => !v);
              }}
              className="inline-flex h-8 w-8 items-center justify-center border border-rule-strong bg-paper-soft text-ink transition hover:border-ink sm:h-[38px] sm:w-[38px]"
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </button>

            {moreMenuOpen && (
              <div
                role="menu"
                aria-label="More navigation links"
                className="absolute right-0 top-full z-50 mt-1.5 w-60 border border-ink bg-paper-bright py-1 shadow-xl"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    onOpenHowItWorks();
                  }}
                  className="flex min-h-[44px] w-full items-center gap-2.5 px-3.5 text-left text-sm font-medium text-ink transition hover:bg-paper-soft"
                >
                  <BookOpen className="h-4 w-4 text-cobalt-700" aria-hidden="true" />
                  <span>How it works</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    onOpenFeModal();
                  }}
                  className="flex min-h-[44px] w-full items-center gap-2.5 px-3.5 text-left text-sm font-medium text-ink transition hover:bg-paper-soft"
                >
                  <Code2 className="h-4 w-4 text-vermilion-600" aria-hidden="true" />
                  <span>Why Fe</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    onOpenContractModal();
                  }}
                  className="flex min-h-[44px] w-full items-center gap-2.5 px-3.5 text-left text-sm font-medium text-ink transition hover:bg-paper-soft"
                >
                  <Globe className="h-4 w-4 text-pine-700" aria-hidden="true" />
                  <span>Contract &amp; network config</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    onOpenSimulationModal();
                  }}
                  className="flex min-h-[44px] w-full items-center gap-2.5 px-3.5 text-left text-sm font-medium text-ink transition hover:bg-paper-soft"
                >
                  <FlaskConical className="h-4 w-4 text-plum-700" aria-hidden="true" />
                  <span>MEV sandwich simulation</span>
                </button>
                <div className="my-1 border-t border-rule" />
                <button
                  type="button"
                  role="menuitem"
                  disabled={refreshing}
                  onClick={() => {
                    setMoreMenuOpen(false);
                    onRefresh();
                  }}
                  className="flex min-h-[44px] w-full items-center gap-2.5 px-3.5 text-left text-sm font-medium text-ink-muted transition hover:bg-paper-soft hover:text-ink disabled:opacity-50"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                  <span>Refresh Sepolia state</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
