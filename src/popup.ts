/** Popup UI — reflects settings + live tab state, writes settings only. */

import { showRunningBanner } from "./shared/banner.js";
import { clearActivationsForHost, setActivation } from "./shared/activations.js";
import {
  adjustCapture,
  canCapture,
  getCaptureEnds,
  getCaptureMinutes,
  getCaptured,
  giveCaptureConsent,
  hasCaptureConsent,
  requestCapture,
  NOT_INVOKED,
  setCaptureMinutes,
  setInvoked,
  setPendingStart,
  takePendingStart,
} from "./shared/capture.js";
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
  favicon: $<HTMLImageElement>("siteFavicon"),
  host: $("siteHost"),
  siteToggle: $<HTMLInputElement>("siteToggle"),
  tabPath: $("tabPath"),
  tabToggle: $<HTMLInputElement>("tabToggle"),
  hint: $("siteHint"),
  runToggle: $<HTMLInputElement>("runToggle"),
  runCard: $("runCard"),
  runHelp: $<HTMLButtonElement>("runHelp"),
  infoTitle: $("infoTitle"),
  consentOk: $<HTMLButtonElement>("consentOk"),
  consentCancel: $<HTMLButtonElement>("consentCancel"),
  helpClose: $<HTMLButtonElement>("helpClose"),
  captureNote: $("captureNote"),
  timerPick: $("timerPick"),
  timerLabel: $("timerLabel"),
  timerLeft: $("timerLeft"),
  heldCard: $("heldCard"),
  heldList: $<HTMLUListElement>("heldList"),
  heldCount: $("heldCount"),
  runSect: $("runSect"),
  memSect: $("memSect"),
  memCount: $("memCount"),
  memList: $<HTMLUListElement>("memList"),
  live: $("liveBadge"),
  pendingStep: $("pendingStep"),
  doneNote: $("doneNote"),
  aliveToggle: $<HTMLInputElement>("aliveToggle"),
  memCard: $("memCard"),
  pausedHint: $("pausedHint"),
  openOptions: $<HTMLButtonElement>("openOptions"),
};

/** The popup re-checks the on-page strip once per opening. */
let stripChecked = false;

/** Minutes left on a timer (0 = none), for the strip's "until …" label. */
function remainingMinutes(endsAt: number): number {
  return endsAt > 0 ? Math.max(1, Math.round((endsAt - Date.now()) / 60_000)) : 0;
}

async function render(): Promise<void> {
  const [settings, overrides, captured, ends, minutes] = await Promise.all([
    getSettings(),
    getOverrides(),
    getCaptured(),
    getCaptureEnds(),
    getCaptureMinutes(),
  ]);
  applyTheme(settings.theme);

  els.app.dataset.enabled = String(settings.enabled);

  const tabs = await chrome.tabs.query({});

  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  // Opening the popup here granted activeTab: Settings may now start Keep running on this tab.
  if (active?.id != null && canCapture(active.url)) void setInvoked(active.id, true);
  // A held tab whose strip went missing (it failed, or the page dropped it): put it back.
  // The strip ignores a second injection, so this is safe on every render.
  if (active?.id != null && captured.includes(active.id) && !stripChecked) {
    stripChecked = true;
    void showRunningBanner(active.id, remainingMinutes(ends[active.id] ?? 0));
  }
  renderCurrentTab(settings, overrides, active);
  renderRunToggle(captured, active);
  renderAlive(settings, overrides, captured, active);
  renderTimer(minutes, ends, active);
  renderHeld(tabs, captured, ends, settings, overrides);
  renderProtectNote(settings, overrides, active);
  fitToPopup();
}

/** Chrome's hard limit for an extension popup; past it, Chrome adds a scrollbar. */
const POPUP_MAX_PX = 600;

/** Fold the popup step by step until it fits — never a scrollbar. */
function fitToPopup(): void {
  const steps = ["", "lists", "lists facts"];
  for (const step of steps) {
    els.app.dataset.compact = step;
    if (document.documentElement.scrollHeight <= POPUP_MAX_PX) return;
  }
}

/** "Keep running" switch — only for regular web pages; independent of the master switch. */
function renderRunToggle(
  captured: number[],
  active: chrome.tabs.Tab | undefined,
): void {
  const supported = canCapture(active?.url);
  const on = active?.id != null && captured.includes(active.id);
  els.runToggle.checked = on;
  els.runCard.dataset.on = String(on);
  els.runToggle.disabled = !supported || els.runCard.dataset.pending === "true";
  els.runToggle.title = supported ? "" : t("notAvailableHere");
  els.runToggle.dataset.tabId = active?.id != null ? String(active.id) : "";
  // The note only reports a failed start (with a reload button); keep it through the
  // periodic re-render, clear it once the tab is running.
  if (on) els.captureNote.hidden = true;
}

/** "1 h 20 min" / "45 min" for a remaining span; never shows less than a minute. */
function formatLeft(ms: number): string {
  const total = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return [h ? `${h} ${t("unitHour")}` : "", m ? `${m} ${t("unitMin")}` : ""].filter(Boolean).join(" ");
}

/** Combined switch: on = kept in memory AND running. */
function renderAlive(
  settings: Settings,
  overrides: TabOverrides,
  captured: number[],
  active: chrome.tabs.Tab | undefined,
): void {
  const memoryOn = !!active && effectiveProtect(active, settings, overrides);
  const runOn = active?.id != null && captured.includes(active.id);
  // On only when both modes are on (memory alone on internal pages, which can't run).
  els.aliveToggle.checked = memoryOn && (runOn || !canCapture(active?.url));
  els.aliveToggle.disabled = active?.id == null;
}

/** Auto-off picker while the tab is off; while it's on, the same row extends the timer. */
function renderTimer(
  minutes: number,
  ends: Record<number, number>,
  active: chrome.tabs.Tab | undefined,
): void {
  const endsAt = active?.id != null ? ends[active.id] : undefined;
  const on = endsAt !== undefined;
  els.timerPick.dataset.mode = on ? "extend" : "pick";
  els.timerLabel.textContent = t(on ? "timerExtendLabel" : "timerLabel");
  for (const chip of els.timerPick.querySelectorAll<HTMLButtonElement>(".chip")) {
    const m = Number(chip.dataset.min);
    chip.textContent = t(m === 0 ? "timerNone" : on ? `timerAdd${m}` : `timer${m}`);
    chip.setAttribute("aria-checked", String(!on && m === minutes));
    // "No timer" as an extension is pointless when the tab already has none.
    chip.hidden = on && m === 0 && endsAt === 0;
  }
  els.timerLeft.hidden = !on;
  if (on) {
    els.timerLeft.textContent =
      endsAt > 0 ? t("timerLeft", formatLeft(endsAt - Date.now())) : t("timerForever");
  }
}

/** One list row: favicon, title, a right-hand note, and an "off" cross. */
function heldRow(
  tab: chrome.tabs.Tab,
  note: string,
  noteClass: string,
  stopTitle: string,
  onStop: () => Promise<void>,
): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "held__row";

  const main = document.createElement("button");
  main.type = "button";
  main.className = "held__main";
  main.title = tab.title ?? "";
  const fav = document.createElement("img");
  fav.className = "held__fav";
  fav.alt = "";
  if (tab.favIconUrl) fav.src = tab.favIconUrl;
  else fav.style.visibility = "hidden";
  fav.addEventListener("error", () => (fav.style.visibility = "hidden"));
  const name = document.createElement("span");
  name.className = "held__name";
  name.textContent = tab.title || getHostname(tab.url) || tab.url || "—";
  const right = document.createElement("span");
  right.className = noteClass;
  right.textContent = note;
  main.append(fav, name, right);
  main.addEventListener("click", async () => {
    if (tab.id == null) return;
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    window.close();
  });

  const stop = document.createElement("button");
  stop.type = "button";
  stop.className = "held__stop";
  stop.title = stopTitle;
  stop.setAttribute("aria-label", stopTitle);
  stop.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  stop.addEventListener("click", async () => {
    await onStop();
    void render();
  });

  li.append(main, stop);
  return li;
}

/**
 * Everything the extension is doing right now, in two lists — tabs kept running and
 * tabs kept in memory — so nothing hides behind a bare number on the toolbar icon.
 */
function renderHeld(
  tabs: chrome.tabs.Tab[],
  captured: number[],
  ends: Record<number, number>,
  settings: Settings,
  overrides: TabOverrides,
): void {
  const running = tabs.filter((tab) => tab.id != null && captured.includes(tab.id));
  const inMemory = settings.enabled
    ? tabs.filter((tab) => effectiveProtect(tab, settings, overrides))
    : [];

  els.heldCard.hidden = running.length + inMemory.length === 0;
  els.live.hidden = running.length === 0;
  els.runSect.hidden = running.length === 0;
  els.memSect.hidden = inMemory.length === 0;
  els.heldCount.textContent = String(running.length);
  els.memCount.textContent = String(inMemory.length);

  els.heldList.replaceChildren(
    ...running.map((tab) => {
      const endsAt = ends[tab.id as number] ?? 0;
      return heldRow(
        tab,
        endsAt > 0 ? formatLeft(endsAt - Date.now()) : "∞",
        "held__left",
        t("heldStop"),
        async () => void (await requestCapture(tab.id as number, false)),
      );
    }),
  );
  els.memList.replaceChildren(
    ...inMemory.map((tab) =>
      heldRow(tab, getHostname(tab.url) ?? "", "held__host", t("memoryStop"), () =>
        setTabProtect(tab.id as number, tab.url, tab.title, false),
      ),
    ),
  );
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

  els.memCard.dataset.state = state;
  // Pausing lives in Settings now; say so here instead of leaving the switches silently inert.
  els.pausedHint.hidden = state !== "paused";
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
  els.siteToggle.disabled = !host;
  els.siteToggle.dataset.host = host ?? "";
  els.siteToggle.dataset.tabId = active?.id != null ? String(active.id) : "";

  // Tab-level switch — identify the page by its title (human-readable), falling
  // back to the URL path when a title is missing. A bare UUID path tells the
  // user nothing; the title ("ChatGPT", "Weekly planning — Notion") does.
  const tabTitle = active?.title?.trim();
  els.tabPath.textContent = tabTitle || (host ? pathOf(active?.url) : "—");
  els.tabPath.title = els.tabPath.textContent ?? "";
  els.tabToggle.checked = active ? effectiveProtect(active, settings, overrides) : false;
  els.tabToggle.disabled = active?.id == null;
  els.tabToggle.dataset.tabId = active?.id != null ? String(active.id) : "";
  els.tabToggle.dataset.url = active?.url ?? "";
  els.tabToggle.dataset.title = active?.title ?? "";

  // Internal pages have no site rules — only the tab switch applies.
  els.hint.hidden = !(active && !host);
  if (active && !host) els.hint.textContent = t("internalPageTabOnly");
}

// ── Events ────────────────────────────────────────────────────────────────

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

  // Asking for protection while paused is an explicit intent: resume instead of ignoring it.
  if (wantProtected && !settings.enabled) await saveSettings({ enabled: true });

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
  await setTabProtect(
    tabId,
    els.tabToggle.dataset.url || undefined,
    els.tabToggle.dataset.title || undefined,
    els.tabToggle.checked,
  );
});

/** Keep one tab in memory (or release it): an override only where it differs from the site rules. */
async function setTabProtect(
  tabId: number,
  url: string | undefined,
  title: string | undefined,
  desired: boolean,
): Promise<void> {
  const settings = await getSettings();
  const ruleState = shouldProtect(url, settings);
  const override = desired === ruleState ? null : desired ? "protect" : "discard";
  // Same intent rule as the site switch: turning protection on resumes a paused master.
  if (desired && !settings.enabled) await saveSettings({ enabled: true });
  await setTabOverride(tabId, override, url);
  await setActivation(url, override, { title });
}

/** Main view, or the full-card explainer ("help") / first-use confirmation ("consent"). */
function setView(view: "main" | "help" | "consent"): void {
  els.app.dataset.view = view;
  if (view !== "main") {
    els.infoTitle.textContent = t(view === "consent" ? "runConsentTitle" : "runHelpTitle");
  }
}

async function toggleCapture(tabId: number, want: boolean): Promise<boolean> {
  els.runToggle.disabled = true;
  const minutes = want ? await getCaptureMinutes() : 0;
  const res = await requestCapture(tabId, want, minutes);
  if (!res.ok) {
    els.runToggle.checked = !want;
    if (want && NOT_INVOKED.test(res.error ?? "")) {
      // Opened by Settings, Chrome gave this popup no grant: one click on the icon is left.
      void setInvoked(tabId, false);
      await setPendingStart({ tabId, memory: pendingMemory, at: Date.now() });
      // The Keep running card turns into the one step left; its switch can't work here yet.
      els.runCard.dataset.pending = "true";
      els.pendingStep.hidden = false;
    } else {
      showCaptureFailed(tabId);
    }
  }
  els.runToggle.disabled = els.runCard.dataset.pending === "true";
  if (res.ok) await render();
  if (res.ok && want && guided) await finishGuide(tabId);
  return res.ok;
}

function flash(el: HTMLElement): void {
  el.classList.remove("is-done");
  void el.offsetWidth; // restart the animation
  el.classList.add("is-done");
  setTimeout(() => el.classList.remove("is-done"), 2400);
}

/** Memory to add once Keep running is on — set when finishing a "Keep alive" from Settings. */
let pendingMemory = false;

/** Keep running for this tab, then memory too if this is a Keep alive. */
async function runIntent(tabId: number): Promise<void> {
  const ok = await toggleCapture(tabId, true);
  if (ok && pendingMemory) {
    await setTabProtect(
      tabId,
      els.tabToggle.dataset.url || undefined,
      els.tabToggle.dataset.title || undefined,
      true,
    );
  }
  if (!ok) void render(); // undo any switch shown flipping on ahead of the real start
  if (ok) {
    // Show what just turned on, in words, right under the switch.
    els.doneNote.textContent = t(pendingMemory ? "aliveDone" : "runDone");
    els.doneNote.hidden = false;
    flash(els.runCard);
    if (pendingMemory) flash(els.memCard);
    pendingMemory = false;
  }
}

/** Settings sent the user here to finish turning something on: do it now. */
async function resumePendingStart(): Promise<void> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.id == null || !canCapture(active.url)) return;
  const pending = await takePendingStart(active.id);
  if (!pending) return;
  // The user turns it on themselves; we only make it obvious what to click: the Keep
  // running card glows and its switch is pointed at. For Keep alive, memory comes with it.
  guided = { memory: pending.memory };
  els.runCard.classList.add("is-guided");
  els.app.classList.add("is-guiding");
  pointAt(els.runToggle);
}

/** Set while the popup shows which switch to click for a start handed over by Settings. */
let guided: { memory: boolean } | null = null;

function pointAt(input: HTMLInputElement): void {
  const sw = input.closest<HTMLElement>(".switch");
  if (!sw) return;
  sw.dataset.hint = t("tapToTurnOn");
  sw.classList.add("is-next", "is-target");
}

/** The guided switch was clicked and it worked: drop the pointers, say what turned on. */
async function finishGuide(tabId: number): Promise<void> {
  const wantMemory = guided?.memory ?? false;
  guided = null;
  els.runCard.classList.remove("is-guided");
  els.app.classList.remove("is-guiding");
  for (const sw of document.querySelectorAll<HTMLElement>(".switch.is-target")) {
    sw.classList.remove("is-next", "is-target");
  }
  // A Keep alive from Settings: the user clicked Keep running, memory is part of the deal.
  if (wantMemory && !els.tabToggle.checked) {
    await setTabProtect(
      tabId,
      els.tabToggle.dataset.url || undefined,
      els.tabToggle.dataset.title || undefined,
      true,
    );
    await render();
  }
  const memory = els.tabToggle.checked;
  els.doneNote.textContent = t(memory ? "aliveDone" : "runDone");
  els.doneNote.hidden = false;
  flash(els.runCard);
  if (memory) flash(els.memCard);
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The switches a handed-over start turns on: Keep running, plus memory for Keep alive. */
function turningSwitches(): HTMLElement[] {
  const inputs = pendingMemory ? [els.runToggle, els.tabToggle, els.aliveToggle] : [els.runToggle];
  return inputs.map((input) => input.closest<HTMLElement>(".switch")).filter((x): x is HTMLElement => !!x);
}

/**
 * Let the user watch it happen: the switch that's about to change pulses, then flips on.
 * The real start follows; if it fails, toggleCapture flips the switch back.
 */
async function showSwitchingOn(): Promise<void> {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  await wait(350);
  for (const sw of turningSwitches()) sw.classList.add("is-next");
  await wait(650);
  els.runToggle.checked = true;
  if (pendingMemory) {
    els.tabToggle.checked = true;
    els.aliveToggle.checked = true;
  }
  await wait(300);
}

/**
 * A stale capture on the page (or another extension) blocks a new one; a reload usually
 * clears it. Reloading drops this popup's access to the tab, so it closes — the user
 * switches Keep running on again from a fresh popup.
 */
function showCaptureFailed(tabId: number): void {
  const reload = document.createElement("button");
  reload.type = "button";
  reload.className = "btn btn--ghost btn--sm capture-reload";
  reload.textContent = t("captureReload");
  reload.addEventListener("click", async () => {
    await chrome.tabs.reload(tabId);
    window.close();
  });
  showBubble([document.createTextNode(t("captureFailed")), reload]);
}

// The last click's position: a message answering it appears right under it.
let lastClick: DOMRect | null = null;
document.addEventListener(
  "pointerdown",
  (e) => {
    const target = (e.target as Element | null)?.closest("button, label, input");
    if (target && !target.closest(".bubble")) lastClick = target.getBoundingClientRect();
  },
  true,
);

/** A small note pinned under (or above) the last click; any click elsewhere closes it. */
function showBubble(content: Node[]): void {
  document.querySelector(".bubble")?.remove();
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.setAttribute("role", "alert");
  bubble.append(...content);
  document.body.append(bubble);
  const at = lastClick ?? els.runCard.getBoundingClientRect();
  const w = bubble.offsetWidth;
  const h = bubble.offsetHeight;
  const left = Math.min(Math.max(8, at.right - w), document.documentElement.clientWidth - w - 8);
  const below = at.bottom + 8;
  const top = below + h < window.innerHeight - 4 ? below : Math.max(4, at.top - 8 - h);
  bubble.style.left = `${left + window.scrollX}px`;
  bubble.style.top = `${top + window.scrollY}px`;
  const close = (e: Event): void => {
    if (bubble.contains(e.target as Node)) return;
    bubble.remove();
    document.removeEventListener("pointerdown", close, true);
  };
  setTimeout(() => document.addEventListener("pointerdown", close, true), 0);
}

function runTabId(): number | null {
  const raw = els.runToggle.dataset.tabId;
  const tabId = Number(raw);
  return raw && Number.isFinite(tabId) ? tabId : null;
}

// Keep-running switch: start/stop holding this tab awake. Must run from the popup —
// opening it is what grants activeTab for the current tab. The first time, it only
// opens the confirmation; nothing starts until the user agrees.
els.runToggle.addEventListener("change", async () => {
  const tabId = runTabId();
  if (tabId == null) return;
  const want = els.runToggle.checked;
  if (want && !(await hasCaptureConsent())) {
    els.runToggle.checked = false;
    setView("consent");
    return;
  }
  await toggleCapture(tabId, want);
});

// Keep alive: both modes at once. Off turns both off; anything else turns both on.
els.aliveToggle.addEventListener("change", async () => {
  const tabId = runTabId();
  if (tabId == null) return;
  const want = els.aliveToggle.checked;
  await setTabProtect(
    tabId,
    els.tabToggle.dataset.url || undefined,
    els.tabToggle.dataset.title || undefined,
    want,
  );
  if (!canCapture(els.tabToggle.dataset.url)) return;
  const running = els.runToggle.checked;
  if (want && !running) {
    if (!(await hasCaptureConsent())) {
      els.aliveToggle.checked = false;
      setView("consent");
      return;
    }
    await toggleCapture(tabId, true);
  } else if (!want && running) {
    await toggleCapture(tabId, false);
  }
});

els.consentOk.addEventListener("click", async () => {
  els.consentOk.classList.remove("is-next");
  await giveCaptureConsent();
  setView("main");
  const tabId = runTabId();
  if (tabId == null) return;
  const switches = turningSwitches(); // before runIntent clears pendingMemory
  await showSwitchingOn();
  await runIntent(tabId);
  for (const sw of switches) sw.classList.remove("is-next");
});
els.consentCancel.addEventListener("click", () => setView("main"));
els.runHelp.addEventListener("click", () => setView("help"));
els.helpClose.addEventListener("click", () => setView("main"));

els.timerPick.addEventListener("click", async (e) => {
  const chip = (e.target as HTMLElement).closest<HTMLButtonElement>(".chip");
  if (!chip) return;
  const minutes = Number(chip.dataset.min);
  const tabId = runTabId();
  if (els.timerPick.dataset.mode === "extend" && tabId != null) {
    await adjustCapture(tabId, minutes);
  } else {
    await setCaptureMinutes(minutes);
  }
  void render();
});

els.openOptions.addEventListener("click", () => chrome.runtime.openOptionsPage());
document.getElementById("heldMore")?.addEventListener("click", () => chrome.runtime.openOptionsPage());

// Re-render whenever settings or per-tab overrides change.
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "sync" || area === "session" || area === "local") void render();
});

localizePage();
void render().then(resumePendingStart);
// Keep countdowns fresh while the popup stays open.
setInterval(() => void render(), 20_000);
