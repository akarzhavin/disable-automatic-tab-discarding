/** Tiny page-transition helpers: a top micro-loader bar and fade-out navigation. */

const BAR_ID = "fx-bar";

/** Show the thin top progress bar (creeps to ~82%, completed by hideBar). */
export function showBar(): void {
  if (document.getElementById(BAR_ID)) return;
  const bar = document.createElement("div");
  bar.id = BAR_ID;
  bar.className = "fx-bar";
  document.body.appendChild(bar);
  void bar.offsetWidth; // force reflow so the width transition animates from 0
  bar.style.width = "82%";
}

/** Complete and fade out the top progress bar. */
export function hideBar(): void {
  const bar = document.getElementById(BAR_ID);
  if (!bar) return;
  bar.style.width = "100%";
  bar.style.opacity = "0";
  setTimeout(() => bar.remove(), 320);
}

/** Fade the current page out, show the loader, then navigate (same tab). */
export function navigateWithFade(url: string): void {
  showBar();
  document.body.classList.add("fx-leaving");
  setTimeout(() => {
    location.href = url;
  }, 210);
}
