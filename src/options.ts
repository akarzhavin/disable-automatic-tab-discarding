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
import {
  canCapture,
  getCaptureEnds,
  getCaptureMinutes,
  getCaptured,
  getInvoked,
  giveCaptureConsent,
  hasCaptureConsent,
  NOT_INVOKED,
  requestCapture,
  setInvoked,
  setPendingStart,
} from "./shared/capture.js";
import { DEFAULT_ICON_PATHS, drawIcons } from "./shared/icon.js";
import { getHostname, matchesAny, normalizeDomain } from "./shared/domains.js";
import { localizePage, t } from "./shared/i18n.js";
import { getOverrides, setTabOverride } from "./shared/overrides.js";
import { effectiveProtect, shouldProtect } from "./shared/protection.js";
import { getSettings, saveSettings } from "./shared/settings.js";
import { hideBar, showBar } from "./shared/pagefx.js";
import { applyTheme } from "./shared/theme.js";
import { maybeAutoStartTour, startTour, type TourStep } from "./tour.js";
import {
  MAX_DOMAINS,
  PENDING_KEY,
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
  statRunning: $("statRunning"),
  modeInputs: Array.from(document.querySelectorAll<HTMLInputElement>('input[name="mode"]')),
  tabsCount: $("tabsCount"),
  runList: $<HTMLUListElement>("runList"),
  runEmpty: $("runEmpty"),
  stopAll: $<HTMLButtonElement>("stopAll"),
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
    target: "#runPanel",
    title: t("tourRunTitle"),
    body: t("tourRunBody"),
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

// Where the user last clicked. Rows re-render right after a click, so keep the rectangle,
// not the element. A message that answers that click is shown right there.
let lastClick: { rect: DOMRect; at: number } | null = null;
document.addEventListener(
  "pointerdown",
  (e) => {
    const target = (e.target as Element | null)?.closest("button, label, a, input") ?? (e.target as Element | null);
    if (target) lastClick = { rect: target.getBoundingClientRect(), at: Date.now() };
  },
  true,
);

/** Put a toast just under (or above, near the bottom) the last click; else bottom-centre. */
function placeNearLastClick(el: HTMLElement): void {
  const recent = lastClick && Date.now() - lastClick.at < 15_000 ? lastClick.rect : null;
  el.classList.toggle("toast--anchored", !!recent);
  if (!recent) {
    el.style.left = el.style.top = "";
    return;
  }
  const gap = 8;
  const w = el.offsetWidth || 360;
  const h = el.offsetHeight || 48;
  const left = Math.min(Math.max(16, recent.right - w), window.innerWidth - w - 16);
  const below = recent.bottom + gap;
  const top = below + h < window.innerHeight - 8 ? below : Math.max(8, recent.top - gap - h);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

// Bottom-center toast — answers "I clicked, what happened?".
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function showToast(
  message: string,
  isError = false,
  action?: { label: string; run: () => void },
): void {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  const el = toast;
  el.replaceChildren(document.createTextNode(message));
  if (action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toast__action";
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      el.classList.remove("toast--show");
      action.run();
    });
    el.append(btn);
  }
  el.classList.toggle("toast--error", isError);
  el.classList.toggle("toast--action", !!action);
  placeNearLastClick(el);
  el.classList.add("toast--show");
  clearTimeout(toastTimer);
  // Give the user time to reach the button.
  toastTimer = setTimeout(() => el.classList.remove("toast--show"), action ? 9000 : 3500);
}

/** Ids of tabs held by "Keep running", refreshed on every render. */
let running = new Set<number>();
/** Tabs where Keep running can start from here (the popup was opened on them). */
let invoked = new Set<number>();
/** Whether the user already confirmed the screen-recording explainer (refreshed on render). */
let captureConsent = false;

// ── Render ────────────────────────────────────────────────────────────────

async function render(): Promise<void> {
  const [settings, overrides, tabs, activations, captured] = await Promise.all([
    getSettings(),
    getOverrides(),
    chrome.tabs.query({}),
    getActivations(),
    getCaptured(),
  ]);
  running = new Set(captured);
  captureConsent = await hasCaptureConsent();
  invoked = new Set(await getInvoked());

  applyTheme(settings.theme);
  els.master.checked = settings.enabled;

  for (const r of els.modeInputs) r.checked = r.value === settings.mode;
  for (const btn of els.themeBtns) {
    btn.setAttribute("aria-checked", String(btn.dataset.theme === settings.theme));
  }

  // Counts on the two mode cards
  const protectedNow = tabs.filter((t) => effectiveProtect(t, settings, overrides)).length;
  els.statProtected.textContent = String(protectedNow);
  els.statRunning.textContent = String(tabs.filter((t) => t.id != null && running.has(t.id)).length);

  renderRunList(tabs, await getCaptureEnds());

  renderTabs(settings, overrides, tabs, activations);
  renderRules(settings);
}

/** "1 h 20 min" / "45 min" left on a timer. */
function formatLeft(ms: number): string {
  const total = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return [h ? `${h} ${t("unitHour")}` : "", m ? `${m} ${t("unitMin")}` : ""].filter(Boolean).join(" ");
}

/** The Keep running card: every held tab, its time left, a way to stop it. */
function renderRunList(tabs: chrome.tabs.Tab[], ends: Record<number, number>): void {
  const held = tabs.filter((tab) => tab.id != null && running.has(tab.id));
  els.runEmpty.hidden = held.length > 0;
  els.stopAll.hidden = held.length < 2;
  els.runList.replaceChildren(
    ...held.map((tab) => {
      const id = tab.id as number;
      const li = document.createElement("li");
      li.className = "run-item";
      const main = document.createElement("button");
      main.type = "button";
      main.className = "run-item__main";
      main.title = t("switchToThisTab");
      const fav = document.createElement("img");
      fav.className = "run-item__fav";
      fav.alt = "";
      if (tab.favIconUrl) fav.src = tab.favIconUrl;
      else fav.style.visibility = "hidden";
      fav.addEventListener("error", () => (fav.style.visibility = "hidden"));
      const name = document.createElement("span");
      name.className = "run-item__name";
      name.textContent = tab.title || getHostname(tab.url) || tab.url || "—";
      const left = document.createElement("span");
      left.className = "run-item__left";
      const endsAt = ends[id] ?? 0;
      left.textContent = endsAt > 0 ? formatLeft(endsAt - Date.now()) : "∞";
      main.append(fav, name, left);
      main.addEventListener("click", () => void focusTab(tab));
      const stop = document.createElement("button");
      stop.type = "button";
      stop.className = "run-item__stop";
      stop.title = t("heldStop");
      stop.setAttribute("aria-label", t("heldStop"));
      stop.textContent = "×";
      stop.addEventListener("click", () => void requestCapture(id, false).then(scheduleRender));
      li.append(main, stop);
      return li;
    }),
  );
}

/** One cell of the right-hand columns (in memory · running · keep alive), shared by rows and group heads. */
function colCell(kind: "mem" | "run" | "alive", ...content: Node[]): HTMLElement {
  const el = document.createElement("div");
  el.className = `col col--${kind}`;
  el.append(...content);
  return el;
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
    // The "pick a tab" hint has done its job once a tab here runs.
    if (host === runHintHost && groupTabs.some((tab) => tab.id != null && running.has(tab.id))) {
      runHintHost = null;
    }
    if (host === runHintHost) card.classList.add("hint-run");

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
      if (expandedHosts.has(host)) {
        expandedHosts.delete(host);
        if (runHintHost === host) runHintHost = null;
      }
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

    // The same columns as the rows: the whole site's memory rule, and Keep running —
    // in the header too, so it isn't hidden inside a collapsed group.
    const runnable = groupTabs.filter((t) => t.id != null && canCapture(t.url));
    const cols = document.createElement("div");
    cols.className = "cols";
    cols.append(
      colCell("mem", ...(host !== INTERNAL_GROUP ? [makeSiteSwitch(host, groupTabs, settings)] : [])),
      colCell("run", ...(runnable.length > 0 ? [makeGroupRunButton(host, runnable)] : [])),
      colCell("alive"),
    );
    head.append(cols);
    card.appendChild(head);
    // "Pick a tab" sits inside the group, above the rows it points at — never over them.
    if (host === runHintHost) {
      const hint = document.createElement("p");
      hint.className = "tab-group__hint";
      hint.setAttribute("role", "status");
      hint.textContent = t("groupRunPick");
      card.appendChild(hint);
    }

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
      if (host === runHintHost) applyWave(card);
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

// "Pick one": when a group shows the hint, a single wave runs down its bolt buttons.
// Rows re-render often, so each render resumes the wave where it is (negative delays)
// instead of restarting it, and stops applying it once it has passed.
const WAVE_STEP_MS = 170;
const WAVE_MS = 900;
let runHintAt = 0;

function applyWave(card: HTMLElement): void {
  const bolts = Array.from(card.querySelectorAll<HTMLElement>(".mode-ico--run:not(.is-on)"));
  const elapsed = Date.now() - runHintAt;
  if (elapsed > WAVE_STEP_MS * bolts.length + WAVE_MS) return;
  bolts.forEach((bolt, i) => {
    bolt.classList.add("is-wave");
    bolt.style.animationDelay = `${i * WAVE_STEP_MS - elapsed}ms`;
  });
}

/** Group showing the "pick a tab" hint, until one of its tabs runs or it is collapsed. */
let runHintHost: string | null = null;

/**
 * Header "⚡ Keep running" for a site. It runs one tab at a time: with a single tab it starts
 * it; with several it opens the group and points at the rows' bolt buttons. With tabs
 * already running it shows how many (blue) and stops them.
 */
function makeGroupRunButton(host: string, tabs: chrome.tabs.Tab[]): HTMLButtonElement {
  const held = tabs.filter((tab) => running.has(tab.id as number));
  const on = held.length > 0;
  const btn = document.createElement("button");
  btn.className = "group-run" + (on ? " is-on" : "");
  btn.title = on ? t("groupRunStopTip") : t("groupRunStartTip");
  btn.setAttribute("aria-pressed", String(on));
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", RUN_ICON[0]);
  path.setAttribute("fill", on ? "currentColor" : "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.8");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  btn.setAttribute("aria-label", btn.title);
  btn.append(svg);
  if (on) {
    const n = document.createElement("span");
    n.className = "group-run__count";
    n.textContent = String(held.length);
    btn.append(n);
  }
  btn.addEventListener("click", () => {
    if (on) {
      void Promise.all(held.map((tab) => requestCapture(tab.id as number, false))).then(scheduleRender);
    } else if (tabs.length === 1) {
      void startRunningFromHere(tabs[0]!);
    } else {
      expandedHosts.add(host);
      runHintHost = host; // stays until a tab here is running, or the group is collapsed
      runHintAt = Date.now();
      void render();
    }
  });
  return btn;
}

/** Header chip showing how many tabs in a collapsed group are kept alive. */
function makeActiveBadge(count: number): HTMLElement {
  // Same shape as the "⚡ Keep running" pill: what it is (chip icon + words), then how many.
  const el = document.createElement("span");
  el.className = "tab-group__active";
  el.title = t("groupActiveCount", String(count));
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const d of MEMORY_ICON) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
  }
  const label = document.createElement("span");
  label.textContent = t("groupInMemory");
  const n = document.createElement("span");
  n.className = "tab-group__active-count";
  n.textContent = String(count);
  el.append(svg, label, n);
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
  if (tab.id != null && running.has(tab.id)) li.classList.add("is-running");

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

  li.appendChild(makeModeControls(tab, isOn, !settings.enabled));
  return li;
}

const MEMORY_ICON = [
  "M8.5 6h7a2.5 2.5 0 012.5 2.5v7a2.5 2.5 0 01-2.5 2.5h-7A2.5 2.5 0 016 15.5v-7A2.5 2.5 0 018.5 6z",
  "M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3",
];
const RUN_ICON = ["M13 3L5 13.5h6L10 21l8-10.5h-6L13 3z"];

/** Small round toggle showing one mode's state; a click flips just that mode. */
function modeButton(
  paths: string[],
  kind: "mem" | "run",
  on: boolean,
  title: string,
  disabled: boolean,
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = `mode-ico mode-ico--${kind}` + (on ? " is-on" : "");
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.setAttribute("aria-pressed", String(on));
  btn.disabled = disabled;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.8");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
  }
  btn.append(svg);
  btn.addEventListener("click", onClick);
  return btn;
}

/**
 * A small look-alike of Chrome's toolbar for the hand-over dialog: address bar, other
 * extensions, ours blinking exactly like the real one, the puzzle piece, the profile —
 * and a cursor clicking ours. Shows what to look for before the user goes looking.
 */
function makeMockToolbar(): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "mock-toolbar";
  bar.setAttribute("aria-hidden", "true");

  const omni = document.createElement("span");
  omni.className = "mock-omni";
  const url = document.createElement("span");
  url.className = "mock-url";
  url.textContent = "example.com"; // a stand-in: the picture is about the icons, not the site
  const star = document.createElement("span");
  star.className = "mock-star";
  star.textContent = "☆";
  omni.append(url, star);

  const other = (): HTMLElement => {
    const el = document.createElement("span");
    el.className = "mock-ext";
    return el;
  };

  const ours = document.createElement("span");
  ours.className = "mock-ours";
  const normal = document.createElement("img");
  normal.src = "icons/icon32.png";
  normal.alt = "";
  const lit = document.createElement("img");
  lit.className = "mock-ours__lit";
  lit.alt = "";
  // The same "attention" frame the real icon blinks to.
  void drawIcons("attention").then((frames) => {
    const frame = frames[32];
    if (!frame) return;
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    c.getContext("2d")?.putImageData(frame, 0, 0);
    lit.src = c.toDataURL();
  });
  const cursor = document.createElementNS(SVG_NS, "svg");
  cursor.setAttribute("viewBox", "0 0 24 24");
  cursor.setAttribute("class", "mock-cursor");
  const arrow = document.createElementNS(SVG_NS, "path");
  // The standard arrow pointer: black with a white outline.
  arrow.setAttribute("d", "M5 2.5v16.2l4.1-4 2.7 6.2 2.6-1.1-2.7-6.1h5.8z");
  arrow.setAttribute("fill", "#111111");
  arrow.setAttribute("stroke", "#ffffff");
  arrow.setAttribute("stroke-width", "1.5");
  arrow.setAttribute("stroke-linejoin", "round");
  cursor.append(arrow);
  ours.append(normal, lit, cursor);

  const puzzle = document.createElement("span");
  puzzle.className = "mock-puzzle";
  puzzle.textContent = "🧩";
  const avatar = document.createElement("span");
  avatar.className = "mock-avatar";

  bar.append(omni, other(), other(), ours, puzzle, avatar);
  return bar;
}

// While a hand-over waits for its click, this page (still open in its own tab) blinks the
// toolbar icon on that tab. The worker can't: Chrome puts it to sleep within seconds.
const BLINK_MS = 700;
const BLINK_MAX_MS = 10 * 60 * 1000;
let blink: { tabId: number; timer: ReturnType<typeof setInterval> } | null = null;

async function startBlink(tabId: number): Promise<void> {
  stopBlink();
  const attention = await drawIcons("attention");
  const started = Date.now();
  let lit = false;
  const tick = (): void => {
    if (Date.now() - started > BLINK_MAX_MS) return stopBlink();
    lit = !lit;
    const icon = lit ? { tabId, imageData: attention } : { tabId, path: DEFAULT_ICON_PATHS };
    chrome.action.setIcon(icon).catch(() => stopBlink()); // tab closed
  };
  // The protected-tabs count would cover half the ring; hide it on this tab meanwhile.
  await chrome.action.setBadgeText({ tabId, text: "" }).catch(() => undefined);
  tick();
  blink = { tabId, timer: setInterval(tick, BLINK_MS) };
}

/** Stop blinking and give that tab the icon every other tab has right now. */
function stopBlink(): void {
  if (!blink) return;
  const { tabId, timer } = blink;
  blink = null;
  clearInterval(timer);
  void (async () => {
    const icon =
      running.size > 0 || (await getCaptured()).length > 0
        ? { tabId, imageData: await drawIcons("running") }
        : { tabId, path: DEFAULT_ICON_PATHS };
    await chrome.action.setIcon(icon).catch(() => undefined);
    // null drops this tab's own (empty) badge text, so the shared count shows again.
    await chrome.action.setBadgeText({ tabId, text: null as unknown as string }).catch(() => undefined);
  })();
}

// The popup took the hand-over (or it was dropped): the click happened, stop blinking.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes[PENDING_KEY] && changes[PENDING_KEY].newValue === undefined) {
    stopBlink();
  }
});

/**
 * Keep running can't start from here on a tab the popup hasn't been opened on: Chrome
 * allows it only after a click on the toolbar icon on that tab. Say so up front — what
 * happens and where to click — then hand it over: remember what to finish and switch to
 * the tab. The click on the icon opens the popup, which finishes it.
 * (Opening the popup from here would bring it up without that permission — a dead end.)
 */
function openPopupOn(tab: chrome.tabs.Tab, memory = false): Promise<void> {
  if (tab.id == null) return Promise.resolve();
  const id = tab.id;
  if (!canCapture(tab.url)) return focusTab(tab);
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "consent handoff";

    const title = document.createElement("h2");
    title.className = "consent__title";
    title.textContent = t(memory ? "handoffTitleAlive" : "handoffTitle");

    const steps = document.createElement("ol");
    steps.className = "handoff__steps";
    const step = (text: string, extra?: HTMLElement): void => {
      const li = document.createElement("li");
      const span = document.createElement("span");
      span.textContent = text;
      li.append(span);
      if (extra) li.append(extra);
      steps.append(li);
    };
    step(t("handoffStep1", tab.title || getHostname(tab.url) || tab.url || ""));
    step(t("handoffStep2"), makeMockToolbar());
    step(t(memory ? "handoffStep3Alive" : "handoffStep3"));

    const actions = document.createElement("div");
    actions.className = "consent__actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "consent__btn";
    cancel.textContent = t("consentCancel");
    const go = document.createElement("button");
    go.type = "button";
    go.className = "consent__btn consent__btn--ok";
    go.textContent = t("goToTab");
    actions.append(cancel, go);

    dialog.append(title, steps, actions);
    document.body.append(dialog);
    const done = (): void => {
      dialog.close();
      dialog.remove();
      scheduleRender();
      resolve();
    };
    cancel.addEventListener("click", done);
    dialog.addEventListener("cancel", done);
    go.addEventListener("click", async () => {
      await setPendingStart({ tabId: id, memory, at: Date.now() });
      void startBlink(id);
      done();
      await chrome.tabs.update(id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    });
    dialog.showModal();
    go.focus();
  });
}

/**
 * Start Keep running from this page. Chrome lets us capture a tab only once the extension
 * has been invoked on it (its popup opened there) — site access doesn't count. So this
 * works for tabs the popup was opened on since their last load; for the rest, send the
 * user to the tab, where one click on the toolbar icon does it.
 */
function startRunningFromHere(tab: chrome.tabs.Tab, withMemory = false): Promise<void> {
  if (tab.id == null || !canCapture(tab.url) || !invoked.has(tab.id)) return openPopupOn(tab, withMemory);
  if (!captureConsent) return confirmThenStart(tab, withMemory);
  return tryStart(tab, withMemory);
}

/**
 * Start Keep running; with `withMemory` (Keep alive) turn memory on only once it is running,
 * so the switch never flashes on and falls back off.
 */
async function tryStart(tab: chrome.tabs.Tab, withMemory = false): Promise<void> {
  const id = tab.id as number;
  const minutes = await getCaptureMinutes();
  const res = await requestCapture(id, true, minutes);
  if (res.ok) {
    if (withMemory) await onToggleTab(tab, true);
    scheduleRender();
    return;
  }
  if (NOT_INVOKED.test(res.error ?? "")) {
    // The grant is gone (e.g. the page reloaded): the row turns into "Turn on in tab".
    await setInvoked(id, false);
    showToast(t("runNeedsPopup"), false, {
      label: t("goToTab"),
      run: () => void openPopupOn(tab, withMemory),
    });
  } else {
    // Something else holds a capture of the page; a reload usually clears it.
    showToast(t("captureFailed"), true, {
      label: t("captureReload"),
      run: () => void reloadAndStart(tab),
    });
  }
  scheduleRender();
}

/** Reload the tab, then try again once it has loaded. */
async function reloadAndStart(tab: chrome.tabs.Tab): Promise<void> {
  const id = tab.id as number;
  const loaded = new Promise<void>((resolve) => {
    const onUpdated = (tabId: number, info: { status?: string }): void => {
      if (tabId !== id || info.status !== "complete") return;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
  await chrome.tabs.reload(id);
  await loaded;
  await tryStart(tab);
}

const CHECK_PATH = "M5 12.5l4.5 4.5L19 7.5";

/** The same first-use explanation the popup shows, as a dialog on this page. */
function confirmThenStart(tab: chrome.tabs.Tab, withMemory = false): Promise<void> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "consent";

    const title = document.createElement("h2");
    title.className = "consent__title";
    title.textContent = t("runConsentTitle");
    const lead = document.createElement("p");
    lead.className = "consent__lead";
    lead.textContent = t("runHelpLead");
    const list = document.createElement("ul");
    list.className = "consent__points";
    for (const key of ["runHelpPoint1", "runHelpPoint2", "runHelpPoint3"]) {
      const li = document.createElement("li");
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", CHECK_PATH);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", "2.2");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      svg.append(path);
      const text = document.createElement("span");
      text.textContent = t(key);
      li.append(svg, text);
      list.append(li);
    }

    const actions = document.createElement("div");
    actions.className = "consent__actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "consent__btn";
    cancel.textContent = t("consentCancel");
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "consent__btn consent__btn--ok";
    ok.textContent = t("consentOk");
    actions.append(cancel, ok);

    dialog.append(title, lead, list, actions);
    document.body.append(dialog);

    const close = (): void => {
      dialog.close();
      dialog.remove();
    };
    cancel.addEventListener("click", () => {
      close();
      scheduleRender();
      resolve();
    });
    dialog.addEventListener("cancel", () => {
      dialog.remove();
      scheduleRender();
      resolve();
    });
    ok.addEventListener("click", () => {
      captureConsent = true;
      close();
      void giveCaptureConsent()
        .then(() => tryStart(tab, withMemory))
        .then(resolve);
    });

    dialog.showModal();
    ok.focus();
  });
}

/**
 * The tab row's controls: two mode icons (in memory, running) and one "Keep alive" switch
 * for both. The switch is on only when both modes are; flipping it sets both.
 */
function makeModeControls(tab: chrome.tabs.Tab, memoryOn: boolean, paused: boolean): HTMLElement {
  const id = tab.id as number;
  const runnable = canCapture(tab.url);
  const runOn = running.has(id);
  const noTab = tab.id == null;
  // Chrome starts a capture only on a tab the popup was opened on; elsewhere we can't from here.
  const startable = runnable && invoked.has(id);
  const full = memoryOn && (runOn || !runnable);

  const cols = document.createElement("div");
  cols.className = "cols";

  const mem = modeButton(MEMORY_ICON, "mem", memoryOn, t("memoryTitle"), paused || noTab, () =>
    void onToggleTab(tab, !memoryOn),
  );
  const runTip = runOn ? t("rowRunStop") : startable ? t("rowRunStart") : t("aliveOnTabTip");
  const run = runnable
    ? modeButton(RUN_ICON, "run", runOn, runTip, noTab, () => {
        if (runOn) void requestCapture(id, false).then(scheduleRender);
        else void startRunningFromHere(tab);
      })
    : null;

  // Not fully on, and Keep running can't start from here: be honest — a link to the tab,
  // not a switch that would flick on and fall back off.
  let alive: HTMLElement;
  if (runnable && !full && !runOn && !startable) {
    const go = document.createElement("button");
    go.className = "alive-go";
    go.title = t("aliveOnTabTip");
    go.textContent = `${t("aliveOnTab")} ↗`;
    go.disabled = noTab;
    go.addEventListener("click", () => void openPopupOn(tab, true));
    alive = go;
  } else {
    const sw = document.createElement("label");
    sw.className = "switch switch--sm";
    sw.title = t("aliveRowTip");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = full;
    input.disabled = paused || noTab;
    input.setAttribute("aria-label", t("aliveTitle"));
    input.addEventListener("change", async () => {
      if (input.checked) {
        if (runnable && !runOn) {
          input.disabled = true; // stays on while starting; memory follows only on success
          await startRunningFromHere(tab, true);
        } else {
          await onToggleTab(tab, true);
        }
      } else {
        await onToggleTab(tab, false);
        if (runOn) await requestCapture(id, false);
      }
      scheduleRender();
    });
    const track = document.createElement("span");
    track.className = "switch__track";
    const thumb = document.createElement("span");
    thumb.className = "switch__thumb";
    track.appendChild(thumb);
    sw.append(input, track);
    alive = sw;
  }

  cols.append(colCell("mem", mem), colCell("run", ...(run ? [run] : [])), colCell("alive", alive));
  return cols;
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
    el.title = label; // the chip may be cut short in long languages
    tags.push(el);
  };
  if (tab.id != null && running.has(tab.id)) make(t("tagRunning"), "minitag--running");
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


// React to changes from anywhere: settings (sync), consent (local), overrides/captures (session).
els.stopAll.addEventListener("click", async () => {
  await Promise.all([...running].map((id) => requestCapture(id, false)));
  scheduleRender();
});

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
