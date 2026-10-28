/**
 * Toolbar icon variants, drawn over the packaged icon: "running" (red live dot — some
 * tab is kept running) and "attention" (white shield on a blue disc — "click me to finish turning it on").
 */

export const ICON_SIZES = [16, 32, 48, 128] as const;
export const DEFAULT_ICON_PATHS: Record<number, string> = Object.fromEntries(
  ICON_SIZES.map((s) => [s, `icons/icon${s}.png`]),
);

const RUNNING_COLOR = "#ef4444";
const ATTENTION_COLOR = "#0284c7";

async function drawOne(size: number, mark: "running" | "attention"): Promise<ImageData> {
  const res = await fetch(chrome.runtime.getURL(`icons/icon${size}.png`));
  const bitmap = await createImageBitmap(await res.blob());
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
  ctx.drawImage(bitmap, 0, 0, size, size);

  const lw = Math.max(1.5, size * 0.09);
  if (mark === "running") {
    // Small red dot top-right, like Chrome's own capture indicator.
    const r = size * 0.23 - lw / 2;
    const cx = size - r - lw * 0.6;
    const cy = r + lw * 0.6;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = RUNNING_COLOR;
    ctx.fill();
    ctx.lineWidth = lw;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
  } else {
    // A solid blue disc with the shield in white: high contrast against the normal green
    // shield it alternates with, so the blink reads on any toolbar colour.
    const inner = Math.round(size * 0.62);
    const off = (size - inner) / 2;
    const shield = new OffscreenCanvas(size, size);
    const sctx = shield.getContext("2d") as OffscreenCanvasRenderingContext2D;
    sctx.drawImage(bitmap, off, off + size * 0.02, inner, inner);
    sctx.globalCompositeOperation = "source-in";
    sctx.fillStyle = "#ffffff";
    sctx.fillRect(0, 0, size, size);

    ctx.clearRect(0, 0, size, size);
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = ATTENTION_COLOR;
    ctx.fill();
    ctx.drawImage(shield, 0, 0);
    // The shield's check mark, in the disc's blue, so it still reads as our icon.
    ctx.beginPath();
    ctx.moveTo(size * 0.385, size * 0.5);
    ctx.lineTo(size * 0.47, size * 0.585);
    ctx.lineTo(size * 0.625, size * 0.425);
    ctx.lineWidth = Math.max(1.5, size * 0.075);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = ATTENTION_COLOR;
    ctx.stroke();
  }
  return ctx.getImageData(0, 0, size, size);
}

/** All sizes of one variant, ready for chrome.action.setIcon({ imageData }). */
export async function drawIcons(mark: "running" | "attention"): Promise<Record<number, ImageData>> {
  const frames = await Promise.all(ICON_SIZES.map((s) => drawOne(s, mark)));
  return Object.fromEntries(ICON_SIZES.map((s, i) => [s, frames[i]!]));
}
