/** Popup UI — reflects settings + live tab state, writes settings only. */

import { clearActivationsForHost, setActivation } from "./shared/activations.js";
import { getHostname, matchesAny } from "./shared/domains.js";
import { localizePage, t } from "./shared/i18n.js";
import { getOverrides, removeTabOverride, setTabOverride } from "./shared/overrides.js";
import { effectiveProtect, shouldProtect } from "./shared/protection.js";
import { getSettings, saveSettings } from "./shared/settings.js";
import { applyTheme } from "./shared/theme.js";
import { MAX_DOMAINS, type Settings, type TabOverrides } from "./shared/types.js";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const els = {
  app: $("app"),
  master: $<HTMLInputElement>("masterToggle"),
  count: $("protectedCount"),
  statusText: $("statusText"),
  favicon: $<HTMLImageElement>("siteFavicon"),
  host: $("siteHost"),
  siteToggle: $<HTMLInputElement>("siteToggle"),
  tabPath: $("tabPath"),
  tabToggle: $<HTMLInputElement>("tabToggle"),
  hint: $("siteHint"),
  protectNote: $("protectNote"),
  protectIcon: $("protectIcon"),
  protectText: $("protectText"),
  openOptions: $<HTMLButtonElement>("openOptions"),
};

async function render(): Promise<void> {
  const [settings, overrides] = await Promise.all([getSettings(), getOverrides()]);
  applyTheme(settings.theme);

  els.master.checked = settings.enabled;
  els.app.dataset.enabled = String(settings.enabled);
  els.statusText.textContent = settings.enabled ? t("statusActive") : t("statusPaused");

  const tabs = await chrome.tabs.query({});
  const protectedCount = tabs.filter((t) => effectiveProtect(t, settings, overrides)).length;
  els.count.textContent = String(protectedCount);

  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  renderCurrentTab(settings, overrides, active);
  renderProtectNote(settings, overrides, active);
}

const SVG_NS = "http://www.w3.org/2000/svg";
/** Icon for the protection summary: shield-check (on), moon (off), pause (paused). */
function makeNoteIcon(state: "paused" | "on" | "off"): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  const add = (d: string, w = "1.7"): void => {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    p.setAttribute("stroke", "currentColor");
    p.setAttribute("stroke-width", w);
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("stroke-linejoin", "round");
    svg.appendChild(p);
  };
  if (state === "on") {
    add("M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z");
    add("M9 12l2 2 4-4");
  } else if (state === "off") {
    add("M20 14.5A8 8 0 019.5 4a7 7 0 100 16 8 8 0 0010.5-5.5z");
  } else {
    add("M9 6v12", "2");
    add("M15 6v12", "2");
  }
  return svg;
}

/** Plain-language summary of whether the current tab will survive auto-discarding. */
function renderProtectNote(
  settings: Settings,
  overrides: TabOverrides,
  active: chrome.tabs.Tab | undefined,
): void {
  const state: "paused" | "on" | "off" = !settings.enabled
    ? "paused"
    : active && effectiveProtect(active, settings, overrides)
      ? "on"
      : "off";

  els.protectNote.dataset.state = state;
  els.protectIcon.replaceChildren(makeNoteIcon(state));
  els.protectText.textContent =
    state === "paused"
      ? t("popupSummaryPaused")
      : state === "on"
        ? t("popupSummaryProtected")
        : t("popupSummaryDiscardable");
}

/** Path part of the URL, shown under the "This tab" label. */
function pathOf(url: string | undefined): string {
  if (!url) return "—";
  try {
    const u = new URL(url);
    return (u.pathname || "/") + u.search;
  } catch {
    return "—";
  }
}

function renderCurrentTab(
  settings: Settings,
  overrides: TabOverrides,
  active: chrome.tabs.Tab | undefined,
): void {
  const host = getHostname(active?.url);

  els.favicon.src = active?.favIconUrl ?? "";

  // Site-level switch — reflects the domain rules.
  const siteOnByRule = host
    ? settings.mode === "whitelist"
      ? matchesAny(host, settings.whitelistedDomains)
      : !matchesAny(host, settings.excludedDomains)
    : false;

  els.host.textContent = host ?? (active ? t("internalPage") : "—");
  els.host.title = host ?? "";
  els.siteToggle.checked = !!host && siteOnByRule;
  els.siteToggle.disabled = !settings.enabled || !host;
  els.siteToggle.dataset.host = host ?? "";
  els.siteToggle.dataset.tabId = active?.id != null ? String(active.id) : "";

  // Tab-level switch — identify the page by its title (human-readable), falling
  // back to the URL path when a title is missing. A bare UUID path tells the
  // user nothing; the title ("ChatGPT", "Weekly planning — Notion") does.
  const tabTitle = active?.title?.trim();
  els.tabPath.textContent = tabTitle || (host ? pathOf(active?.url) : "—");
  els.tabPath.title = els.tabPath.textContent ?? "";
  els.tabToggle.checked = active ? effectiveProtect(active, settings, overrides) : false;
  els.tabToggle.disabled = !settings.enabled || active?.id == null;
  els.tabToggle.dataset.tabId = active?.id != null ? String(active.id) : "";
  els.tabToggle.dataset.url = active?.url ?? "";
  els.tabToggle.dataset.title = active?.title ?? "";

  // Internal pages have no site rules — only the tab switch applies.
  els.hint.hidden = !(active && !host);
  if (active && !host) els.hint.textContent = t("internalPageTabOnly");
}

// ── Events ────────────────────────────────────────────────────────────────

els.master.addEventListener("change", () => {
  void saveSettings({ enabled: els.master.checked });
});

// Site switch: edit the domain rules, then drop this tab's manual override —
// a site-level decision is decisive.
els.siteToggle.addEventListener("change", async () => {
  const host = els.siteToggle.dataset.host;
  if (!host) return;
  const wantProtected = els.siteToggle.checked;
  const settings = await getSettings();
  const covers = (d: string) => host === d || host.endsWith("." + d);

  const key = settings.mode === "whitelist" ? "whitelistedDomains" : "excludedDomains";
  const list = settings.mode === "whitelist" ? settings.whitelistedDomains : settings.excludedDomains;
  // In whitelist mode the list holds protected sites; in exclude mode, discardable ones.
  const addToList = (settings.mode === "whitelist") === wantProtected;

  if (addToList) {
    if (list.length >= MAX_DOMAINS) {
      void render(); // revert the switch
      return;
    }
    if (!list.some(covers)) {
      await saveSettings({ [key]: [...list, host].sort() } as Partial<Settings>);
    }
  } else {
    await saveSettings({ [key]: list.filter((d) => !covers(d)) } as Partial<Settings>);
  }

  const tabId = Number(els.siteToggle.dataset.tabId);
  if (els.siteToggle.dataset.tabId && Number.isFinite(tabId)) await removeTabOverride(tabId);
  // A site-level decision governs the whole host, so per-tab memory is moot.
  await clearActivationsForHost(host);
});

// Tab switch: one-time override relative to the rules; remembered by URL for 7 days.
els.tabToggle.addEventListener("change", async () => {
  const raw = els.tabToggle.dataset.tabId;
  const tabId = Number(raw);
  if (!raw || !Number.isFinite(tabId)) return;
  const desired = els.tabToggle.checked;
  const url = els.tabToggle.dataset.url || undefined;
  const title = els.tabToggle.dataset.title || undefined;
  const settings = await getSettings();
  const ruleState = shouldProtect(url, settings);
  const override = desired === ruleState ? null : desired ? "protect" : "discard";
  await setTabOverride(tabId, override, url);
  await setActivation(url, override, { title });
});

els.openOptions.addEventListener("click", () => chrome.runtime.openOptionsPage());

// Re-render whenever settings or per-tab overrides change.
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "sync" || area === "session") void render();
});

localizePage();
void render();
