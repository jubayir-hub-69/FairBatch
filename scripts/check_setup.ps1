<#
.SYNOPSIS
    FairBatch Workspace, Artifact & Sepolia Configuration Readiness Inspector.

.DESCRIPTION
    Verifies project folder organization, local compiler/foundry/rust/node toolchains,
    compiled Fe 26.5.0 artifacts in `./out/`, global `config/deployment.json`,
    Rust backend & React frontend build readiness, and `.env` deployer key readiness
    WITHOUT ever printing secrets.
#>
[CmdletBinding()]
param(
    [string]$EnvFile = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($EnvFile)) {
    $EnvFile = Join-Path $RepoRoot ".env"
}

function Resolve-Tool([string]$Name) {
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -ne $cmd) { return $cmd.Source }
    $foundryBin = Join-Path $env:USERPROFILE ".foundry\bin\$Name.exe"
    if (Test-Path $foundryBin) { return $foundryBin }
    $cargoBin = Join-Path $env:USERPROFILE ".cargo\bin\$Name.exe"
    if (Test-Path $cargoBin) { return $cargoBin }
    return $null
}

function Read-DotEnv([string]$Path) {
    $map = @{}
    if (-not (Test-Path $Path)) { return $map }
    foreach ($rawLine in (Get-Content $Path)) {
        $line = $rawLine.Trim()
        if ($line.Length -eq 0 -or $line.StartsWith("#")) { continue }
        $eqIdx = $line.IndexOf("=")
        if ($eqIdx -lt 1) { continue }
        $k = $line.Substring(0, $eqIdx).Trim()
        $v = $line.Substring($eqIdx + 1).Trim()
        if (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) {
            $v = $v.Substring(1, $v.Length - 2)
        }
        $map[$k] = $v
    }
    return $map
}

Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host " FairBatch Workspace & Ethereum Sepolia Readiness Check" -ForegroundColor Cyan
Write-Host "========================================================================" -ForegroundColor Cyan

Write-Host "[1/5] Project Directory Structure ($RepoRoot)" -ForegroundColor Yellow
$RequiredDirs = @("src", "out", "backend", "frontend", "config", "deployments", "scripts", "docs")
foreach ($d in $RequiredDirs) {
    $p = Join-Path $RepoRoot $d
    $exists = Test-Path $p
    Write-Host ("  {0,-16} : {1}" -f "$d/", $(if ($exists) { "OK" } else { "MISSING" })) `
        -ForegroundColor $(if ($exists) { "Green" } else { "Red" })
    if (-not $exists) { throw "Missing required project directory: $p" }
}

Write-Host ""
Write-Host "[2/5] Local Toolchains" -ForegroundColor Yellow
$FeBin    = Resolve-Tool "fe"
$CastBin  = Resolve-Tool "cast"
$CargoBin = Resolve-Tool "cargo"
$NodeBin  = Resolve-Tool "node"

if ($FeBin)    { Write-Host ("  fe               : {0}" -f (& $FeBin --version).Trim()) } else { Write-Host "  fe               : NOT IN PATH (optional if out/ is built)" -ForegroundColor DarkYellow }
if ($CastBin)  { Write-Host ("  cast             : {0}" -f ((& $CastBin --version | Select-Object -First 1).Trim())) } else { throw "Missing Foundry 'cast'" }
if ($CargoBin) { Write-Host ("  cargo            : {0}" -f (& $CargoBin --version).Trim()) } else { throw "Missing Rust 'cargo'" }
if ($NodeBin)  { Write-Host ("  node             : {0}" -f (& $NodeBin --version).Trim()) } else { throw "Missing 'node'" }

Write-Host ""
Write-Host "[3/5] Compiled Fe 26.5.0 Contract Artifacts (./out/)" -ForegroundColor Yellow
$RequiredArtifacts = @(
    "FairBatch.bin",
    "FairBatch.runtime.bin",
    "FairBatch.abi.json",
    "Faucet.bin",
    "Faucet.runtime.bin",
    "Faucet.abi.json",
    "MockERC20.bin",
    "MockERC20.abi.json"
)
foreach ($art in $RequiredArtifacts) {
    $ap = Join-Path (Join-Path $RepoRoot "out") $art
    if (-not (Test-Path $ap)) {
        throw "Missing compiled artifact '$ap'. Run 'fe build' first."
    }
    $len = (Get-Item $ap).Length
    Write-Host ("  {0,-24} : PRESENT ({1} file bytes)" -f $art, $len) -ForegroundColor Green
}

Write-Host ""
Write-Host "[4/5] Backend Solver & Frontend Terminal Readiness" -ForegroundColor Yellow
$BackendCargoToml = Join-Path $RepoRoot "backend\Cargo.toml"
$FrontendPkgJson  = Join-Path $RepoRoot "frontend\package.json"
$FrontendNodeMods = Join-Path $RepoRoot "frontend\node_modules"
$FrontendDist     = Join-Path $RepoRoot "frontend\dist"

Write-Host ("  backend/Cargo.toml       : {0}" -f $(if (Test-Path $BackendCargoToml) { "OK" } else { "MISSING" }))
Write-Host ("  frontend/package.json    : {0}" -f $(if (Test-Path $FrontendPkgJson)  { "OK" } else { "MISSING" }))
Write-Host ("  frontend/node_modules    : {0}" -f $(if (Test-Path $FrontendNodeMods) { "INSTALLED" } else { "NOT INSTALLED (run 'npm install' in frontend/)" }))
Write-Host ("  frontend/dist            : {0}" -f $(if (Test-Path $FrontendDist)     { "BUILT" } else { "NOT BUILT (run 'npm run build' in frontend/)" }))

Write-Host ""
Write-Host "[5/5] Global Sepolia Deployment Config & Deployer Key Readiness" -ForegroundColor Yellow
$GlobalConfigPath = Join-Path $RepoRoot "config\deployment.json"
if (Test-Path $GlobalConfigPath) {
    $cfg = Get-Content -Raw $GlobalConfigPath | ConvertFrom-Json
    Write-Host ("  config/deployment.json   : PRESENT (chainId={0})" -f $cfg.chainId) -ForegroundColor Green
    Write-Host ("  FairBatch                : {0}" -f $cfg.contracts.fairBatch)
    Write-Host ("  Faucet                   : {0}" -f $cfg.contracts.faucet)
    Write-Host ("  Base Token (fWETH)       : {0}" -f $cfg.contracts.baseToken)
    Write-Host ("  Quote Token (fUSDC)      : {0}" -f $cfg.contracts.quoteToken)
} else {
    Write-Host "  config/deployment.json   : MISSING (run scripts/deploy_sepolia.ps1)" -ForegroundColor DarkYellow
}

$EnvMap = Read-DotEnv $EnvFile
$RawKey = if ($EnvMap.ContainsKey("DEPLOYER_PRIVATE_KEY")) { $EnvMap["DEPLOYER_PRIVATE_KEY"] } else { "" }
if ([string]::IsNullOrWhiteSpace($RawKey)) {
    Write-Host "  DEPLOYER_PRIVATE_KEY     : [NOT SET] (only needed for redeploying)" -ForegroundColor DarkYellow
} else {
    $normKey = if ($RawKey.StartsWith("0x")) { $RawKey } else { "0x$RawKey" }
    if ($normKey -match "^0x[0-9a-fA-F]{64}$") {
        $DerivedAddr = (& $CastBin wallet address --private-key $normKey).Trim()
        Write-Host ("  DEPLOYER_PRIVATE_KEY     : [READY] -> Public Deployer Address: {0}" -f $DerivedAddr) -ForegroundColor Green
    } else {
        throw "Malformed DEPLOYER_PRIVATE_KEY in .env."
    }
}

Write-Host ""
Write-Host "Setup verification complete!" -ForegroundColor Green
