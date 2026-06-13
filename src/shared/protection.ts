/** Pure decision logic: given a tab URL and settings, should this tab be protected? */

import { getHostname, matchesAny } from "./domains.js";
import type { Settings, TabOverrides } from "./types.js";

/**
 * Whether a tab should be kept alive (autoDiscardable:false).
 *
 * - Master switch off → never protect.
 * - Restricted pages (no web hostname, e.g. chrome://) → protected in "exclude"
 *   mode (they can't be excluded by domain), not protected in "whitelist" mode.
 * - "exclude" mode → protect unless the host matches an excluded domain.
 * - "whitelist" mode → protect only if the host matches a whitelisted domain.
 */
export function shouldProtect(url: string | undefined, settings: Settings): boolean {
  if (!settings.enabled) return false;

  const host = getHostname(url);

  if (settings.mode === "whitelist") {
    if (!host) return false;
    return matchesAny(host, settings.whitelistedDomains);
  }

  // exclude mode
  if (!host) return true;
  return !matchesAny(host, settings.excludedDomains);
}

/**
 * Final per-tab decision: a manual override (set from the tab list) beats the
 * domain rules; the master switch beats everything.
 */
export function effectiveProtect(
  tab: Pick<chrome.tabs.Tab, "id" | "url">,
  settings: Settings,
  overrides: TabOverrides,
): boolean {
  if (!settings.enabled) return false;
  const entry = tab.id != null ? overrides[tab.id] : undefined;
  // Tolerate a legacy string entry from before override entries grew a `key`.
  const value = typeof entry === "string" ? entry : entry?.value;
  if (value === "protect") return true;
  if (value === "discard") return false;
  return shouldProtect(tab.url, settings);
}
