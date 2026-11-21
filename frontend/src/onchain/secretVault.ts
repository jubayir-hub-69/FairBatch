import type { LocalSecretVaultEntry } from '../types';

const STORAGE_KEY = 'fairbatch.secrets.v1';

function readAll(): LocalSecretVaultEntry[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is LocalSecretVaultEntry =>
        Boolean(entry) &&
        typeof entry.commit_id === 'number' &&
        typeof entry.batch_id === 'number' &&
        typeof entry.trader === 'string' &&
        typeof entry.salt === 'string',
    );
  } catch {
    return [];
  }
}

function writeAll(entries: LocalSecretVaultEntry[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // The vault stays in React state for this session if storage is unavailable.
  }
}

export function loadSecretVault(): LocalSecretVaultEntry[] {
  return readAll().sort((a, b) => a.batch_id - b.batch_id || a.commit_id - b.commit_id);
}

export function upsertSecret(entry: LocalSecretVaultEntry): LocalSecretVaultEntry[] {
  const entries = readAll();
  const next = entries.filter(
    (item) => !(item.batch_id === entry.batch_id && item.commit_id === entry.commit_id),
  );
  next.push(entry);
  writeAll(next);
  return next.sort((a, b) => a.batch_id - b.batch_id || a.commit_id - b.commit_id);
}

export function markSecretRevealed(
  batchId: number,
  commitId: number,
): LocalSecretVaultEntry[] {
  const next = readAll().map((item) =>
    item.batch_id === batchId && item.commit_id === commitId
      ? { ...item, revealed: true }
      : item,
  );
  writeAll(next);
  return next;
}

export function removeSecret(batchId: number, commitId: number): LocalSecretVaultEntry[] {
  const next = readAll().filter(
    (item) => !(item.batch_id === batchId && item.commit_id === commitId),
  );
  writeAll(next);
  return next;
}
