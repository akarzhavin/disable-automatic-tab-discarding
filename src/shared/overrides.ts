/** Per-tab manual overrides in chrome.storage.session — cleared with the browser,
 * which is exactly the lifetime of a tab id. */

import { activationKey } from "./activations.js";
import { OVERRIDES_KEY, type TabOverride, type TabOverrides } from "./types.js";

export async function getOverrides(): Promise<TabOverrides> {
  const raw = await chrome.storage.session.get(OVERRIDES_KEY);
  return (raw[OVERRIDES_KEY] ?? {}) as TabOverrides;
}

/** Replace the whole override map in one write (used by batch hydration). */
export async function setOverrides(overrides: TabOverrides): Promise<void> {
  await chrome.storage.session.set({ [OVERRIDES_KEY]: overrides });
}

/**
 * Set, replace or (with null) clear the override for one tab. Records the URL the
 * override is bound to so navigation can re-key it. No-ops skip the write.
 */
export async function setTabOverride(
  tabId: number,
  value: TabOverride | null,
  url?: string,
): Promise<void> {
  const overrides = await getOverrides();
  if (value === null) {
    if (!(tabId in overrides)) return;
    delete overrides[tabId];
  } else {
    const key = activationKey(url);
    const existing = overrides[tabId];
    if (existing && existing.value === value && existing.key === key) return;
    overrides[tabId] = { value, key };
  }
  await chrome.storage.session.set({ [OVERRIDES_KEY]: overrides });
}

/** Drop the override when its tab closes. */
export function removeTabOverride(tabId: number): Promise<void> {
  return setTabOverride(tabId, null);
}
