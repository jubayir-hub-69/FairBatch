import { describe, expect, it, vi } from 'vitest';
import type { PublicClient } from 'viem';
import {
  dedupeEvents,
  loadFairBatchEvents,
  resetEventCache,
  type FairBatchEvent,
} from '../onchain/events';
import {
  deriveLivePhase,
  indexFairBatchEvents,
  reconstructReserveHistory,
  remainingSecondsForPhase,
  type RawBatchInfo,
} from '../onchain/state';
import { describeTxError } from '../onchain/actions';
import { detectSimpleStep } from '../onchain/useFairBatch';
import { DEFAULT_RUNTIME_CONFIG } from '../onchain/config';
import {
  formatDuration,
  formatInvariant,
  formatPrice,
  formatToken,
  formatUsd,
  getChainLabel,
  shortenAddress,
} from '../lib/format';
import type { ClaimableDto } from '../types';

const ALICE = '0x9AFe5CeF11fC10756faef213f7A30D9873B5d372';
const BOB = '0x1234567890123456789012345678901234567890';
const TX_A = `0x${'aa'.repeat(32)}` as `0x${string}`;
const TX_B = `0x${'bb'.repeat(32)}` as `0x${string}`;

describe('onchain/events deduplication & concurrency guard (Bugs 1a & 1b)', () => {
  it('deduplicates identical event logs and sorts by (blockNumber, logIndex)', () => {
    const ev1: FairBatchEvent = {
      eventName: 'OrderSubmitted',
      args: { batchId: 2n, orderId: 0n },
      blockNumber: 105n,
      logIndex: 3,
      transactionHash: TX_A,
    };
    const ev2: FairBatchEvent = {
      eventName: 'BatchSettled',
      args: { batchId: 1n },
      blockNumber: 100n,
      logIndex: 1,
      transactionHash: TX_B,
    };

    const result = dedupeEvents([ev1, ev1, ev2, ev1, ev2]);
    expect(result).toHaveLength(2);
    expect(result[0].blockNumber).toBe(100n);
    expect(result[1].blockNumber).toBe(105n);
  });

  it('coalesces concurrent loadFairBatchEvents calls so StrictMode never triples events', async () => {
    resetEventCache();
    let getLogsCalls = 0;
    const mockClient = {
      getBlockNumber: vi.fn(async () => DEFAULT_RUNTIME_CONFIG.deploymentBlock + 10n),
      getLogs: vi.fn(async () => {
        getLogsCalls += 1;
        await new Promise((r) => setTimeout(r, 15));
        return [
          {
            eventName: 'BatchSettled',
            args: {
              batchId: 1n,
              clearingPrice: 3000n * 10n ** 18n,
              totalSellBase: 1n * 10n ** 18n,
              totalBuyQuote: 0n,
              cowMatchedBase: 0n,
              cowMatchedQuote: 0n,
              reserveBaseAfter: 101n * 10n ** 18n,
              reserveQuoteAfter: 297_000n * 10n ** 6n,
            },
            blockNumber: DEFAULT_RUNTIME_CONFIG.deploymentBlock + 2n,
            logIndex: 0,
            transactionHash: TX_A,
          },
        ];
      }),
    } as unknown as PublicClient;

    const [a, b, c] = await Promise.all([
      loadFairBatchEvents(mockClient, DEFAULT_RUNTIME_CONFIG),
      loadFairBatchEvents(mockClient, DEFAULT_RUNTIME_CONFIG),
      loadFairBatchEvents(mockClient, DEFAULT_RUNTIME_CONFIG),
    ]);

    expect(getLogsCalls).toBe(1);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(c).toHaveLength(1);
  });
});

describe('onchain/state indexing, reserve history, and phase derivation (Bugs 1a-1c)', () => {
  it('deduplicates orders, commitments, and settled batch records by on-chain ID', () => {
    const duplicateOrder: FairBatchEvent = {
      eventName: 'OrderSubmitted',
      args: {
        batchId: 2n,
        orderId: 0n,
        trader: ALICE,
        side: 0,
        amountIn: 1n * 10n ** 18n,
        limitPrice: 2700n * 10n ** 18n,
        mode: 0,
      },
      blockNumber: 200n,
      logIndex: 1,
      transactionHash: TX_A,
    };
    const duplicateSettled: FairBatchEvent = {
      eventName: 'BatchSettled',
      args: {
        batchId: 1n,
        clearingPrice: 3000n * 10n ** 18n,
        totalSellBase: 1n * 10n ** 18n,
        totalBuyQuote: 0n,
        cowMatchedBase: 0n,
        cowMatchedQuote: 0n,
        reserveBaseAfter: 101n * 10n ** 18n,
        reserveQuoteAfter: 297_000n * 10n ** 6n,
      },
      blockNumber: 150n,
      logIndex: 2,
      transactionHash: TX_B,
    };

    const indexed = indexFairBatchEvents(
      [duplicateOrder, duplicateOrder, duplicateOrder, duplicateSettled, duplicateSettled],
      DEFAULT_RUNTIME_CONFIG,
    );

    expect(indexed.ordersByBatch.get(2)).toHaveLength(1);
    expect(indexed.settledEvents).toHaveLength(1);
  });

  it('transitions Open -> Reveal -> Ready immediately when deadlines pass (strict > matching src/lib.fe)', () => {
    const batch: RawBatchInfo = {
      batchId: 5n,
      startTime: 1_000n,
      commitDeadline: 1_060n,
      revealDeadline: 1_120n,
      orderCount: 1n,
      commitCount: 0n,
      phase: 0, // stale RPC phase still saying Open
    };

    expect(deriveLivePhase(batch, 1_059)).toBe('Open');
    expect(deriveLivePhase(batch, 1_060)).toBe('Open'); // now <= commitDeadline
    expect(deriveLivePhase(batch, 1_061)).toBe('Reveal'); // now > commitDeadline
    expect(deriveLivePhase(batch, 1_120)).toBe('Reveal'); // now <= revealDeadline
    expect(deriveLivePhase(batch, 1_121)).toBe('Ready'); // now > revealDeadline!

    expect(remainingSecondsForPhase(batch, 'Open', 1_030)).toBe(30);
    expect(remainingSecondsForPhase(batch, 'Reveal', 1_100)).toBe(20);
    expect(remainingSecondsForPhase(batch, 'Ready', 1_150)).toBe(0);

    // Settled batches stay Settled regardless of timestamp
    expect(deriveLivePhase({ ...batch, phase: 3 }, 2_000)).toBe('Settled');
  });

  it('reconstructs reserve history without double-counting seedReserves LiquidityAdded', () => {
    const events: FairBatchEvent[] = [
      {
        eventName: 'LiquidityAdded',
        args: {
          amountBase: 100n * 10n ** 18n,
          amountQuote: 300_000n * 10n ** 6n,
        },
        blockNumber: 10n,
        logIndex: 0,
        transactionHash: TX_A,
      },
      {
        eventName: 'BatchSettled',
        args: {
          batchId: 1n,
          reserveBaseAfter: 101n * 10n ** 18n,
          reserveQuoteAfter: 297_058_823_529n,
        },
        blockNumber: 20n,
        logIndex: 0,
        transactionHash: TX_B,
      },
      {
        eventName: 'BatchSettled',
        args: {
          batchId: 2n,
          reserveBaseAfter: 102n * 10n ** 18n,
          reserveQuoteAfter: 294_174_757_281n,
        },
        blockNumber: 30n,
        logIndex: 0,
        transactionHash: TX_B,
      },
    ];

    const history = reconstructReserveHistory(events, DEFAULT_RUNTIME_CONFIG);
    // Batch #1 pre-reserves MUST be 100 fWETH / 300,000 fUSDC (NOT double-counted 200 / 600,000!)
    expect(history.get(1)?.base).toBe(100n * 10n ** 18n);
    expect(history.get(1)?.quote).toBe(300_000n * 10n ** 6n);
    // Batch #2 pre-reserves match Batch #1 post-reserves
    expect(history.get(2)?.base).toBe(101n * 10n ** 18n);
    expect(history.get(2)?.quote).toBe(297_058_823_529n);
  });

  it('falls back to configured initial reserves if LiquidityAdded is outside log window', () => {
    const events: FairBatchEvent[] = [
      {
        eventName: 'BatchSettled',
        args: {
          batchId: 1n,
          reserveBaseAfter: 101n * 10n ** 18n,
          reserveQuoteAfter: 297_000n * 10n ** 6n,
        },
        blockNumber: 20n,
        logIndex: 0,
        transactionHash: TX_A,
      },
    ];
    const history = reconstructReserveHistory(events, DEFAULT_RUNTIME_CONFIG);
    expect(history.get(1)?.base).toBe(DEFAULT_RUNTIME_CONFIG.initialReserveBase);
    expect(history.get(1)?.quote).toBe(DEFAULT_RUNTIME_CONFIG.initialReserveQuote);
  });
});

describe('Simple mode step detection', () => {
  const unclaimedForAlice: ClaimableDto = {
    batch_id: 3,
    order_id: 0,
    trader: ALICE,
    label: 'Alice',
    side: 'SellBase',
    status: 'Filled',
    amount_in: 1,
    amount_filled: 1,
    payout_out: 2950,
    refund_in: 0,
    effective_price: 2950,
    claimed: false,
  };

  it('derives Steps 1 -> 2 -> 3 -> 4 strictly from wallet and on-chain state', () => {
    // Disconnected -> Step 1
    expect(
      detectSimpleStep({ account: null, wrongNetwork: false, balances: null, claimable: [] }),
    ).toBe(1);

    // Wrong network -> Step 1
    expect(
      detectSimpleStep({
        account: ALICE,
        wrongNetwork: true,
        balances: { eth: 1n, base: 1n, quote: 0n, lpShares: 0n },
        claimable: [],
      }),
    ).toBe(1);

    // Connected on Sepolia with 0 test tokens -> Step 2 (Get test tokens)
    expect(
      detectSimpleStep({
        account: ALICE,
        wrongNetwork: false,
        balances: { eth: 10n ** 16n, base: 0n, quote: 0n, lpShares: 0n },
        claimable: [],
      }),
    ).toBe(2);

    // Already holds fWETH or fUSDC -> auto-skips Step 2 straight to Step 3 (Swap)
    expect(
      detectSimpleStep({
        account: ALICE,
        wrongNetwork: false,
        balances: { eth: 10n ** 16n, base: 10n ** 17n, quote: 0n, lpShares: 0n },
        claimable: [],
      }),
    ).toBe(3);

    // Has an unclaimed settled receipt -> Step 4 (Collect), even if balances are 0
    expect(
      detectSimpleStep({
        account: ALICE,
        wrongNetwork: false,
        balances: { eth: 10n ** 16n, base: 0n, quote: 0n, lpShares: 0n },
        claimable: [unclaimedForAlice],
      }),
    ).toBe(4);

    // Another user's unclaimed receipt does not push Bob to Step 4
    expect(
      detectSimpleStep({
        account: BOB,
        wrongNetwork: false,
        balances: { eth: 10n ** 16n, base: 1n, quote: 0n, lpShares: 0n },
        claimable: [unclaimedForAlice],
      }),
    ).toBe(3);
  });
});

describe('Human-readable revert & error mapping', () => {
  it('maps contract revert reasons to plain-language user messages', () => {
    expect(describeTxError(new Error('execution reverted: Faucet cooldown active'))).toMatch(
      /Faucet cooldown active/i,
    );
    expect(
      describeTxError(new Error('execution reverted: LP shares locked'), {
        lockUnlockTimeSecs: 1_800_000_000,
      }),
    ).toMatch(/Your liquidity is locked until/i);
    expect(
      describeTxError(new Error('execution reverted: Slippage: insufficient LP shares')),
    ).toBe('Price moved too much, try again.');
    expect(
      describeTxError(new Error('execution reverted: Slippage: insufficient base output')),
    ).toBe('Price moved too much, try again.');
    expect(describeTxError(new Error('execution reverted: Commit window closed'))).toBe(
      'This round closed, try the next one.',
    );
    expect(describeTxError(new Error('execution reverted: Reveal window closed'))).toBe(
      'Sealed order not revealed in time.',
    );
    expect(describeTxError(new Error('User rejected the request'))).toMatch(/canceled/i);
    expect(describeTxError(new Error('HTTP 429 Too Many Requests'))).toMatch(/RPC is busy/i);
  });
});

describe('Number, address, and duration formatting', () => {
  it('formats tokens, prices, USD, invariants, addresses, and durations consistently', () => {
    expect(formatPrice(2941.176, 2)).toBe('2,941.18');
    expect(formatPrice(Number.NaN)).toBe('0.00');
    expect(formatUsd(-12.345, 2)).toBe('-$12.35');
    expect(formatUsd(1234.5, 2)).toBe('$1,234.50');
    expect(formatToken(0.5, 4, 2)).toBe('0.50');
    expect(formatToken(1.23456, 4, 2)).toBe('1.2346');
    expect(formatInvariant(30_000_000)).toBe('30.000M');
    expect(formatInvariant(2_500_000_000)).toBe('2.500B');
    expect(shortenAddress(ALICE)).toBe('0x9AFe…d372');
    expect(getChainLabel(11155111)).toBe('Ethereum Sepolia');
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(125)).toBe('2m 05s');
    expect(formatDuration(43_200)).toBe('12h');
    expect(formatDuration(90_000)).toBe('1d 1h');
  });
});
