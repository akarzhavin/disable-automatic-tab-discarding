/**
 * Offscreen document — the only place a MediaStream can stay open in MV3.
 *
 * Streams are held, never read or stored: the capture itself is what keeps the
 * tab awake. Each one is attached to a hidden, muted <video> so Chrome sees a
 * live consumer (a stream nobody renders may not count as in use).
 */

import type { CaptureEnded, CaptureResult, OffscreenRequest } from "./shared/capture.js";

const streams = new Map<number, MediaStream>();
const sinks = new Map<number, HTMLVideoElement>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const finishers = new Map<number, () => void>();

/** Hidden consumer for a stream; never displayed, never heard. */
function attachSink(tabId: number, stream: MediaStream): void {
  const video = document.createElement("video");
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.srcObject = stream;
  video.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none";
  document.body.appendChild(video);
  void video.play().catch(() => undefined);
  sinks.set(tabId, video);
}

function release(tabId: number): void {
  clearTimeout(timers.get(tabId));
  timers.delete(tabId);
  finishers.delete(tabId);
  streams.get(tabId)?.getTracks().forEach((track) => track.stop());
  streams.delete(tabId);
  const sink = sinks.get(tabId);
  if (sink) {
    sink.srcObject = null;
    sink.remove();
    sinks.delete(tabId);
  }
}

/** (Re)start a tab's auto-off timer; 0 means none. */
function arm(tabId: number, endsAt: number): void {
  clearTimeout(timers.get(tabId));
  timers.delete(tabId);
  const finish = finishers.get(tabId);
  if (endsAt > 0 && finish) timers.set(tabId, setTimeout(finish, Math.max(0, endsAt - Date.now())));
}

async function start(tabId: number, streamId: string, endsAt: number): Promise<CaptureResult> {
  release(tabId);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId },
      } as MediaTrackConstraints,
    });
    streams.set(tabId, stream);
    attachSink(tabId, stream);
    // The stream ends by itself when the tab closes, or here when its timer runs out;
    // either way tell the worker so it can clean up.
    const finish = (): void => {
      if (streams.get(tabId) !== stream) return;
      release(tabId);
      const msg: CaptureEnded = { type: "capture:ended", tabId };
      void chrome.runtime.sendMessage(msg).catch(() => undefined);
    };
    stream.getVideoTracks()[0]?.addEventListener("ended", finish);
    finishers.set(tabId, finish);
    arm(tabId, endsAt);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

chrome.runtime.onMessage.addListener((msg: OffscreenRequest, _sender, sendResponse) => {
  if (msg?.type === "offscreen:start") {
    void start(msg.tabId, msg.streamId, msg.endsAt).then(sendResponse);
    return true;
  }
  if (msg?.type === "offscreen:retime") {
    arm(msg.tabId, msg.endsAt);
    sendResponse({ ok: true } satisfies CaptureResult);
    return false;
  }
  if (msg?.type === "offscreen:stop") {
    release(msg.tabId);
    sendResponse({ ok: true } satisfies CaptureResult);
  }
  return false;
});
