export function formatPrice(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '0.00';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatUsd(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '$0.00';
  const sign = value < 0 ? '-' : '';
  return (
    sign +
    '$' +
    Math.abs(value).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  );
}

export function formatToken(value: number, maxDecimals = 4, minDecimals = 2): string {
  if (!Number.isFinite(value)) return '0.00';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: minDecimals,
    maximumFractionDigits: Math.max(minDecimals, maxDecimals),
  });
}

export function formatInvariant(k: number): string {
  if (!Number.isFinite(k) || k <= 0) return '0';
  if (k >= 1_000_000_000) return `${(k / 1_000_000_000).toFixed(3)}B`;
  if (k >= 1_000_000) return `${(k / 1_000_000).toFixed(3)}M`;
  if (k >= 1_000) return `${(k / 1_000).toFixed(2)}K`;
  return k.toFixed(2);
}

export function shortenAddress(addr: string): string {
  if (!addr || addr.length < 12) return addr || '0x0000…0000';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function getChainLabel(chainId: number): string {
  if (chainId === 11155111) return 'Ethereum Sepolia';
  return `Chain #${chainId}`;
}

export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '0s';
  const secs = Math.floor(totalSeconds);
  const days = Math.floor(secs / 86_400);
  const hours = Math.floor((secs % 86_400) / 3_600);
  const minutes = Math.floor((secs % 3_600) / 60);
  const rem = secs % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return rem > 0 ? `${minutes}m ${String(rem).padStart(2, '0')}s` : `${minutes}m`;
  return `${rem}s`;
}
