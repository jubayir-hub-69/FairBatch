import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Clock,
  Droplets,
  ExternalLink,
  Loader2,
  Wallet,
  X,
} from 'lucide-react';
import { formatUnits } from 'viem';
import type { ClaimableDto, LocalSecretVaultEntry, OrderSide } from '../types';
import type { FairBatchController } from '../onchain/useFairBatch';
import { detectSimpleStep } from '../onchain/useFairBatch';
import { formatDuration, formatPrice, formatToken } from '../lib/format';
import { FIRST_VISIT_INTRO, SIMPLE_COPY } from '../lib/glossary';
import { ProgressStrip } from './simple/ProgressStrip';
import { SimpleSwapCard } from './simple/SimpleSwapCard';
import { SimpleWaitingCard } from './simple/SimpleWaitingCard';
import {
  SimpleCollectCard,
  type CollectedReceiptSummary,
} from './simple/SimpleCollectCard';
import { SimpleEarn } from './simple/SimpleEarn';

const INTRO_DISMISSED_KEY = 'fairbatch.introDismissed.v1';

type SimpleTab = 'swap' | 'earn';

interface SimpleExperienceProps {
  controller: FairBatchController;
  onOpenHowItWorks: () => void;
}

function readIntroDismissed(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(INTRO_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function human(raw: bigint | undefined, decimals: number): number {
  if (raw === undefined) return 0;
  return Number(formatUnits(raw, decimals));
}

export const SimpleExperience: React.FC<SimpleExperienceProps> = ({
  controller: fb,
  onOpenHowItWorks,
}) => {
  const [activeTab, setActiveTab] = useState<SimpleTab>('swap');
  const [introDismissed, setIntroDismissed] = useState<boolean>(() => readIntroDismissed());
  const [forceShowSwapForm, setForceShowSwapForm] = useState<boolean>(false);
  const [lastCollected, setLastCollected] = useState<CollectedReceiptSummary | null>(null);

  const snapshot = fb.snapshot;
  const state = snapshot?.state ?? null;
  const account = fb.account;

  const myUnclaimed = useMemo(() => {
    if (!snapshot || !account) return [];
    const addr = account.toLowerCase();
    return snapshot.claimable.filter(
      (c) => !c.claimed && c.trader.toLowerCase() === addr,
    );
  }, [snapshot, account]);

  const myActiveOrders = useMemo(() => {
    if (!snapshot || !account) return [];
    const addr = account.toLowerCase();
    return snapshot.orders.filter((o) => o.trader.toLowerCase() === addr);
  }, [snapshot, account]);

  const myActiveCommits = useMemo(() => {
    if (!snapshot || !account) return [];
    const addr = account.toLowerCase();
    return snapshot.commitments.filter(
      (c) => c.trader.toLowerCase() === addr && !c.revealed && !c.slashed,
    );
  }, [snapshot, account]);

  const currentStep = useMemo(
    () =>
      detectSimpleStep({
        account,
        wrongNetwork: fb.wrongNetwork,
        balances: snapshot?.balances ?? null,
        claimable: snapshot?.claimable ?? [],
      }),
    [account, fb.wrongNetwork, snapshot?.balances, snapshot?.claimable],
  );

  const hasTokens = Boolean(
    snapshot && (snapshot.balances.base > 0n || snapshot.balances.quote > 0n),
  );
  const hasActiveOrder = myActiveOrders.length > 0 || myActiveCommits.length > 0;
  const busy = fb.busyAction !== null;

  const handleDismissIntro = () => {
    setIntroDismissed(true);
    try {
      localStorage.setItem(INTRO_DISMISSED_KEY, '1');
    } catch {
      // ignore storage errors
    }
  };

  const handleCollectOne = async (item: ClaimableDto) => {
    const res = await fb.claim(item);
    setLastCollected({ hash: res.hash, items: [item] });
  };

  const handleCollectAll = async (items: ClaimableDto[]) => {
    const res = await fb.claimMany(items);
    setLastCollected({ hash: res.hash, items });
  };

  const handleSubmitDirect = async (params: {
    side: OrderSide;
    amountIn: string;
    limitPrice: string;
  }) => {
    setLastCollected(null);
    await fb.submitDirect(params);
    setForceShowSwapForm(false);
  };

  const handleSettleAndSubmitDirect = async (params: {
    side: OrderSide;
    amountIn: string;
    limitPrice: string;
  }) => {
    setLastCollected(null);
    await fb.settleAndSubmitDirect(params);
    setForceShowSwapForm(false);
  };

  const handleSignAndSubmitIntent = async (params: {
    side: OrderSide;
    amountIn: string;
    limitPrice: string;
  }) => {
    setLastCollected(null);
    await fb.signAndSubmitIntent(params);
    setForceShowSwapForm(false);
  };

  const handleSealCommit = async (params: {
    side: OrderSide;
    amountIn: string;
    limitPrice: string;
    salt: string;
    bondEth: string;
  }) => {
    setLastCollected(null);
    await fb.sealCommit(params);
    setForceShowSwapForm(false);
  };

  const handleRevealCommit = async (secret: LocalSecretVaultEntry) => {
    await fb.revealCommit(secret);
  };

  const handleStartNextRound = async () => {
    await fb.settle();
  };

  const faucet = snapshot?.faucet ?? null;
  const claimBaseHuman = human(
    faucet?.claimBaseAmount ?? fb.config.faucetClaimBase,
    fb.config.baseDecimals,
  );
  const claimQuoteHuman = human(
    faucet?.claimQuoteAmount ?? fb.config.faucetClaimQuote,
    fb.config.quoteDecimals,
  );
  const nextClaimSecs = Number(faucet?.nextClaimAt ?? 0n);
  const cooldownRemaining = nextClaimSecs > fb.chainNow ? nextClaimSecs - fb.chainNow : 0;
  const faucetReady =
    fb.config.tokenFaucetEnabled &&
    cooldownRemaining === 0 &&
    (faucet ? faucet.canClaim || nextClaimSecs <= fb.chainNow : true);

  return (
    <div className="mx-auto w-full max-w-xl space-y-4">
      {/* Dismissible first-visit intro (max 3 lines) */}
      {!introDismissed && (
        <section
          aria-label="Welcome to FairBatch"
          data-testid="simple-intro-banner"
          className="relative border border-ink bg-paper-bright px-4 py-3.5 pr-12 shadow-slip"
        >
          <button
            type="button"
            onClick={handleDismissIntro}
            aria-label="Dismiss welcome message"
            className="absolute right-2 top-2 inline-flex h-9 w-9 items-center justify-center text-ink-muted transition hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
          <h1 className="font-display text-base font-bold text-ink">
            {FIRST_VISIT_INTRO.title}
          </h1>
          <div className="mt-1 space-y-1 text-sm leading-snug text-ink-soft">
            {FIRST_VISIT_INTRO.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </section>
      )}

      {/* Sub-tabs (Swap | Earn) + persistent "How it works" link */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="tablist"
          aria-label="Simple mode sections"
          className="inline-flex border border-ink bg-paper-bright p-0.5"
        >
          <button
            type="button"
            role="tab"
            data-testid="simple-tab-swap"
            aria-selected={activeTab === 'swap'}
            onClick={() => setActiveTab('swap')}
            className={`tap-target px-5 font-display text-sm font-bold transition ${
              activeTab === 'swap'
                ? 'bg-ink text-paper'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            Swap
          </button>
          <button
            type="button"
            role="tab"
            data-testid="simple-tab-earn"
            aria-selected={activeTab === 'earn'}
            onClick={() => setActiveTab('earn')}
            className={`tap-target px-5 font-display text-sm font-bold transition ${
              activeTab === 'earn'
                ? 'bg-ink text-paper'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            Earn
          </button>
        </div>

        <button
          type="button"
          data-testid="simple-how-it-works-link"
          onClick={onOpenHowItWorks}
          className="tap-target inline-flex items-center gap-1.5 px-2 text-sm font-bold text-cobalt-700 underline decoration-dotted underline-offset-4 transition hover:text-ink"
        >
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          <span>How it works</span>
        </button>
      </div>

      {activeTab === 'earn' && snapshot ? (
        <SimpleEarn
          config={fb.config}
          reserves={snapshot.reserves}
          balances={snapshot.balances}
          lpLock={snapshot.lpLock}
          chainNow={fb.chainNow}
          account={account}
          wrongNetwork={fb.wrongNetwork}
          busyAction={fb.busyAction}
          txStatus={fb.txStatus}
          onConnect={fb.connect}
          onSwitchNetwork={fb.switchNetwork}
          onAddLiquidity={async (base, quote, lockSecs, minShares) => {
            await fb.addLiquidity(base, quote, lockSecs, minShares);
          }}
          onRemoveLiquidity={async (shares, minBase, minQuote) => {
            await fb.removeLiquidity(shares, minBase, minQuote);
          }}
        />
      ) : (
        <div className="space-y-4">
          {/* 4-step progress strip derived from on-chain state */}
          <ProgressStrip
            currentStep={currentStep}
            hasTokens={hasTokens}
            hasActiveOrder={hasActiveOrder}
            hasUnclaimed={myUnclaimed.length > 0}
          />

          {/* STEP 1: Connect wallet / Switch to Sepolia / No wallet install */}
          {currentStep === 1 && (
            <section
              aria-label="Connect wallet"
              data-testid="simple-step-connect"
              className="ledger-panel p-5"
            >
              {!fb.hasWallet && !account ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-vermilion-600" />
                    <div>
                      <h2 className="font-display text-xl font-bold text-ink">
                        {SIMPLE_COPY.noWalletTitle}
                      </h2>
                      <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                        {SIMPLE_COPY.noWalletBody}
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <a
                      href="https://metamask.io/download/"
                      target="_blank"
                      rel="noreferrer"
                      className="tap-target inline-flex items-center justify-center gap-2 bg-vermilion-500 px-4 font-display text-sm font-bold text-[#FBF8F0] transition hover:bg-vermilion-600"
                    >
                      <span>Install MetaMask</span>
                      <ExternalLink className="h-4 w-4" />
                    </a>
                    <a
                      href="https://rabby.io/"
                      target="_blank"
                      rel="noreferrer"
                      className="tap-target inline-flex items-center justify-center gap-2 border border-ink bg-paper-bright px-4 font-display text-sm font-bold text-ink transition hover:bg-paper-soft"
                    >
                      <span>Install Rabby</span>
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>
                </div>
              ) : fb.wrongNetwork ? (
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-vermilion-600" />
                    <div>
                      <h2 className="font-display text-xl font-bold text-ink">
                        Switch to Ethereum Sepolia
                      </h2>
                      <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                        Your wallet is connected to a different network. Switch to Ethereum
                        Sepolia (free testnet) to swap and collect tokens.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    data-testid="simple-switch-network-button"
                    disabled={busy}
                    onClick={() => void fb.switchNetwork()}
                    className="tap-target inline-flex w-full items-center justify-center gap-2 bg-vermilion-500 px-5 py-3.5 font-display text-base font-bold text-[#FBF8F0] transition hover:bg-vermilion-600 disabled:opacity-50"
                  >
                    {busy ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        <span>{fb.txStatus ?? 'Switching network…'}</span>
                      </>
                    ) : (
                      <span>Switch to Sepolia</span>
                    )}
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <h2 className="font-display text-xl font-bold text-ink">
                      Step 1: Connect your wallet
                    </h2>
                    <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                      Connect your Ethereum wallet on Sepolia to claim free test tokens and run a
                      protected swap.
                    </p>
                  </div>
                  <button
                    type="button"
                    data-testid="simple-connect-button"
                    disabled={busy}
                    onClick={() => void fb.connect()}
                    className="tap-target inline-flex w-full items-center justify-center gap-2 bg-vermilion-500 px-5 py-3.5 font-display text-base font-bold text-[#FBF8F0] transition hover:bg-vermilion-600 disabled:opacity-50"
                  >
                    {busy ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        <span>Connecting…</span>
                      </>
                    ) : (
                      <>
                        <Wallet className="h-5 w-5" aria-hidden="true" />
                        <span>Connect wallet</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </section>
          )}

          {/* STEP 2: Get free test tokens (auto-skipped if user already holds tokens) */}
          {currentStep === 2 && (
            <section
              aria-label="Get free test tokens"
              data-testid="simple-step-faucet"
              className="ledger-panel p-5"
            >
              <div className="space-y-4">
                <div>
                  <span className="eyebrow">Step 2 · Free testnet faucet</span>
                  <h2 className="mt-1 font-display text-xl font-bold text-ink">
                    Get free test tokens
                  </h2>
                  <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                    Claim{' '}
                    <strong className="text-ink">
                      {formatToken(claimBaseHuman, 2, 0)} {fb.config.baseSymbol} +{' '}
                      {formatPrice(claimQuoteHuman, 0)} {fb.config.quoteSymbol}
                    </strong>{' '}
                    at no cost (just Sepolia gas) so you can try your first swap.
                  </p>
                </div>

                {cooldownRemaining > 0 && (
                  <div className="flex items-start gap-2.5 border-l-2 border-brass-600 bg-brass-50 px-3.5 py-3 text-sm text-brass-900">
                    <Clock className="mt-0.5 h-4 w-4 shrink-0 text-brass-700" />
                    <span>
                      Faucet cooldown active — you already claimed test tokens recently. Your next
                      claim opens in <strong>{formatDuration(cooldownRemaining)}</strong>.
                    </span>
                  </div>
                )}

                <button
                  type="button"
                  data-testid="simple-faucet-button"
                  disabled={busy || !faucetReady}
                  onClick={() => void fb.claimFaucet()}
                  className="tap-target inline-flex w-full items-center justify-center gap-2 bg-vermilion-500 px-5 py-3.5 font-display text-base font-bold text-[#FBF8F0] transition hover:bg-vermilion-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {fb.busyAction === 'faucet' ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span>{fb.txStatus ?? 'Claiming test tokens…'}</span>
                    </>
                  ) : cooldownRemaining > 0 ? (
                    <>
                      <Clock className="h-5 w-5" />
                      <span>Next claim in {formatDuration(cooldownRemaining)}</span>
                    </>
                  ) : (
                    <>
                      <Droplets className="h-5 w-5" aria-hidden="true" />
                      <span>Get free test tokens</span>
                    </>
                  )}
                </button>
              </div>
            </section>
          )}

          {/* STEP 4: Result + Collect (or post-collect success screen) */}
          {snapshot && (myUnclaimed.length > 0 || lastCollected) && (
            <SimpleCollectCard
              config={fb.config}
              unclaimed={myUnclaimed}
              settledHistory={snapshot.settledHistory}
              lastCollected={lastCollected}
              busyAction={fb.busyAction}
              txStatus={fb.txStatus}
              onCollectOne={handleCollectOne}
              onCollectAll={handleCollectAll}
              onSwapAgain={() => {
                setLastCollected(null);
                setForceShowSwapForm(true);
              }}
            />
          )}

          {/* STEP 3B: Waiting / Status Card when user has an active order in the current round */}
          {snapshot &&
            hasActiveOrder &&
            !forceShowSwapForm &&
            myUnclaimed.length === 0 &&
            !lastCollected && (
              <SimpleWaitingCard
                config={fb.config}
                batch={snapshot.batch}
                livePhase={fb.livePhase}
                chainNow={fb.chainNow}
                userOrders={myActiveOrders}
                userPendingCommits={myActiveCommits}
                localSecrets={fb.secretVault}
                busyAction={fb.busyAction}
                txStatus={fb.txStatus}
                onRevealCommit={handleRevealCommit}
                onSettleRound={handleStartNextRound}
                onPlaceAnother={() => setForceShowSwapForm(true)}
              />
            )}

          {/* STEP 3A: Swap Card (shown when on Step 3, or previewed below Step 1/2 if user wants to see rates) */}
          {snapshot &&
            state &&
            myUnclaimed.length === 0 &&
            !lastCollected &&
            (!hasActiveOrder || forceShowSwapForm) && (
              <SimpleSwapCard
                config={fb.config}
                state={state}
                batch={snapshot.batch}
                livePhase={fb.livePhase}
                chainNow={fb.chainNow}
                account={account}
                wrongNetwork={fb.wrongNetwork}
                balances={snapshot.balances}
                faucet={snapshot.faucet}
                minBondWei={snapshot.minBondWei}
                userPendingCommits={myActiveCommits}
                localSecrets={fb.secretVault}
                busyAction={fb.busyAction}
                txStatus={fb.txStatus}
                onConnect={fb.connect}
                onSwitchNetwork={fb.switchNetwork}
                onClaimFaucet={async () => {
                  await fb.claimFaucet();
                }}
                onSubmitDirect={handleSubmitDirect}
                onSettleAndSubmitDirect={handleSettleAndSubmitDirect}
                onSignAndSubmitIntent={handleSignAndSubmitIntent}
                onSealCommit={handleSealCommit}
                onRevealCommit={handleRevealCommit}
                onStartNextRound={handleStartNextRound}
              />
            )}
        </div>
      )}
    </div>
  );
};
