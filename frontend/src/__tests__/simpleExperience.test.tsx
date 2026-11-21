import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BatchPhase, ClaimableDto, OrderDto, StateResponse } from '../types';
import type { FairBatchController } from '../onchain/useFairBatch';
import type { OnchainSnapshot } from '../onchain/state';
import { DEFAULT_RUNTIME_CONFIG } from '../onchain/config';
import { computeBatchSettlement } from '../lib/clearingMath';
import App from '../App';

const ALICE = '0x9AFe5CeF11fC10756faef213f7A30D9873B5d372';
const BATCH_ID = 10;

let controller: FairBatchController;

vi.mock('../onchain/useFairBatch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../onchain/useFairBatch')>();
  return {
    ...actual,
    useFairBatch: () => controller,
  };
});

function buildSnapshot(options: {
  phase?: BatchPhase;
  orders?: OrderDto[];
  claimable?: ClaimableDto[];
  baseBal?: bigint;
  quoteBal?: bigint;
  lpShares?: bigint;
  lockedShares?: bigint;
  unlockTime?: bigint;
} = {}): OnchainSnapshot {
  const phase = options.phase ?? 'Open';
  const orders = options.orders ?? [];
  const claimable = options.claimable ?? [];
  const settlement = computeBatchSettlement(BATCH_ID, 100, 300_000, orders);
  const nowSecs = Math.floor(Date.now() / 1000);

  const state: StateResponse = {
    batch_id: BATCH_ID,
    phase,
    commit_duration_secs: 60,
    reveal_duration_secs: 60,
    phase_remaining_secs: 42,
    reserves: {
      rx: 100,
      ry: 300_000,
      spot_price: 3000,
      k_invariant: 30_000_000,
      base_symbol: 'fWETH',
      quote_symbol: 'fUSDC',
      base_decimals: 18,
      quote_decimals: 6,
    },
    commitments: [],
    orders,
    claimable,
    settled_history: [],
  };

  return {
    config: DEFAULT_RUNTIME_CONFIG,
    health: {
      status: 'ok',
      execution_mode: 'rpc_connected',
      rpc_url: DEFAULT_RUNTIME_CONFIG.rpcUrl,
      chain_id: DEFAULT_RUNTIME_CONFIG.chainId,
      contracts: {
        fair_batch: DEFAULT_RUNTIME_CONFIG.fairBatch,
        base_token: DEFAULT_RUNTIME_CONFIG.baseToken,
        quote_token: DEFAULT_RUNTIME_CONFIG.quoteToken,
        faucet: DEFAULT_RUNTIME_CONFIG.faucet,
        deployed: true,
      },
      fe_artifacts_present: false,
      fe_artifacts: [],
    },
    state,
    batch: {
      batchId: BigInt(BATCH_ID),
      startTime: BigInt(nowSecs - 20),
      commitDeadline: BigInt(nowSecs + 40),
      revealDeadline: BigInt(nowSecs + 100),
      orderCount: BigInt(orders.length),
      commitCount: 0n,
      phase: phase === 'Reveal' ? 1 : phase === 'Ready' ? 2 : 0,
    },
    reserves: {
      reserveBase: 100n * 10n ** 18n,
      reserveQuote: 300_000n * 10n ** 6n,
      totalShares: 5_477n * 10n ** 18n,
      spotPriceWad: 3_000n * 10n ** 18n,
    },
    balances: {
      eth: 10n ** 17n,
      base: options.baseBal ?? 1n * 10n ** 18n,
      quote: options.quoteBal ?? 100n * 10n ** 6n,
      lpShares: options.lpShares ?? 50n * 10n ** 18n,
    },
    allowances: { base: 0n, quote: 0n },
    lpLock: {
      lockedShares: options.lockedShares ?? 0n,
      unlockTime: options.unlockTime ?? 0n,
      unlockedShares: (options.lpShares ?? 50n * 10n ** 18n) - (options.lockedShares ?? 0n),
    },
    faucet: {
      address: DEFAULT_RUNTIME_CONFIG.faucet,
      baseBalance: 2_000n * 10n ** 18n,
      quoteBalance: 1_000_000n * 10n ** 6n,
      claimBaseAmount: 1n * 10n ** 18n,
      claimQuoteAmount: 100n * 10n ** 6n,
      cooldownSecs: 43_200,
      lastClaim: 0n,
      nextClaimAt: 0n,
      canClaim: true,
    },
    nonce: 0n,
    domainSeparator: `0x${'22'.repeat(32)}`,
    minBondWei: 100_000_000_000_000n,
    orders: orders.map((o) => ({
      ...o,
      batch_id: BATCH_ID,
      amount_in_raw: 0n,
      limit_price_raw: 0n,
      mode: 0,
    })),
    commitments: [],
    allCommitments: [],
    batchSettled: false,
    claimable,
    settledHistory: [],
    activeSettlement: settlement,
    blockTimestamp: nowSecs,
    chainTimeOffsetSecs: 0,
    lastUpdated: Date.now(),
  };
}

function makeCtrl(overrides: Partial<FairBatchController> = {}): FairBatchController {
  const snapshot = overrides.snapshot ?? buildSnapshot();
  return {
    config: DEFAULT_RUNTIME_CONFIG,
    hasWallet: true,
    account: null,
    walletChainId: DEFAULT_RUNTIME_CONFIG.chainId,
    snapshot,
    livePhase: overrides.livePhase ?? snapshot.state.phase,
    chainNow: Math.floor(Date.now() / 1000),
    loading: false,
    refreshing: false,
    busyAction: null,
    txStatus: null,
    error: null,
    notice: null,
    secretVault: [],
    configured: true,
    wrongNetwork: false,
    connect: vi.fn(async () => undefined),
    switchNetwork: vi.fn(async () => undefined),
    disconnect: vi.fn(),
    refresh: vi.fn(),
    clearNotice: vi.fn(),
    submitDirect: vi.fn(async () => ({ hash: `0x${'11'.repeat(32)}`, receipt: {}, orderId: 0 })),
    settleAndSubmitDirect: vi.fn(async () => ({
      hash: `0x${'22'.repeat(32)}`,
      receipt: {},
      orderId: 0,
      settledPreviousBatchId: BATCH_ID,
    })),
    signAndSubmitIntent: vi.fn(async () => ({
      hash: `0x${'33'.repeat(32)}`,
      receipt: {},
      orderId: 0,
    })),
    sealCommit: vi.fn(async () => ({ hash: '0x', receipt: {}, commitId: 0 })),
    revealCommit: vi.fn(async () => ({ hash: '0x', receipt: {}, orderId: 0 })),
    signIntent: vi.fn(async () => ({})),
    submitIntent: vi.fn(async () => ({ hash: '0x', receipt: {}, orderId: 0 })),
    settle: vi.fn(async () => ({ hash: `0x${'44'.repeat(32)}`, batchId: BATCH_ID })),
    slash: vi.fn(async () => ({ hash: '0x', forfeitedBond: 0n })),
    claim: vi.fn(async () => ({
      hash: `0x${'55'.repeat(32)}`,
      payoutBase: 0n,
      payoutQuote: 1_500n * 10n ** 6n,
    })),
    claimMany: vi.fn(async () => ({ hash: `0x${'66'.repeat(32)}`, claimed: 2 })),
    addLiquidity: vi.fn(async () => ({ hash: `0x${'77'.repeat(32)}`, receipt: {} })),
    removeLiquidity: vi.fn(async () => ({ hash: `0x${'88'.repeat(32)}`, receipt: {} })),
    claimFaucet: vi.fn(async () => ({
      hash: `0x${'99'.repeat(32)}`,
      receipt: {},
      baseAmount: 1n * 10n ** 18n,
      quoteAmount: 100n * 10n ** 6n,
      nextClaimAt: 0n,
    })),
    approve: vi.fn(async () => null),
    ...overrides,
  } as unknown as FairBatchController;
}

describe('Simple mode end-to-end flows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    try {
      localStorage.clear();
    } catch {
      // ignore
    }
  });

  it('shows install links when no Ethereum wallet exists', () => {
    controller = makeCtrl({ hasWallet: false, account: null });
    render(<App />);
    expect(screen.getByText(/No Ethereum wallet detected/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Install MetaMask/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Install Rabby/i })).toBeInTheDocument();
  });

  it('shows Switch to Sepolia on wrong network and invokes switchNetwork', async () => {
    controller = makeCtrl({ account: ALICE, wrongNetwork: true, walletChainId: 1 });
    render(<App />);
    const btn = screen.getByTestId('simple-switch-network-button');
    fireEvent.click(btn);
    await waitFor(() => {
      expect(controller.switchNetwork).toHaveBeenCalledTimes(1);
    });
  });

  it('shows Step 2 Faucet when user holds 0 test tokens and calls claimFaucet', async () => {
    controller = makeCtrl({
      account: ALICE,
      snapshot: buildSnapshot({ baseBal: 0n, quoteBal: 0n }),
    });
    render(<App />);
    const faucetBtn = screen.getByTestId('simple-faucet-button');
    expect(faucetBtn).toHaveTextContent(/Get free test tokens/i);
    fireEvent.click(faucetBtn);
    await waitFor(() => {
      expect(controller.claimFaucet).toHaveBeenCalledTimes(1);
    });
  });

  it('auto-routes via EIP-712 signed swap during Finalizing (Reveal) phase', async () => {
    controller = makeCtrl({
      account: ALICE,
      livePhase: 'Reveal',
      snapshot: buildSnapshot({ phase: 'Reveal' }),
    });
    render(<App />);
    expect(screen.getByTestId('simple-finalizing-notice')).toBeInTheDocument();
    const swapBtn = screen.getByTestId('simple-swap-button');
    expect(swapBtn).toHaveTextContent(/Swap now \(sign & send\)/i);

    fireEvent.click(swapBtn);
    await waitFor(() => {
      expect(controller.signAndSubmitIntent).toHaveBeenCalledTimes(1);
    });
  });

  it('combines settle + direct order into one multicall when round is Ready', async () => {
    controller = makeCtrl({
      account: ALICE,
      livePhase: 'Ready',
      snapshot: buildSnapshot({ phase: 'Ready' }),
    });
    render(<App />);
    expect(screen.getByTestId('simple-ready-banner')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('simple-swap-button'));
    await waitFor(() => {
      expect(controller.settleAndSubmitDirect).toHaveBeenCalledTimes(1);
    });
  });

  it('shows Waiting card when the connected wallet has a live order in the active round', () => {
    controller = makeCtrl({
      account: ALICE,
      livePhase: 'Open',
      snapshot: buildSnapshot({
        phase: 'Open',
        orders: [
          {
            order_id: 0,
            trader: ALICE,
            label: 'Alice',
            side: 'SellBase',
            amount_in: 0.5,
            limit_price: 2760,
            submission_type: 'Direct',
            is_attacker: false,
          },
        ],
      }),
    });
    render(<App />);
    expect(screen.getByTestId('simple-waiting-card')).toBeInTheDocument();
    expect(screen.getByText(/Waiting for this round to close/i)).toBeInTheDocument();
  });

  it('collects multiple settled receipts in one multicall and opens Earn tab with custom lock', async () => {
    const receipts: ClaimableDto[] = [
      {
        batch_id: 8,
        order_id: 0,
        trader: ALICE,
        label: 'Alice',
        side: 'SellBase',
        status: 'Filled',
        amount_in: 0.5,
        amount_filled: 0.5,
        payout_out: 1475,
        refund_in: 0,
        effective_price: 2950,
        claimed: false,
      },
      {
        batch_id: 9,
        order_id: 0,
        trader: ALICE,
        label: 'Alice',
        side: 'SellBase',
        status: 'Filled',
        amount_in: 0.5,
        amount_filled: 0.5,
        payout_out: 1460,
        refund_in: 0,
        effective_price: 2920,
        claimed: false,
      },
    ];
    controller = makeCtrl({
      account: ALICE,
      snapshot: buildSnapshot({ claimable: receipts }),
    });
    render(<App />);

    const collectBtn = screen.getByTestId('simple-collect-button');
    expect(collectBtn).toHaveTextContent(/Collect all 2 orders/i);
    fireEvent.click(collectBtn);
    await waitFor(() => {
      expect(controller.claimMany).toHaveBeenCalledWith(receipts);
    });

    // Switch to Earn tab and test custom lock duration + Add liquidity
    fireEvent.click(screen.getByTestId('simple-tab-earn'));
    expect(screen.getByTestId('simple-earn-view')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('simple-earn-lock-toggle'));
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.change(screen.getByTestId('simple-custom-lock-input'), {
      target: { value: '45' },
    });
    fireEvent.click(screen.getByTestId('simple-earn-add-button'));
    await waitFor(() => {
      expect(controller.addLiquidity).toHaveBeenCalledWith(
        '0.02',
        '60',
        2700, // 45 minutes in seconds
        expect.any(BigInt),
      );
    });
  });

  it('opens How it works, Why Fe, and MEV Sandwich Simulation modals cleanly', () => {
    controller = makeCtrl({ account: ALICE });
    render(<App />);

    fireEvent.click(screen.getByTestId('simple-how-it-works-link'));
    expect(screen.getByText(/How FairBatch works/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Got it/i }));

    fireEvent.click(screen.getByTestId('header-more-menu'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Why Fe/i }));
    expect(screen.getByText(/Verified Fe 26\.5\.0 contracts/i)).toBeInTheDocument();
    expect(screen.getAllByText(/src\/clearing\.fe/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /Close Why Fe modal/i }));

    fireEvent.click(screen.getByTestId('header-more-menu'));
    fireEvent.click(screen.getByRole('menuitem', { name: /MEV sandwich simulation/i }));
    expect(
      screen.getByText(/Client-side simulation — not an on-chain result/i),
    ).toBeInTheDocument();
  });
});
