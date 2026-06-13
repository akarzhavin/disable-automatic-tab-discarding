/** Apply the theme preference to a page by toggling [data-theme] on <html>. */

import type { ThemePref } from "./types.js";

/**
 * Set the theme. For "auto" we remove the attribute and let CSS decide via
 * prefers-color-scheme. For "light"/"dark" we pin it with a data attribute.
 */
export function applyTheme(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === "auto") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", pref);
  }
}
