# `backend/` — Off-Chain Reference Solver & MEV Comparison Tool

> **Scope Note:** The core contribution of FairBatch is the **Fe `26.5.0` smart-contract suite in [`../src/`](../src/)**. This Rust crate (`fairbatch-backend`) is an **optional off-chain reference/parity verifier and sequential-AMM MEV sandwich simulator**. It is **not** required to run the live Sepolia web terminal (`../frontend/`, which connects directly to Ethereum Sepolia via `viem` and `../config/deployment.json`).

## Purpose

- **Differential Parity Verification (`clearing.rs`, `math.rs`, `tests/api_integration.rs`):** Independently implements the 256-bit `Wad` Hybrid CoW + FM-AMM clearing math and cross-checks outputs atom-for-atom against `../src/clearing.fe` and `../src/tests.fe`.
- **MEV Sandwich Benchmark (`simulator.rs`):** Simulates a sequential Uniswap v2 (`x * y = k`, 30 bps fee) pool with an optimal front-run/back-run sandwich bot against FairBatch's uniform clearing price $p^*$.
- **EIP-712 & Artifact Inspector (`intent.rs`, `chain.rs`):** Validates `keccak256` commit-reveal hashing, `k256` secp256k1 EIP-712 signing/recovery, and reads Sepolia deployment metadata from `../config/deployment.json`.

## Running Reference Tests

```sh
cd backend
cargo clippy --all-targets -- -D warnings
cargo test
```
