import type { PublicClient } from 'viem';
import { fairBatchEvents } from './abi';
import type { RuntimeConfig } from './config';

export type FairBatchEventName =
  | 'LiquidityAdded'
  | 'LiquidityLocked'
  | 'LiquidityRemoved'
  | 'OrderCommitted'
  | 'OrderRevealed'
  | 'OrderSubmitted'
  | 'CommitmentSlashed'
  | 'BatchSettled'
  | 'OrderClaimed';

export interface FairBatchEvent {
  eventName: FairBatchEventName;
  args: Record<string, unknown>;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: `0x${string}`;
}

interface EventCache {
  key: string;
  lastBlock: bigint;
  events: FairBatchEvent[];
}

let cache: EventCache | null = null;
let inflight: { key: string; promise: Promise<FairBatchEvent[]> } | null = null;

const MAX_CHUNK = 50_000n;
const MIN_CHUNK = 1_000n;

export function resetEventCache(): void {
  cache = null;
  inflight = null;
}

/**
 * Deduplicates and canonically orders event logs by (blockNumber, logIndex, transactionHash).
 * Prevents duplicate rows when concurrent refreshes or overlapping RPC queries return the same log.
 */
export function dedupeEvents(events: FairBatchEvent[]): FairBatchEvent[] {
  const byKey = new Map<string, FairBatchEvent>();
  for (const event of events) {
    const id = `${event.blockNumber.toString()}:${event.logIndex}:${event.transactionHash.toLowerCase()}:${event.eventName}`;
    if (!byKey.has(id)) {
      byKey.set(id, event);
    }
  }
  return Array.from(byKey.values()).sort((a, b) => {
    if (a.blockNumber === b.blockNumber) {
      if (a.logIndex !== b.logIndex) return a.logIndex - b.logIndex;
      return a.transactionHash.localeCompare(b.transactionHash);
    }
    return a.blockNumber < b.blockNumber ? -1 : 1;
  });
}

function normalizeLog(log: {
  eventName?: string;
  args?: unknown;
  blockNumber: bigint | null;
  logIndex: number | null;
  transactionHash: `0x${string}` | null;
}): FairBatchEvent | null {
  if (!log.eventName || !log.args) return null;
  if (log.blockNumber === null || log.logIndex === null || !log.transactionHash) return null;
  const args = log.args as Record<string, unknown>;
  return {
    eventName: log.eventName as FairBatchEventName,
    args,
    blockNumber: log.blockNumber,
    logIndex: log.logIndex,
    transactionHash: log.transactionHash,
  };
}

async function fetchRange(
  client: PublicClient,
  config: RuntimeConfig,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<FairBatchEvent[]> {
  const collected: FairBatchEvent[] = [];
  let cursor = fromBlock;
  let span = MAX_CHUNK;

  while (cursor <= toBlock) {
    const end = cursor + span - 1n > toBlock ? toBlock : cursor + span - 1n;
    try {
      const logs = await client.getLogs({
        address: config.fairBatch,
        events: fairBatchEvents,
        fromBlock: cursor,
        toBlock: end,
      });
      for (const log of logs) {
        const normalized = normalizeLog(log as Parameters<typeof normalizeLog>[0]);
        if (normalized) collected.push(normalized);
      }
      cursor = end + 1n;
    } catch (error) {
      if (span <= MIN_CHUNK) throw error;
      span = span / 2n;
    }
  }

  return collected;
}

async function loadEventsInner(
  client: PublicClient,
  config: RuntimeConfig,
  force: boolean,
): Promise<FairBatchEvent[]> {
  const key = `${config.chainId}:${config.fairBatch.toLowerCase()}`;
  const latest = await client.getBlockNumber();
  const configuredStart = config.deploymentBlock > 0n ? config.deploymentBlock - 1n : 0n;

  if (force || cache?.key !== key) {
    cache = {
      key,
      lastBlock: configuredStart > latest ? latest : configuredStart,
      events: [],
    };
  }

  if (cache.lastBlock >= latest) return cache.events;

  const fromBlock = cache.lastBlock + 1n;
  const fresh = await fetchRange(client, config, fromBlock, latest);
  const merged = dedupeEvents([...cache.events, ...fresh]);
  cache = { key, lastBlock: latest, events: merged };
  return merged;
}

export async function loadFairBatchEvents(
  client: PublicClient,
  config: RuntimeConfig,
  force = false,
): Promise<FairBatchEvent[]> {
  const key = `${config.chainId}:${config.fairBatch.toLowerCase()}`;
  if (!force && inflight && inflight.key === key) {
    return inflight.promise;
  }

  const promise = loadEventsInner(client, config, force).finally(() => {
    if (inflight?.promise === promise) {
      inflight = null;
    }
  });
  inflight = { key, promise };
  return promise;
}
