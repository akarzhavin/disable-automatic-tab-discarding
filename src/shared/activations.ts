/**
 * Durable, URL-keyed memory of per-tab decisions (chrome.storage.local).
 *
 * The live per-tab override (overrides.ts) is keyed by tab id and dies when the
 * tab closes or the browser restarts. This layer remembers the same decision by
 * URL, with a 7-day TTL re-anchored on each open, so reopening a tab restores
 * the activation. A site-level decision wipes the cache for that whole host.
 */

import { getHostname } from "./domains.js";
import {
  ACTIVATIONS_KEY,
  ACTIVATION_TTL_MS,
  type TabOverride,
  type TabOverrides,
  type UrlActivations,
} from "./types.js";

/** Stable page identity: scheme + host + path + query, ignoring the fragment.
 *  Built from protocol+host (not origin) so chrome:// pages, whose origin is
 *  "null", still get distinct keys. */
export function activationKey(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

async function readAll(): Promise<UrlActivations> {
  const raw = await chrome.storage.local.get(ACTIVATIONS_KEY);
  return (raw[ACTIVATIONS_KEY] ?? {}) as UrlActivations;
}

/** Read all activations, pruning any that have expired. */
export async function getActivations(now: number = Date.now()): Promise<UrlActivations> {
  const all = await readAll();
  let changed = false;
  for (const key of Object.keys(all)) {
    if (all[key]!.expiresAt <= now) {
      delete all[key];
      changed = true;
    }
  }
  if (changed) await chrome.storage.local.set({ [ACTIVATIONS_KEY]: all });
  return all;
}

/** Remember (value) or forget (null) a per-tab decision for a URL, fresh TTL. */
export async function setActivation(
  url: string | undefined,
  value: TabOverride | null,
  opts: { title?: string; now?: number } = {},
): Promise<void> {
  const key = activationKey(url);
  if (!key) return;
  const now = opts.now ?? Date.now();
  const all = await readAll();
  if (value === null) {
    if (!(key in all)) return;
    delete all[key];
  } else {
    all[key] = { value, expiresAt: now + ACTIVATION_TTL_MS, title: opts.title };
  }
  await chrome.storage.local.set({ [ACTIVATIONS_KEY]: all });
}

/**
 * Move a tab's remembered activation from `oldKey` to its new URL, dropping the
 * stale entry. Used when an active tab navigates within itself, so the memory
 * follows the tab instead of leaving an orphaned ghost on the old page.
 */
export async function moveActivation(
  oldKey: string,
  newUrl: string | undefined,
  value: TabOverride,
  title: string | undefined,
  now: number = Date.now(),
): Promise<void> {
  const newKey = activationKey(newUrl);
  if (!newKey || newKey === oldKey) return;
  const all = await readAll();
  delete all[oldKey];
  all[newKey] = { value, expiresAt: now + ACTIVATION_TTL_MS, title };
  await chrome.storage.local.set({ [ACTIVATIONS_KEY]: all });
}

/** Drop every cached activation whose host is `host` or a subdomain of it. */
export async function clearActivationsForHost(
  host: string,
  now: number = Date.now(),
): Promise<void> {
  const all = await readAll();
  let changed = false;
  for (const key of Object.keys(all)) {
    const h = getHostname(key);
    if (h && (h === host || h.endsWith("." + host))) {
      delete all[key];
      changed = true;
    } else if (all[key]!.expiresAt <= now) {
      delete all[key]; // opportunistic prune
      changed = true;
    }
  }
  if (changed) await chrome.storage.local.set({ [ACTIVATIONS_KEY]: all });
}

/**
 * Fill in live overrides for tabs that have a fresh cached activation but no
 * override yet, re-anchoring each used activation's TTL to now. Mutates and
 * returns the passed `overrides`; `changed` tells the caller whether to persist
 * the override map. Expired entries are pruned from the cache along the way.
 */
export async function hydrateOverrides(
  tabs: chrome.tabs.Tab[],
  overrides: TabOverrides,
  now: number = Date.now(),
): Promise<{ overrides: TabOverrides; changed: boolean }> {
  const all = await readAll();
  let changed = false;
  let cacheChanged = false;

  // Prune expired entries first so stale memories never resurrect a tab.
  for (const key of Object.keys(all)) {
    if (all[key]!.expiresAt <= now) {
      delete all[key];
      cacheChanged = true;
    }
  }

  for (const tab of tabs) {
    if (tab.id == null || tab.discarded) continue;
    if (overrides[tab.id] !== undefined) continue; // a live override wins
    const key = activationKey(tab.url);
    const entry = key ? all[key] : undefined;
    if (!entry || !key) continue;
    overrides[tab.id] = { value: entry.value, key };
    entry.expiresAt = now + ACTIVATION_TTL_MS; // re-anchor: "7 days from this open"
    changed = true;
    cacheChanged = true;
  }

  if (cacheChanged) await chrome.storage.local.set({ [ACTIVATIONS_KEY]: all });
  return { overrides, changed };
}
