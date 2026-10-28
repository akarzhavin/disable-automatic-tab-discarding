/**
 * In-page strip telling the user this tab is held by "Keep running".
 *
 * Injected once, when the user switches the tab on, using the activeTab grant
 * from opening the popup on that tab — no site access is requested. The strip
 * lives until the page reloads or navigates; the toolbar icon carries on.
 * The two functions below are serialised into the page, so they must stay
 * self-contained (no outer references).
 */

import { t } from "./i18n.js";

export const BANNER_ID = "keep-tabs-alive-running-banner";

export interface BannerText {
  text: string;
  off: string;
  hide: string;
}

/** Runs inside the page (isolated world). */
export function bannerMain(label: BannerText, id: string): void {
  if (document.getElementById(id)) return;

  // A strip across the top that makes room for itself instead of covering the site:
  // the page moves down by its height, and so do headers pinned to the top of the window
  // (fixed/sticky), which a plain margin wouldn't move. Everything is put back on close.
  const H = 36;
  const restore: Array<() => void> = [];
  const html = document.documentElement;
  const host = document.createElement("div");
  host.id = id;
  host.style.cssText = `all:initial;position:fixed;top:0;left:0;right:0;height:${H}px;z-index:2147483647;`;
  const root = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = `
    .bar{box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:12px;
      height:${H}px;padding:0 12px;background:#0284c7;color:#fff;
      font:600 13px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
      box-shadow:0 1px 6px rgba(0,0,0,.18)}
    svg{flex:none;width:16px;height:16px}
    .txt{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    button{all:unset;cursor:pointer;box-sizing:border-box;border-radius:999px;padding:3px 12px;
      font:inherit;font-weight:700;white-space:nowrap}
    button:focus-visible{outline:2px solid #fff;outline-offset:2px}
    .off{background:#fff;color:#075985}
    .off:hover{background:#e0f2fe}
    .hide{padding:3px 8px;font-size:16px;line-height:1}
    .hide:hover{background:rgba(255,255,255,.18)}`;

  const bar = document.createElement("div");
  bar.className = "bar";
  bar.setAttribute("role", "status");

  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svgNs, "path");
  path.setAttribute("d", "M13 3L5 13.5h6L10 21l8-10.5h-6L13 3z");
  path.setAttribute("fill", "currentColor");
  svg.append(path);

  const txt = document.createElement("span");
  txt.className = "txt";
  txt.textContent = label.text;

  const close = (): void => {
    host.remove();
    for (const undo of restore) undo();
  };
  // Kept on the isolated world's window so a later injection (bannerRemove) can undo it too.
  (window as unknown as Record<string, () => void>)[id] = close;

  const off = document.createElement("button");
  off.className = "off";
  off.textContent = label.off;
  off.addEventListener("click", () => {
    void chrome.runtime.sendMessage({ type: "capture:stop-self" });
    close();
  });

  const hide = document.createElement("button");
  hide.className = "hide";
  hide.textContent = "×";
  hide.title = label.hide;
  hide.setAttribute("aria-label", label.hide);
  hide.addEventListener("click", close);

  bar.append(svg, txt, off, hide);
  root.append(style, bar);
  html.append(host);

  // Make room only once the strip itself is on the page; an odd element on some site must
  // never cost the strip, so each step is guarded on its own.
  try {
    const prevMargin = html.style.getPropertyValue("margin-top");
    const prevPriority = html.style.getPropertyPriority("margin-top");
    const baseMargin = parseFloat(getComputedStyle(html).marginTop) || 0;
    html.style.setProperty("margin-top", `${baseMargin + H}px`, "important");
    restore.push(() => html.style.setProperty("margin-top", prevMargin, prevPriority));
  } catch {
    // Leave the page where it is.
  }
  const walker = document.createTreeWalker(document.body ?? html, NodeFilter.SHOW_ELEMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    try {
      const el = n as HTMLElement;
      if (!el.style) continue; // non-HTML/SVG elements have no inline style
      const cs = getComputedStyle(el);
      if (cs.position !== "fixed" && cs.position !== "sticky") continue;
      const top = parseFloat(cs.top);
      if (Number.isNaN(top) || top >= H) continue; // only things pinned at the very top
      const prev = el.style.getPropertyValue("top");
      const prio = el.style.getPropertyPriority("top");
      el.style.setProperty("top", `${top + H}px`, "important");
      restore.push(() => el.style.setProperty("top", prev, prio));
    } catch {
      // Skip this element.
    }
  }

  // The strip must never outlive what it announces: the worker tells it to close when
  // this tab stops being held (switched off anywhere, timer ran out) — a message needs no
  // site access, unlike removing it with another injection.
  const onMessage = (msg: { type?: string }): void => {
    if (msg?.type !== "banner:close") return;
    chrome.runtime.onMessage.removeListener(onMessage);
    close();
  };
  try {
    chrome.runtime.onMessage.addListener(onMessage);
  } catch {
    // Extension context already gone.
  }
  const alive = setInterval(() => {
    if (!document.getElementById(id)) return clearInterval(alive);
    // A reloaded or removed extension leaves this script orphaned: chrome.runtime.id vanishes.
    if (!chrome.runtime?.id) {
      clearInterval(alive);
      close();
    }
  }, 5000);
}

/** Runs inside the page: close the strip and put the page back where it was. */
export function bannerRemove(id: string): void {
  const close = (window as unknown as Record<string, (() => void) | undefined>)[id];
  if (close) {
    close();
    delete (window as unknown as Record<string, unknown>)[id];
  } else {
    document.getElementById(id)?.remove();
  }
}

/** Show the strip on a tab we hold active tab access to. Failure is harmless — the icon still marks it. */
export async function injectBanner(tabId: number, label: BannerText): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: bannerMain,
      args: [label, BANNER_ID],
    });
  } catch (e) {
    // No access (restricted page, grant gone) — nothing to show; say why in the worker log.
    console.warn("Keep Tabs Alive: couldn't show the strip on tab", tabId, e);
  }
}

export async function removeBanner(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: bannerRemove, args: [BANNER_ID] });
  } catch {
    // Page navigated away or tab closed: the strip is already gone.
  }
}

/** The strip shown right after Keep running starts, with the auto-off time if there is one. */
export async function showRunningBanner(tabId: number, minutes: number): Promise<void> {
  const until =
    minutes > 0
      ? new Date(Date.now() + minutes * 60_000).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";
  await injectBanner(tabId, {
    text: until ? `${t("bannerText")} · ${t("bannerUntil", until)}` : t("bannerText"),
    off: t("bannerOff"),
    hide: t("bannerHide"),
  });
}
