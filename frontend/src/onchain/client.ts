import {
  createPublicClient,
  createWalletClient,
  custom,
  fallback,
  getAddress,
  http,
  type Address,
  type EIP1193Provider,
  type PublicClient,
} from 'viem';
import { getChain, type RuntimeConfig } from './config';

type ConfiguredWalletClient = ReturnType<typeof createWalletClient>;

let cachedPublic:
  | { key: string; client: PublicClient }
  | null = null;

export function getPublicClient(config: RuntimeConfig): PublicClient {
  const urls = config.rpcUrls?.length ? config.rpcUrls : [config.rpcUrl];
  const key = `${config.chainId}:${urls.join('|')}`;
  if (cachedPublic?.key === key) return cachedPublic.client;

  const transports = urls.map((url) =>
    http(url, {
      timeout: 20_000,
      retryCount: 2,
      retryDelay: 500,
    }),
  );

  const transport =
    transports.length > 1
      ? fallback(transports, { rank: false, retryCount: 2, retryDelay: 600 })
      : transports[0];

  const client = createPublicClient({
    chain: getChain(config),
    transport,
  });
  cachedPublic = { key, client };
  return client;
}

export function clearPublicClientCache(): void {
  cachedPublic = null;
}

export function getInjectedProvider(): EIP1193Provider | null {
  if (typeof window === 'undefined') return null;
  return (window.ethereum as unknown as EIP1193Provider | undefined) ?? null;
}

export function hasInjectedWallet(): boolean {
  return Boolean(getInjectedProvider());
}

function walletClientFor(config: RuntimeConfig, account?: Address): ConfiguredWalletClient {
  const provider = getInjectedProvider();
  if (!provider) {
    throw new Error(
      'No Ethereum wallet detected. Install MetaMask or Rabby to trade on Ethereum Sepolia.',
    );
  }
  return createWalletClient({
    account,
    chain: getChain(config),
    transport: custom(provider),
  });
}

async function ensureWalletChain(
  client: ConfiguredWalletClient,
  config: RuntimeConfig,
): Promise<void> {
  const current = await client.getChainId();
  if (current === config.chainId) return;
  const chain = getChain(config);
  try {
    await client.switchChain({ id: config.chainId });
  } catch {
    try {
      await client.addChain({ chain });
    } catch {
      // Some wallets report the chain as already known; retry switch below.
    }
    await client.switchChain({ id: config.chainId });
  }
}

export async function switchWalletToSepolia(config: RuntimeConfig): Promise<number> {
  const client = walletClientFor(config);
  await ensureWalletChain(client, config);
  return client.getChainId();
}

export async function connectInjectedWallet(config: RuntimeConfig): Promise<Address> {
  const client = walletClientFor(config);
  const accounts = await client.requestAddresses();
  if (!accounts[0]) throw new Error('Wallet returned no accounts.');
  await ensureWalletChain(client, config);
  return getAddress(accounts[0]);
}

export async function restoreInjectedAccount(config: RuntimeConfig): Promise<Address | null> {
  const provider = getInjectedProvider();
  if (!provider) return null;
  try {
    const client = walletClientFor(config);
    const accounts = await client.getAddresses();
    return accounts[0] ? getAddress(accounts[0]) : null;
  } catch {
    return null;
  }
}

export async function getWalletChainId(config: RuntimeConfig): Promise<number | null> {
  if (!getInjectedProvider()) return null;
  try {
    return await walletClientFor(config).getChainId();
  } catch {
    return null;
  }
}

export async function ensureWalletReady(
  config: RuntimeConfig,
  account: Address,
): Promise<ConfiguredWalletClient> {
  const client = walletClientFor(config, account);
  await ensureWalletChain(client, config);
  return client;
}

export function watchInjectedWallet(handlers: {
  onAccountsChanged: (accounts: Address[]) => void;
  onChainChanged: (chainId: number) => void;
  onDisconnect: () => void;
}): () => void {
  const provider = getInjectedProvider();
  if (!provider?.on || !provider.removeListener) return () => undefined;

  const handleAccounts = (...args: unknown[]) => {
    const accounts = Array.isArray(args[0]) ? (args[0] as string[]) : [];
    handlers.onAccountsChanged(accounts.filter(Boolean).map((a) => getAddress(a)));
  };
  const handleChain = (...args: unknown[]) => {
    const raw = args[0];
    if (typeof raw === 'string') {
      handlers.onChainChanged(Number.parseInt(raw, 16));
    } else if (typeof raw === 'number') {
      handlers.onChainChanged(raw);
    }
  };
  const handleDisconnect = () => handlers.onDisconnect();

  provider.on('accountsChanged', handleAccounts);
  provider.on('chainChanged', handleChain);
  provider.on('disconnect', handleDisconnect);

  return () => {
    provider.removeListener?.('accountsChanged', handleAccounts);
    provider.removeListener?.('chainChanged', handleChain);
    provider.removeListener?.('disconnect', handleDisconnect);
  };
}
