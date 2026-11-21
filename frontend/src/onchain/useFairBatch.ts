import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatUnits, type Address, type Hash } from 'viem';
import type {
  BatchPhase,
  ClaimableDto,
  LocalSecretVaultEntry,
  OrderSide,
  SignedIntentArtifact,
} from '../types';
import { formatDuration } from '../lib/format';
import { useNow } from '../lib/useNow';
import {
  addLiquidity as addLiquidityAction,
  approveFairBatch,
  claimFaucet as claimFaucetAction,
  claimMany as claimManyAction,
  claimOrder,
  commitOrder,
  describeTxError,
  removeLiquidity as removeLiquidityAction,
  revealOrder,
  settleAndSubmitDirect as settleAndSubmitDirectAction,
  settleBatch as settleBatchAction,
  signAndSubmitIntent as signAndSubmitIntentAction,
  signIntent as signIntentAction,
  slashUnrevealed,
  submitDirectOrder,
  submitSignedIntent,
  type CommitResult,
  type DirectOrderResult,
  type FaucetClaimResult,
  type IntentResult,
  type LiquidityResult,
  type RevealResult,
} from './actions';
import {
  connectInjectedWallet,
  getWalletChainId,
  hasInjectedWallet,
  restoreInjectedAccount,
  switchWalletToSepolia,
  watchInjectedWallet,
} from './client';
import {
  DEFAULT_RUNTIME_CONFIG,
  isContractConfigured,
  loadRuntimeConfig,
  type RuntimeConfig,
} from './config';
import {
  deriveLivePhase,
  loadOnchainSnapshot,
  type OnchainSnapshot,
  type WalletBalances,
} from './state';
import {
  loadSecretVault,
  markSecretRevealed,
  upsertSecret,
} from './secretVault';

const AUTOCONNECT_KEY = 'fairbatch.autoconnect.v1';

export type SimpleStep = 1 | 2 | 3 | 4;

/**
 * Pure step detector for Simple mode's 4-step progress bar:
 *   1 Connect -> 2 Get test tokens -> 3 Swap -> 4 Collect
 * Derived strictly from wallet + on-chain state so a page refresh restores the exact step.
 */
export function detectSimpleStep(params: {
  account: string | null;
  wrongNetwork: boolean;
  balances: WalletBalances | null;
  claimable: ClaimableDto[];
}): SimpleStep {
  if (!params.account || params.wrongNetwork) return 1;
  const normalized = params.account.toLowerCase();
  const hasUnclaimed = params.claimable.some(
    (c) => !c.claimed && c.trader.toLowerCase() === normalized,
  );
  if (hasUnclaimed) return 4;

  const hasTokens =
    (params.balances?.base ?? 0n) > 0n || (params.balances?.quote ?? 0n) > 0n;
  if (!hasTokens) return 2;
  return 3;
}

export interface Notice {
  kind: 'success' | 'error' | 'info';
  text: string;
  hash?: Hash;
}

export interface FairBatchController {
  config: RuntimeConfig;
  hasWallet: boolean;
  account: Address | null;
  walletChainId: number | null;
  snapshot: OnchainSnapshot | null;
  livePhase: BatchPhase;
  chainNow: number;
  loading: boolean;
  refreshing: boolean;
  busyAction: string | null;
  txStatus: string | null;
  error: string | null;
  notice: Notice | null;
  secretVault: LocalSecretVaultEntry[];
  configured: boolean;
  wrongNetwork: boolean;
  connect: () => Promise<void>;
  switchNetwork: () => Promise<void>;
  disconnect: () => void;
  refresh: () => void;
  clearNotice: () => void;
  submitDirect: (params: {
    side: OrderSide;
    amountIn: string;
    limitPrice: string;
  }) => Promise<DirectOrderResult>;
  settleAndSubmitDirect: (params: {
    side: OrderSide;
    amountIn: string;
    limitPrice: string;
  }) => Promise<DirectOrderResult>;
  signAndSubmitIntent: (params: {
    side: OrderSide;
    amountIn: string;
    limitPrice: string;
  }) => Promise<DirectOrderResult>;
  sealCommit: (params: {
    side: OrderSide;
    amountIn: string;
    limitPrice: string;
    salt: string;
    bondEth: string;
  }) => Promise<CommitResult>;
  revealCommit: (secret: LocalSecretVaultEntry) => Promise<RevealResult>;
  signIntent: (params: {
    side: OrderSide;
    amountIn: string;
    limitPrice: string;
  }) => Promise<IntentResult>;
  submitIntent: (artifact: SignedIntentArtifact) => Promise<DirectOrderResult>;
  settle: () => Promise<{ hash: Hash; batchId: number }>;
  slash: (batchId: number, commitId: number) => Promise<{ hash: Hash; forfeitedBond: bigint }>;
  claim: (item: ClaimableDto) => Promise<{ hash: Hash; payoutBase: bigint; payoutQuote: bigint }>;
  claimMany: (items: ClaimableDto[]) => Promise<{ hash: Hash; claimed: number }>;
  addLiquidity: (
    amountBase: string,
    amountQuote: string,
    lockDurationSecs?: number,
    minShares?: bigint,
  ) => Promise<LiquidityResult>;
  removeLiquidity: (
    shares: string,
    minBase?: bigint,
    minQuote?: bigint,
  ) => Promise<LiquidityResult>;
  claimFaucet: () => Promise<FaucetClaimResult>;
  approve: (token: 'base' | 'quote') => Promise<Hash | null>;
}

function toMessage(hash: Hash, text: string): Notice {
  return { kind: 'success', text, hash };
}

export function useFairBatch(): FairBatchController {
  const config = useMemo<RuntimeConfig>(() => loadRuntimeConfig(), []);
  const wallNow = useNow(1_000);
  const [account, setAccount] = useState<Address | null>(null);
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<OnchainSnapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [secretVault, setSecretVault] = useState<LocalSecretVaultEntry[]>(() =>
    loadSecretVault(),
  );
  const [refreshNonce, setRefreshNonce] = useState<number>(0);

  const busyRef = useRef<string | null>(null);
  busyRef.current = busyAction;
  const requestIdRef = useRef<number>(0);
  const accountRef = useRef<Address | null>(null);
  accountRef.current = account;
  const snapshotRef = useRef<OnchainSnapshot | null>(null);
  snapshotRef.current = snapshot;

  const hasWallet = useMemo(() => hasInjectedWallet(), []);

  const refresh = useCallback(() => {
    setRefreshNonce((value) => value + 1);
  }, []);

  // Derive live chain timestamp & auto-advancing phase so countdowns never stall at 00:00.
  const chainNow = useMemo(() => {
    if (!snapshot) return wallNow;
    return wallNow + snapshot.chainTimeOffsetSecs;
  }, [snapshot, wallNow]);

  const livePhase: BatchPhase = useMemo(() => {
    if (!snapshot) return 'Open';
    return deriveLivePhase(snapshot.batch, chainNow);
  }, [snapshot, chainNow]);

  // Restore an already-authorised injected wallet on first load.
  useEffect(() => {
    let cancelled = false;
    let auto = '1';
    try {
      auto = localStorage.getItem(AUTOCONNECT_KEY) ?? '1';
    } catch {
      auto = '1';
    }
    if (auto === '0') return () => { cancelled = true; };
    void (async () => {
      const restored = await restoreInjectedAccount(config);
      if (cancelled || !restored) return;
      setAccount(restored);
      setWalletChainId(await getWalletChainId(config));
    })();
    return () => {
      cancelled = true;
    };
  }, [config]);

  // Wallet events.
  useEffect(() => {
    return watchInjectedWallet({
      onAccountsChanged: (accounts) => {
        setAccount(accounts[0] ?? null);
        if (accounts.length === 0) {
          setWalletChainId(null);
        } else {
          void getWalletChainId(config).then((cid) => setWalletChainId(cid));
        }
        refresh();
      },
      onChainChanged: (chainId) => {
        setWalletChainId(chainId);
        refresh();
      },
      onDisconnect: () => {
        setAccount(null);
        setWalletChainId(null);
      },
    });
  }, [config, refresh]);

  // Snapshot fetch.
  useEffect(() => {
    let cancelled = false;
    if (!isContractConfigured(config)) {
      setError('No FairBatch contract address is configured in config/deployment.json.');
      setLoading(false);
      setSnapshot(null);
      return () => { cancelled = true; };
    }
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (!snapshotRef.current) setLoading(true);
    else setRefreshing(true);

    void (async () => {
      try {
        const next = await loadOnchainSnapshot(config, account);
        if (cancelled || requestId !== requestIdRef.current) return;
        setSnapshot(next);
        setError(null);
      } catch (err) {
        if (cancelled || requestId !== requestIdRef.current) return;
        setError(describeTxError(err));
      } finally {
        if (!cancelled && requestId === requestIdRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [config, account, refreshNonce]);

  // Regular background polling (10s).
  useEffect(() => {
    const id = window.setInterval(() => {
      if (busyRef.current === null) refresh();
    }, 10_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  // Re-read chain state whenever the user returns to this tab or focuses the window.
  useEffect(() => {
    const handleResume = () => {
      if (document.visibilityState === 'visible' && busyRef.current === null) {
        refresh();
      }
    };
    const handleFocus = () => {
      if (busyRef.current === null) refresh();
    };
    document.addEventListener('visibilitychange', handleResume);
    window.addEventListener('focus', handleFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleResume);
      window.removeEventListener('focus', handleFocus);
    };
  }, [refresh]);

  // Fast confirmation poll when crossing commitDeadline or revealDeadline so
  // on-chain `currentBatch()` catches up within a few seconds of a deadline passing.
  const onChainPhaseMatchesLive =
    snapshot === null || snapshot.state.phase === livePhase;
  useEffect(() => {
    if (onChainPhaseMatchesLive || busyRef.current !== null) return;
    const id = window.setInterval(() => {
      if (busyRef.current === null) refresh();
    }, 3_000);
    return () => window.clearInterval(id);
  }, [onChainPhaseMatchesLive, refresh]);

  const requireAccount = useCallback((): Address => {
    const active = accountRef.current;
    if (!active) {
      throw new Error('Connect your wallet to continue.');
    }
    return active;
  }, []);

  const runAction = useCallback(
    async <T,>(
      name: string,
      fn: (active: Address, report: (msg: string) => void) => Promise<T>,
      successText: (result: T) => Notice,
    ): Promise<T> => {
      const active = requireAccount();
      setBusyAction(name);
      setTxStatus(null);
      setError(null);
      setNotice(null);
      const report = (msg: string) => setTxStatus(msg);
      try {
        const result = await fn(active, report);
        setNotice(successText(result));
        refresh();
        return result;
      } catch (err) {
        const unlockTimeSecs = Number(snapshotRef.current?.lpLock?.unlockTime ?? 0n);
        const message = describeTxError(err, { lockUnlockTimeSecs: unlockTimeSecs });
        setError(message);
        setNotice({ kind: 'error', text: message });
        throw new Error(message);
      } finally {
        setBusyAction(null);
        setTxStatus(null);
      }
    },
    [refresh, requireAccount],
  );

  const connect = useCallback(async () => {
    setBusyAction('connect');
    setTxStatus('Connecting your wallet…');
    setError(null);
    try {
      const connected = await connectInjectedWallet(config);
      setAccount(connected);
      setWalletChainId(await getWalletChainId(config));
      try {
        localStorage.setItem(AUTOCONNECT_KEY, '1');
      } catch {
        // ignore storage errors
      }
      setNotice({ kind: 'success', text: 'Wallet connected on Ethereum Sepolia.' });
      refresh();
    } catch (err) {
      const message = describeTxError(err);
      setError(message);
      setNotice({ kind: 'error', text: message });
      throw new Error(message);
    } finally {
      setBusyAction(null);
      setTxStatus(null);
    }
  }, [config, refresh]);

  const switchNetwork = useCallback(async () => {
    setBusyAction('switch-network');
    setTxStatus('Switching wallet to Ethereum Sepolia…');
    setError(null);
    try {
      const nextChainId = await switchWalletToSepolia(config);
      setWalletChainId(nextChainId);
      setNotice({ kind: 'success', text: 'Switched to Ethereum Sepolia.' });
      refresh();
    } catch (err) {
      const message = describeTxError(err);
      setError(message);
      setNotice({ kind: 'error', text: message });
      throw new Error(message);
    } finally {
      setBusyAction(null);
      setTxStatus(null);
    }
  }, [config, refresh]);

  const disconnect = useCallback(() => {
    setAccount(null);
    setWalletChainId(null);
    try {
      localStorage.setItem(AUTOCONNECT_KEY, '0');
    } catch {
      // ignore storage errors
    }
    setNotice({ kind: 'info', text: 'Wallet disconnected.' });
  }, []);

  const submitDirect = useCallback(
    (params: { side: OrderSide; amountIn: string; limitPrice: string }) =>
      runAction(
        'direct',
        (active, report) => submitDirectOrder(config, active, params, report),
        (result) =>
          toMessage(
            result.hash,
            `Order ${result.orderId >= 0 ? `#${result.orderId} ` : ''}placed in the current round.`,
          ),
      ),
    [config, runAction],
  );

  const settleAndSubmitDirect = useCallback(
    (params: { side: OrderSide; amountIn: string; limitPrice: string }) =>
      runAction(
        'direct',
        (active, report) => settleAndSubmitDirectAction(config, active, params, report),
        (result) =>
          toMessage(
            result.hash,
            result.settledPreviousBatchId !== undefined
              ? `Finished Round #${result.settledPreviousBatchId} and placed your order in the new round.`
              : 'Order placed in the new round.',
          ),
      ),
    [config, runAction],
  );

  const signAndSubmitIntent = useCallback(
    (params: { side: OrderSide; amountIn: string; limitPrice: string }) =>
      runAction(
        'submit-intent',
        (active, report) =>
          signAndSubmitIntentAction(
            config,
            active,
            {
              ...params,
              label: `${active.slice(0, 6)}…${active.slice(-4)} (Signed)`,
            },
            report,
          ),
        (result) =>
          toMessage(
            result.hash,
            `Signed order ${result.orderId >= 0 ? `#${result.orderId} ` : ''}placed in the current round.`,
          ),
      ),
    [config, runAction],
  );

  const sealCommit = useCallback(
    async (params: {
      side: OrderSide;
      amountIn: string;
      limitPrice: string;
      salt: string;
      bondEth: string;
    }): Promise<CommitResult> => {
      const active = requireAccount();
      const currentSnapshot = snapshotRef.current;
      if (!currentSnapshot) throw new Error('Round state is still loading.');
      const batchId = currentSnapshot.state.batch_id;
      const result = await runAction(
        'commit',
        (walletAddress, report) =>
          commitOrder(
            config,
            walletAddress,
            { ...params, batchId },
            report,
          ),
        (res) => toMessage(res.hash, `Sealed order placed in Round #${batchId}.`),
      );

      let commitId = result.commitId;
      if (commitId < 0) {
        const fresh = await loadOnchainSnapshot(config, active);
        const found = fresh.commitments.find(
          (commit) =>
            commit.commitment_hash.toLowerCase() === result.commitmentHash.toLowerCase() &&
            commit.trader.toLowerCase() === active.toLowerCase(),
        );
        commitId = found?.commit_id ?? -1;
      }

      if (commitId >= 0) {
        setSecretVault(
          upsertSecret({
            commit_id: commitId,
            batch_id: batchId,
            trader: active,
            label: `${active.slice(0, 6)}…${active.slice(-4)} (Sealed)`,
            side: params.side,
            amount_in: Number(params.amountIn),
            limit_price: Number(params.limitPrice),
            salt: params.salt,
            commitment_hash: result.commitmentHash,
            bond_eth: Number(params.bondEth),
            bond_wei: result.bondWei.toString(),
            amount_in_raw: result.amountInRaw.toString(),
            limit_price_raw: result.limitPriceRaw.toString(),
            revealed: false,
          }),
        );
      }
      return result;
    },
    [config, requireAccount, runAction],
  );

  const revealCommit = useCallback(
    (secret: LocalSecretVaultEntry) =>
      runAction(
        'reveal',
        (active, report) => revealOrder(config, active, secret, report),
        (result) => {
          setSecretVault(markSecretRevealed(secret.batch_id, secret.commit_id));
          return toMessage(
            result.hash,
            `Sealed order revealed and deposit returned.`,
          );
        },
      ),
    [config, runAction],
  );

  const signIntent = useCallback(
    async (params: {
      side: OrderSide;
      amountIn: string;
      limitPrice: string;
    }): Promise<IntentResult> => {
      const active = requireAccount();
      setBusyAction('sign-intent');
      setTxStatus('Sign your order message in your wallet…');
      setError(null);
      setNotice(null);
      try {
        return await signIntentAction(
          config,
          active,
          {
            ...params,
            label: `${active.slice(0, 6)}…${active.slice(-4)} (Signed)`,
          },
          (msg) => setTxStatus(msg),
        );
      } catch (err) {
        const message = describeTxError(err);
        setError(message);
        throw new Error(message);
      } finally {
        setBusyAction(null);
        setTxStatus(null);
      }
    },
    [config, requireAccount],
  );

  const submitIntent = useCallback(
    (artifact: SignedIntentArtifact) =>
      runAction(
        'submit-intent',
        (active, report) => submitSignedIntent(config, active, artifact, report),
        (result) =>
          toMessage(
            result.hash,
            `Signed order ${result.orderId >= 0 ? `#${result.orderId} ` : ''}accepted.`,
          ),
      ),
    [config, runAction],
  );

  const settle = useCallback(
    () =>
      runAction(
        'settle',
        (active, report) => settleBatchAction(config, active, report),
        (result) =>
          toMessage(
            result.hash,
            `Round #${result.batchId >= 0 ? result.batchId : '?'} finalized at one fair price.`,
          ),
      ),
    [config, runAction],
  );

  const slash = useCallback(
    (batchId: number, commitId: number) =>
      runAction(
        'slash',
        (active, report) => slashUnrevealed(config, active, batchId, commitId, report),
        (result) =>
          toMessage(
            result.hash,
            `Expired deposit slashed; ${Number(result.forfeitedBond) / 1e18} ETH bounty sent to your wallet.`,
          ),
      ),
    [config, runAction],
  );

  const claim = useCallback(
    (item: ClaimableDto) =>
      runAction(
        'claim',
        (active, report) => claimOrder(config, active, item.batch_id, item.order_id, report),
        (result) =>
          toMessage(
            result.hash,
            `Collected tokens from Round #${item.batch_id}.`,
          ),
      ),
    [config, runAction],
  );

  const claimMany = useCallback(
    (items: ClaimableDto[]) =>
      runAction(
        'multicall-claim',
        (active, report) =>
          claimManyAction(
            config,
            active,
            items.map((item) => ({
              batchId: item.batch_id,
              orderId: item.order_id,
            })),
            report,
          ),
        (result) =>
          toMessage(
            result.hash,
            `Collected ${result.claimed} completed order${result.claimed === 1 ? '' : 's'} in one transaction.`,
          ),
      ),
    [config, runAction],
  );

  const addLiquidity = useCallback(
    (amountBase: string, amountQuote: string, lockDurationSecs = 0, minShares = 0n) =>
      runAction(
        'add-liquidity',
        (active, report) =>
          addLiquidityAction(
            config,
            active,
            amountBase,
            amountQuote,
            lockDurationSecs,
            minShares,
            report,
          ),
        (result) => {
          const shareText = result.sharesMinted
            ? ` · ${(Number(result.sharesMinted) / 1e18).toFixed(2)} shares`
            : '';
          const lockText =
            lockDurationSecs > 0 ? ` · locked for ${formatDuration(lockDurationSecs)}` : '';
          return toMessage(result.hash, `Liquidity added${shareText}${lockText}.`);
        },
      ),
    [config, runAction],
  );

  const removeLiquidity = useCallback(
    (shares: string, minBase = 0n, minQuote = 0n) =>
      runAction(
        'remove-liquidity',
        (active, report) =>
          removeLiquidityAction(config, active, shares, minBase, minQuote, report),
        (result) => toMessage(result.hash, 'Liquidity withdrawn to your wallet.'),
      ),
    [config, runAction],
  );

  const claimFaucet = useCallback(
    () =>
      runAction(
        'faucet',
        (active, report) => claimFaucetAction(config, active, report),
        (result) =>
          toMessage(
            result.hash,
            `Received ${formatUnits(result.baseAmount, config.baseDecimals)} ${config.baseSymbol} + ${formatUnits(
              result.quoteAmount,
              config.quoteDecimals,
            )} ${config.quoteSymbol}.`,
          ),
      ),
    [config, runAction],
  );

  const approve = useCallback(
    (token: 'base' | 'quote') =>
      runAction(
        'approve',
        (active, report) => approveFairBatch(config, active, token, report),
        (result) =>
          result
            ? toMessage(
                result,
                `Approved ${token === 'base' ? config.baseSymbol : config.quoteSymbol}.`,
              )
            : { kind: 'info', text: 'Already approved.' },
      ),
    [config, runAction],
  );

  const wrongNetwork = useMemo(
    () => walletChainId !== null && walletChainId !== config.chainId,
    [walletChainId, config.chainId],
  );

  return {
    config,
    hasWallet,
    account,
    walletChainId,
    snapshot,
    livePhase,
    chainNow,
    loading,
    refreshing,
    busyAction,
    txStatus,
    error,
    notice,
    secretVault,
    configured: isContractConfigured(config),
    wrongNetwork,
    connect,
    switchNetwork,
    disconnect,
    refresh,
    clearNotice: () => setNotice(null),
    submitDirect,
    settleAndSubmitDirect,
    signAndSubmitIntent,
    sealCommit,
    revealCommit,
    signIntent,
    submitIntent,
    settle,
    slash,
    claim,
    claimMany,
    addLiquidity,
    removeLiquidity,
    claimFaucet,
    approve,
  };
}

export { DEFAULT_RUNTIME_CONFIG };
