import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  ShieldAlert,
  Wallet,
} from 'lucide-react';
import type { ClaimableDto, LocalSecretVaultEntry } from './types';
import { explorerTxUrl } from './onchain/config';
import { useFairBatch } from './onchain/useFairBatch';
import { TopCommandBar, type UiMode } from './components/TopCommandBar';
import { SimpleExperience } from './components/SimpleExperience';
import { ProStatsRow } from './components/ProStatsRow';
import { AccountPanel } from './components/AccountPanel';
import { BatchConsole } from './components/BatchConsole';
import { OrderTicket } from './components/OrderTicket';
import { LiquidityPanel } from './components/LiquidityPanel';
import { PriceChart } from './components/PriceChart';
import { MevComparison } from './components/MevComparison';
import { ClaimsPanel } from './components/ClaimsPanel';
import { ContractConfigModal } from './components/ContractConfigModal';
import { FeArchitectureModal } from './components/FeArchitectureModal';
import { HowItWorksModal } from './components/HowItWorksModal';
import { SandwichSimulationModal } from './components/SandwichSimulationModal';
import { SIMPLE_COPY } from './lib/glossary';

const MODE_STORAGE_KEY = 'fairbatch.uiMode.v1';

function readInitialMode(defaultMode: UiMode): UiMode {
  try {
    if (typeof localStorage === 'undefined') return defaultMode;
    const saved = localStorage.getItem(MODE_STORAGE_KEY);
    if (saved === 'simple' || saved === 'pro') return saved;
  } catch {
    // storage unavailable
  }
  return defaultMode;
}

export const App: React.FC = () => {
  const fb = useFairBatch();
  const [mode, setMode] = useState<UiMode>(() => readInitialMode('simple'));
  const [selectedViewBatchId, setSelectedViewBatchId] = useState<number | 'live'>('live');
  const [isContractModalOpen, setIsContractModalOpen] = useState<boolean>(false);
  const [isFeModalOpen, setIsFeModalOpen] = useState<boolean>(false);
  const [isHowItWorksOpen, setIsHowItWorksOpen] = useState<boolean>(false);
  const [isSimulationModalOpen, setIsSimulationModalOpen] = useState<boolean>(false);

  const handleModeChange = (next: UiMode) => {
    setMode(next);
    try {
      localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      // ignore storage failure
    }
  };

  const snapshot = fb.snapshot;
  const state = snapshot?.state ?? null;

  useEffect(() => {
    if (!snapshot || selectedViewBatchId === 'live') return;
    const exists = snapshot.settledHistory.some(
      (record) => record.batch_id === selectedViewBatchId,
    );
    if (!exists) setSelectedViewBatchId('live');
  }, [snapshot, selectedViewBatchId]);

  const displayedSettlement = useMemo(() => {
    if (!snapshot) return null;
    if (selectedViewBatchId !== 'live') {
      const found = snapshot.settledHistory.find(
        (record) => record.batch_id === selectedViewBatchId,
      );
      if (found) return found;
    }
    return snapshot.activeSettlement;
  }, [snapshot, selectedViewBatchId]);

  const handleSettle = async () => {
    const settlingBatch = snapshot?.state.batch_id ?? null;
    try {
      const result = await fb.settle();
      setSelectedViewBatchId(
        result.batchId >= 0 ? result.batchId : (settlingBatch ?? 'live'),
      );
    } catch {
      // surfaced via notice
    }
  };

  const handleSettleMany = async (items: ClaimableDto[]) => {
    await fb.claimMany(items);
  };

  const handleClaimSingle = async (item: ClaimableDto) => {
    await fb.claim(item);
  };

  const handleReveal = async (secret: LocalSecretVaultEntry) => {
    await fb.revealCommit(secret);
  };

  const notice = fb.notice;
  const txUrl = notice?.hash ? explorerTxUrl(fb.config, notice.hash) : null;

  return (
    <div className="flex min-h-screen flex-col text-ink">
      <TopCommandBar
        mode={mode}
        onModeChange={handleModeChange}
        config={fb.config}
        batch={snapshot?.batch ?? null}
        livePhase={fb.livePhase}
        chainNow={fb.chainNow}
        account={fb.account}
        balances={snapshot?.balances ?? null}
        walletChainId={fb.walletChainId}
        wrongNetwork={fb.wrongNetwork}
        loading={fb.loading}
        refreshing={fb.refreshing}
        busyAction={fb.busyAction}
        onConnect={fb.connect}
        onSwitchNetwork={fb.switchNetwork}
        onDisconnect={fb.disconnect}
        onRefresh={fb.refresh}
        onOpenHowItWorks={() => setIsHowItWorksOpen(true)}
        onOpenFeModal={() => setIsFeModalOpen(true)}
        onOpenContractModal={() => setIsContractModalOpen(true)}
        onOpenSimulationModal={() => setIsSimulationModalOpen(true)}
      />

      <main className="mx-auto w-full max-w-[1560px] flex-1 px-4 py-5 lg:px-8">
        {notice && (
          <div
            role="status"
            className={`mb-4 flex flex-wrap items-center justify-between gap-3 border-l-2 px-3.5 py-2.5 text-sm font-medium ${
              notice.kind === 'error'
                ? 'border-vermilion-500 bg-vermilion-50 text-vermilion-800'
                : notice.kind === 'info'
                  ? 'border-cobalt-500 bg-cobalt-50 text-cobalt-800'
                  : 'border-pine-600 bg-pine-50 text-pine-800'
            }`}
          >
            <div className="flex min-w-0 items-center gap-2">
              {notice.kind === 'error' ? (
                <ShieldAlert className="h-4 w-4 shrink-0 text-vermilion-600" />
              ) : (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-pine-700" />
              )}
              <span className="min-w-0 break-words">{notice.text}</span>
              {txUrl && notice.hash && (
                <a
                  href={txUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 border border-current px-2 py-0.5 font-mono text-xs font-bold opacity-85 transition hover:opacity-100"
                >
                  <span>Tx {notice.hash.slice(0, 8)}…</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            <button
              type="button"
              onClick={fb.clearNotice}
              className="shrink-0 border border-current px-2 py-0.5 font-mono text-xs font-bold opacity-75 transition hover:opacity-100"
            >
              Dismiss
            </button>
          </div>
        )}

        {!snapshot && fb.loading && (
          <section className="ledger-panel flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
            <RefreshCw className="h-6 w-6 animate-spin text-cobalt-600" />
            <h2 className="font-display text-xl font-bold text-ink">
              Loading Ethereum Sepolia state
            </h2>
            <p className="max-w-md text-sm leading-relaxed text-ink-muted">
              Reading the current round, pool reserves, and recent orders from Ethereum Sepolia.
            </p>
          </section>
        )}

        {!snapshot && !fb.loading && (
          <section className="border border-vermilion-500/40 bg-vermilion-50 p-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-vermilion-600" />
              <div className="min-w-0">
                <h2 className="font-display text-xl font-bold text-ink">
                  {fb.configured
                    ? 'Unable to reach Ethereum Sepolia right now'
                    : 'No FairBatch contract configured'}
                </h2>
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-muted">
                  {fb.error ??
                    'Configure a deployed FairBatch address and JSON-RPC endpoint to begin.'}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={fb.refresh}
                    disabled={fb.refreshing}
                    className="tap-target inline-flex items-center gap-1.5 border border-vermilion-600 bg-paper-bright px-4 font-sans text-sm font-bold text-vermilion-800 transition hover:bg-vermilion-100 disabled:opacity-40"
                  >
                    <RefreshCw className={`h-4 w-4 ${fb.refreshing ? 'animate-spin' : ''}`} />
                    <span>Retry</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsContractModalOpen(true)}
                    className="tap-target inline-flex items-center gap-1.5 border border-ink bg-ink px-4 font-sans text-sm font-bold text-paper transition hover:bg-ink-soft"
                  >
                    <Wallet className="h-4 w-4" />
                    <span>Contract &amp; network config</span>
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {snapshot && state && displayedSettlement && mode === 'simple' && (
          <SimpleExperience
            controller={fb}
            onOpenHowItWorks={() => setIsHowItWorksOpen(true)}
          />
        )}

        {snapshot && state && displayedSettlement && mode === 'pro' && (
          <>
            <ProStatsRow
              config={fb.config}
              state={state}
              batch={snapshot.batch}
              livePhase={fb.livePhase}
              account={fb.account}
              walletChainId={fb.walletChainId}
              wrongNetwork={fb.wrongNetwork}
              loading={fb.loading}
            />

            <div className="grid items-start gap-5 lg:grid-cols-12">
              <div className="min-w-0 space-y-4 lg:col-span-4">
                <AccountPanel
                  config={fb.config}
                  account={fb.account}
                  walletChainId={fb.walletChainId}
                  wrongNetwork={fb.wrongNetwork}
                  balances={snapshot.balances}
                  allowances={snapshot.allowances}
                  faucet={snapshot.faucet}
                  busyAction={fb.busyAction}
                  faucetEnabled={fb.config.tokenFaucetEnabled}
                  onConnect={fb.connect}
                  onDisconnect={fb.disconnect}
                  onClaimFaucet={async () => {
                    await fb.claimFaucet();
                  }}
                  onApprove={async (token) => {
                    await fb.approve(token);
                  }}
                />

                <OrderTicket
                  state={{ ...state, phase: fb.livePhase }}
                  config={fb.config}
                  account={fb.account}
                  localSecrets={fb.secretVault}
                  busyAction={fb.busyAction}
                  minBondWei={snapshot.minBondWei}
                  onConnect={fb.connect}
                  onSubmitDirect={async (params) => {
                    await fb.submitDirect(params);
                  }}
                  onSettleAndSubmitDirect={async (params) => {
                    await fb.settleAndSubmitDirect(params);
                  }}
                  onSealCommit={async (params) => {
                    await fb.sealCommit(params);
                  }}
                  onRevealCommit={handleReveal}
                  onSignIntent={fb.signIntent}
                  onSubmitIntent={async (artifact) => {
                    await fb.submitIntent(artifact);
                  }}
                />
              </div>

              <div className="min-w-0 space-y-5 lg:col-span-8">
                <BatchConsole
                  batch={snapshot.batch}
                  phase={fb.livePhase}
                  chainNow={fb.chainNow}
                  orderCount={state.orders.length}
                  account={fb.account}
                  commitments={snapshot.allCommitments}
                  busyAction={fb.busyAction}
                  refreshing={fb.refreshing}
                  onSettle={async () => {
                    await handleSettle();
                  }}
                  onSlash={async (batchId, commitId) => {
                    await fb.slash(batchId, commitId);
                  }}
                  onRefresh={fb.refresh}
                />

                <PriceChart
                  settlement={displayedSettlement}
                  isLivePreview={selectedViewBatchId === 'live'}
                  baseSymbol={fb.config.baseSymbol}
                  quoteSymbol={fb.config.quoteSymbol}
                />

                <MevComparison
                  settlement={displayedSettlement}
                  settledHistory={snapshot.settledHistory}
                  selectedViewBatchId={selectedViewBatchId}
                  activeBatchId={state.batch_id}
                  baseSymbol={fb.config.baseSymbol}
                  quoteSymbol={fb.config.quoteSymbol}
                  onSelectViewBatch={setSelectedViewBatchId}
                  onOpenSimulationModal={() => setIsSimulationModalOpen(true)}
                />
              </div>
            </div>

            <div className="mt-5 grid items-start gap-5 lg:grid-cols-12">
              <div className="min-w-0 lg:col-span-5">
                <LiquidityPanel
                  config={fb.config}
                  reserves={snapshot.reserves}
                  balances={snapshot.balances}
                  lpLock={snapshot.lpLock}
                  account={fb.account}
                  busyAction={fb.busyAction}
                  onAddLiquidity={async (amountBase, amountQuote, lockDurationSecs, minShares) => {
                    await fb.addLiquidity(amountBase, amountQuote, lockDurationSecs, minShares);
                  }}
                  onRemoveLiquidity={async (shares, minBase, minQuote) => {
                    await fb.removeLiquidity(shares, minBase, minQuote);
                  }}
                />
              </div>

              <div className="min-w-0 lg:col-span-7">
                <ClaimsPanel
                  claimable={snapshot.claimable}
                  config={fb.config}
                  account={fb.account}
                  busyAction={fb.busyAction}
                  onClaimSingle={handleClaimSingle}
                  onClaimMany={handleSettleMany}
                  onConnect={fb.connect}
                />
              </div>
            </div>
          </>
        )}
      </main>

      <footer className="mt-10 border-t border-ink bg-paper-deep">
        <div className="mx-auto flex max-w-[1560px] flex-col items-center justify-between gap-2 px-4 py-4 text-center font-mono text-xs text-ink-muted xl:flex-row xl:text-left lg:px-8">
          <span className="font-bold text-ink-soft">
            FairBatch Exchange · One price, every order
          </span>
          <span>{SIMPLE_COPY.footerVerified}</span>
          <span>
            {snapshot
              ? `Sepolia · ${fb.config.fairBatch.slice(0, 6)}…${fb.config.fairBatch.slice(-4)}`
              : 'Ethereum Sepolia'}
          </span>
        </div>
      </footer>

      <HowItWorksModal
        isOpen={isHowItWorksOpen}
        onClose={() => setIsHowItWorksOpen(false)}
      />

      <ContractConfigModal
        isOpen={isContractModalOpen}
        config={fb.config}
        account={fb.account}
        walletChainId={fb.walletChainId}
        wrongNetwork={fb.wrongNetwork}
        busyAction={fb.busyAction}
        onClose={() => setIsContractModalOpen(false)}
        onConnect={fb.connect}
        onDisconnect={fb.disconnect}
      />

      <FeArchitectureModal
        isOpen={isFeModalOpen}
        onClose={() => setIsFeModalOpen(false)}
      />

      <SandwichSimulationModal
        isOpen={isSimulationModalOpen}
        rx={state?.reserves.rx ?? 100}
        ry={state?.reserves.ry ?? 300_000}
        baseSymbol={fb.config.baseSymbol}
        quoteSymbol={fb.config.quoteSymbol}
        onClose={() => setIsSimulationModalOpen(false)}
      />
    </div>
  );
};

export default App;
