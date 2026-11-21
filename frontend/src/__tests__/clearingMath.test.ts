import { describe, expect, it } from 'vitest';
import {
  computeBatchSettlement,
  runSandwichSimulation,
  simulateSequentialAmm,
} from '../lib/clearingMath';
import {
  computeLocalCommitmentHash,
  keccak256Utf8,
} from '../lib/keccak';
import type { OrderDto } from '../types';

const TRADERS = [
  '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
  '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
];

const MEV_BOT = '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF';

function makeFiveSellers(withSandwich = false): OrderDto[] {
  const victims: OrderDto[] = TRADERS.map((trader, idx) => ({
    order_id: idx + 1,
    trader,
    label: `Trader #${idx + 1}`,
    side: 'SellBase',
    amount_in: 1.0,
    limit_price: 2350,
    submission_type: idx === 2 ? 'Eip712Intent' : idx === 4 ? 'CommitReveal' : 'Direct',
    is_attacker: false,
  }));
  if (!withSandwich) return victims;
  return [
    {
      order_id: 9001,
      trader: MEV_BOT,
      label: 'MEV Bot (Front-Run)',
      side: 'SellBase',
      amount_in: 7.7,
      limit_price: 1500,
      submission_type: 'Direct',
      is_attacker: true,
    },
    ...victims,
    {
      order_id: 9002,
      trader: MEV_BOT,
      label: 'MEV Bot (Back-Run)',
      side: 'BuyBase',
      amount_in: 21_000,
      limit_price: 4500,
      submission_type: 'Direct',
      is_attacker: true,
    },
  ];
}

function makeBalancedCow(): OrderDto[] {
  return [
    {
      order_id: 1,
      trader: TRADERS[0],
      label: 'Alice',
      side: 'SellBase',
      amount_in: 2.0,
      limit_price: 2850,
      submission_type: 'Direct',
      is_attacker: false,
    },
    {
      order_id: 2,
      trader: TRADERS[1],
      label: 'Bob',
      side: 'SellBase',
      amount_in: 3.0,
      limit_price: 2900,
      submission_type: 'Eip712Intent',
      is_attacker: false,
    },
    {
      order_id: 3,
      trader: TRADERS[2],
      label: 'Carol',
      side: 'BuyBase',
      amount_in: 6000,
      limit_price: 3150,
      submission_type: 'Direct',
      is_attacker: false,
    },
    {
      order_id: 4,
      trader: TRADERS[3],
      label: 'Dave',
      side: 'BuyBase',
      amount_in: 9000,
      limit_price: 3100,
      submission_type: 'CommitReveal',
      is_attacker: false,
    },
  ];
}

function makeMarginalProRata(): OrderDto[] {
  return [
    {
      order_id: 1,
      trader: TRADERS[0],
      label: 'Alice (ITM Sell)',
      side: 'SellBase',
      amount_in: 2.0,
      limit_price: 2600,
      submission_type: 'Direct',
      is_attacker: false,
    },
    {
      order_id: 2,
      trader: TRADERS[1],
      label: 'Bob (Marginal @ 2,800)',
      side: 'SellBase',
      amount_in: 4.0,
      limit_price: 2800,
      submission_type: 'Direct',
      is_attacker: false,
    },
    {
      order_id: 3,
      trader: TRADERS[2],
      label: 'Carol (Marginal @ 2,800)',
      side: 'SellBase',
      amount_in: 4.0,
      limit_price: 2800,
      submission_type: 'Eip712Intent',
      is_attacker: false,
    },
    {
      order_id: 4,
      trader: TRADERS[3],
      label: 'Dave (OTM @ 3,150)',
      side: 'SellBase',
      amount_in: 2.0,
      limit_price: 3150,
      submission_type: 'Direct',
      is_attacker: false,
    },
    {
      order_id: 5,
      trader: TRADERS[4],
      label: 'Eve (ITM Buy)',
      side: 'BuyBase',
      amount_in: 2800,
      limit_price: 3100,
      submission_type: 'Direct',
      is_attacker: false,
    },
  ];
}

describe('Keccak-256 & Cryptographic Primitives', () => {
  it('matches canonical Ethereum keccak256("") and Fe 26.5 EIP-712 typehashes', () => {
    expect(keccak256Utf8('')).toBe(
      '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
    );
    expect(keccak256Utf8('FairBatch')).toBe(
      '0xbfc8188869712178434ae4bf52a3a78c858fb11b896cf2025bf6cc70fc65617c',
    );
    expect(
      keccak256Utf8(
        'SignedOrder(address trader,uint8 side,uint256 amountIn,uint256 limitPrice,uint256 batchId,uint256 nonce,uint256 deadline)',
      ),
    ).toBe(
      '0x533cd46d2f02704a53b40b6efd823ebfb6860646a4f98544ac1c2cbc83db34a8',
    );
  });

  it('produces deterministic 32-byte commitment hashes sensitive to salt and limit price', () => {
    const h1 = computeLocalCommitmentHash({
      batch_id: 1,
      trader: TRADERS[0],
      side: 'SellBase',
      amount_in: 2.5,
      limit_price: 2700,
      salt: '0x' + '11'.repeat(32),
    });
    const h2 = computeLocalCommitmentHash({
      batch_id: 1,
      trader: TRADERS[0],
      side: 'SellBase',
      amount_in: 2.5,
      limit_price: 2700,
      salt: '0x' + '22'.repeat(32),
    });
    expect(h1).toMatch(/^0x[0-9a-f]{64}$/);
    expect(h1).not.toBe(h2);
  });
});

describe('Hybrid CoW + FM-AMM Batch Clearing & Sequential Baseline Math', () => {
  it('clears 5 ETH sellers at uniform p* = 2727.2727... with strict LND growth', () => {
    const settlement = computeBatchSettlement(1, 100, 300_000, makeFiveSellers());

    expect(settlement.clearing_price).toBeCloseTo(2727.272727, 4);
    expect(settlement.fills).toHaveLength(5);

    const firstPayout = settlement.fills[0].payout_out;
    for (const fill of settlement.fills) {
      expect(fill.status).toBe('Filled');
      expect(fill.payout_out).toBe(firstPayout);
      expect(fill.effective_price).toBeCloseTo(2727.272727, 4);
    }

    expect(settlement.reserves_after.k_invariant).toBeGreaterThan(
      settlement.reserves_before.k_invariant,
    );
  });

  it('computes strictly moving sequential AMM prices and honest signed value diff (bug 1e)', () => {
    const threeSells: OrderDto[] = [0, 1, 2].map((id) => ({
      order_id: id,
      trader: TRADERS[id],
      label: `Seller #${id + 1}`,
      side: 'SellBase',
      amount_in: 1.0,
      limit_price: 2500,
      submission_type: 'Direct',
      is_attacker: false,
    }));

    const seq = simulateSequentialAmm(100, 300_000, threeSells, 30, false);
    expect(seq.ammReceipts).toHaveLength(3);
    // Each successive sell moves reserves, strictly decreasing execution price
    expect(seq.ammReceipts[0].effective_price).toBeGreaterThan(
      seq.ammReceipts[1].effective_price,
    );
    expect(seq.ammReceipts[1].effective_price).toBeGreaterThan(
      seq.ammReceipts[2].effective_price,
    );

    const avgFromRows =
      (seq.ammReceipts[0].effective_price +
        seq.ammReceipts[1].effective_price +
        seq.ammReceipts[2].effective_price) /
      3;
    expect(seq.ammVictimAvgPrice).toBeCloseTo(avgFromRows, 6);

    // On un-sandwiched one-sided sells, FM-AMM clears at the post-trade marginal price
    // (leaving LVR surplus for LPs), so signed diff vs un-sandwiched AMM is negative, NOT clamped to 0.
    const settlement = computeBatchSettlement(2, 100, 300_000, threeSells);
    expect(settlement.clearing_price).toBeCloseTo(300_000 / 106, 4);
    expect(settlement.comparison.user_value_saved_quote).toBeLessThan(0);
  });

  it('satisfies order-permutation invariance across arbitrary arrival shuffles', () => {
    const baseOrders: OrderDto[] = [
      {
        order_id: 1,
        trader: TRADERS[0],
        label: 'Alice',
        side: 'SellBase',
        amount_in: 3.0,
        limit_price: 2600,
        submission_type: 'Direct',
        is_attacker: false,
      },
      {
        order_id: 2,
        trader: TRADERS[1],
        label: 'Bob',
        side: 'BuyBase',
        amount_in: 6000,
        limit_price: 3150,
        submission_type: 'Eip712Intent',
        is_attacker: false,
      },
      {
        order_id: 3,
        trader: TRADERS[2],
        label: 'Carol',
        side: 'SellBase',
        amount_in: 1.5,
        limit_price: 2750,
        submission_type: 'CommitReveal',
        is_attacker: false,
      },
    ];

    const reversed = [...baseOrders].reverse();
    const s1 = computeBatchSettlement(1, 100, 300_000, baseOrders);
    const s2 = computeBatchSettlement(1, 100, 300_000, reversed);

    expect(s1.clearing_price).toBeCloseTo(s2.clearing_price, 9);
    for (const f1 of s1.fills) {
      const f2 = s2.fills.find((x) => x.order_id === f1.order_id)!;
      expect(f2.payout_out).toBe(f1.payout_out);
      expect(f2.refund_in).toBe(f1.refund_in);
    }
  });

  it('crosses Balanced CoW 100% peer-to-peer at $3,000.00 with positive real trader savings', () => {
    const settlement = computeBatchSettlement(1, 100, 300_000, makeBalancedCow());

    expect(settlement.clearing_price).toBeCloseTo(3000.0, 4);
    expect(settlement.cow_ratio_pct).toBeCloseTo(100.0, 2);
    expect(settlement.reserves_after.rx).toBeCloseTo(100.0, 6);
    expect(settlement.reserves_after.ry).toBeCloseTo(300_000.0, 4);
    // CoW avoids the 30 bps pool fee + round-trip price impact, delivering real positive savings
    expect(settlement.comparison.user_value_saved_quote).toBeGreaterThan(0);
  });

  it('pins marginal limit tier at $2,800.00 with pro-rata partial fills and 100% OTM refund', () => {
    const settlement = computeBatchSettlement(1, 100, 300_000, makeMarginalProRata());

    expect(settlement.clearing_price).toBeCloseTo(2800.0, 4);

    const statuses = settlement.fills.map((f) => f.status);
    expect(statuses).toContain('Filled');
    expect(statuses).toContain('PartialFill');
    expect(statuses).toContain('OutOfMoneyRefund');

    const otmDave = settlement.fills.find((f) => f.label.includes('Dave'))!;
    expect(otmDave.status).toBe('OutOfMoneyRefund');
    expect(otmDave.refund_in).toBe(2.0);
    expect(otmDave.payout_out).toBe(0);
  });

  it('eliminates MEV sandwich profit ($0.00 on FairBatch vs >$1,000 on Sequential AMM)', () => {
    const settlement = computeBatchSettlement(1, 100, 300_000, makeFiveSellers(true));

    expect(settlement.clearing_price).toBeCloseTo(2727.272727, 4);
    expect(settlement.comparison.amm_sandwich_profit_quote).toBeGreaterThan(1000);
    expect(settlement.comparison.fairbatch_sandwich_profit_quote).toBe(0);
    expect(settlement.comparison.user_value_saved_quote).toBeGreaterThan(0);

    const sim = runSandwichSimulation({
      rx: 100,
      ry: 300_000,
      side: 'SellBase',
      amountIn: 2,
    });
    expect(sim.fairbatchBotProfitQuote).toBe(0);
    expect(sim.ammBotProfitQuote).toBeGreaterThan(0);
    expect(sim.fairbatchOut).toBeGreaterThan(sim.ammSandwichedOut);
  });
});
