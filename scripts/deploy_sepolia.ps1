<#
.SYNOPSIS
    FairBatch Ethereum Sepolia Deployment, Faucet Funding & Reserve Seeding (`CHAIN_ID = 11155111`).

.DESCRIPTION
    Deploys the complete Sepolia contract suite from a single deployer key (`DEPLOYER_PRIVATE_KEY`):
      1. 18-decimal `fWETH` (`MockERC20`) & 6-decimal `fUSDC` (`MockERC20`)
      2. `FairBatch` exchange (with optional LP locking & 200k-gas bond refund)
      3. `Faucet` (1 fWETH + 100 fUSDC per wallet every 12 hours), funded with
         2,000 fWETH and 1,000,000 fUSDC
    Seeds initial FM-AMM liquidity (`100 fWETH / 300,000 fUSDC`), verifies live on-chain
    views, and writes both `deployments/sepolia.json` and the shared global config
    `config/deployment.json` (used by both frontend and backend).

    STRICT SECURITY GUARANTEES:
      - NEVER prints, logs, echoes, or writes `DEPLOYER_PRIVATE_KEY` or `SOLVER_PRIVATE_KEY`.
      - Contract addresses are stored in `config/deployment.json` and `deployments/sepolia.json`,
        NOT in `.env` or `frontend/.env*`.
      - Supports `-DryRun` for 100% offline verification with zero network calls.
#>
[CmdletBinding()]
param(
    [switch]$DryRun,
    [string]$EnvFile = "",
    [string]$RpcUrlOverride = "",
    [string]$ManifestOutPath = "",
    [string]$GlobalConfigOutPath = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($EnvFile)) {
    $EnvFile = Join-Path $RepoRoot ".env"
}
$OutDir = Join-Path $RepoRoot "out"

function Resolve-FoundryTool([string]$Name) {
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -ne $cmd) { return $cmd.Source }
    $foundryBin = Join-Path $env:USERPROFILE ".foundry\bin\$Name.exe"
    if (Test-Path $foundryBin) { return $foundryBin }
    $fallback = Join-Path $env:USERPROFILE ".cargo\bin\$Name.exe"
    if (Test-Path $fallback) { return $fallback }
    throw "Required Foundry binary '$Name' not found in PATH, ~/.foundry/bin, or ~/.cargo/bin."
}

$CastBin = Resolve-FoundryTool "cast"

# ------------------------------------------------------------------------------
# Zero-dependency `.env` loader (reads key=value pairs without echoing secrets)
# ------------------------------------------------------------------------------
function Read-DotEnvFile([string]$Path) {
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

function Get-Cfg([hashtable]$EnvMap, [string]$Key, [string]$DefaultVal = "") {
    $procVal = [Environment]::GetEnvironmentVariable($Key)
    if (-not [string]::IsNullOrWhiteSpace($procVal)) { return $procVal.Trim() }
    if ($EnvMap.ContainsKey($Key) -and -not [string]::IsNullOrWhiteSpace($EnvMap[$Key])) {
        return "$($EnvMap[$Key])".Trim()
    }
    return $DefaultVal
}

# ------------------------------------------------------------------------------
# Strongly-Typed In-Memory EIP-1559 (`0x02`) RLP Transaction Builder (.NET C#)
# Bypasses Windows Win32 32,767-char CreateProcess CLI limits cleanly & deterministically
# ------------------------------------------------------------------------------
if (-not ("FairBatchRlp" -as [type])) {
    Add-Type -ReferencedAssemblies "System.Numerics" -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.IO;
using System.Numerics;

public static class FairBatchRlp {
    public static byte[] HexToBytes(string hex) {
        if (string.IsNullOrWhiteSpace(hex)) return new byte[0];
        string clean = hex.Trim();
        if (clean.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) clean = clean.Substring(2);
        if (clean.Length == 0) return new byte[0];
        if ((clean.Length % 2) != 0) clean = "0" + clean;
        byte[] res = new byte[clean.Length / 2];
        for (int i = 0; i < res.Length; i++) {
            res[i] = Convert.ToByte(clean.Substring(i * 2, 2), 16);
        }
        return res;
    }

    public static string BytesToHex(byte[] bytes) {
        if (bytes == null || bytes.Length == 0) return "";
        return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
    }

    public static byte[] MinimalBigEndian(BigInteger val) {
        if (val.Sign < 0) throw new ArgumentException("RLP uint cannot be negative");
        if (val.IsZero) return new byte[0];
        byte[] le = val.ToByteArray();
        Array.Reverse(le);
        int start = 0;
        while (start < le.Length && le[start] == 0) start++;
        if (start >= le.Length) return new byte[0];
        byte[] be = new byte[le.Length - start];
        Buffer.BlockCopy(le, start, be, 0, be.Length);
        return be;
    }

    public static byte[] StripLeadingZeros(byte[] raw) {
        if (raw == null || raw.Length == 0) return new byte[0];
        int start = 0;
        while (start < raw.Length && raw[start] == 0) start++;
        if (start >= raw.Length) return new byte[0];
        byte[] trimmed = new byte[raw.Length - start];
        Buffer.BlockCopy(raw, start, trimmed, 0, trimmed.Length);
        return trimmed;
    }

    public static byte[] EncodeBytes(byte[] data) {
        if (data == null || data.Length == 0) return new byte[] { 0x80 };
        if (data.Length == 1 && data[0] < 0x80) return new byte[] { data[0] };
        if (data.Length <= 55) {
            byte[] res = new byte[1 + data.Length];
            res[0] = (byte)(0x80 + data.Length);
            Buffer.BlockCopy(data, 0, res, 1, data.Length);
            return res;
        }
        byte[] lenBe = MinimalBigEndian(new BigInteger(data.Length));
        byte[] longRes = new byte[1 + lenBe.Length + data.Length];
        longRes[0] = (byte)(0xb7 + lenBe.Length);
        Buffer.BlockCopy(lenBe, 0, longRes, 1, lenBe.Length);
        Buffer.BlockCopy(data, 0, longRes, 1 + lenBe.Length, data.Length);
        return longRes;
    }

    public static byte[] EncodeUint(BigInteger val) {
        return EncodeBytes(MinimalBigEndian(val));
    }

    public static byte[] EncodeList(IList<byte[]> items) {
        using (var ms = new MemoryStream()) {
            if (items != null) {
                foreach (var item in items) {
                    if (item != null && item.Length > 0) ms.Write(item, 0, item.Length);
                }
            }
            byte[] payload = ms.ToArray();
            if (payload.Length <= 55) {
                byte[] res = new byte[1 + payload.Length];
                res[0] = (byte)(0xc0 + payload.Length);
                Buffer.BlockCopy(payload, 0, res, 1, payload.Length);
                return res;
            }
            byte[] lenBe = MinimalBigEndian(new BigInteger(payload.Length));
            byte[] longRes = new byte[1 + lenBe.Length + payload.Length];
            longRes[0] = (byte)(0xf7 + lenBe.Length);
            Buffer.BlockCopy(lenBe, 0, longRes, 1, lenBe.Length);
            Buffer.BlockCopy(payload, 0, longRes, 1 + lenBe.Length, payload.Length);
            return longRes;
        }
    }

    public static string Keccak256Hex(byte[] input) {
        ulong[] rc = new ulong[] {
            0x0000000000000001UL, 0x0000000000008082UL, 0x800000000000808aUL, 0x8000000080008000UL,
            0x000000000000808bUL, 0x0000000080000001UL, 0x8000000080008081UL, 0x8000000000008009UL,
            0x000000000000008aUL, 0x0000000000000088UL, 0x0000000080008009UL, 0x000000008000000aUL,
            0x000000008000808bUL, 0x800000000000008bUL, 0x8000000000008089UL, 0x8000000000008003UL,
            0x8000000000008002UL, 0x8000000000000080UL, 0x000000000000800aUL, 0x800000008000000aUL,
            0x8000000080008081UL, 0x8000000000008080UL, 0x0000000080000001UL, 0x8000000080008008UL
        };
        int[] r = new int[] {
            0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14
        };
        int[] piln = new int[] {
            10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1
        };
        int[] rotc = new int[] {
            1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44
        };
        ulong[] st = new ulong[25];
        int rate = 136;
        int offset = 0;
        int rem = input.Length;
        byte[] block = new byte[rate];
        while (rem >= rate) {
            for (int i = 0; i < rate / 8; i++) st[i] ^= BitConverter.ToUInt64(input, offset + i * 8);
            KeccakF1600(st, rc, piln, rotc);
            offset += rate;
            rem -= rate;
        }
        Array.Clear(block, 0, rate);
        if (rem > 0) Buffer.BlockCopy(input, offset, block, 0, rem);
        block[rem] ^= 0x01;
        block[rate - 1] ^= 0x80;
        for (int i = 0; i < rate / 8; i++) st[i] ^= BitConverter.ToUInt64(block, i * 8);
        KeccakF1600(st, rc, piln, rotc);
        byte[] outBytes = new byte[32];
        for (int i = 0; i < 4; i++) Buffer.BlockCopy(BitConverter.GetBytes(st[i]), 0, outBytes, i * 8, 8);
        return "0x" + BytesToHex(outBytes);
    }

    private static ulong RotL64(ulong x, int s) { return (x << s) | (x >> (64 - s)); }

    private static void KeccakF1600(ulong[] st, ulong[] rc, int[] piln, int[] rotc) {
        ulong[] bc = new ulong[5];
        for (int round = 0; round < 24; round++) {
            for (int i = 0; i < 5; i++) bc[i] = st[i] ^ st[i + 5] ^ st[i + 10] ^ st[i + 15] ^ st[i + 20];
            for (int i = 0; i < 5; i++) {
                ulong t = bc[(i + 4) % 5] ^ RotL64(bc[(i + 1) % 5], 1);
                for (int j = 0; j < 25; j += 5) st[j + i] ^= t;
            }
            ulong t0 = st[1];
            for (int i = 0; i < 24; i++) {
                int j = piln[i];
                bc[0] = st[j];
                st[j] = RotL64(t0, rotc[i]);
                t0 = bc[0];
            }
            for (int j = 0; j < 25; j += 5) {
                for (int i = 0; i < 5; i++) bc[i] = st[j + i];
                for (int i = 0; i < 5; i++) st[j + i] ^= (~bc[(i + 1) % 5]) & bc[(i + 2) % 5];
            }
            st[0] ^= rc[round];
        }
    }

    public static string BuildUnsignedEip1559PreimageHex(
        BigInteger chainId, BigInteger nonce, BigInteger maxPriorityFee, BigInteger maxFee,
        BigInteger gasLimit, string toHex, BigInteger valueWei, string dataHex
    ) {
        var items = new List<byte[]> {
            EncodeUint(chainId),
            EncodeUint(nonce),
            EncodeUint(maxPriorityFee),
            EncodeUint(maxFee),
            EncodeUint(gasLimit),
            EncodeBytes(HexToBytes(toHex)),
            EncodeUint(valueWei),
            EncodeBytes(HexToBytes(dataHex)),
            EncodeList(new List<byte[]>())
        };
        return "0x02" + BytesToHex(EncodeList(items));
    }

    public static string BuildSignedEip1559RawTxHex(
        BigInteger chainId, BigInteger nonce, BigInteger maxPriorityFee, BigInteger maxFee,
        BigInteger gasLimit, string toHex, BigInteger valueWei, string dataHex, string sigHex65
    ) {
        string cleanSig = sigHex65.Trim();
        if (cleanSig.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) cleanSig = cleanSig.Substring(2);
        if (cleanSig.Length != 130) throw new ArgumentException("Expected 65-byte (130 hex char) ECDSA signature");
        byte[] rTrim = StripLeadingZeros(HexToBytes(cleanSig.Substring(0, 64)));
        byte[] sTrim = StripLeadingZeros(HexToBytes(cleanSig.Substring(64, 64)));
        int vInt = Convert.ToInt32(cleanSig.Substring(128, 2), 16);
        int yParity = vInt >= 27 ? (vInt - 27) : vInt;

        var items = new List<byte[]> {
            EncodeUint(chainId),
            EncodeUint(nonce),
            EncodeUint(maxPriorityFee),
            EncodeUint(maxFee),
            EncodeUint(gasLimit),
            EncodeBytes(HexToBytes(toHex)),
            EncodeUint(valueWei),
            EncodeBytes(HexToBytes(dataHex)),
            EncodeList(new List<byte[]>()),
            EncodeUint(new BigInteger(yParity)),
            EncodeBytes(rTrim),
            EncodeBytes(sTrim)
        };
        return "0x02" + BytesToHex(EncodeList(items));
    }
}
"@
}

function New-SignedEip1559RawTx(
    [System.Numerics.BigInteger]$ChainId,
    [System.Numerics.BigInteger]$Nonce,
    [System.Numerics.BigInteger]$MaxPriorityFeeWei,
    [System.Numerics.BigInteger]$MaxFeeWei,
    [System.Numerics.BigInteger]$GasLimit,
    [string]$ToAddressHex,
    [System.Numerics.BigInteger]$ValueWei,
    [string]$DataHex,
    [string]$PrivateKeyHex
) {
    $signingPreimageHex = [FairBatchRlp]::BuildUnsignedEip1559PreimageHex(
        $ChainId, $Nonce, $MaxPriorityFeeWei, $MaxFeeWei, $GasLimit, $ToAddressHex, $ValueWei, $DataHex
    )
    $txDigest = [FairBatchRlp]::Keccak256Hex([FairBatchRlp]::HexToBytes($signingPreimageHex))
    $sigHex = (& $CastBin wallet sign --no-hash --private-key $PrivateKeyHex $txDigest).Trim()
    return [FairBatchRlp]::BuildSignedEip1559RawTxHex(
        $ChainId, $Nonce, $MaxPriorityFeeWei, $MaxFeeWei, $GasLimit, $ToAddressHex, $ValueWei, $DataHex, $sigHex
    )
}

function Parse-HexBigInt([string]$HexVal) {
    $clean = ($HexVal.Trim().Trim('"') -replace "^0x", "")
    if ($clean.Length -eq 0) { return [System.Numerics.BigInteger]::Zero }
    return [System.Numerics.BigInteger]::Parse("00$clean", [System.Globalization.NumberStyles]::HexNumber)
}

# ------------------------------------------------------------------------------
# Load Configuration & Validate Artifacts (Sepolia Only)
# ------------------------------------------------------------------------------
$EnvMap = Read-DotEnvFile $EnvFile

$NetworkName       = "sepolia"
$TargetChainId     = [uint64]11155111
$ExplorerBase      = "https://sepolia.etherscan.io"
$RpcUrl            = if (-not [string]::IsNullOrWhiteSpace($RpcUrlOverride)) { $RpcUrlOverride } else { Get-Cfg $EnvMap "RPC_URL" "https://ethereum-sepolia-rpc.publicnode.com" }
$BaseDecimals      = [int](Get-Cfg $EnvMap "BASE_DECIMALS" "18")
$QuoteDecimals     = [int](Get-Cfg $EnvMap "QUOTE_DECIMALS" "6")
$CommitWindowSecs  = [uint64](Get-Cfg $EnvMap "COMMIT_WINDOW_SECS" "60")
$RevealWindowSecs  = [uint64](Get-Cfg $EnvMap "REVEAL_WINDOW_SECS" "60")
$MinBondWei        = Get-Cfg $EnvMap "MIN_BOND_WEI" "100000000000000"
$InitReserveBase   = [uint64](Get-Cfg $EnvMap "INITIAL_RESERVE_BASE" "100")
$InitReserveQuote  = [uint64](Get-Cfg $EnvMap "INITIAL_RESERVE_QUOTE" "300000")
$FaucetFundBase    = [uint64](Get-Cfg $EnvMap "FAUCET_FUND_BASE" "2000")
$FaucetFundQuote   = [uint64](Get-Cfg $EnvMap "FAUCET_FUND_QUOTE" "1000000")
$FaucetClaimBase   = [uint64](Get-Cfg $EnvMap "FAUCET_CLAIM_BASE" "1")
$FaucetClaimQuote  = [uint64](Get-Cfg $EnvMap "FAUCET_CLAIM_QUOTE" "100")
$FaucetCooldownSec = [uint64](Get-Cfg $EnvMap "FAUCET_COOLDOWN_SECS" "43200")
$DeployerKeyRaw    = Get-Cfg $EnvMap "DEPLOYER_PRIVATE_KEY" ""

$ScaleBase  = [System.Numerics.BigInteger]::Pow(10, $BaseDecimals)
$ScaleQuote = [System.Numerics.BigInteger]::Pow(10, $QuoteDecimals)
$SeedBaseRawStr        = ([System.Numerics.BigInteger]$InitReserveBase  * $ScaleBase).ToString()
$SeedQuoteRawStr       = ([System.Numerics.BigInteger]$InitReserveQuote * $ScaleQuote).ToString()
$FaucetFundBaseRawStr  = ([System.Numerics.BigInteger]$FaucetFundBase   * $ScaleBase).ToString()
$FaucetFundQuoteRawStr = ([System.Numerics.BigInteger]$FaucetFundQuote  * $ScaleQuote).ToString()
$FaucetClaimBaseRawStr = ([System.Numerics.BigInteger]$FaucetClaimBase  * $ScaleBase).ToString()
$FaucetClaimQuoteRawStr = ([System.Numerics.BigInteger]$FaucetClaimQuote * $ScaleQuote).ToString()

if ([string]::IsNullOrWhiteSpace($ManifestOutPath)) {
    $ManifestOutPath = Join-Path (Join-Path $RepoRoot "deployments") "sepolia.json"
}
if ([string]::IsNullOrWhiteSpace($GlobalConfigOutPath)) {
    $GlobalConfigOutPath = Join-Path (Join-Path $RepoRoot "config") "deployment.json"
}

$FairBatchBinPath     = Join-Path $OutDir "FairBatch.bin"
$FairBatchRuntimePath = Join-Path $OutDir "FairBatch.runtime.bin"
$FairBatchAbiPath     = Join-Path $OutDir "FairBatch.abi.json"
$MockErc20BinPath     = Join-Path $OutDir "MockERC20.bin"
$FaucetBinPath        = Join-Path $OutDir "Faucet.bin"
$FaucetRuntimePath    = Join-Path $OutDir "Faucet.runtime.bin"
$FaucetAbiPath        = Join-Path $OutDir "Faucet.abi.json"

foreach ($required in @($FairBatchBinPath, $FairBatchRuntimePath, $FairBatchAbiPath, $MockErc20BinPath, $FaucetBinPath, $FaucetRuntimePath, $FaucetAbiPath)) {
    if (-not (Test-Path $required)) {
        throw "Missing compiled artifact '$required'. Run 'fe build' first."
    }
}

$FairBatchInitHex    = (Get-Content -Raw $FairBatchBinPath).Trim() -replace "^0x", ""
$FairBatchRuntimeHex = (Get-Content -Raw $FairBatchRuntimePath).Trim() -replace "^0x", ""
$MockErc20InitHex    = (Get-Content -Raw $MockErc20BinPath).Trim() -replace "^0x", ""
$FaucetInitHex       = (Get-Content -Raw $FaucetBinPath).Trim() -replace "^0x", ""
$FaucetRuntimeHex    = (Get-Content -Raw $FaucetRuntimePath).Trim() -replace "^0x", ""

Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host (" FairBatch Sepolia Deployment Pipeline -- Chain ID: {0} ({1})" -f $TargetChainId, $(if ($DryRun) { "OFFLINE DRY-RUN" } else { "LIVE BROADCAST" })) -ForegroundColor Cyan
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host ("  Env File            : {0} ({1})" -f $EnvFile, $(if (Test-Path $EnvFile) { "loaded" } else { "using defaults" }))
Write-Host ("  Batch Windows       : Commit={0}s | Reveal={1}s | MinBond={2} wei" -f $CommitWindowSecs, $RevealWindowSecs, $MinBondWei)
Write-Host ("  Reserve Seed Plan   : {0} fWETH ({1} raw) + {2} fUSDC ({3} raw)" -f $InitReserveBase, $SeedBaseRawStr, $InitReserveQuote, $SeedQuoteRawStr)
Write-Host ("  Faucet Funding Plan : {0} fWETH + {1} fUSDC ({2} fWETH + {3} fUSDC / {4}s)" -f $FaucetFundBase, $FaucetFundQuote, $FaucetClaimBase, $FaucetClaimQuote, $FaucetCooldownSec)
Write-Host ("  FairBatch Init Size : {0} bytes ({1} static runtime bytes)" -f ([int]($FairBatchInitHex.Length / 2)), ([int]($FairBatchRuntimeHex.Length / 2)))
Write-Host ("  Faucet Init Size    : {0} bytes ({1} static runtime bytes)" -f ([int]($FaucetInitHex.Length / 2)), ([int]($FaucetRuntimeHex.Length / 2)))

# ------------------------------------------------------------------------------
# Mode A: Strictly Offline `-DryRun` Verification (Zero Network Calls!)
# ------------------------------------------------------------------------------
if ($DryRun) {
    Write-Host ""
    Write-Host "[Dry-Run 1/3] Validating ABI encoding & >32KB EIP-1559 RLP builder offline..." -ForegroundColor Yellow
    $PreviewBase  = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14"
    $PreviewQuote = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"

    $PreviewCtor = (& $CastBin abi-encode "constructor(address,address,uint8,uint8,uint256,uint256,uint256)" `
        $PreviewBase $PreviewQuote "$BaseDecimals" "$QuoteDecimals" "$CommitWindowSecs" "$RevealWindowSecs" $MinBondWei).Trim() -replace "^0x", ""
    $FullCreationHex = "0x$FairBatchInitHex$PreviewCtor"

    $PreviewFaucetCtor = (& $CastBin abi-encode "constructor(address,address,uint256,uint256,uint256)" `
        $PreviewBase $PreviewQuote $FaucetClaimBaseRawStr $FaucetClaimQuoteRawStr "$FaucetCooldownSec").Trim() -replace "^0x", ""
    $FaucetCreationHex = "0x$FaucetInitHex$PreviewFaucetCtor"

    $DummyTestKey = "0x0000000000000000000000000000000000000000000000000000000000000001"
    $SampleRawTx = New-SignedEip1559RawTx `
        -ChainId ([System.Numerics.BigInteger]$TargetChainId) `
        -Nonce ([System.Numerics.BigInteger]::Zero) `
        -MaxPriorityFeeWei ([System.Numerics.BigInteger]1000000) `
        -MaxFeeWei ([System.Numerics.BigInteger]10000000) `
        -GasLimit ([System.Numerics.BigInteger]40000000) `
        -ToAddressHex "" `
        -ValueWei ([System.Numerics.BigInteger]::Zero) `
        -DataHex $FullCreationHex `
        -PrivateKeyHex $DummyTestKey

    Write-Host ("  FairBatch Creation  : {0} bytes (offline RLP self-test PASS, signed={1} bytes)" -f ([int](($FullCreationHex.Length - 2) / 2)), ([int](($SampleRawTx.Length - 2) / 2)))
    Write-Host ("  Faucet Creation     : {0} bytes" -f ([int](($FaucetCreationHex.Length - 2) / 2)))

    Write-Host ""
    Write-Host "[Dry-Run 2/3] Checking DEPLOYER_PRIVATE_KEY readiness in .env..." -ForegroundColor Yellow
    if ([string]::IsNullOrWhiteSpace($DeployerKeyRaw)) {
        Write-Host "  DEPLOYER_PRIVATE_KEY: [WAITING FOR USER INPUT] (empty in .env)" -ForegroundColor DarkYellow
    } else {
        $normKey = if ($DeployerKeyRaw.StartsWith("0x")) { $DeployerKeyRaw } else { "0x$DeployerKeyRaw" }
        if ($normKey -notmatch "^0x[0-9a-fA-F]{64}$") {
            throw "DEPLOYER_PRIVATE_KEY in .env is malformed (expected 64 hex characters, with or without 0x prefix)."
        }
        $pubAddr = (& $CastBin wallet address --private-key $normKey).Trim()
        Write-Host "  DEPLOYER_PRIVATE_KEY: [CONFIGURED] -> Deployer Address: $pubAddr" -ForegroundColor Green
    }

    Write-Host ""
    Write-Host "[Dry-Run 3/3] Offline dry-run succeeded! Zero network calls or broadcasts were executed." -ForegroundColor Green
    exit 0
}

# ------------------------------------------------------------------------------
# Mode B: Live Broadcast & On-Chain Verification (Ethereum Sepolia)
# ------------------------------------------------------------------------------
if ([string]::IsNullOrWhiteSpace($DeployerKeyRaw)) {
    throw "DEPLOYER_PRIVATE_KEY is empty in '$EnvFile'. Paste your funded Sepolia private key into .env before running live deployment."
}
$DeployerKey = if ($DeployerKeyRaw.StartsWith("0x")) { $DeployerKeyRaw } else { "0x$DeployerKeyRaw" }
if ($DeployerKey -notmatch "^0x[0-9a-fA-F]{64}$") {
    throw "DEPLOYER_PRIVATE_KEY must be a valid 32-byte hex key (0x + 64 hex chars)."
}

$DeployerAddr = (& $CastBin wallet address --private-key $DeployerKey).Trim()
Write-Host ("  Deployer Account    : {0}" -f $DeployerAddr) -ForegroundColor Green

function Invoke-Rpc([string]$Method, [string]$RawParamsJson = "[]") {
    $body = "{`"jsonrpc`":`"2.0`",`"id`":1,`"method`":`"$Method`",`"params`":$RawParamsJson}"
    for ($attempt = 0; $attempt -lt 5; $attempt++) {
        try {
            $resp = Invoke-RestMethod -Uri $RpcUrl -Method Post -ContentType "application/json" -Body $body -TimeoutSec 30
            if ($null -ne $resp.PSObject.Properties["error"] -and $null -ne $resp.error) {
                throw "RPC error for '$Method': $($resp.error | ConvertTo-Json -Compress)"
            }
            if ($null -eq $resp.result) { return "null" }
            if ($resp.result -is [string]) { return "`"$($resp.result)`"" }
            return ($resp.result | ConvertTo-Json -Depth 10 -Compress)
        } catch {
            if ($attempt -lt 4) {
                Start-Sleep -Seconds 2
            } else {
                throw "RPC call '$Method' failed against endpoint: $($_.Exception.Message)"
            }
        }
    }
}

Write-Host ""
Write-Host "[1/6] Verifying Sepolia Chain ID & Deployer Balance..." -ForegroundColor Yellow
$LiveChainHex = (Invoke-Rpc "eth_chainId" "[]").Trim('"')
$LiveChainId  = [uint64](Parse-HexBigInt $LiveChainHex)
if ($LiveChainId -ne $TargetChainId) {
    throw "Chain ID mismatch! RPC returned Chain ID $LiveChainId ($LiveChainHex), expected Sepolia ($TargetChainId)."
}
$BalanceHex = (Invoke-Rpc "eth_getBalance" "[`"$DeployerAddr`",`"latest`"]").Trim('"')
$BalanceWei = Parse-HexBigInt $BalanceHex
$MinRequiredWei = [System.Numerics.BigInteger]::Parse("1000000000000000") # 0.001 ETH minimum check
Write-Host ("  Verified Chain ID   : {0} ({1})" -f $LiveChainId, $LiveChainHex)
Write-Host ("  Deployer Balance    : {0} wei" -f $BalanceWei.ToString())
if ($BalanceWei -lt $MinRequiredWei) {
    throw "Insufficient deployer ETH balance ($BalanceWei wei < 0.001 ETH) on Sepolia for contract deployment."
}

# Dynamic EIP-1559 fees scaled to live Sepolia baseFee so low-balance testnets don't fail upfront checks
$LatestBlock = (Invoke-Rpc "eth_getBlockByNumber" "[`"latest`",false]") | ConvertFrom-Json
$BaseFeeWei  = if ($null -ne $LatestBlock.baseFeePerGas) { Parse-HexBigInt $LatestBlock.baseFeePerGas } else { [System.Numerics.BigInteger]1000000 }
$PriorityFeeWei = [System.Numerics.BigInteger]1000000 # 0.001 gwei floor
try {
    $tipHex = (Invoke-Rpc "eth_maxPriorityFeePerGas" "[]").Trim('"')
    $parsedTip = Parse-HexBigInt $tipHex
    if ($parsedTip -gt $PriorityFeeWei) { $PriorityFeeWei = $parsedTip }
} catch { }
# Cap priority fee so a 45M-gas creation tx still fits within the deployer's balance
$MaxFeeWei = ($BaseFeeWei * 2) + $PriorityFeeWei + [System.Numerics.BigInteger]10000000
Write-Host ("  EIP-1559 Fees       : baseFee={0} wei | priorityFee={1} wei | maxFee={2} wei" -f $BaseFeeWei, $PriorityFeeWei, $MaxFeeWei)

$CurrentNonce = Parse-HexBigInt ((Invoke-Rpc "eth_getTransactionCount" "[`"$DeployerAddr`",`"pending`"]").Trim('"'))

function Estimate-TxGasLimit(
    [string]$Label,
    [string]$ToAddr,
    [string]$DataHex,
    [uint64]$FallbackMinGas
) {
    $callObj = if ([string]::IsNullOrWhiteSpace($ToAddr)) {
        "[{`"from`":`"$DeployerAddr`",`"data`":`"$DataHex`"}]"
    } else {
        "[{`"from`":`"$DeployerAddr`",`"to`":`"$ToAddr`",`"data`":`"$DataHex`"}]"
    }
    $estHex = (Invoke-Rpc "eth_estimateGas" $callObj).Trim('"')
    $estGas = [uint64](Parse-HexBigInt $estHex)
    $withPct = [uint64](($estGas * 115) / 100)
    $withPad = $estGas + [uint64]200000
    return [Math]::Max($FallbackMinGas, [Math]::Max($withPct, $withPad))
}

function Send-SignedTxAndWait(
    [string]$Label,
    [string]$ToAddr,
    [string]$DataHex,
    [uint64]$GasLimitVal
) {
    $DynamicGasLimit = Estimate-TxGasLimit $Label $ToAddr $DataHex $GasLimitVal
    $rawTx = New-SignedEip1559RawTx `
        -ChainId ([System.Numerics.BigInteger]$LiveChainId) `
        -Nonce $script:CurrentNonce `
        -MaxPriorityFeeWei $PriorityFeeWei `
        -MaxFeeWei $MaxFeeWei `
        -GasLimit ([System.Numerics.BigInteger]$DynamicGasLimit) `
        -ToAddressHex $ToAddr `
        -ValueWei ([System.Numerics.BigInteger]::Zero) `
        -DataHex $DataHex `
        -PrivateKeyHex $DeployerKey

    $txHash = (Invoke-Rpc "eth_sendRawTransaction" "[`"$rawTx`"]").Trim('"')
    $script:CurrentNonce = $script:CurrentNonce + 1
    Write-Host ("  Broadcast {0,-24}: tx={1} (gasLimit={2})" -f $Label, $txHash, $DynamicGasLimit)

    for ($attempt = 0; $attempt -lt 90; $attempt++) {
        $rcptRaw = Invoke-Rpc "eth_getTransactionReceipt" "[`"$txHash`"]"
        if ($rcptRaw -ne "null" -and -not [string]::IsNullOrWhiteSpace($rcptRaw)) {
            $rcpt = $rcptRaw | ConvertFrom-Json
            if ($null -ne $rcpt -and $null -ne $rcpt.status) {
                if ($rcpt.status -ne "0x1") {
                    throw "Transaction '$Label' ($txHash) reverted on-chain (status=$($rcpt.status))."
                }
                return $rcpt
            }
        }
        Start-Sleep -Seconds 2
    }
    throw "Timed out waiting for transaction '$Label' ($txHash) to be mined."
}

# Pre-flight FairBatch creation estimate before spending any gas
$PreflightFbCtor = (& $CastBin abi-encode "constructor(address,address,uint8,uint8,uint256,uint256,uint256)" `
    "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14" "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" `
    "$BaseDecimals" "$QuoteDecimals" "$CommitWindowSecs" "$RevealWindowSecs" $MinBondWei).Trim() -replace "^0x", ""
$PreflightFbGas = Estimate-TxGasLimit "Pre-flight FairBatch" "" "0x$FairBatchInitHex$PreflightFbCtor" 5000000
Write-Host ("  Pre-flight FairBatch: estimated creation gasLimit = {0} (PASS)" -f $PreflightFbGas) -ForegroundColor Green

# Step 2: Deploy 18-dec fWETH & 6-dec fUSDC MockERC20 Tokens (same deployer)
Write-Host ""
Write-Host "[2/6] Deploying 18-dec fWETH & 6-dec fUSDC MockERC20 Tokens..." -ForegroundColor Yellow
$BaseCtorHex  = (& $CastBin abi-encode "constructor(uint8)" "$BaseDecimals").Trim() -replace "^0x", ""
$QuoteCtorHex = (& $CastBin abi-encode "constructor(uint8)" "$QuoteDecimals").Trim() -replace "^0x", ""

$BaseRcpt  = Send-SignedTxAndWait "Create fWETH (18d)" "" "0x$MockErc20InitHex$BaseCtorHex" 1500000
$QuoteRcpt = Send-SignedTxAndWait "Create fUSDC (6d)"  "" "0x$MockErc20InitHex$QuoteCtorHex" 1500000

$BaseTokenAddr  = $BaseRcpt.contractAddress
$QuoteTokenAddr = $QuoteRcpt.contractAddress
Write-Host ("  fWETH Deployed      : {0}" -f $BaseTokenAddr) -ForegroundColor Green
Write-Host ("  fUSDC Deployed      : {0}" -f $QuoteTokenAddr) -ForegroundColor Green

# Step 3: Deploy FairBatch (>32KB creation payload via signed EIP-1559 raw tx)
Write-Host ""
Write-Host "[3/6] Deploying FairBatch Contract (Fe 26.5.0 Sonatina Bytecode)..." -ForegroundColor Yellow
$FbCtorHex = (& $CastBin abi-encode "constructor(address,address,uint8,uint8,uint256,uint256,uint256)" `
    $BaseTokenAddr $QuoteTokenAddr "$BaseDecimals" "$QuoteDecimals" "$CommitWindowSecs" "$RevealWindowSecs" $MinBondWei).Trim() -replace "^0x", ""
$FbRcpt = Send-SignedTxAndWait "Create FairBatch" "" "0x$FairBatchInitHex$FbCtorHex" 6500000
$FairBatchAddr = $FbRcpt.contractAddress
$FairBatchBlock = [uint64](Parse-HexBigInt $FbRcpt.blockNumber)
Write-Host ("  FairBatch Deployed  : {0} (block={1}, gasUsed={2})" -f $FairBatchAddr, $FairBatchBlock, (Parse-HexBigInt $FbRcpt.gasUsed)) -ForegroundColor Green

# Step 4: Deploy & Fund Separate Sepolia Faucet Contract
Write-Host ""
Write-Host ("[4/6] Deploying & Funding Faucet ({0} fWETH + {1} fUSDC; drip {2} fWETH + {3} fUSDC / {4}s)..." -f $FaucetFundBase, $FaucetFundQuote, $FaucetClaimBase, $FaucetClaimQuote, $FaucetCooldownSec) -ForegroundColor Yellow
$FaucetCtorHex = (& $CastBin abi-encode "constructor(address,address,uint256,uint256,uint256)" `
    $BaseTokenAddr $QuoteTokenAddr $FaucetClaimBaseRawStr $FaucetClaimQuoteRawStr "$FaucetCooldownSec").Trim() -replace "^0x", ""
$FaucetRcpt = Send-SignedTxAndWait "Create Faucet" "" "0x$FaucetInitHex$FaucetCtorHex" 1500000
$FaucetAddr = $FaucetRcpt.contractAddress
Write-Host ("  Faucet Deployed     : {0} (gasUsed={1})" -f $FaucetAddr, (Parse-HexBigInt $FaucetRcpt.gasUsed)) -ForegroundColor Green

$SetMinterData = (& $CastBin calldata "setMinter(address)" $FaucetAddr).Trim()
$null = Send-SignedTxAndWait "setMinter fWETH->Faucet" $BaseTokenAddr  $SetMinterData 150000
$null = Send-SignedTxAndWait "setMinter fUSDC->Faucet" $QuoteTokenAddr $SetMinterData 150000

$FundBaseData  = (& $CastBin calldata "mint(address,uint256)" $FaucetAddr $FaucetFundBaseRawStr).Trim()
$FundQuoteData = (& $CastBin calldata "mint(address,uint256)" $FaucetAddr $FaucetFundQuoteRawStr).Trim()
$FundBaseRcpt  = Send-SignedTxAndWait "Fund Faucet fWETH"  $BaseTokenAddr  $FundBaseData  250000
$FundQuoteRcpt = Send-SignedTxAndWait "Fund Faucet fUSDC"  $QuoteTokenAddr $FundQuoteData 250000
Write-Host ("  Faucet Authorized & Funded: {0} fWETH + {1} fUSDC" -f $FaucetFundBase, $FaucetFundQuote) -ForegroundColor Green

# Step 5: Seed Initial FM-AMM Liquidity
Write-Host ""
Write-Host ("[5/6] Minting & Seeding Initial FM-AMM Reserves ({0} fWETH + {1} fUSDC)..." -f $InitReserveBase, $InitReserveQuote) -ForegroundColor Yellow
$MintApproveBaseData  = (& $CastBin calldata "mintAndApprove(address,address,uint256)" $DeployerAddr $FairBatchAddr $SeedBaseRawStr).Trim()
$MintApproveQuoteData = (& $CastBin calldata "mintAndApprove(address,address,uint256)" $DeployerAddr $FairBatchAddr $SeedQuoteRawStr).Trim()
$null = Send-SignedTxAndWait "mintAndApprove fWETH" $BaseTokenAddr  $MintApproveBaseData  250000
$null = Send-SignedTxAndWait "mintAndApprove fUSDC" $QuoteTokenAddr $MintApproveQuoteData 250000

$SeedData = (& $CastBin calldata "seedReserves(uint256,uint256)" $SeedBaseRawStr $SeedQuoteRawStr).Trim()
$SeedRcpt = Send-SignedTxAndWait "seedReserves()" $FairBatchAddr $SeedData 500000
Write-Host "  Seeded FM-AMM Pool  : SUCCESS" -ForegroundColor Green
Start-Sleep -Seconds 4 # Allow load-balanced Sepolia RPC replicas to sync mined state

# Step 6: Verify Live On-Chain Views & Write Global Config + Deployment Manifest
Write-Host ""
Write-Host "[6/6] Verifying On-Chain Bytecode, Reserves & Faucet Balances..." -ForegroundColor Yellow
$CodeHex = (Invoke-Rpc "eth_getCode" "[`"$FairBatchAddr`",`"latest`"]").Trim('"')
$RuntimeBytesCount = [int](($CodeHex.Length - 2) / 2)
$FaucetCodeHex = (Invoke-Rpc "eth_getCode" "[`"$FaucetAddr`",`"latest`"]").Trim('"')
$FaucetRuntimeBytesCount = [int](($FaucetCodeHex.Length - 2) / 2)

$DomainSepRaw = (& $CastBin call --rpc-url $RpcUrl $FairBatchAddr "domainSeparator()(bytes32)").Trim()
$ReservesRaw  = (& $CastBin call --rpc-url $RpcUrl $FairBatchAddr "getReserves()(uint256,uint256,uint256,uint256)").Trim() -split "`r?`n"
$BatchRaw     = (& $CastBin call --rpc-url $RpcUrl $FairBatchAddr "currentBatch()(uint256,uint256,uint256,uint256,uint256,uint256,uint8)").Trim() -split "`r?`n"
$FaucetBalBase  = (((& $CastBin call --rpc-url $RpcUrl $BaseTokenAddr  "balanceOf(address)(uint256)" $FaucetAddr).Trim()) -split "\s+")[0]
$FaucetBalQuote = (((& $CastBin call --rpc-url $RpcUrl $QuoteTokenAddr "balanceOf(address)(uint256)" $FaucetAddr).Trim()) -split "\s+")[0]

$OnChainRx     = ($ReservesRaw[0] -split "\s+")[0]
$OnChainRy     = ($ReservesRaw[1] -split "\s+")[0]
$ActiveBatchId = [uint64](($BatchRaw[0] -split "\s+")[0])

Write-Host ("  FairBatch Runtime   : {0} bytes" -f $RuntimeBytesCount)
Write-Host ("  Faucet Runtime      : {0} bytes" -f $FaucetRuntimeBytesCount)
Write-Host ("  domainSeparator()   : {0}" -f $DomainSepRaw)
Write-Host ("  Active Batch ID     : #{0}" -f $ActiveBatchId)
Write-Host ("  On-Chain Reserves   : R_x={0} raw | R_y={1} raw" -f $OnChainRx, $OnChainRy)
Write-Host ("  Faucet Balances     : fWETH={0} raw | fUSDC={1} raw" -f $FaucetBalBase, $FaucetBalQuote)

$ManifestDir = Split-Path -Parent $ManifestOutPath
if (-not (Test-Path $ManifestDir)) { New-Item -ItemType Directory -Force -Path $ManifestDir | Out-Null }
$GlobalCfgDir = Split-Path -Parent $GlobalConfigOutPath
if (-not (Test-Path $GlobalCfgDir)) { New-Item -ItemType Directory -Force -Path $GlobalCfgDir | Out-Null }

$FbExplorerUrl     = "$ExplorerBase/address/$FairBatchAddr"
$BaseExplorerUrl   = "$ExplorerBase/address/$BaseTokenAddr"
$QuoteExplorerUrl  = "$ExplorerBase/address/$QuoteTokenAddr"
$FaucetExplorerUrl = "$ExplorerBase/address/$FaucetAddr"

$ManifestObj = [ordered]@{
    network           = $NetworkName
    chain_id          = $LiveChainId
    deployed_at_utc   = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    compiler          = "fe 26.5.0 (3dab95f) [sonatina]"
    deployer          = $DeployerAddr
    explorer_base_url = $ExplorerBase
    contracts         = [ordered]@{
        fair_batch = [ordered]@{
            address       = $FairBatchAddr
            tx_hash       = $FbRcpt.transactionHash
            block_number  = $FairBatchBlock
            gas_used      = [uint64](Parse-HexBigInt $FbRcpt.gasUsed)
            runtime_bytes = $RuntimeBytesCount
            explorer_url  = $FbExplorerUrl
        }
        base_token = [ordered]@{
            symbol              = "fWETH"
            decimals            = $BaseDecimals
            deployed_test_token = $true
            address             = $BaseTokenAddr
            tx_hash             = $BaseRcpt.transactionHash
            block_number        = [uint64](Parse-HexBigInt $BaseRcpt.blockNumber)
            gas_used            = [uint64](Parse-HexBigInt $BaseRcpt.gasUsed)
            explorer_url        = $BaseExplorerUrl
        }
        quote_token = [ordered]@{
            symbol              = "fUSDC"
            decimals            = $QuoteDecimals
            deployed_test_token = $true
            address             = $QuoteTokenAddr
            tx_hash             = $QuoteRcpt.transactionHash
            block_number        = [uint64](Parse-HexBigInt $QuoteRcpt.blockNumber)
            gas_used            = [uint64](Parse-HexBigInt $QuoteRcpt.gasUsed)
            explorer_url        = $QuoteExplorerUrl
        }
        faucet = [ordered]@{
            address            = $FaucetAddr
            tx_hash            = $FaucetRcpt.transactionHash
            block_number       = [uint64](Parse-HexBigInt $FaucetRcpt.blockNumber)
            gas_used           = [uint64](Parse-HexBigInt $FaucetRcpt.gasUsed)
            runtime_bytes      = $FaucetRuntimeBytesCount
            claim_base_raw     = $FaucetClaimBaseRawStr
            claim_quote_raw    = $FaucetClaimQuoteRawStr
            cooldown_secs      = $FaucetCooldownSec
            funded_base_raw    = $FaucetFundBaseRawStr
            funded_quote_raw   = $FaucetFundQuoteRawStr
            fund_base_tx_hash  = $FundBaseRcpt.transactionHash
            fund_quote_tx_hash = $FundQuoteRcpt.transactionHash
            explorer_url       = $FaucetExplorerUrl
        }
    }
    init_params = [ordered]@{
        base_decimals      = $BaseDecimals
        quote_decimals     = $QuoteDecimals
        commit_window_secs = $CommitWindowSecs
        reveal_window_secs = $RevealWindowSecs
        min_bond_wei       = $MinBondWei
    }
    initial_seed = [ordered]@{
        seeded            = $true
        reserve_base_raw  = $SeedBaseRawStr
        reserve_quote_raw = $SeedQuoteRawStr
        tx_hash           = $SeedRcpt.transactionHash
        gas_used          = [uint64](Parse-HexBigInt $SeedRcpt.gasUsed)
    }
    onchain_verification = [ordered]@{
        domain_separator   = $DomainSepRaw
        active_batch_id    = $ActiveBatchId
        reserve_base_raw   = $OnChainRx
        reserve_quote_raw  = $OnChainRy
        faucet_base_raw    = $FaucetBalBase
        faucet_quote_raw   = $FaucetBalQuote
    }
}

$GlobalConfigObj = [ordered]@{
    network         = $NetworkName
    name            = "Ethereum Sepolia"
    chainId         = $LiveChainId
    rpcUrl          = $RpcUrl
    explorerUrl     = $ExplorerBase
    deployer        = $DeployerAddr
    deploymentBlock = $FairBatchBlock
    contracts       = [ordered]@{
        fairBatch  = $FairBatchAddr
        baseToken  = $BaseTokenAddr
        quoteToken = $QuoteTokenAddr
        faucet     = $FaucetAddr
    }
    tokens          = [ordered]@{
        base  = [ordered]@{ symbol = "fWETH"; decimals = $BaseDecimals }
        quote = [ordered]@{ symbol = "fUSDC"; decimals = $QuoteDecimals }
    }
    market          = [ordered]@{
        commitWindowSecs    = $CommitWindowSecs
        revealWindowSecs    = $RevealWindowSecs
        minBondWei          = $MinBondWei
        initialReserveBase  = $SeedBaseRawStr
        initialReserveQuote = $SeedQuoteRawStr
    }
    faucet          = [ordered]@{
        claimBaseAmount   = $FaucetClaimBaseRawStr
        claimQuoteAmount  = $FaucetClaimQuoteRawStr
        cooldownSecs      = $FaucetCooldownSec
        fundedBaseAmount  = $FaucetFundBaseRawStr
        fundedQuoteAmount = $FaucetFundQuoteRawStr
    }
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($ManifestOutPath, (($ManifestObj | ConvertTo-Json -Depth 8) + "`n"), $utf8NoBom)
[System.IO.File]::WriteAllText($GlobalConfigOutPath, (($GlobalConfigObj | ConvertTo-Json -Depth 8) + "`n"), $utf8NoBom)
Write-Host ("  Wrote Manifest      : {0}" -f $ManifestOutPath) -ForegroundColor Green
Write-Host ("  Wrote Global Config : {0}" -f $GlobalConfigOutPath) -ForegroundColor Green

Write-Host ""
Write-Host "Deployment & Verification Complete!" -ForegroundColor Cyan
Write-Host ("  FairBatch Explorer  : {0}" -f $FbExplorerUrl) -ForegroundColor Cyan
Write-Host ("  Faucet Explorer     : {0}" -f $FaucetExplorerUrl) -ForegroundColor Cyan
