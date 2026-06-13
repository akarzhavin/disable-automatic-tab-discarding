/**
 * Service worker — the heart of the extension.
 *
 * MV3 service workers are ephemeral: they spin up for an event and die. So we
 * keep NO mutable module state — every handler recomputes from chrome.storage
 * and chrome.tabs. All listeners are registered synchronously at top level so
 * they survive a cold start.
 */

import { activationKey, hydrateOverrides, moveActivation } from "./shared/activations.js";
import { getOverrides, removeTabOverride, setOverrides } from "./shared/overrides.js";
import { effectiveProtect } from "./shared/protection.js";
import { getSettings } from "./shared/settings.js";
import { incrementStat, markInstalled } from "./shared/stats.js";
import { OVERRIDES_KEY, SETTINGS_KEY, type Settings, type TabOverrides } from "./shared/types.js";

const BADGE_COLOR = "#10a37f";

/** Apply the desired autoDiscardable state to one tab, if it differs. */
async function applyToTab(
  tab: chrome.tabs.Tab,
  settings: Settings,
  overrides: TabOverrides,
): Promise<void> {
  if (tab.id == null || tab.id === chrome.tabs.TAB_ID_NONE) return;
  // Discarded tabs can't be updated until they reload; onUpdated will catch them.
  if (tab.discarded) return;

  const desiredAutoDiscardable = !effectiveProtect(tab, settings, overrides);
  if (tab.autoDiscardable === desiredAutoDiscardable) return; // no-op; avoids churn

  try {
    await chrome.tabs.update(tab.id, { autoDiscardable: desiredAutoDiscardable });
    if (!desiredAutoDiscardable) void incrementStat("protectOps");
  } catch {
    // Tab vanished mid-flight — ignore.
  }
}

/** Re-evaluate every open tab, then refresh the badge. */
async function applyToAllTabs(): Promise<void> {
  const [settings, live, tabs] = await Promise.all([
    getSettings(),
    getOverrides(),
    chrome.tabs.query({}),
  ]);
  // Restore remembered activations onto reopened/restored tabs before evaluating.
  const { overrides, changed } = await hydrateOverrides(tabs, live);
  if (changed) await setOverrides(overrides);
  await Promise.all(tabs.map((t) => applyToTab(t, settings, overrides)));
  await updateBadge(settings, tabs);
}

/** Recompute the toolbar badge from current tab state (never from a counter). */
async function updateBadge(settings?: Settings, tabs?: chrome.tabs.Tab[]): Promise<void> {
  const s = settings ?? (await getSettings());
  const list = tabs ?? (await chrome.tabs.query({}));
  const count = s.enabled ? list.filter((t) => t.autoDiscardable === false).length : 0;

  await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  await chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
}

/**
 * If an active tab has navigated away from the URL its override was bound to,
 * move the remembered activation to the new URL and re-point the override.
 * Mutates `overrides` and persists when it changes anything.
 */
async function rekeyOnNavigation(
  tab: chrome.tabs.Tab,
  overrides: TabOverrides,
): Promise<void> {
  if (tab.id == null) return;
  const entry = overrides[tab.id];
  // Skip legacy string entries and unkeyable bindings.
  if (!entry || typeof entry === "string" || entry.key == null) return;
  const currentKey = activationKey(tab.url);
  // Ignore transient loading states with no parseable URL.
  if (!currentKey || currentKey === entry.key) return;

  await moveActivation(entry.key, tab.url, entry.value, tab.title);
  entry.key = currentKey;
  await setOverrides(overrides);
}

/** Apply to a single tab id (used by tab events). */
async function handleTab(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  if (!tab) {
    await updateBadge();
    return;
  }
  const [settings, live] = await Promise.all([getSettings(), getOverrides()]);
  // An active tab that navigated within itself: move its memory to the new page
  // so it follows the tab instead of stranding a ghost on the old URL.
  await rekeyOnNavigation(tab, live);
  // A reopened tab carries no live override; restore it from the URL cache.
  const { overrides, changed } = await hydrateOverrides([tab], live);
  if (changed) await setOverrides(overrides);
  await applyToTab(tab, settings, overrides);
  await updateBadge(settings);
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  // Seed install time (Date.now is fine here — runtime, not a workflow script).
  if (details.reason === "install") {
    void markInstalled(Date.now());
    // One-time welcome / introduction tab.
    void chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
  }
  void applyToAllTabs();
});

chrome.runtime.onStartup.addListener(() => {
  void applyToAllTabs();
});

// ── Tab events ────────────────────────────────────────────────────────────────

chrome.tabs.onCreated.addListener((tab) => {
  // URL is often empty here; onUpdated is the authoritative apply point.
  if (tab.id != null) void handleTab(tab.id);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.discarded === true) {
    void incrementStat("discardEventsObserved");
  }
  // Re-apply when a tab navigates or (re)loads, or wakes from discard.
  if (
    changeInfo.url !== undefined ||
    changeInfo.status === "loading" ||
    changeInfo.discarded === false
  ) {
    void handleTab(tabId);
  } else {
    void updateBadge();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void removeTabOverride(tabId); // no-op write when there was no override
  void updateBadge();
});

chrome.tabs.onReplaced.addListener(() => {
  void updateBadge();
});

// ── Settings / override changes → single re-evaluation path ──────────────────

chrome.storage.onChanged.addListener((changes, area) => {
  if (
    (area === "sync" && changes[SETTINGS_KEY]) ||
    (area === "session" && changes[OVERRIDES_KEY])
  ) {
    void applyToAllTabs();
  }
});
