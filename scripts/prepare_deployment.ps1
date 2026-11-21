<#
.SYNOPSIS
    FairBatch Offline Sepolia Deployment Readiness & Calldata Builder (Strictly Dry-Run).

.DESCRIPTION
    Prepares ABI-encoded constructor arguments, creation payload inspection,
    Cancun/Shanghai EVM opcode verification (`cast disassemble`), and ERC-20 /
    reserve-seeding calldata for Ethereum Sepolia WITHOUT ever connecting to an
    RPC endpoint or broadcasting any transaction.
#>
[CmdletBinding()]
param(
    [string]$BaseToken = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
    [string]$QuoteToken = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    [int]$BaseDecimals = 18,
    [int]$QuoteDecimals = 6,
    [uint64]$CommitWindowSecs = 60,
    [uint64]$RevealWindowSecs = 60,
    [string]$MinBondWei = "100000000000000",            # 0.0001 ETH reveal bond
    [string]$SeedBaseRaw = "100000000000000000000",     # 100 fWETH (18 decimals)
    [string]$SeedQuoteRaw = "300000000000",             # 300,000 fUSDC (6 decimals)
    [string]$FaucetBaseRaw = "1000000000000000000",     # 1 fWETH per claim
    [string]$FaucetQuoteRaw = "100000000",              # 100 fUSDC per claim
    [uint64]$FaucetCooldownSecs = 43200,                # 12 hours
    [string]$OutDir = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($OutDir)) {
    $OutDir = Join-Path $RepoRoot "out"
}

$CastBin = "cast"
if (-not (Get-Command $CastBin -ErrorAction SilentlyContinue)) {
    $FoundryCast = Join-Path $env:USERPROFILE ".foundry\bin\cast.exe"
    $CargoCast = Join-Path $env:USERPROFILE ".cargo\bin\cast.exe"
    if (Test-Path $FoundryCast) {
        $CastBin = $FoundryCast
    } elseif (Test-Path $CargoCast) {
        $CastBin = $CargoCast
    } else {
        throw "Foundry 'cast' binary not found in PATH, ~/.foundry/bin, or ~/.cargo/bin."
    }
}

Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host " FairBatch Sepolia Readiness & Calldata Builder (OFFLINE DRY-RUN)" -ForegroundColor Cyan
Write-Host " Safety Mode : STRICTLY OFFLINE -- ZERO RPC CALLS OR BROADCASTS" -ForegroundColor Green
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host " Target Network    : Ethereum Sepolia Testnet (Chain ID: 11155111)"
Write-Host " Required EVM Fork : Cancun / Pectra (EIP-1153 TLOAD/TSTORE active)"
Write-Host (" Base Token (X)    : {0} ({1} decimals)" -f $BaseToken, $BaseDecimals)
Write-Host (" Quote Token (Y)   : {0} ({1} decimals)" -f $QuoteToken, $QuoteDecimals)
Write-Host (" Commit / Reveal   : {0}s / {1}s | Min Reveal Bond: {2} wei" -f $CommitWindowSecs, $RevealWindowSecs, $MinBondWei)
Write-Host (" Initial Seed Plan : {0} raw Base + {1} raw Quote" -f $SeedBaseRaw, $SeedQuoteRaw)
Write-Host (" Faucet Claim Plan : {0} raw Base + {1} raw Quote / {2}s" -f $FaucetBaseRaw, $FaucetQuoteRaw, $FaucetCooldownSecs)
Write-Host ""

$FairBatchBinPath     = Join-Path $OutDir "FairBatch.bin"
$FairBatchRuntimePath = Join-Path $OutDir "FairBatch.runtime.bin"
$FaucetBinPath        = Join-Path $OutDir "Faucet.bin"
$FaucetRuntimePath    = Join-Path $OutDir "Faucet.runtime.bin"

Write-Host "[1/3] Artifact & Cancun Bytecode Inspection ($OutDir)" -ForegroundColor Yellow
if ((Test-Path $FairBatchBinPath) -and (Test-Path $FairBatchRuntimePath)) {
    $InitHex    = (Get-Content -Raw $FairBatchBinPath).Trim() -replace "^0x", ""
    $RuntimeHex = (Get-Content -Raw $FairBatchRuntimePath).Trim() -replace "^0x", ""
    $InitBytes    = [int]($InitHex.Length / 2)
    $RuntimeBytes = [int]($RuntimeHex.Length / 2)
    $Eip170Pct    = [math]::Round(($RuntimeBytes / 24576.0) * 100.0, 2)

    Write-Host ("  FairBatch.bin         : {0} bytes" -f $InitBytes)
    Write-Host ("  FairBatch.runtime.bin : {0} bytes ({1}% of 24,576-byte EIP-170 limit)" -f $RuntimeBytes, $Eip170Pct)

    $Disasm = (cmd /c "`"$CastBin`" disassemble < `"$FairBatchRuntimePath`"") -split "`r?`n"
    $Push0Count  = ($Disasm | Select-String -Pattern "\bPUSH0\b").Count
    $McopyCount  = ($Disasm | Select-String -Pattern "\bMCOPY\b").Count
    $TloadCount  = ($Disasm | Select-String -Pattern "\bTLOAD\b").Count
    $TstoreCount = ($Disasm | Select-String -Pattern "\bTSTORE\b").Count
    Write-Host ("  Verified Opcodes      : PUSH0={0} (Shanghai) | MCOPY={1}, TLOAD={2}, TSTORE={3} (Cancun)" -f $Push0Count, $McopyCount, $TloadCount, $TstoreCount)
} else {
    Write-Host "  FairBatch.bin not yet generated in ./out/ (run 'fe build' first)." -ForegroundColor DarkYellow
}

if ((Test-Path $FaucetBinPath) -and (Test-Path $FaucetRuntimePath)) {
    $FaucetInitBytes = [int](((Get-Content -Raw $FaucetBinPath).Trim() -replace "^0x", "").Length / 2)
    $FaucetRtBytes   = [int](((Get-Content -Raw $FaucetRuntimePath).Trim() -replace "^0x", "").Length / 2)
    Write-Host ("  Faucet.bin            : {0} bytes ({1} static runtime bytes)" -f $FaucetInitBytes, $FaucetRtBytes)
}

Write-Host ""
Write-Host "[2/3] Offline ABI-Encoded Constructor & Seeding Calldata" -ForegroundColor Yellow
$EncodedCtor = (& $CastBin abi-encode "constructor(address,address,uint8,uint8,uint256,uint256,uint256)" `
    $BaseToken $QuoteToken "$BaseDecimals" "$QuoteDecimals" "$CommitWindowSecs" "$RevealWindowSecs" $MinBondWei).Trim()
$EncodedFaucetCtor = (& $CastBin abi-encode "constructor(address,address,uint256,uint256,uint256)" `
    $BaseToken $QuoteToken $FaucetBaseRaw $FaucetQuoteRaw "$FaucetCooldownSecs").Trim()
$SeedCalldata = (& $CastBin calldata "seedReserves(uint256,uint256)" $SeedBaseRaw $SeedQuoteRaw).Trim()

Write-Host ("  FairBatch Ctor Args   : {0}" -f $EncodedCtor)
Write-Host ("  Faucet Ctor Args      : {0}" -f $EncodedFaucetCtor)
Write-Host ("  seedReserves() Data   : {0}" -f $SeedCalldata)

Write-Host ""
Write-Host "[3/3] Global Deployment Configuration" -ForegroundColor Yellow
Write-Host "  Contract addresses are persisted automatically to config/deployment.json and deployments/sepolia.json by scripts/deploy_sepolia.ps1."
Write-Host ""
Write-Host "Dry-run complete. Zero external network calls were made." -ForegroundColor Green
