import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Globe,
  Link2,
  LogOut,
  RefreshCw,
  Wallet,
  X,
} from 'lucide-react';
import type { RuntimeConfig } from '../onchain/config';
import { explorerAddressUrl } from '../onchain/config';
import { getChainLabel, shortenAddress } from '../lib/format';

interface ContractConfigModalProps {
  isOpen: boolean;
  config: RuntimeConfig;
  account: string | null;
  walletChainId: number | null;
  wrongNetwork: boolean;
  busyAction: string | null;
  onClose: () => void;
  onConnect: () => Promise<void>;
  onDisconnect: () => void;
}

export const ContractConfigModal: React.FC<ContractConfigModalProps> = ({
  isOpen,
  config,
  account,
  walletChainId,
  wrongNetwork,
  busyAction,
  onClose,
  onConnect,
  onDisconnect,
}) => {
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const busy = busyAction !== null;

  const handleConnect = async () => {
    setWalletError(null);
    setStatusMsg(null);
    try {
      await onConnect();
      setStatusMsg('Wallet connected for Ethereum Sepolia transactions.');
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : 'Failed to connect wallet');
    }
  };

  const contractRows: Array<{ label: string; detail: string; address: string }> = [
    {
      label: 'FairBatch Exchange',
      detail: 'Uniform batch clearing + optional LP locking',
      address: config.fairBatch,
    },
    {
      label: 'Sepolia Faucet',
      detail: '1 fWETH + 100 fUSDC per wallet every 12h',
      address: config.faucet,
    },
    {
      label: `Base Token · ${config.baseSymbol}`,
      detail: `${config.baseDecimals} decimals`,
      address: config.baseToken,
    },
    {
      label: `Quote Token · ${config.quoteSymbol}`,
      detail: `${config.quoteDecimals} decimals`,
      address: config.quoteToken,
    },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="contract-config-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto border border-ink bg-paper-bright shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b-2 border-ink bg-paper px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-ink bg-ink text-paper">
              <Globe className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <div className="eyebrow">Ethereum Sepolia configuration</div>
              <h2
                id="contract-config-modal-title"
                className="mt-1 font-display text-xl font-bold leading-tight text-ink"
              >
                Contract &amp; network config
              </h2>
              <p className="mt-1 text-sm text-ink-muted">
                Loaded directly from{' '}
                <code className="font-mono text-xs text-ink-soft">config/deployment.json</code>{' '}
                with RPC fallbacks from{' '}
                <code className="font-mono text-xs text-ink-soft">config/networks.json</code>.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Contract Configuration Modal"
            className="tap-target inline-flex w-11 items-center justify-center border border-rule-strong text-ink-muted transition hover:border-ink hover:text-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="border border-rule bg-paper-soft p-3.5">
              <div className="flex items-center gap-1.5 font-mono text-xs font-bold uppercase tracking-label text-ink-soft">
                <Link2 className="h-4 w-4 text-cobalt-700" />
                <span>Target network</span>
              </div>
              <p className="mt-1.5 font-mono text-sm font-bold text-ink">
                {getChainLabel(config.chainId)} · Chain ID {config.chainId}
              </p>
              <p className="mt-1 break-all font-mono text-xs text-ink-muted">
                Primary RPC: {config.rpcUrl}
              </p>
              {config.fallbackRpcUrls.length > 0 && (
                <p className="mt-1 break-all font-mono text-xs text-ink-faint">
                  Fallbacks: {config.fallbackRpcUrls.join(', ')}
                </p>
              )}
              <p className="mt-1 font-mono text-xs text-ink-faint">
                Deployer: {shortenAddress(config.deployer)} · Block #{config.deploymentBlock.toString()}
              </p>
            </div>

            <div className="border border-rule bg-paper-soft p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-mono text-xs font-bold uppercase tracking-label text-ink-soft">
                  <Wallet className="h-4 w-4 text-cobalt-700" />
                  <span>Wallet status</span>
                </span>
                {account && (
                  <span className="border border-pine-600/40 bg-pine-50 px-2 py-0.5 font-mono text-xs text-pine-700">
                    {shortenAddress(account)}
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-sm leading-snug text-ink-muted">
                {account
                  ? wrongNetwork
                    ? `Wallet is on chain ${walletChainId ?? '?'}; FairBatch requires Ethereum Sepolia (${config.chainId}).`
                    : 'Ready to sign orders, liquidity deposits, faucet claims, and collections on Sepolia.'
                  : 'Connect MetaMask, Rabby, or another Ethereum wallet on Sepolia.'}
              </p>
              {account ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleConnect()}
                    disabled={busy}
                    className="tap-target inline-flex items-center gap-1.5 border border-cobalt-600/40 bg-cobalt-50 px-3 font-mono text-xs font-bold uppercase text-cobalt-700 transition hover:bg-cobalt-100 disabled:opacity-40"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span>Switch / reconnect</span>
                  </button>
                  <button
                    type="button"
                    onClick={onDisconnect}
                    className="tap-target inline-flex items-center gap-1.5 border border-rule-strong px-3 font-mono text-xs font-bold uppercase text-ink-muted transition hover:border-ink hover:text-ink"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    <span>Disconnect</span>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleConnect()}
                  disabled={busy}
                  className="tap-target mt-3 inline-flex items-center gap-1.5 border border-cobalt-600/40 bg-cobalt-50 px-3 font-mono text-xs font-bold uppercase text-cobalt-700 transition hover:bg-cobalt-100 disabled:opacity-40"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  <span>Connect wallet</span>
                </button>
              )}
            </div>
          </div>

          <div className="flex items-start gap-2.5 border-l-2 border-brass-500 bg-brass-50 px-3.5 py-2.5 text-sm leading-relaxed text-brass-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-brass-700" />
            <div>
              <span className="font-bold">EVM Cancun opcode compatibility:</span>{' '}
              FairBatch and Faucet use Fe 26.5 <code>std::evm::mutex::Mutex</code> (
              <code>TLOAD</code>/<code>TSTORE</code>, EIP-1153) and <code>PUSH0</code> (EIP-3855) on
              Ethereum Sepolia.
            </div>
          </div>

          <div>
            <span className="eyebrow mb-2 block">Deployed Sepolia Contracts</span>
            <div className="divide-y divide-rule border border-rule bg-paper">
              {contractRows.map((row) => {
                const url = explorerAddressUrl(config, row.address);
                return (
                  <div
                    key={row.label}
                    className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-3"
                  >
                    <div>
                      <div className="font-display text-sm font-bold text-ink">{row.label}</div>
                      <div className="font-mono text-xs text-ink-muted">{row.detail}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="break-all font-mono text-xs text-ink-soft">
                        {row.address}
                      </code>
                      {url && (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`View ${row.label} on Etherscan`}
                          className="inline-flex h-9 w-9 items-center justify-center border border-rule-strong text-ink-muted transition hover:border-ink hover:text-ink"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {statusMsg && (
            <div className="flex items-center gap-2 border-l-2 border-pine-600 bg-pine-50 px-3.5 py-2.5 text-sm text-pine-800">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{statusMsg}</span>
            </div>
          )}

          {walletError && (
            <div className="border-l-2 border-vermilion-500 bg-vermilion-50 px-3.5 py-2.5 text-sm text-vermilion-800">
              {walletError}
            </div>
          )}

          <div className="flex justify-end border-t border-rule pt-3">
            <button
              type="button"
              onClick={onClose}
              className="tap-target border border-ink bg-ink px-5 font-display text-sm font-bold text-paper transition hover:bg-ink-soft"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
