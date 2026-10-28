/**
 * "Keep running" — hold a tab awake by capturing it.
 *
 * Chrome treats a tab with an active capturer as in use, so it isn't throttled
 * while hidden or covered. We open a capture of the tab and keep the stream
 * open; the frames are never read, stored or sent anywhere.
 *
 * Flow: the popup (which holds the activeTab grant for the current tab) asks
 * Chrome for a stream id and messages the service worker; the worker hands it
 * to an offscreen document, the only MV3 context that can keep a MediaStream
 * alive. The set of captured tab ids lives in chrome.storage.session.
 */

import {
  CAPTURE_CONSENT_KEY,
  CAPTURE_ENDS_KEY,
  CAPTURE_MINUTES_KEY,
  CAPTURES_KEY,
  DEFAULT_CAPTURE_MINUTES,
  INVOKED_KEY,
  PENDING_KEY,
} from "./types.js";

/** popup → service worker */
export type CaptureRequest =
  /** The worker does the whole start, so it finishes even if the popup closes meanwhile. */
  | { type: "capture:start"; tabId: number; minutes: number }
  | { type: "capture:stop"; tabId: number }
  /** Push a running tab's auto-off out by `minutes` (from now, or from its current end). 0 removes the timer. */
  | { type: "capture:adjust"; tabId: number; minutes: number }
  /** In-page strip's "Turn off" — the worker takes the tab id from the sender. */
  | { type: "capture:stop-self" };

/** offscreen document → service worker: the stream died on its own (tab closed). */
export interface CaptureEnded {
  type: "capture:ended";
  tabId: number;
}

/** service worker → offscreen document */
export type OffscreenRequest =
  | { type: "offscreen:start"; tabId: number; streamId: string; endsAt: number }
  | { type: "offscreen:retime"; tabId: number; endsAt: number }
  | { type: "offscreen:stop"; tabId: number };

export interface CaptureResult {
  ok: boolean;
  error?: string;
}

export async function getCaptured(): Promise<number[]> {
  const raw = await chrome.storage.session.get(CAPTURES_KEY);
  return (raw[CAPTURES_KEY] ?? []) as number[];
}

export async function setCaptured(ids: number[]): Promise<void> {
  await chrome.storage.session.set({ [CAPTURES_KEY]: ids });
}

/** Tabs Keep running can be started on from anywhere (the popup was opened there). */
export async function getInvoked(): Promise<number[]> {
  const raw = await chrome.storage.session.get(INVOKED_KEY);
  return (raw[INVOKED_KEY] ?? []) as number[];
}

export async function setInvoked(tabId: number, invoked: boolean): Promise<void> {
  const ids = await getInvoked();
  if (ids.includes(tabId) === invoked) return;
  await chrome.storage.session.set({
    [INVOKED_KEY]: invoked ? [...ids, tabId] : ids.filter((id) => id !== tabId),
  });
}

/** A start Settings handed over to the popup: Keep running, plus memory for Keep alive. */
export interface PendingStart {
  tabId: number;
  memory: boolean;
  at: number;
}

/** How long a handed-over start waits for the popup to open on that tab. */
const PENDING_TTL_MS = 10 * 60 * 1000;

export async function setPendingStart(pending: PendingStart | null): Promise<void> {
  if (pending) await chrome.storage.session.set({ [PENDING_KEY]: pending });
  else await chrome.storage.session.remove(PENDING_KEY);
}

/** The pending start for this tab, if any — removed as it is taken. */
export async function takePendingStart(tabId: number): Promise<PendingStart | null> {
  const raw = (await chrome.storage.session.get(PENDING_KEY))[PENDING_KEY] as PendingStart | undefined;
  if (!raw || raw.tabId !== tabId) return null;
  await chrome.storage.session.remove(PENDING_KEY);
  return Date.now() - raw.at < PENDING_TTL_MS ? raw : null;
}

/** Chrome's refusal when the extension hasn't been invoked on the tab (no activeTab grant). */
export const NOT_INVOKED = /invoked|activeTab/i;

/** tabId → epoch ms the capture auto-stops (0 = runs until switched off). */
export type CaptureEnds = Record<number, number>;

export async function getCaptureEnds(): Promise<CaptureEnds> {
  const raw = await chrome.storage.session.get(CAPTURE_ENDS_KEY);
  return (raw[CAPTURE_ENDS_KEY] ?? {}) as CaptureEnds;
}

export async function setCaptureEnds(ends: CaptureEnds): Promise<void> {
  await chrome.storage.session.set({ [CAPTURE_ENDS_KEY]: ends });
}

/** Longest a timer can be set to. */
export const TIMER_MAX_MIN = 24 * 60;

/** Popup-side: extend a held tab's timer (0 = remove it). */
export async function adjustCapture(tabId: number, minutes: number): Promise<CaptureResult> {
  try {
    return await send({ type: "capture:adjust", tabId, minutes });
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** The auto-off delay the user last picked, in minutes (0 = none). */
export async function getCaptureMinutes(): Promise<number> {
  const raw = await chrome.storage.local.get(CAPTURE_MINUTES_KEY);
  const v = raw[CAPTURE_MINUTES_KEY];
  return typeof v === "number" && v >= 0 ? v : DEFAULT_CAPTURE_MINUTES;
}

export async function setCaptureMinutes(minutes: number): Promise<void> {
  await chrome.storage.local.set({ [CAPTURE_MINUTES_KEY]: minutes });
}

/** Has the user already confirmed what "Keep running" does? Asked once, on first use. */
export async function hasCaptureConsent(): Promise<boolean> {
  const raw = await chrome.storage.local.get(CAPTURE_CONSENT_KEY);
  return raw[CAPTURE_CONSENT_KEY] === true;
}

export async function giveCaptureConsent(): Promise<void> {
  await chrome.storage.local.set({ [CAPTURE_CONSENT_KEY]: true });
}

/** Only regular web pages can be captured; chrome://, extension and store pages can't. */
export function canCapture(url: string | undefined): boolean {
  return !!url && /^https?:\/\//i.test(url);
}

/** Popup/settings-side: start or stop holding one tab awake (the worker does the work). */
export async function requestCapture(tabId: number, on: boolean, minutes = 0): Promise<CaptureResult> {
  try {
    if (!on) {
      return await send({ type: "capture:stop", tabId });
    }
    return await send({ type: "capture:start", tabId, minutes });
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Callback form: the bundled @types/chrome doesn't type the promise overload. */
export function getStreamId(tabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(id);
    });
  });
}

async function send(msg: CaptureRequest): Promise<CaptureResult> {
  const res = (await chrome.runtime.sendMessage(msg)) as CaptureResult | undefined;
  return res ?? { ok: false, error: "no response" };
}
