/**
 * Tiny i18n layer over chrome.i18n.
 *
 * `t()` looks up a message (with optional substitutions); `localizePage()`
 * walks the DOM once and fills in any element carrying a `data-i18n*`
 * attribute. Chrome picks the locale automatically from the browser UI
 * language, falling back to the `default_locale` declared in the manifest.
 */

/** Get a localized message. Falls back to the key if it isn't found. */
export function t(key: string, substitutions?: string | string[]): string {
  const msg = chrome.i18n.getMessage(key, substitutions);
  return msg || key;
}

/**
 * Replace text/attributes for every element tagged with a `data-i18n*`
 * attribute. Supported attributes:
 *   data-i18n             → textContent
 *   data-i18n-html        → innerHTML (for messages that contain markup)
 *   data-i18n-title       → title
 *   data-i18n-placeholder → placeholder
 *   data-i18n-aria-label  → aria-label
 */
export function localizePage(root: ParentNode = document): void {
  apply(root, "data-i18n", (el, v) => (el.textContent = v));
  apply(root, "data-i18n-html", (el, v) => (el.innerHTML = v));
  apply(root, "data-i18n-title", (el, v) => el.setAttribute("title", v));
  apply(root, "data-i18n-placeholder", (el, v) => el.setAttribute("placeholder", v));
  apply(root, "data-i18n-aria-label", (el, v) => el.setAttribute("aria-label", v));

  // Reflect the active locale + direction on <html> for CSS/`:lang()` hooks.
  const html = document.documentElement;
  if (html) {
    html.lang = chrome.i18n.getUILanguage?.() ?? html.lang;
    const dir = t("@@bidi_dir");
    if (dir === "rtl" || dir === "ltr") html.dir = dir;
  }
}

function apply(
  root: ParentNode,
  attr: string,
  set: (el: HTMLElement, value: string) => void,
): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(`[${attr}]`))) {
    const key = el.getAttribute(attr);
    if (key) set(el, t(key));
  }
}
