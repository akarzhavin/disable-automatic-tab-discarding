/**
 * Generic guided-tour engine — a sequence of spotlight pop-ups that highlight
 * and explain page elements. Used by both the options page and the popup; each
 * passes its own steps and a "seen" key. Self-contained: builds its own overlay
 * and cleans up after itself.
 */

import { t } from "./shared/i18n.js";

export interface TourStep {
  /** CSS selector for the element to highlight. */
  target: string;
  title: string;
  body: string;
}

const PAD = 8; // spotlight padding around the target
const GAP = 14; // gap between spotlight and card

let steps: TourStep[] = [];
let idx = 0;
let nodes: {
  overlay: HTMLElement;
  spotlight: HTMLElement;
  card: HTMLElement;
  title: HTMLElement;
  body: HTMLElement;
  progress: HTMLElement;
  back: HTMLButtonElement;
  next: HTMLButtonElement;
} | null = null;

function build(): NonNullable<typeof nodes> {
  const overlay = el("div", "tour-overlay");
  const spotlight = el("div", "tour-spotlight");
  const card = el("div", "tour-card");

  const title = el("h3", "tour-card__title");
  const body = el("p", "tour-card__body");

  const footer = el("div", "tour-card__footer");
  const progress = el("div", "tour-card__progress");
  const buttons = el("div", "tour-card__buttons");

  const skip = el("button", "tour-card__skip") as HTMLButtonElement;
  skip.textContent = t("tourSkip");
  skip.addEventListener("click", () => end());

  const back = el("button", "btn btn--ghost btn--sm") as HTMLButtonElement;
  back.textContent = t("tourBack");
  back.addEventListener("click", () => go(idx - 1));

  const next = el("button", "btn btn--sm") as HTMLButtonElement;
  next.addEventListener("click", () => go(idx + 1));

  buttons.append(back, next);
  footer.append(progress, buttons);
  card.append(skip, title, body, footer);
  document.body.append(overlay, spotlight, card);

  // Dismiss on click-outside / Escape.
  overlay.addEventListener("click", () => end());
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", reposition, { passive: true });
  window.addEventListener("scroll", reposition, { passive: true });

  return { overlay, spotlight, card, title, body, progress, back, next };
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function onKey(e: KeyboardEvent): void {
  if (e.key === "Escape") end();
  else if (e.key === "ArrowRight" || e.key === "Enter") go(idx + 1);
  else if (e.key === "ArrowLeft") go(idx - 1);
}

export function startTour(tourSteps: TourStep[]): void {
  if (tourSteps.length === 0) return;
  steps = tourSteps;
  if (!nodes) nodes = build();
  document.body.classList.add("tour-on");
  go(0);
}

function go(to: number): void {
  if (!nodes) return;
  if (to < 0) return;
  if (to >= steps.length) {
    end();
    return;
  }
  idx = to;
  showStep();
}

function showStep(): void {
  if (!nodes) return;
  const step = steps[idx];
  nodes.title.innerHTML = step.title;
  nodes.body.innerHTML = step.body;
  nodes.progress.textContent = t("tourProgress", [String(idx + 1), String(steps.length)]);
  nodes.back.style.visibility = idx === 0 ? "hidden" : "visible";
  nodes.next.textContent = idx === steps.length - 1 ? t("tourDone") : t("tourNext");

  const target = document.querySelector(step.target);
  if (target) {
    target.scrollIntoView({ block: "center", behavior: "auto" });
    // Wait for the scroll to settle, then measure.
    requestAnimationFrame(() => requestAnimationFrame(reposition));
  } else {
    reposition();
  }
}

function reposition(): void {
  if (!nodes || !document.body.classList.contains("tour-on")) return;
  const target = document.querySelector(steps[idx].target);
  const card = nodes.card;

  if (!(target instanceof HTMLElement)) {
    // No target — center the card, hide the spotlight.
    nodes.spotlight.style.opacity = "0";
    card.style.left = `${(window.innerWidth - card.offsetWidth) / 2}px`;
    card.style.top = `${(window.innerHeight - card.offsetHeight) / 2}px`;
    return;
  }

  const r = target.getBoundingClientRect();
  const top = r.top - PAD;
  const left = r.left - PAD;
  const width = r.width + PAD * 2;
  const height = r.height + PAD * 2;

  nodes.spotlight.style.opacity = "1";
  Object.assign(nodes.spotlight.style, {
    top: `${top}px`,
    left: `${left}px`,
    width: `${width}px`,
    height: `${height}px`,
  });

  // Place the card below the target if it fits, otherwise above.
  const cw = card.offsetWidth;
  const ch = card.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let cardTop = top + height + GAP;
  if (cardTop + ch > vh - 12) {
    const above = top - GAP - ch;
    cardTop = above >= 12 ? above : Math.max(12, (vh - ch) / 2);
  }
  let cardLeft = r.left + r.width / 2 - cw / 2;
  cardLeft = Math.min(Math.max(12, cardLeft), vw - cw - 12);

  card.style.top = `${cardTop}px`;
  card.style.left = `${cardLeft}px`;
}

function end(): void {
  if (!nodes) return;
  document.body.classList.remove("tour-on");
  document.removeEventListener("keydown", onKey);
  window.removeEventListener("resize", reposition);
  window.removeEventListener("scroll", reposition);
  nodes.overlay.remove();
  nodes.spotlight.remove();
  nodes.card.remove();
  nodes = null;
}

/** Auto-start a tour once. Marks it seen immediately so it shows exactly once. */
export async function maybeAutoStartTour(tourSteps: TourStep[], seenKey: string): Promise<void> {
  try {
    const seen = (await chrome.storage.local.get(seenKey))[seenKey];
    if (!seen) {
      await chrome.storage.local.set({ [seenKey]: true });
      // Let the first render settle before measuring targets.
      setTimeout(() => startTour(tourSteps), 400);
    }
  } catch {
    // Storage unavailable — skip auto-start.
  }
}
