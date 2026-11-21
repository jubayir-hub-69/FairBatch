import type { BatchPhase } from '../types';

export const SIMPLE_TERMS = {
  batch: 'round',
  clearingPrice: 'fair price',
  claim: 'collect',
  revealBond: 'deposit (returned after reveal)',
} as const;

export const FIRST_VISIT_INTRO = {
  title: 'Swap without sandwich bots',
  lines: [
    'FairBatch groups swaps into short rounds and gives everyone in the round the exact same fair price.',
    'Because arrival order does not matter inside a round, front-running bots cannot squeeze your trade.',
    'You are on the Ethereum Sepolia testnet — grab free test tokens below to try a full swap in under a minute.',
  ],
} as const;

export const HOW_IT_WORKS_STEPS: ReadonlyArray<{
  step: number;
  title: string;
  body: string;
}> = [
  {
    step: 1,
    title: 'Connect & get free test tokens',
    body: 'Connect MetaMask, Rabby, or another Ethereum wallet on Sepolia, then claim free fWETH and fUSDC from the testnet faucet.',
  },
  {
    step: 2,
    title: 'Join the current round',
    body: 'Enter how much you want to swap and confirm. Your order joins a short round alongside other traders.',
  },
  {
    step: 3,
    title: 'Everyone gets one fair price',
    body: 'When the round ends, anyone can click once to finalize it. The smart contract computes a single fair price for every order in the round.',
  },
  {
    step: 4,
    title: 'Collect your tokens',
    body: 'Once the round finishes, press Collect to pull your tokens (and any unused refund) straight into your wallet.',
  },
];

export function simplePhaseName(phase: BatchPhase): string {
  switch (phase) {
    case 'Open':
      return 'Collecting orders';
    case 'Reveal':
      return 'Finalizing';
    case 'Ready':
      return 'Round finished';
    case 'Settled':
      return 'Completed';
  }
}

export function proPhaseName(phase: BatchPhase): string {
  switch (phase) {
    case 'Open':
      return 'Open / Collect';
    case 'Reveal':
      return 'Reveal / Intent';
    case 'Ready':
      return 'Ready to settle';
    case 'Settled':
      return 'Settled';
  }
}

export const SIMPLE_ORDER_MODES = {
  direct: {
    title: 'Standard',
    description: 'Fastest option — sends your order straight into the current round in one step.',
  },
  sealed: {
    title: 'Private (sealed)',
    description:
      'Hides your order size and price limit until the round closes, using a small ETH deposit (returned when you reveal).',
  },
  signed: {
    title: 'Gasless signing (EIP-712)',
    description:
      'Sign a typed message off-chain, then submit it during either the collecting or finalizing window.',
  },
} as const;

export const SIMPLE_COPY = {
  swapCaption:
    "Your order joins a round and everyone in it gets the same fair price, so bots can't sandwich you.",
  readyBanner:
    'This round is finished. Start the next round to keep trading (one click, anyone can do it).',
  readyButton: 'Start next round',
  earnTagline: 'Earn a share of every swap',
  sealedStorageWarning:
    "Do not clear browser data or switch browsers before revealing — your reveal secret is stored only in this browser and is needed to recover your deposit.",
  sealedDepositNote:
    'Requires a small Sepolia ETH deposit (returned in full when you reveal in time). If you never reveal, anyone can slash the expired deposit.',
  noWalletTitle: 'No Ethereum wallet detected',
  noWalletBody:
    'Install MetaMask or Rabby in your browser to sign test swaps on Ethereum Sepolia.',
  footerVerified:
    'Built natively in Fe 26.5.0 — clearing::solve_batch, core::fixed::Wad, EIP-1153 Mutex, std::evm::eip712',
} as const;

export const PRO_TOOLTIPS: Record<string, string> = {
  rx: 'Pool reserve of the base token (fWETH) available to absorb net order imbalance.',
  ry: 'Pool reserve of the quote token (fUSDC) available to absorb net order imbalance.',
  k: 'Constant-product invariant (R_x × R_y); under FM-AMM uniform clearing it never decreases after a batch.',
  spot: 'Pre-batch pool ratio (R_y / R_x) before pending orders are priced.',
  pStar: 'Uniform clearing price computed from reserves and eligible orders: every filled order in the batch gets this exact price.',
  cow: 'Coincidence of Wants: opposite-side buy and sell orders matched directly peer-to-peer at p* without moving pool reserves.',
  fmAmm: 'Function-Maximizing AMM: clears the entire batch at its post-trade marginal price so arbitrageurs cannot extract LVR.',
  proRata: 'When orders sit exactly at the clearing price p*, available volume is split proportionally by order size and the rest is refunded.',
  pullOverPush: 'Settlement records claimable receipts instead of pushing transfers in a loop, so one blocked address can never stall a batch.',
  revealBond: 'Refundable Sepolia ETH deposit locked with a sealed commitment; returned on reveal, or paid as a bounty to whoever slashes an expired unrevealed commit.',
  eip712: 'Typed structured data signing (domain-bound to FairBatch on Sepolia) verified on-chain with nonces and deadlines.',
  lnd: 'Liquidity-Nondecreasing invariant: R_x′·R_y′ ≥ R_x·R_y on every batch settlement.',
  multicall: 'Executes multiple FairBatch calls (such as claiming several receipts or settling + submitting) atomically in one transaction.',
};

export interface VerifiedFeFeature {
  id: string;
  label: string;
  badge: string;
  filePath: string;
  summary: string;
  code: string;
  highlights: string[];
}

/**
 * Every module path, symbol, and code excerpt below has been verified against
 * the frozen Fe 26.5.0 contracts under `src/` in this repository.
 */
export const VERIFIED_FE_FEATURES: VerifiedFeFeature[] = [
  {
    id: 'pure-clearing',
    label: 'Zero-Effect solve_batch',
    badge: '0 uses clauses',
    filePath: 'src/clearing.fe',
    summary:
      'Every function in src/clearing.fe — including solve_batch — declares zero `uses` clauses. The Fe 26.5 compiler statically forbids storage access, logs, external calls, or EVM context inside pricing.',
    code: `// src/clearing.fe — Zero \`uses\` clauses (compiler-enforced pure solver)
use core::fixed::Wad
use core::num::{mul_div, mul_div_ceil}
use core::ptr::{MemArray, MemSlice, MemVec}
use core::sort::{dedup_sorted, reverse, sort}

pub fn solve_batch(
    rx_raw: u256,
    ry_raw: u256,
    base_decimals: u8,
    quote_decimals: u8,
    orders: MemSlice<Order>,
) -> ClearingOutput {
    sort(mut sellers)
    sort(mut buyers)
    reverse(mut buyers)
    let eq = find_equilibrium(rx: rx_norm, ry: ry_norm, ...)
}`,
    highlights: [
      'Compile-time isolation: pricing math cannot read storage, msg.sender, or block.timestamp.',
      'Canonical core::sort::sort ordering removes arrival-order priority inside every batch.',
      'Verified by 64 Fe unit and integration tests in src/tests.fe.',
    ],
  },
  {
    id: 'wad-solvency',
    label: 'Wad & 512-bit Solvency',
    badge: 'core::fixed::Wad',
    filePath: 'src/math.fe',
    summary:
      'Multi-decimal normalization (18-decimal fWETH vs 6-decimal fUSDC) and 512-bit `mul_div` floor rounding guarantee solvency and the Liquidity-Nondecreasing invariant.',
    code: `// src/math.fe — 512-bit overflow-safe Wad & decimal normalization
use core::fixed::Wad
use core::num::mul_div

pub fn normalize_amount(raw_amt: u256, decimals: u8) -> u256 { ... }
pub fn denormalize_floor(norm_amt: u256, decimals: u8) -> u256 { ... }
pub fn compute_fm_amm_price(
    rx_norm: u256, ry_norm: u256,
    sell_base_norm: u256, buy_quote_norm: u256,
) -> Wad { ... }`,
    highlights: [
      'Strict floor rounding ensures sum(user payouts) + post-batch reserves <= total escrowed.',
      'verify_lnd_invariant confirms R_x′·R_y′ >= R_x·R_y using 512-bit comparisons.',
      'Slippage bounds (min_shares, min_base, min_quote) protect liquidity adds and removals.',
    ],
  },
  {
    id: 'transient-mutex',
    label: 'EIP-1153 Mutex, Clock & Multicall',
    badge: 'std::evm::mutex',
    filePath: 'src/lib.fe',
    summary:
      'FairBatch uses Cancun transient storage (`std::evm::mutex::Mutex`) for gas-efficient reentrancy protection, custom `BatchClock` effect injection for deterministic tests, pull-over-push claims, and `std::evm::multicall`.',
    code: `// src/lib.fe — Granular uses(...), EIP-1153 Mutex, BatchClock & Multicall
use std::evm::erc20::{safe_transfer, safe_transfer_from}
use std::evm::multicall::{MulticallMsg, multicall}
use std::evm::mutex::Mutex

pub trait BatchClock {
    fn now(self) -> Timestamp
}

pub fn evaluate_batch_phase(meta: BatchMeta, cfg: MarketConfig) -> u8
uses (clock: BatchClock) { ... }

recv MulticallMsg {
    Multicall { data } -> DynArray<Bytes> uses (ctx, mut call) {
        multicall(data)
    }
}`,
    highlights: [
      'Pull-over-push claim() prevents any single reverting token receiver from blocking settlement.',
      'MulticallMsg enables 1-transaction batch claiming and atomic settle + order submission.',
      'slashUnrevealed pays the forfeited ETH bond directly to the permissionless caller.',
    ],
  },
  {
    id: 'eip712-intents',
    label: 'EIP-712 & Commit-Reveal',
    badge: 'std::evm::eip712',
    filePath: 'src/intent.fe',
    summary:
      'Dual pre-settlement privacy: compile-time `keccak` typehashes, domain-bound EIP-712 signed intents with ECDSA/ERC-1271 verification, and bonded commit-reveal hashing.',
    code: `// src/intent.fe — Native Fe 26.5 EIP-712 & Commitment Hashing
use core::bytes::keccak
use std::evm::crypto::keccak_words
use std::evm::eip712::{Domain, digest}
use std::evm::signature::{is_valid_signature_now, recover}

pub const SIGNED_ORDER_TYPEHASH: u256 = keccak(
    "SignedOrder(address trader,uint8 side,uint256 amountIn,uint256 limitPrice,uint256 batchId,uint256 nonce,uint256 deadline)",
)

pub fn verify_signed_order(...) -> bool uses (ctx: Ctx, call: Call) { ... }`,
    highlights: [
      'Domain binds name ("FairBatch"), version ("1"), chainId, and verifyingContract.',
      'Supports EOA secp256k1 and ERC-1271 smart-contract signatures via is_valid_signature_now.',
      'Faucet contract (src/faucet.fe) also uses Mutex and typed Duration cooldowns.',
    ],
  },
];
