/**
 * Service worker — the heart of the extension.
 *
 * MV3 service workers are ephemeral: they spin up for an event and die. So we
 * keep NO mutable module state — every handler recomputes from chrome.storage
 * and chrome.tabs. All listeners are registered synchronously at top level so
 * they survive a cold start.
 */

import { activationKey, hydrateOverrides, moveActivation } from "./shared/activations.js";
import {
  type CaptureEnded,
  type CaptureRequest,
  type CaptureResult,
  type OffscreenRequest,
  TIMER_MAX_MIN,
  getCaptureEnds,
  getCaptured,
  getStreamId,
  setCaptureEnds,
  setCaptured,
  setInvoked,
} from "./shared/capture.js";
import { removeBanner, showRunningBanner } from "./shared/banner.js";
import { DEFAULT_ICON_PATHS, drawIcons } from "./shared/icon.js";
import { getOverrides, removeTabOverride, setOverrides } from "./shared/overrides.js";
import { effectiveProtect } from "./shared/protection.js";
import { getSettings } from "./shared/settings.js";
import { incrementStat, markInstalled } from "./shared/stats.js";
import {
  CAPTURES_KEY,
  OVERRIDES_KEY,
  SETTINGS_KEY,
  type Settings,
  type TabOverrides,
} from "./shared/types.js";

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

// ── "Keep running" captures ───────────────────────────────────────────────────

const OFFSCREEN_URL = "offscreen.html";

async function hasOffscreen(): Promise<boolean> {
  const ctx = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  return ctx.length > 0;
}

async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: "Hold a tab capture open so Chrome keeps that tab running at full speed.",
  });
}

/** Close the offscreen document once nothing is captured any more. */
async function closeOffscreenIfIdle(): Promise<void> {
  if ((await getCaptured()).length === 0 && (await hasOffscreen())) {
    await chrome.offscreen.closeDocument().catch(() => undefined);
  }
}

/**
 * The whole start runs here, not in the popup: Chrome may close the popup while the
 * capture begins, and work left in a closed popup is simply dropped. The popup's
 * activeTab grant (or site access, from Settings) belongs to the extension, so the
 * worker can use it.
 */
async function startCapture(tabId: number, minutes: number): Promise<CaptureResult> {
  try {
    const streamId = await getStreamId(tabId);
    await ensureOffscreen();
    const endsAt = minutes > 0 ? Date.now() + minutes * 60_000 : 0;
    const msg: OffscreenRequest = { type: "offscreen:start", tabId, streamId, endsAt };
    const res = (await chrome.runtime.sendMessage(msg)) as CaptureResult | undefined;
    if (!res?.ok) {
      await closeOffscreenIfIdle();
      return res ?? { ok: false, error: "no response" };
    }
    // Ends first: the icon/list listeners fire on the captured-ids write.
    await setCaptureEnds({ ...(await getCaptureEnds()), [tabId]: endsAt });
    const captured = await getCaptured();
    if (!captured.includes(tabId)) await setCaptured([...captured, tabId]);
    await showRunningBanner(tabId, minutes);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Stop holding one tab (user switched it off, or the tab went away). */
async function releaseCapture(tabId: number): Promise<void> {
  const captured = await getCaptured();
  if (!captured.includes(tabId)) return;
  if (await hasOffscreen()) {
    const msg: OffscreenRequest = { type: "offscreen:stop", tabId };
    await chrome.runtime.sendMessage(msg).catch(() => undefined);
  }
  const { [tabId]: _gone, ...ends } = await getCaptureEnds();
  await setCaptureEnds(ends);
  await setCaptured(captured.filter((id) => id !== tabId));
  // Close the strip on the page: a message reaches it even after the activeTab grant is gone.
  void chrome.tabs.sendMessage(tabId, { type: "banner:close" }).catch(() => removeBanner(tabId));
  await closeOffscreenIfIdle();
}

/** Extend a held tab's timer by `minutes` (0 removes it), capped at a day from now. */
async function adjustCapture(tabId: number, minutes: number): Promise<CaptureResult> {
  if (!(await getCaptured()).includes(tabId)) return { ok: false, error: "not held" };
  const ends = await getCaptureEnds();
  const now = Date.now();
  const current = ends[tabId] ?? 0;
  const base = current > now ? current : now;
  const next = minutes === 0 ? 0 : Math.min(base + minutes * 60_000, now + TIMER_MAX_MIN * 60_000);
  const msg: OffscreenRequest = { type: "offscreen:retime", tabId, endsAt: next };
  await chrome.runtime.sendMessage(msg).catch(() => undefined);
  await setCaptureEnds({ ...ends, [tabId]: next });
  return { ok: true };
}

chrome.runtime.onMessage.addListener(
  (msg: CaptureRequest | CaptureEnded, sender, sendResponse) => {
    switch (msg?.type) {
      case "capture:start":
        void startCapture(msg.tabId, msg.minutes).then(sendResponse);
        return true;
      case "capture:stop":
        void releaseCapture(msg.tabId).then(() => sendResponse({ ok: true } satisfies CaptureResult));
        return true;
      case "capture:adjust":
        void adjustCapture(msg.tabId, msg.minutes).then(sendResponse);
        return true;
      case "capture:stop-self":
        if (sender.tab?.id != null) void releaseCapture(sender.tab.id);
        return false;
      case "capture:ended":
        void releaseCapture(msg.tabId);
        return false;
      default:
        return false;
    }
  },
);

// ── Toolbar icon: mark tabs held by "Keep running" ────────────────────────────

/** Mark the toolbar icon on every tab while anything is held; restore it when nothing is. */
async function setRunningIcon(running: boolean): Promise<void> {
  try {
    if (running) {
      await chrome.action.setIcon({ imageData: await drawIcons("running") });
      await chrome.action.setTitle({ title: chrome.i18n.getMessage("actionTitleRunning") });
    } else {
      await chrome.action.setIcon({ path: DEFAULT_ICON_PATHS });
      await chrome.action.setTitle({ title: chrome.i18n.getMessage("actionTitle") });
    }
  } catch {
    // Icon assets unavailable — the popup and settings still show what is held.
  }
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
  // A new document load ends the popup's activeTab grant for this tab.
  if (changeInfo.status === "loading") void setInvoked(tabId, false);
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
  void releaseCapture(tabId); // no-op when the tab wasn't captured
  void setInvoked(tabId, false);
  void updateBadge();
});

chrome.tabs.onReplaced.addListener(() => {
  void updateBadge();
});

// ── Settings / override changes → single re-evaluation path ──────────────────

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes[CAPTURES_KEY]) {
    const before = (changes[CAPTURES_KEY].oldValue ?? []) as number[];
    const after = (changes[CAPTURES_KEY].newValue ?? []) as number[];
    if ((before.length > 0) !== (after.length > 0)) void setRunningIcon(after.length > 0);
  }
  if (
    (area === "sync" && changes[SETTINGS_KEY]) ||
    (area === "session" && changes[OVERRIDES_KEY])
  ) {
    void applyToAllTabs();
  }
});
