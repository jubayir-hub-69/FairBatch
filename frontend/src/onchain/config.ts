import { getAddress, isAddress, zeroAddress, type Address, type Chain } from 'viem';
import { sepolia } from 'viem/chains';
import deployment from '../../../config/deployment.json';
import networks from '../../../config/networks.json';

export interface RuntimeConfig {
  network: 'sepolia';
  chainId: number;
  rpcUrl: string;
  fallbackRpcUrls: string[];
  rpcUrls: string[];
  explorerUrl: string;
  deployer: Address;
  fairBatch: Address;
  baseToken: Address;
  quoteToken: Address;
  faucet: Address;
  baseSymbol: string;
  quoteSymbol: string;
  baseDecimals: number;
  quoteDecimals: number;
  deploymentBlock: bigint;
  commitWindowSecs: number;
  revealWindowSecs: number;
  minBondWei: bigint;
  initialReserveBase: bigint;
  initialReserveQuote: bigint;
  faucetClaimBase: bigint;
  faucetClaimQuote: bigint;
  faucetCooldownSecs: number;
  tokenFaucetEnabled: boolean;
}

function parseAddress(raw: string | undefined): Address {
  if (!raw || !isAddress(raw)) return zeroAddress;
  return getAddress(raw);
}

function collectRpcUrls(primary: string, fallbacks: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of [primary, ...fallbacks]) {
    const trimmed = candidate.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  return out;
}

function buildSepoliaConfig(): RuntimeConfig {
  const faucet = parseAddress(deployment.contracts.faucet);
  const rawFallbacks = networks.networks?.sepolia?.fallback_rpc_urls ?? [];
  const rpcUrls = collectRpcUrls(deployment.rpcUrl, rawFallbacks);
  const fallbackRpcUrls = rpcUrls.slice(1);
  return {
    network: 'sepolia',
    chainId: deployment.chainId,
    rpcUrl: rpcUrls[0] ?? deployment.rpcUrl,
    fallbackRpcUrls,
    rpcUrls,
    explorerUrl: deployment.explorerUrl,
    deployer: parseAddress(deployment.deployer),
    fairBatch: parseAddress(deployment.contracts.fairBatch),
    baseToken: parseAddress(deployment.contracts.baseToken),
    quoteToken: parseAddress(deployment.contracts.quoteToken),
    faucet,
    baseSymbol: deployment.tokens.base.symbol,
    quoteSymbol: deployment.tokens.quote.symbol,
    baseDecimals: deployment.tokens.base.decimals,
    quoteDecimals: deployment.tokens.quote.decimals,
    deploymentBlock: BigInt(deployment.deploymentBlock),
    commitWindowSecs: deployment.market.commitWindowSecs,
    revealWindowSecs: deployment.market.revealWindowSecs,
    minBondWei: BigInt(deployment.market.minBondWei),
    initialReserveBase: BigInt(deployment.market.initialReserveBase),
    initialReserveQuote: BigInt(deployment.market.initialReserveQuote),
    faucetClaimBase: BigInt(deployment.faucet.claimBaseAmount),
    faucetClaimQuote: BigInt(deployment.faucet.claimQuoteAmount),
    faucetCooldownSecs: deployment.faucet.cooldownSecs,
    tokenFaucetEnabled: faucet !== zeroAddress,
  };
}

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = buildSepoliaConfig();

export function loadRuntimeConfig(): RuntimeConfig {
  return DEFAULT_RUNTIME_CONFIG;
}

export function isContractConfigured(config: RuntimeConfig): boolean {
  return config.fairBatch !== zeroAddress && isAddress(config.fairBatch);
}

export function getChain(config: RuntimeConfig): Chain {
  return {
    ...sepolia,
    rpcUrls: { default: { http: config.rpcUrls } },
  };
}

export function explorerAddressUrl(config: RuntimeConfig, address: string): string | null {
  if (!config.explorerUrl) return null;
  return `${config.explorerUrl}/address/${address}`;
}

export function explorerTxUrl(config: RuntimeConfig, hash: string): string | null {
  if (!config.explorerUrl) return null;
  return `${config.explorerUrl}/tx/${hash}`;
}
