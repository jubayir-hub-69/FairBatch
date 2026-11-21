import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { BatchPhase, ClaimableDto, OrderDto, StateResponse } from '../types';
import type { FairBatchController } from '../onchain/useFairBatch';
import type { FaucetState, LiquidityLockState, OnchainSnapshot } from '../onchain/state';
import { DEFAULT_RUNTIME_CONFIG } from '../onchain/config';
import { computeBatchSettlement } from '../lib/clearingMath';
import { formatPrice } from '../lib/format';
import App from '../App';

const ALICE = '0x9AFe5CeF11fC10756faef213f7A30D9873B5d372';
const BOB = '0x1234567890123456789012345678901234567890';
const BATCH_ID = 8;

const ORDERS: OrderDto[] = [
  {
    order_id: 0,
    trader: ALICE,
    label: '0x9AFe…d372 · direct',
    side: 'SellBase',
    amount_in: 2,
    limit_price: 2650,
    submission_type: 'Direct',
    is_attacker: false,
  },
  {
    order_id: 1,
    trader: BOB,
    label: '0x1234…7890 · signed',
    side: 'BuyBase',
    amount_in: 6000,
    limit_price: 3200,
    submission_type: 'Eip712Intent',
    is_attacker: false,
  },
];

const CLAIMS: ClaimableDto[] = [
  {
    batch_id: 7,
    order_id: 0,
    trader: ALICE,
    label: '0x9AFe…d372 · sealed',
    side: 'SellBase',
    status: 'Filled',
    amount_in: 1.5,
    amount_filled: 1.5,
    payout_out: 4500,
    refund_in: 0,
    effective_price: 3000,
    claimed: false,
  },
  {
    batch_id: 7,
    order_id: 1,
    trader: BOB,
    label: '0x1234…7890 · signed',
    side: 'BuyBase',
    status: 'PartialFill',
    amount_in: 6000,
    amount_filled: 3000,
    payout_out: 1,
    refund_in: 3000,
    effective_price: 3000,
    claimed: false,
  },
];

let controller: FairBatchController;

function makeSnapshot(
  phase: BatchPhase,
  _account: string | null = null,
  overrides: { lpLock?: Partial<LiquidityLockState>; faucet?: Partial<FaucetState> } = {},
): OnchainSnapshot {
  const settlement = computeBatchSettlement(BATCH_ID, 100, 300_000, ORDERS);
  const state: StateResponse = {
    batch_id: BATCH_ID,
    phase,
    commit_duration_secs: 60,
    reveal_duration_secs: 60,
    phase_remaining_secs: 30,
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
    commitments: [
      {
        commit_id: 4,
        trader: ALICE,
        commitment_hash: `0x${'11'.repeat(32)}`,
        bond_eth: 0.001,
        revealed: false,
        slashed: false,
      },
    ],
    orders: ORDERS,
    claimable: CLAIMS,
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
      startTime: 1_000n,
      commitDeadline: 1_060n,
      revealDeadline: 1_120n,
      orderCount: 2n,
      commitCount: 1n,
      phase: phase === 'Reveal' ? 1 : phase === 'Ready' ? 2 : phase === 'Settled' ? 3 : 0,
    },
    reserves: {
      reserveBase: 100_000_000_000_000_000_000n,
      reserveQuote: 300_000_000_000n,
      totalShares: 5_477_225_575_051_661_134_569n,
      spotPriceWad: 3_000n * 10n ** 18n,
    },
    balances: {
      eth: 10n ** 18n,
      base: 5n * 10n ** 18n,
      quote: 20_000n * 10n ** 6n,
      lpShares: 100n * 10n ** 18n,
    },
    allowances: { base: 10n ** 24n, quote: 10n ** 24n },
    lpLock: {
      lockedShares: 0n,
      unlockTime: 0n,
      unlockedShares: 100n * 10n ** 18n,
      ...overrides.lpLock,
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
      ...overrides.faucet,
    },
    nonce: 3n,
    domainSeparator: `0x${'22'.repeat(32)}`,
    minBondWei: 100_000_000_000_000n,
    orders: ORDERS.map((order) => ({
      ...order,
      batch_id: BATCH_ID,
      amount_in_raw: 0n,
      limit_price_raw: 0n,
      mode: 0,
    })),
    commitments: [
      {
        batch_id: BATCH_ID,
        commit_id: 4,
        trader: ALICE,
        commitment_hash: `0x${'11'.repeat(32)}`,
        bond_eth: 0.001,
        bond_wei: 100_000_000_000_000n,
        revealed: false,
        slashed: false,
      },
    ],
    allCommitments: [],
    batchSettled: false,
    claimable: CLAIMS,
    settledHistory: [],
    activeSettlement: settlement,
    blockTimestamp: Math.floor(Date.now() / 1000),
    chainTimeOffsetSecs: 0,
    lastUpdated: Date.now(),
  };
}

function makeController(
  overrides: Partial<FairBatchController> = {},
): FairBatchController {
  const account = overrides.account ?? null;
  const snapshot = overrides.snapshot ?? makeSnapshot('Open', account);
  return {
    config: DEFAULT_RUNTIME_CONFIG,
    hasWallet: true,
    account,
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
    submitDirect: vi.fn(async () => ({ hash: '0x', receipt: {}, orderId: 1 })),
    settleAndSubmitDirect: vi.fn(async () => ({ hash: '0x', receipt: {}, orderId: 1 })),
    signAndSubmitIntent: vi.fn(async () => ({ hash: '0x', receipt: {}, orderId: 1 })),
    sealCommit: vi.fn(async () => ({ hash: '0x', receipt: {} })),
    revealCommit: vi.fn(async () => ({ hash: '0x', receipt: {} })),
    signIntent: vi.fn(async () => ({
      trader: ALICE,
      label: 'Signed',
      side: 'SellBase' as const,
      amount_in: 2,
      limit_price: 2650,
      amount_in_raw: '2000000000000000000',
      limit_price_raw: '2650000000000000000000',
      batch_id: BATCH_ID,
      nonce: 0,
      deadline: 1,
      signature: `0x${'33'.repeat(65)}`,
      digest: `0x${'44'.repeat(32)}`,
    })),
    submitIntent: vi.fn(async () => ({ hash: '0x', receipt: {} })),
    settle: vi.fn(async () => ({ hash: '0x', batchId: BATCH_ID })),
    slash: vi.fn(async () => ({ hash: '0x', forfeitedBond: 0n })),
    claim: vi.fn(async () => ({ hash: '0x', payoutBase: 0n, payoutQuote: 0n })),
    claimMany: vi.fn(async () => ({ hash: '0x', claimed: 1 })),
    addLiquidity: vi.fn(async () => ({ hash: '0x', receipt: {} })),
    removeLiquidity: vi.fn(async () => ({ hash: '0x', receipt: {} })),
    claimFaucet: vi.fn(async () => ({
      hash: '0x',
      receipt: {},
      baseAmount: 10n ** 18n,
      quoteAmount: 100n * 10n ** 6n,
      nextClaimAt: 0n,
    })),
    approve: vi.fn(async () => null),
    ...overrides,
  } as unknown as FairBatchController;
}

vi.mock('../onchain/useFairBatch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../onchain/useFairBatch')>();
  return {
    ...actual,
    useFairBatch: () => controller,
  };
});

describe('FairBatch on-chain terminal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    try {
      localStorage.clear();
    } catch {
      // ignore if unavailable
    }
    controller = makeController();
  });

  function renderPro() {
    const view = render(<App />);
    fireEvent.click(screen.getByTestId('mode-pro-button'));
    return view;
  }

  it('defaults to Simple mode with progress strip, plain swap card, and Ready-round banner', async () => {
    controller = makeController({
      account: ALICE,
      snapshot: makeSnapshot('Ready', ALICE),
    });
    const { rerender } = render(<App />);

    expect(screen.getByTestId('mode-simple-button')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('simple-progress-strip')).toBeInTheDocument();
    // Alice has an unclaimed receipt in CLAIMS -> Step 4 Collect card is shown first
    expect(screen.getByTestId('simple-collect-card')).toBeInTheDocument();

    // Without unclaimed receipts, Alice sees the Ready banner & Swap card
    const cleanSnap = makeSnapshot('Ready', ALICE);
    cleanSnap.claimable = [];
    cleanSnap.orders = [];
    cleanSnap.state.orders = [];
    cleanSnap.commitments = [];
    controller = makeController({ account: ALICE, snapshot: cleanSnap });
    rerender(<App />);
    expect(screen.getByTestId('simple-ready-banner')).toBeInTheDocument();
    expect(screen.getByTestId('simple-swap-button')).toHaveTextContent(
      /Start next round & Swap/i,
    );
  });

  it('renders the live batch, reserves and clearing preview from chain snapshot', () => {
    renderPro();
    const settlement = computeBatchSettlement(BATCH_ID, 100, 300_000, ORDERS);

    expect(screen.getByTestId('batch-id-badge')).toHaveTextContent(
      `BATCH #${BATCH_ID}`,
    );
    expect(screen.getByTestId('reserve-rx')).toHaveTextContent('100.00 fWETH');
    expect(screen.getByTestId('reserve-ry')).toHaveTextContent('300,000 fUSDC');
    expect(screen.getByTestId('pool-spot-price')).toHaveTextContent('$3,000.00');
    expect(screen.getByTestId('connection-status-badge')).toHaveTextContent(
      'Read-only · live RPC',
    );
    expect(
      screen.getByRole('img', { name: /Batch Supply and Demand Depth Chart/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('uniform-clearing-price-readout')).toHaveTextContent(
      `$${formatPrice(settlement.clearing_price, 2)} fUSDC/fWETH`,
    );
    expect(screen.getByTestId('account-connect-button')).toBeInTheDocument();
  });

  it('enables permissionless settlement only for a connected wallet in the ready phase', async () => {
    controller = makeController({
      account: ALICE,
      snapshot: makeSnapshot('Ready', ALICE),
    });
    renderPro();

    const settleButton = screen.getByTestId('settle-batch-button');
    expect(settleButton).not.toBeDisabled();

    fireEvent.click(settleButton);
    await waitFor(() => {
      expect(controller.settle).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps settlement locked while the commit window is still open', () => {
    renderPro();
    expect(screen.queryByTestId('settle-batch-button')).not.toBeInTheDocument();
    expect(
      screen.getByText(/Settlement opens after the reveal window/i),
    ).toBeInTheDocument();
  });

  it('submits a sealed commitment through the connected wallet', async () => {
    controller = makeController({ account: ALICE });
    renderPro();

    fireEvent.click(screen.getByRole('tab', { name: /Commit-Reveal/i }));
    fireEvent.click(
      screen.getByRole('button', { name: /Seal & lock commitment/i }),
    );

    await waitFor(() => {
      expect(controller.sealCommit).toHaveBeenCalledTimes(1);
    });
    expect(controller.sealCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        side: 'SellBase',
        amountIn: '2.0',
        limitPrice: '2650',
        bondEth: '0.001',
      }),
    );
    expect(
      await screen.findByText(/Sealed commitment confirmed/i),
    ).toBeInTheDocument();
  });

  it('lets only the connected owner claim settled receipts', async () => {
    controller = makeController({ account: ALICE });
    renderPro();

    expect(screen.getByText('Other wallet')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Multicall My Claims \(1\)/i }),
    ).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: /Claim Payout/i }));
    await waitFor(() => {
      expect(controller.claim).toHaveBeenCalledWith(
        expect.objectContaining({ batch_id: 7, order_id: 0, trader: ALICE }),
      );
    });

    fireEvent.click(
      screen.getByRole('button', { name: /Multicall My Claims \(1\)/i }),
    );
    await waitFor(() => {
      expect(controller.claimMany).toHaveBeenCalledWith([
        expect.objectContaining({ batch_id: 7, order_id: 0, trader: ALICE }),
      ]);
    });
  });

  it('claims 1 fWETH + 100 fUSDC from the Sepolia faucet and enforces cooldown display', async () => {
    controller = makeController({ account: ALICE });
    const { rerender } = renderPro();

    const claimBtn = screen.getByTestId('faucet-claim-button');
    expect(claimBtn).toBeEnabled();
    expect(claimBtn).toHaveTextContent(/Claim 1 fWETH \+ 100 fUSDC/i);

    fireEvent.click(claimBtn);
    await waitFor(() => {
      expect(controller.claimFaucet).toHaveBeenCalledTimes(1);
    });

    const futureUnlock = BigInt(Math.floor(Date.now() / 1000) + 3_600);
    controller = makeController({
      account: ALICE,
      snapshot: makeSnapshot('Open', ALICE, {
        faucet: { canClaim: false, nextClaimAt: futureUnlock },
      }),
    });
    rerender(<App />);
    expect(screen.getByTestId('faucet-claim-button')).toBeDisabled();
    expect(screen.getByTestId('faucet-claim-button')).toHaveTextContent(/Next claim in/i);
  });

  it('supports optional liquidity locking when adding liquidity and shows active lock status', async () => {
    const futureUnlock = BigInt(Math.floor(Date.now() / 1000) + 7_200);
    controller = makeController({
      account: ALICE,
      snapshot: makeSnapshot('Open', ALICE, {
        lpLock: {
          lockedShares: 40n * 10n ** 18n,
          unlockTime: futureUnlock,
          unlockedShares: 60n * 10n ** 18n,
        },
      }),
    });
    renderPro();

    expect(screen.getByTestId('lp-lock-banner')).toHaveTextContent(/40\.00 shares locked/i);
    expect(screen.getByTestId('lp-lock-banner')).toHaveTextContent(/60\.00 withdrawable now/i);

    fireEvent.click(screen.getByRole('button', { name: '12 hours' }));
    fireEvent.click(screen.getByTestId('lp-add-submit'));

    await waitFor(() => {
      expect(controller.addLiquidity).toHaveBeenCalledWith(
        '1',
        '3000',
        43_200,
        expect.any(BigInt),
      );
    });
  });

  it('renders the read-only Sepolia deployment modal from config/deployment.json with no local fork controls', () => {
    renderPro();

    fireEvent.click(screen.getByTestId('header-more-menu'));
    fireEvent.click(
      screen.getByRole('menuitem', { name: /Contract & network config/i }),
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(DEFAULT_RUNTIME_CONFIG.fairBatch)).toBeInTheDocument();
    expect(screen.getByText(DEFAULT_RUNTIME_CONFIG.faucet)).toBeInTheDocument();
    expect(screen.queryByText(/Local Anvil/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save contract config/i })).not.toBeInTheDocument();
  });

  it('renders transaction notices with an explorer link', () => {
    controller = makeController({
      notice: {
        kind: 'success',
        text: 'Direct order #12 confirmed on-chain.',
        hash: `0x${'ab'.repeat(32)}`,
      },
    });
    render(<App />);

    expect(
      screen.getByText('Direct order #12 confirmed on-chain.'),
    ).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Tx 0xababab/i });
    expect(link).toHaveAttribute(
      'href',
      `https://sepolia.etherscan.io/tx/0x${'ab'.repeat(32)}`,
    );
  });
});
