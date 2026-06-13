/**
 * Options page — the control center.
 *
 * The hero is a live list of ALL open tabs, each with its own protect switch.
 * Rows never disappear when you flip a switch — the state just changes in
 * place. A manual switch writes a per-tab override (storage.session) that
 * beats the domain rules; the background worker reacts via storage.onChanged.
 */

import {
  activationKey,
  clearActivationsForHost,
  getActivations,
  setActivation,
} from "./shared/activations.js";
import { getHostname, matchesAny, normalizeDomain } from "./shared/domains.js";
import { localizePage, t } from "./shared/i18n.js";
import { getOverrides, setTabOverride } from "./shared/overrides.js";
import { effectiveProtect, shouldProtect } from "./shared/protection.js";
import { getSettings, saveSettings } from "./shared/settings.js";
import { hideBar, showBar } from "./shared/pagefx.js";
import { getStats, resetStats } from "./shared/stats.js";
import { applyTheme } from "./shared/theme.js";
import { maybeAutoStartTour, startTour, type TourStep } from "./tour.js";
import {
  MAX_DOMAINS,
  type Settings,
  type TabOverrides,
  type ThemePref,
  type UrlActivations,
} from "./shared/types.js";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const els = {
  master: $<HTMLInputElement>("masterToggle"),
  startTour: $<HTMLButtonElement>("startTour"),
  themeBtns: Array.from(document.querySelectorAll<HTMLButtonElement>(".seg__btn")),
  statProtected: $("statProtected"),
  statOpen: $("statOpen"),
  statOps: $("statOps"),
  statDiscards: $("statDiscards"),
  statsSince: $("statsSince"),
  resetStats: $<HTMLButtonElement>("resetStats"),
  modeInputs: Array.from(document.querySelectorAll<HTMLInputElement>('input[name="mode"]')),
  tabsCount: $("tabsCount"),
  tabSearch: $<HTMLInputElement>("tabSearch"),
  tabGroups: $("tabGroups"),
  tabsEmpty: $("tabsEmpty"),
  listTitle: $("listTitle"),
  listDesc: $("listDesc"),
  rulesCount: $("rulesCount"),
  form: $<HTMLFormElement>("domainForm"),
  input: $<HTMLInputElement>("domainInput"),
  error: $("domainError"),
  list: $<HTMLUListElement>("domainList"),
  empty: $("domainEmpty"),
};

const OPTIONS_TOUR: TourStep[] = [
  {
    target: "#masterSwitch",
    title: t("tourMasterTitle"),
    body: t("tourMasterBody"),
  },
  {
    target: "#modePanel",
    title: t("tourModeTitle"),
    body: t("tourModeBody"),
  },
  {
    target: "#tabsPanel",
    title: t("tourTabsTitle"),
    body: t("tourTabsBody"),
  },
  {
    target: "#rulesPanel",
    title: t("tourRulesTitle"),
    body: t("tourRulesBody"),
  },
];

function activeList(s: Settings): { key: keyof Settings; domains: string[] } {
  return s.mode === "whitelist"
    ? { key: "whitelistedDomains", domains: s.whitelistedDomains }
    : { key: "excludedDomains", domains: s.excludedDomains };
}

// Collapse bursts of tab/storage events into one re-render.
let renderTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleRender(): void {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => void render(), 80);
}

// Bottom-center toast — answers "I clicked, what happened?".
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function showToast(message: string, isError = false): void {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.toggle("toast--error", isError);
  toast.classList.add("toast--show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("toast--show"), 3500);
}

// ── Render ────────────────────────────────────────────────────────────────

async function render(): Promise<void> {
  const [settings, overrides, stats, tabs, activations] = await Promise.all([
    getSettings(),
    getOverrides(),
    getStats(),
    chrome.tabs.query({}),
    getActivations(),
  ]);

  applyTheme(settings.theme);
  els.master.checked = settings.enabled;

  for (const r of els.modeInputs) r.checked = r.value === settings.mode;
  for (const btn of els.themeBtns) {
    btn.setAttribute("aria-checked", String(btn.dataset.theme === settings.theme));
  }

  // Stats strip
  const protectedNow = tabs.filter((t) => effectiveProtect(t, settings, overrides)).length;
  els.statProtected.textContent = String(protectedNow);
  els.statOpen.textContent = String(tabs.length);
  els.statOps.textContent = stats.protectOps.toLocaleString();
  els.statDiscards.textContent = stats.discardEventsObserved.toLocaleString();
  els.statsSince.textContent = stats.installedAt
    ? t(
        "statsSince",
        new Date(stats.installedAt).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        }),
      )
    : " ";

  renderTabs(settings, overrides, tabs, activations);
  renderRules(settings);
}

// Sentinel key for tabs with no web host (chrome://, extension pages, …).
const INTERNAL_GROUP = "::keep-tabs-internal::";

// Which host groups are expanded. Host groups start collapsed each visit; the
// internal-pages group starts expanded (seeded here) but stays collapsible.
const expandedHosts = new Set<string>([INTERNAL_GROUP]);

const SVG_NS = "http://www.w3.org/2000/svg";
/** A chevron pointing right when collapsed; CSS rotates it down when expanded. */
function makeChevron(): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "tab-group__chevron");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M9 6l6 6-6 6");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2.2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
  return svg;
}

/** A neutral globe — fallback when a group has no usable favicon. */
function makeGlobe(): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const stroke = (d: string): SVGElement => {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", "currentColor");
    p.setAttribute("stroke-width", "1.6");
    return p;
  };
  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("cx", "12");
  circle.setAttribute("cy", "12");
  circle.setAttribute("r", "9");
  circle.setAttribute("fill", "none");
  circle.setAttribute("stroke", "currentColor");
  circle.setAttribute("stroke-width", "1.6");
  svg.append(circle, stroke("M3 12h18"), stroke("M12 3a14 14 0 010 18a14 14 0 010-18"));
  return svg;
}

/** Logo shown before the host name: the group's favicon, or a globe fallback. */
function makeGroupIcon(host: string, group: chrome.tabs.Tab[]): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "tab-group__icon";
  const fav =
    host !== INTERNAL_GROUP ? group.find((t) => t.favIconUrl)?.favIconUrl : undefined;
  if (fav) {
    const img = document.createElement("img");
    img.src = fav;
    img.alt = "";
    img.addEventListener("error", () => wrap.replaceChildren(makeGlobe()));
    wrap.appendChild(img);
  } else {
    wrap.appendChild(makeGlobe());
  }
  return wrap;
}

/** A remembered activation whose tab is currently closed. */
interface Ghost {
  url: string;
  title?: string;
}
/** A group row is either a live open tab or a closed-but-remembered ghost. */
type Item = { tab: chrome.tabs.Tab } | { ghost: Ghost };
const isGhost = (it: Item): it is { ghost: Ghost } => "ghost" in it;

function renderTabs(
  settings: Settings,
  overrides: TabOverrides,
  tabs: chrome.tabs.Tab[],
  activations: UrlActivations,
): void {
  els.tabsCount.textContent = String(tabs.length);

  // Keys of currently-open tabs — so a remembered tab that's open isn't doubled.
  const openKeys = new Set<string>();
  for (const tab of tabs) {
    const k = activationKey(tab.url);
    if (k) openKeys.add(k);
  }
  // Ghosts: "protect" memories whose tab is closed — kept visible so the user
  // can still deactivate them.
  const ghosts: Ghost[] = [];
  for (const [key, a] of Object.entries(activations)) {
    if (a.value !== "protect" || openKeys.has(key)) continue;
    ghosts.push({ url: key, title: a.title });
  }

  const q = els.tabSearch.value.trim().toLowerCase();
  const matchTab = (t: chrome.tabs.Tab) =>
    (t.title ?? "").toLowerCase().includes(q) || (t.url ?? "").toLowerCase().includes(q);
  const matchGhost = (g: Ghost) =>
    (g.title ?? "").toLowerCase().includes(q) || g.url.toLowerCase().includes(q);
  const visibleTabs = q ? tabs.filter(matchTab) : tabs;
  const visibleGhosts = q ? ghosts.filter(matchGhost) : ghosts;

  els.tabGroups.replaceChildren();
  const totalVisible = visibleTabs.length + visibleGhosts.length;
  els.tabsEmpty.hidden = totalVisible > 0;
  els.tabsEmpty.textContent =
    tabs.length + ghosts.length === 0 ? t("noOpenTabs") : t("noTabsMatch");

  // Group by host; internal pages share one bucket shown last.
  const byHost = new Map<string, Item[]>();
  const push = (host: string, item: Item): void => {
    const group = byHost.get(host);
    if (group) group.push(item);
    else byHost.set(host, [item]);
  };
  for (const tab of visibleTabs) push(getHostname(tab.url) ?? INTERNAL_GROUP, { tab });
  for (const g of visibleGhosts) push(getHostname(g.url) ?? INTERNAL_GROUP, { ghost: g });

  // Stable order: hosts alphabetically, internal pages last.
  const hosts = [...byHost.keys()].sort((a, b) => {
    if (a === INTERNAL_GROUP) return 1;
    if (b === INTERNAL_GROUP) return -1;
    return a.localeCompare(b);
  });

  for (const host of hosts) {
    const items = byHost.get(host)!;
    // Open tabs first (by window/index), then closed ghosts (by name).
    items.sort((a, b) => {
      if (isGhost(a) !== isGhost(b)) return isGhost(a) ? 1 : -1;
      if (isGhost(a) && isGhost(b)) {
        return (a.ghost.title ?? a.ghost.url).localeCompare(b.ghost.title ?? b.ghost.url);
      }
      const ta = (a as { tab: chrome.tabs.Tab }).tab;
      const tb = (b as { tab: chrome.tabs.Tab }).tab;
      return ta.windowId - tb.windowId || ta.index - tb.index;
    });
    const groupTabs = items.filter((it): it is { tab: chrome.tabs.Tab } => !isGhost(it)).map((it) => it.tab);
    const pinnedCount = groupTabs.filter((t) => t.pinned).length;
    // Tabs individually kept alive (per-tab override or a closed ghost) — the
    // signal a collapsed group would otherwise hide.
    const activeCount = items.reduce((n, it) => {
      if (isGhost(it)) return n + 1;
      return n + (it.tab.id != null && overrides[it.tab.id]?.value === "protect" ? 1 : 0);
    }, 0);
    const keptAlive = host !== INTERNAL_GROUP && siteKeptAlive(host, settings);
    // Collapsed by default; a search query force-expands so results are visible.
    const isExpanded = q !== "" || expandedHosts.has(host);

    // Each group is its own rounded card so the boundaries read clearly.
    const card = document.createElement("section");
    card.className = "tab-group";
    if (isExpanded) card.classList.add("is-expanded");

    const head = document.createElement("div");
    head.className = "tab-group__head";

    // Clickable region (chevron + logo + host + count) toggles the group.
    const toggle = document.createElement("button");
    toggle.className = "tab-group__toggle";
    toggle.setAttribute("aria-expanded", String(isExpanded));
    toggle.append(makeChevron(), makeGroupIcon(host, groupTabs));
    const name = document.createElement("span");
    name.className = "tab-group__host";
    name.textContent = host === INTERNAL_GROUP ? t("internalPagesGroup") : host;
    name.title = name.textContent;
    const count = document.createElement("span");
    count.className = "tab-group__count";
    count.textContent = String(items.length);
    toggle.append(name, count);
    toggle.addEventListener("click", () => {
      if (expandedHosts.has(host)) expandedHosts.delete(host);
      else expandedHosts.add(host);
      void render();
    });
    head.append(toggle);

    // Kept-alive count stays visible whether collapsed or expanded (unless the
    // whole site is kept alive, which the toggle already shows).
    if (activeCount > 0 && !keptAlive) head.append(makeActiveBadge(activeCount));
    // Pinned flag only matters while collapsed — expanded rows carry their own tag.
    if (!isExpanded && pinnedCount > 0 && host !== INTERNAL_GROUP) {
      head.append(makePinBadge(pinnedCount, keptAlive));
    }

    // Site-wide "keep alive" switch — internal pages have no domain rule.
    if (host !== INTERNAL_GROUP) {
      const label = document.createElement("span");
      label.className = "tab-group__alive";
      label.textContent = t("keepSiteAlive");
      head.append(label, makeSiteSwitch(host, groupTabs, settings));
    }
    card.appendChild(head);

    // Rows only when expanded — collapsed groups show just the header + count.
    if (isExpanded) {
      const ul = document.createElement("ul");
      ul.className = "tab-list";
      for (const item of items) {
        ul.appendChild(
          isGhost(item)
            ? makeGhostRow(item.ghost, settings)
            : makeTabRow(item.tab, settings, overrides, false),
        );
      }
      card.appendChild(ul);
    }
    els.tabGroups.appendChild(card);
  }
}

const PIN_PATH =
  "M12 17v5 M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z";
function makePin(): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const d of PIN_PATH.trim().split(" M")) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d.startsWith("M") ? d : "M" + d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
  }
  return svg;
}

/** Header chip showing how many tabs in a collapsed group are kept alive. */
function makeActiveBadge(count: number): HTMLElement {
  const el = document.createElement("span");
  el.className = "tab-group__active";
  el.title = t("groupActiveCount", String(count));
  const dot = document.createElement("span");
  dot.className = "dot";
  el.append(dot);
  const n = document.createElement("span");
  n.textContent = String(count);
  el.append(n);
  return el;
}

/** Header chip flagging pinned tabs hidden inside a collapsed group. */
function makePinBadge(count: number, keptAlive: boolean): HTMLElement {
  const el = document.createElement("span");
  el.className = "tab-group__pins" + (keptAlive ? "" : " tab-group__pins--warn");
  el.title = keptAlive ? t("groupHasPinned") : t("groupPinnedUnprotected");
  el.append(makePin());
  const n = document.createElement("span");
  n.textContent = String(count);
  el.append(n);
  return el;
}

function makeTabRow(
  tab: chrome.tabs.Tab,
  settings: Settings,
  overrides: TabOverrides,
  showHost = true,
): HTMLLIElement {
  const host = getHostname(tab.url);
  const isOn = effectiveProtect(tab, settings, overrides);
  const isManual = tab.id != null && overrides[tab.id] !== undefined;

  const li = document.createElement("li");
  li.className = "tab-row";
  if (tab.discarded) li.classList.add("is-asleep");

  // Clickable main area → jump to the tab.
  const main = document.createElement("button");
  main.className = "tab-row__main";
  main.title = t("switchToThisTab");

  const favicon = document.createElement("img");
  favicon.className = "tab-row__favicon";
  favicon.src = tab.favIconUrl ?? "";
  favicon.alt = "";
  favicon.addEventListener("error", () => {
    favicon.style.visibility = "hidden";
  });
  main.appendChild(favicon);

  const text = document.createElement("span");
  text.className = "tab-row__text";

  const title = document.createElement("span");
  title.className = "tab-row__title";
  title.textContent = tab.title || host || tab.url || t("untitledTab");
  text.appendChild(title);

  // Sub-line: host (unless shown in a group header) + state tags.
  const tags = tabTags(tab, isManual);
  if (showHost || tags.length) {
    const sub = document.createElement("span");
    sub.className = "tab-row__sub";
    if (showHost) {
      const hostEl = document.createElement("span");
      hostEl.className = "tab-row__host";
      hostEl.textContent = host ?? t("internalPage");
      sub.appendChild(hostEl);
    }
    for (const tag of tags) sub.appendChild(tag);
    text.appendChild(sub);
  }

  main.appendChild(text);
  main.addEventListener("click", () => void focusTab(tab));
  li.appendChild(main);

  // Per-tab protect switch (one-time override). Site-wide rule lives in the group head.
  const sw = document.createElement("label");
  sw.className = "switch switch--sm";
  sw.title = !settings.enabled
    ? t("switchPausedByMaster")
    : isOn
      ? t("switchProtectedFlip")
      : t("switchDiscardableFlip");

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = isOn;
  input.disabled = !settings.enabled || tab.id == null;
  input.addEventListener("change", () => void onToggleTab(tab, input.checked));
  sw.appendChild(input);

  const track = document.createElement("span");
  track.className = "switch__track";
  const thumb = document.createElement("span");
  thumb.className = "switch__thumb";
  track.appendChild(thumb);
  sw.appendChild(track);

  li.appendChild(sw);
  return li;
}

/**
 * A row for a remembered-but-closed tab. It can't be focused; its switch is on
 * (the activation lives) and flipping it off forgets the activation.
 */
function makeGhostRow(ghost: Ghost, settings: Settings): HTMLLIElement {
  const host = getHostname(ghost.url);

  const li = document.createElement("li");
  li.className = "tab-row is-ghost";

  // Static main area (the tab is closed — nothing to focus).
  const main = document.createElement("div");
  main.className = "tab-row__main tab-row__main--static";

  const icon = document.createElement("span");
  icon.className = "tab-row__favicon tab-row__favicon--ghost";
  icon.append(makeGlobe());
  main.appendChild(icon);

  const text = document.createElement("span");
  text.className = "tab-row__text";

  const title = document.createElement("span");
  title.className = "tab-row__title";
  title.textContent = ghost.title || host || ghost.url;
  title.title = ghost.url;
  text.appendChild(title);

  const sub = document.createElement("span");
  sub.className = "tab-row__sub";
  const hostEl = document.createElement("span");
  hostEl.className = "tab-row__host";
  hostEl.textContent = host ?? t("internalPage");
  sub.appendChild(hostEl);
  const tag = document.createElement("span");
  tag.className = "minitag minitag--closed";
  tag.textContent = t("tagClosed");
  sub.appendChild(tag);
  text.appendChild(sub);

  main.appendChild(text);
  li.appendChild(main);

  // Switch reflects the live memory; turning it off forgets the activation.
  const sw = document.createElement("label");
  sw.className = "switch switch--sm";
  sw.title = t("ghostForgetTip");

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = true;
  input.addEventListener("change", () => void onToggleGhost(ghost, input.checked));
  sw.appendChild(input);

  const track = document.createElement("span");
  track.className = "switch__track";
  const thumb = document.createElement("span");
  thumb.className = "switch__thumb";
  track.appendChild(thumb);
  sw.appendChild(track);

  li.appendChild(sw);
  void settings; // master state doesn't gate forgetting a memory
  return li;
}

/** Forget (or re-add) a closed tab's remembered activation. */
async function onToggleGhost(ghost: Ghost, keepAlive: boolean): Promise<void> {
  await setActivation(ghost.url, keepAlive ? "protect" : null, { title: ghost.title });
  scheduleRender();
}

function tabTags(tab: chrome.tabs.Tab, isManual: boolean): HTMLSpanElement[] {
  const tags: HTMLSpanElement[] = [];
  const make = (label: string, extra?: string): void => {
    const el = document.createElement("span");
    el.className = "minitag" + (extra ? ` ${extra}` : "");
    el.textContent = label;
    tags.push(el);
  };
  if (isManual) make(t("tagManual"), "minitag--manual");
  if (tab.discarded) make(t("tagAsleep"));
  if (tab.pinned) make(t("tagPinned"));
  if (tab.audible && !tab.mutedInfo?.muted) make(t("tagPlaying"));
  return tags;
}

/** Flip one tab. Store an override only when it differs from the site rules. */
async function onToggleTab(tab: chrome.tabs.Tab, desired: boolean): Promise<void> {
  if (tab.id == null) return;
  const settings = await getSettings();
  const ruleState = shouldProtect(tab.url, settings);
  const override = desired === ruleState ? null : desired ? "protect" : "discard";
  await setTabOverride(tab.id, override, tab.url);
  // Remember the decision by URL so it survives close/reopen for 7 days.
  await setActivation(tab.url, override, { title: tab.title });
  scheduleRender(); // covers the no-op-write case; storage events cover the rest
}

/** Whether the whole site is permanently kept alive by the rules (ignores overrides). */
function siteKeptAlive(host: string, settings: Settings): boolean {
  return settings.mode === "whitelist"
    ? matchesAny(host, settings.whitelistedDomains)
    : !matchesAny(host, settings.excludedDomains);
}

/** Build the site-wide "keep this whole host alive" switch shown in a group head. */
function makeSiteSwitch(
  host: string,
  groupTabs: chrome.tabs.Tab[],
  settings: Settings,
): HTMLLabelElement {
  const sw = document.createElement("label");
  sw.className = "switch switch--sm";
  sw.title = settings.enabled ? t("keepSiteAliveTip", host) : t("switchPausedByMaster");

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = siteKeptAlive(host, settings);
  input.disabled = !settings.enabled;
  input.addEventListener("change", () => void setSiteAlive(host, groupTabs, input.checked));
  sw.appendChild(input);

  const track = document.createElement("span");
  track.className = "switch__track";
  const thumb = document.createElement("span");
  thumb.className = "switch__thumb";
  track.appendChild(thumb);
  sw.appendChild(track);
  return sw;
}

/**
 * Flip the permanent site rule for a whole host, then clear per-tab overrides for
 * its tabs — a site-level decision is decisive, so every tab of the host follows.
 */
async function setSiteAlive(
  host: string,
  groupTabs: chrome.tabs.Tab[],
  keepAlive: boolean,
): Promise<void> {
  const settings = await getSettings();
  const whitelist = settings.mode === "whitelist";
  const key = whitelist ? "whitelistedDomains" : "excludedDomains";
  const list = whitelist ? settings.whitelistedDomains : settings.excludedDomains;
  const covers = (d: string) => host === d || host.endsWith("." + d);
  // Keeping a site alive means: present in the whitelist, or absent from the exclude list.
  const shouldList = whitelist ? keepAlive : !keepAlive;

  if (shouldList) {
    if (list.length >= MAX_DOMAINS) {
      showToast(t("errorMaxDomains", String(MAX_DOMAINS)), true);
      return;
    }
    if (!list.some(covers)) {
      await saveSettings({ [key]: [...list, host].sort() } as Partial<Settings>);
    }
  } else {
    await saveSettings({ [key]: list.filter((d) => !covers(d)) } as Partial<Settings>);
  }

  await Promise.all(
    groupTabs.map((t) => (t.id != null ? setTabOverride(t.id, null) : Promise.resolve())),
  );
  // A site-level decision governs the whole host, so per-tab memory is moot.
  await clearActivationsForHost(host);
}

/** Activate a tab and focus its window. */
async function focusTab(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id == null) return;
  try {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } catch {
    // Tab/window gone — the list refreshes on the next event.
  }
}

function renderRules(settings: Settings): void {
  const whitelist = settings.mode === "whitelist";
  const { domains } = activeList(settings);

  els.listTitle.textContent = whitelist ? t("protectedSites") : t("excludedSites");
  els.rulesCount.textContent = String(domains.length);
  els.listDesc.innerHTML = whitelist ? t("listDescWhitelist") : t("listDescExclude");
  els.input.placeholder = whitelist
    ? t("domainPlaceholderWhitelist")
    : t("domainPlaceholderExclude");

  els.list.replaceChildren();
  els.empty.hidden = domains.length > 0;

  for (const domain of domains) {
    const li = document.createElement("li");
    li.className = "domain-row";

    const name = document.createElement("span");
    name.className = "domain-row__name";
    name.textContent = domain;
    li.appendChild(name);

    const remove = document.createElement("button");
    remove.className = "domain-row__remove";
    remove.textContent = t("remove");
    remove.addEventListener("click", () => void removeDomain(domain));
    li.appendChild(remove);

    els.list.appendChild(li);
  }
}

async function removeDomain(domain: string): Promise<void> {
  const settings = await getSettings();
  const { key, domains } = activeList(settings);
  await saveSettings({ [key]: domains.filter((d) => d !== domain) } as Partial<Settings>);
}

function showError(msg: string): void {
  els.error.textContent = msg;
  els.error.hidden = false;
}

// ── Events ────────────────────────────────────────────────────────────────

els.master.addEventListener("change", () => {
  void saveSettings({ enabled: els.master.checked });
});

for (const radio of els.modeInputs) {
  radio.addEventListener("change", () => {
    if (radio.checked) void saveSettings({ mode: radio.value as Settings["mode"] });
  });
}

for (const btn of els.themeBtns) {
  btn.addEventListener("click", () => {
    void saveSettings({ theme: btn.dataset.theme as ThemePref });
  });
}

els.tabSearch.addEventListener("input", scheduleRender);

els.startTour.addEventListener("click", () => startTour(OPTIONS_TOUR));

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.error.hidden = true;

  const domain = normalizeDomain(els.input.value);
  if (!domain) {
    showError(t("errorInvalidDomain"));
    return;
  }

  const settings = await getSettings();
  const { key, domains } = activeList(settings);

  if (domains.includes(domain)) {
    showError(t("errorDomainExists", domain));
    return;
  }
  if (domains.length >= MAX_DOMAINS) {
    showError(t("errorMaxDomains", String(MAX_DOMAINS)));
    return;
  }

  await saveSettings({ [key]: [...domains, domain].sort() } as Partial<Settings>);
  els.input.value = "";
  els.input.focus();
});

els.resetStats.addEventListener("click", () => void resetStats());

// React to changes from anywhere: settings (sync), stats (local), overrides (session).
chrome.storage.onChanged.addListener(() => scheduleRender());

// Keep the tab list live while the page is open.
chrome.tabs.onCreated.addListener(scheduleRender);
chrome.tabs.onRemoved.addListener(scheduleRender);
chrome.tabs.onUpdated.addListener(scheduleRender);
chrome.tabs.onReplaced.addListener(scheduleRender);
chrome.tabs.onMoved.addListener(scheduleRender);
chrome.tabs.onAttached.addListener(scheduleRender);
chrome.tabs.onActivated.addListener(scheduleRender);

localizePage();
showBar();
void render().then(() => {
  hideBar();
  void maybeAutoStartTour(OPTIONS_TOUR, "tourSeenV1");
});
