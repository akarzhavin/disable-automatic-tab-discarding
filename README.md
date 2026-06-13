# Keep Tabs Alive — Disable Automatic Tab Discarding

A polished Chrome (Manifest V3) extension that stops Chrome from automatically
discarding (suspending) your tabs and reloading them when you switch back.

Inspired by the minimal [DoNotDiscard](https://github.com/WorldLanguages/DoNotDiscard),
rebuilt with a real UI: per-site rules, per-tab control, live statistics, a
toolbar badge, a guided tour, 50+ languages and a clean light/dark interface.

## Features

- **Master switch** — pause/resume all protection from the popup in one click.
- **Two modes**
  - *Protect everything* — keep every tab alive except sites you exclude.
  - *Whitelist only* — keep only the sites you list alive.
- **Per-site rules** — protect/exclude the current site in one click. Domain
  rules also match subdomains (`example.com` covers `mail.example.com`). Shown in
  the popup as a **Permanent** scope.
- **Per-tab switches** — the settings page lists every open tab (searchable,
  grouped by window) with its own protect switch. A manual switch is a
  **Temporary** override that beats the site rules for that one tab until it's
  closed — or promote it into a permanent site rule with one click.
- **Toolbar badge** — shows how many tabs are currently protected.
- **Statistics** — protected-now count, protect operations, and discard events
  Chrome performed, since install.
- **Themes** — Auto (follows your OS), Light, or Dark.
- **Localized** — the interface ships in 50+ languages.
- **Privacy-first** — no tracking, no analytics, no servers. See
  [PRIVACY_POLICY.md](PRIVACY_POLICY.md).

## How it works

A background service worker marks tabs with
`chrome.tabs.update(tabId, { autoDiscardable: false })`, re-evaluating on tab
create/navigate, on startup, and whenever your settings change. All state lives
in `chrome.storage` (settings in `sync`, stats in `local`, per-tab overrides in
`session`) because MV3 service workers are ephemeral.

## Build

```bash
npm install
npm run build      # → dist/   (npm run watch for incremental builds)
```

TypeScript compiles to plain ES-module JavaScript with `tsc` — no bundler, no
runtime dependencies.

### Production package

```bash
npm run package    # clean build → minify → release/keep-tabs-alive-v1.0.0.zip
```

`npm run minify` runs [scripts/minify.mjs](scripts/minify.mjs), which uses
`esbuild` to minify the built JS (per file — ES-module imports are preserved, no
bundling) and CSS, and compacts every JSON file (`manifest.json` and the
`_locales/*` message catalogs). HTML is left untouched on purpose. The resulting
zip has `manifest.json` at its root, ready to upload to the Chrome Web Store.

## Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right)
3. **Load unpacked** → select the `dist/` folder

## Verify it works

- Open `chrome://discards`. The **Auto Discardable** column shows ✕ for every
  protected tab. The toolbar badge matches that count.
- Add a domain under *Excluded sites* (Settings) → that tab flips back to ✓
  without a reload.
- Toggle the master switch off → all tabs return to ✓ and the badge clears.

> Note: `chrome://discards` still lets you discard a tab *manually*. This
> extension only blocks Chrome's **automatic** memory-saver discarding.

## Project layout

```
src/
  background.ts        # service worker — applies protection, badge, stats
  popup.ts             # toolbar popup
  options.ts           # settings page
  welcome.ts           # first-run welcome page
  tour.ts              # guided tour overlay
  shared/              # types, domain matching, protection rule, storage, i18n, theme
static/                # manifest, HTML, CSS, icons, _locales (copied verbatim into dist/)
scripts/
  minify.mjs           # production minifier (esbuild + JSON compaction)
promo/                 # Chrome Web Store promo screenshot generator + output
release/               # packaged .zip for the Web Store
```

## Privacy

Keep Tabs Alive collects no data and makes no network requests. Full details in
[PRIVACY_POLICY.md](PRIVACY_POLICY.md).
