/** Lifetime counters in chrome.storage.local, with serialized read-modify-write. */

import { DEFAULT_STATS, STATS_KEY, type Stats } from "./types.js";

/** Read stats, filling missing fields from defaults. */
export async function getStats(): Promise<Stats> {
  const raw = await chrome.storage.local.get(STATS_KEY);
  const stored = (raw[STATS_KEY] ?? {}) as Partial<Stats>;
  return { ...DEFAULT_STATS, ...stored };
}

/**
 * Serialize mutations so concurrent service-worker events don't clobber each
 * other's read-modify-write on the single stats object.
 */
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  // Keep the chain alive even if a task rejects.
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Atomically apply a transform to the stats object and persist it. */
export function updateStats(mutate: (s: Stats) => void): Promise<Stats> {
  return enqueue(async () => {
    const stats = await getStats();
    mutate(stats);
    await chrome.storage.local.set({ [STATS_KEY]: stats });
    return stats;
  });
}

/** Increment one numeric counter. */
export function incrementStat(key: "protectOps" | "discardEventsObserved", by = 1): Promise<Stats> {
  return updateStats((s) => {
    s[key] += by;
  });
}

/** Reset counters but preserve installedAt. */
export function resetStats(): Promise<Stats> {
  return updateStats((s) => {
    s.protectOps = 0;
    s.discardEventsObserved = 0;
  });
}

/** Record install time once (first install only). */
export function markInstalled(now: number): Promise<Stats> {
  return updateStats((s) => {
    if (!s.installedAt) s.installedAt = now;
  });
}
