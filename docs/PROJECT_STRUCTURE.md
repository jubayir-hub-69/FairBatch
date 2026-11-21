# FairBatch — Project Structure & Sepolia Deployment Guide

This document maps every directory and tracked file in the FairBatch repository and documents the current **Ethereum Sepolia (`Chain ID 11155111`)** deployment and verification workflow.

---

## 1. Repository Layout

```text
FairBatch/
├── .gitattributes                       # Enforces LF line endings on *.fe (keeps `fe fmt --check` clean on Windows/CI)
├── .github/workflows/ci.yml             # CI: Fe 26.5 fmt/check/test/build, Rust reference tests, frontend tests/build
├── fe.toml                              # Fe 26.5.0 ingot manifest (`fair_batch` v0.1.0)
├── LICENSE                              # Apache License 2.0
├── README.md                            # Project overview, Why Fe, live Sepolia E2E txs, gas table & limitations
│
├── src/                                 # Fe 26.5.0 Smart Contracts (Core Technical Contribution)
│   ├── lib.fe                           # FairBatch exchange: BatchClock, 3 order modes, slasher payout, slippage-safe LP + locks, MulticallMsg
│   ├── clearing.fe                      # Zero-effect (`uses ()`) Hybrid CoW + FM-AMM uniform clearing engine
│   ├── math.fe                          # Zero-effect Wad (UFixed<18>), 18d/6d scaling, 512-bit comparisons & LND check
│   ├── intent.fe                        # Commit-reveal keccak_words + EIP-712 / ERC-1271 signature verification
│   ├── storage.fe                       # MarketConfig, PoolState, BatchMeta & LiquidityLock storage structs
│   ├── types.fe                         # Side enum, #[abi] structs, #[event] records & constants
│   ├── faucet.fe                        # Sepolia Faucet (1 fWETH + 100 fUSDC / 12h) with BatchClock cooldown & Mutex
│   ├── mock_erc20.fe                    # Access-controlled MockERC20 (owner/minter mint, owner-only blacklist)
│   └── tests.fe                         # 69 Fe unit, property, MockClock, EVM integration & security revert tests
│
├── out/                                 # [GIT-IGNORED] Compiled Fe 26.5.0 Sonatina EVM Artifacts (`fe build`)
│   ├── FairBatch.{bin,runtime.bin,abi.json}
│   ├── Faucet.{bin,runtime.bin,abi.json}
│   └── MockERC20.{bin,runtime.bin,abi.json}
│
├── config/                              # Shared Network & Deployment Configuration (Single Source of Truth)
│   ├── deployment.json                  # Live Sepolia contract addresses, tokens, batch windows & faucet config
│   └── networks.json                    # Sepolia Cancun/Pectra metadata & canonical opcode requirements
│
├── deployments/                         # Public Sepolia Deployment Manifest (Zero Secrets)
│   ├── README.md                        # Manifest generation documentation
│   └── sepolia.json                     # Live deployment tx hashes, blocks, gas usage & verified views
│
├── frontend/                            # React 18 + TypeScript + TailwindCSS + viem Exchange Terminal
│   ├── package.json                     # Vite, React, viem, TypeScript & Vitest scripts
│   └── src/
│       ├── App.tsx                      # Clearing Ledger terminal shell driven directly by Sepolia RPC + wallet
│       ├── onchain/                     # viem client, ABI, event indexer, snapshot builder, tx actions & secret vault
│       ├── components/                  # OrderTicket, LiquidityPanel, BatchConsole, ClaimsPanel, PriceChart, AccountPanel...
│       ├── lib/                         # Pure TS clearing helpers, formatting & keccak
│       └── __tests__/                   # 35 Vitest unit & component tests
│
├── backend/                             # Optional Off-Chain Rust Reference Solver & MEV Comparison Tool (Not Core Contribution)
│   ├── README.md                        # Scope note & reference test commands
│   ├── Cargo.toml                       # `fairbatch-backend` crate
│   ├── src/                             # clearing.rs, math.rs, simulator.rs, intent.rs, chain.rs, state.rs, api.rs, main.rs
│   └── tests/api_integration.rs         # 10 integration & atom-for-atom parity tests (30 Rust tests total)
│
├── scripts/                             # PowerShell Readiness & Sepolia Deployment Scripts
│   ├── check_setup.ps1                  # Verifies workspace folders, toolchains, out/ artifacts & config/deployment.json
│   ├── prepare_deployment.ps1           # Offline constructor/seeding calldata builder & Cancun opcode disassembler
│   └── deploy_sepolia.ps1               # Sepolia deployer (`-DryRun` & live broadcast) with pure-C# EIP-1559 + Keccak-256
│
└── docs/                                # Engineering & Visual Design Documentation
    ├── PROJECT_STRUCTURE.md             # This file
    ├── RESEARCH_AND_FEASIBILITY.md      # Mathematical proofs (T1–T5) & Cancun EVM opcode analysis
    ├── design/                          # Clearing Ledger design philosophy & visual specimens
    └── screenshots/                     # Simple, Ready, Waiting, Result, Earn, Pro & 380px mobile captures
```

---

## 2. How the Frontend Connects (No REST Backend Required)

`frontend/src/onchain/config.ts` imports [`config/deployment.json`](../config/deployment.json) directly at build time. At runtime:
- Read queries and event indexing go straight to Ethereum Sepolia RPC (`https://ethereum-sepolia-rpc.publicnode.com`) via `viem`'s `PublicClient` (`frontend/src/onchain/client.ts`).
- Write transactions (`claim`, `approve`, `submitDirectOrder`, `commitOrder`, `revealOrder`, `submitSignedIntent`, `settleBatch`, `slashUnrevealed`, `addLiquidity`, `addLiquidityLocked`, `removeLiquidity`, `multicall`) are signed in the browser via the user's injected EIP-1193 wallet (`window.ethereum`).

To launch the terminal from a clean clone:

```sh
cd frontend
npm ci
npm run dev
```

---

## 3. Redeploying to Ethereum Sepolia (Optional — Already Deployed)

Only required if you want to deploy your own fresh Sepolia instance:

1. Compile the Fe `26.5.0` contracts so `./out/` exists:
   ```sh
   fe build
   ```
2. Create a git-ignored `.env` file in the repository root with a funded Sepolia key:
   ```ini
   DEPLOYER_PRIVATE_KEY=0xYOUR_64_HEX_CHAR_SEPOLIA_PRIVATE_KEY
   ```
3. Run offline readiness checks (zero network calls):
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check_setup.ps1
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/prepare_deployment.ps1
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy_sepolia.ps1 -DryRun
   ```
4. Broadcast live deployment to Sepolia:
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy_sepolia.ps1
   ```
   This deploys `fWETH` (`18d`), `fUSDC` (`6d`), `FairBatch`, and `Faucet`, authorizes `Faucet` as token minter, funds `Faucet` (`2,000 fWETH + 1,000,000 fUSDC`), seeds `100 fWETH / 300,000 fUSDC`, verifies live on-chain views, and writes both [`config/deployment.json`](../config/deployment.json) and [`deployments/sepolia.json`](../deployments/sepolia.json).

---

## 4. Current Live Ethereum Sepolia Deployment (`Chain ID 11155111`)

Recorded in [`config/deployment.json`](../config/deployment.json) and [`deployments/sepolia.json`](../deployments/sepolia.json):

| Contract / Action | Address / Value | Transaction Hash | Block | Gas Used | Sepolia Etherscan |
| :--- | :--- | :--- | :---: | :---: | :--- |
| **`fWETH` (`18` decimals)** | `0xe9903189bf3e418759feb26f11a7d1c99be0e556` | `0x5b3f18005b6d6344eef187eec18456300a1aaf26f0a1cb4241b527b9a21d990b` | `12176749` | `2,676,774` | [View Token](https://sepolia.etherscan.io/address/0xe9903189bf3e418759feb26f11a7d1c99be0e556) |
| **`fUSDC` (`6` decimals)** | `0xbd2c54af6dd7e5e14d5b97d393eb2c8e2e8ebcca` | `0xd15e031b8141c028dcefdaeecbb2dce1366c976dca004b0f9a11ab290aba0fbe` | `12176750` | `2,676,774` | [View Token](https://sepolia.etherscan.io/address/0xbd2c54af6dd7e5e14d5b97d393eb2c8e2e8ebcca) |
| **`FairBatch` Exchange** | `0x6fa21b7ada82e8b04fca51fdc60793c3fd80265f` | `0x6ed5ad0144aedeb3c5cd4e5d91d54ccda9d2d8b58d64a5467e757573d8c9ff91` | `12176751` | `36,300,761` | [View Contract](https://sepolia.etherscan.io/address/0x6fa21b7ada82e8b04fca51fdc60793c3fd80265f) |
| **`Faucet` (`1 fWETH + 100 fUSDC / 12h`)** | `0xe355220e8e9a650d082d49f130f0bfe344a792c7` | `0x8a2886ba04e1986c8257011ab23f596808d704374acd5f1753d0ad0238078b48` | `12176752` | `2,294,323` | [View Faucet](https://sepolia.etherscan.io/address/0xe355220e8e9a650d082d49f130f0bfe344a792c7) |
| **`seedReserves(100e18, 300000e6)`** | `R_x = 100 fWETH`, `R_y = 300,000 fUSDC` | `0xfd3f9db3779324372d0b3d3e1dcc79e3a82fa88f930ac5203c9ec931aff12065` | `12176759` | `811,614` | [View Seed Tx](https://sepolia.etherscan.io/tx/0xfd3f9db3779324372d0b3d3e1dcc79e3a82fa88f930ac5203c9ec931aff12065) |

- **Deployer Account:** [`0x7d9Cb2994D86B6a4e65761B5d81DADa69ce54a7f`](https://sepolia.etherscan.io/address/0x7d9Cb2994D86B6a4e65761B5d81DADa69ce54a7f)
- **Verified `domainSeparator()`:** `0x5f0204041a131fe55ebf032359d28559fb9d9caeddf81c37e11fcb05fc6c8ef5` (`23,038` deployed runtime bytes)
