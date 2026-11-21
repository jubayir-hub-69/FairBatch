import { useEffect, useState } from 'react';

/**
 * Wall-clock seconds ticker used for batch countdowns. The chain is the source
 * of truth for deadlines; this only re-renders the remaining time each second.
 */
export function useNow(intervalMs = 1_000): number {
  const [now, setNow] = useState<number>(() => Math.floor(Date.now() / 1_000));

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Math.floor(Date.now() / 1_000));
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return now;
}
