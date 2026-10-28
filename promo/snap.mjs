// Snapshot the REAL extension pages (popup, settings, welcome) for the promo slides.
//
// The pages are loaded from dist/ in Playwright's bundled Chromium with a stubbed
// `chrome` API (tabs, storage, i18n from the locale's messages.json), so the slides
// always show the shipped UI — same markup, same code, same strings. The rendered
// DOM is saved as static HTML with absolute asset paths and no scripts.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const letterTile = (letter, color) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='36' height='36'><rect width='36' height='36' rx='8' fill='${color}'/>` +
      `<text x='18' y='25' font-family='-apple-system,Arial' font-size='20' font-weight='700' fill='#fff' text-anchor='middle'>${letter}</text></svg>`,
  );
const FAV = {
  github: letterTile('G', '#24292f'),
  gmail: letterTile('M', '#ea4335'),
  docs: letterTile('D', '#1a73e8'),
  notion: letterTile('N', '#111111'),
  youtube: letterTile('Y', '#ff0000'),
  figma: letterTile('F', '#a259ff'),
};

// id, host-path, title, favicon
const TABS = [
  [1, 'https://github.com/anthropics/claude-code', 'anthropics/claude-code: Agentic coding tool', FAV.github],
  [2, 'https://github.com/pulls', 'Pull requests · your work', FAV.github],
  [3, 'https://github.com/issues', 'Issues · keep-tabs-alive', FAV.github],
  [4, 'https://mail.google.com/mail/u/0/', 'Inbox (24) — Gmail', FAV.gmail],
  [5, 'https://mail.google.com/mail/u/0/#sent', 'Sent — Gmail', FAV.gmail],
  [6, 'https://docs.google.com/document/d/1', 'Q3 planning — Google Docs', FAV.docs],
  [7, 'https://docs.google.com/spreadsheets/d/2', 'Budget 2026 — Sheets', FAV.docs],
  [8, 'https://www.notion.so/weekly', 'Weekly planning — Notion', FAV.notion],
  [9, 'https://www.youtube.com/watch?v=1', 'Lo-fi beats to focus — YouTube', FAV.youtube],
];

/** Everything a scenario can vary; the rest is shared. */
function scenarioFor(kind, { theme }) {
  const base = {
    theme,
    mode: 'whitelist',
    whitelist: ['github.com', 'mail.google.com', 'docs.google.com', 'notion.so'],
    activeId: 1,
    captured: [],
    ends: {},
  };
  const soon = (min) => Date.now() + min * 60_000;
  switch (kind) {
    case 'popup-mem':
      return { ...base, whitelist: ['github.com', 'notion.so'], activeId: 1 };
    case 'popup-run':
      return { ...base, activeId: 2, captured: [2, 6], ends: { 2: 0, 6: soon(54) } };
    case 'popup-dark':
      return { ...base, theme: 'dark', activeId: 8, captured: [8, 9], ends: { 8: soon(54), 9: 0 } };
    case 'options':
      return { ...base, activeId: 2, captured: [2, 6], ends: { 2: 0, 6: soon(95) } };
    default:
      return base;
  }
}

/** Runs in the page before any script: a stand-in for the parts of `chrome` the pages use. */
function installStub({ msgs, enMsgs, lang, scenario, tabs }) {
  const sub = (m, a) => {
    let x = m.message;
    for (const [k, v] of Object.entries(m.placeholders || {})) {
      x = x.split('$' + k.toUpperCase() + '$').join((a || [])[Number(String(v.content).slice(1)) - 1] ?? '');
    }
    return x;
  };
  const ev = () => ({ addListener() {}, removeListener() {} });
  const valueStore = (init) => ({
    get: async (k) => {
      if (k == null) return { ...init };
      const keys = Array.isArray(k) ? k : typeof k === 'string' ? [k] : Object.keys(k);
      return Object.fromEntries(keys.map((key) => [key, init[key]]));
    },
    set: async () => {},
    remove: async () => {},
  });
  // Local storage answers "yes" to any flag (consent given, tour already seen, …).
  const localStore = {
    get: async (k) => {
      const keys = k == null ? [] : Array.isArray(k) ? k : [typeof k === 'string' ? k : Object.keys(k)[0]];
      return Object.fromEntries(keys.map((key) => [key, key === 'captureMinutes' ? 0 : true]));
    },
    set: async () => {},
    remove: async () => {},
  };
  const list = tabs.map(([id, url, title, fav], i) => ({
    id,
    windowId: 1,
    index: i,
    url,
    title,
    favIconUrl: fav,
    autoDiscardable: true,
    active: id === scenario.activeId,
  }));
  list.push({ id: 99, windowId: 1, index: 99, url: 'chrome://extensions/', title: 'Extensions', autoDiscardable: true, active: false });
  window.chrome = {
    i18n: {
      getMessage: (k, a) => {
        const m = msgs[k] || enMsgs[k];
        return m ? sub(m, a == null ? [] : [].concat(a)) : '';
      },
      getUILanguage: () => lang,
    },
    storage: {
      sync: valueStore({
        settings: {
          enabled: true,
          mode: scenario.mode,
          excludedDomains: [],
          whitelistedDomains: scenario.whitelist,
          theme: scenario.theme,
        },
      }),
      local: localStore,
      session: valueStore({
        captureTabs: scenario.captured,
        captureEnds: scenario.ends,
        invokedTabs: scenario.captured,
      }),
      onChanged: ev(),
    },
    tabs: {
      query: async (q) => (q && q.active ? list.filter((t) => t.active) : list),
      get: async (id) => list.find((t) => t.id === id),
      onCreated: ev(),
      onRemoved: ev(),
      onUpdated: ev(),
      onReplaced: ev(),
      onActivated: ev(),
      onMoved: ev(),
      onAttached: ev(),
      onDetached: ev(),
      update: async () => {},
    },
    windows: { update: async () => {}, onFocusChanged: ev(), onRemoved: ev() },
    runtime: { id: 'promo', openOptionsPage() {}, onMessage: ev(), sendMessage: async () => ({ ok: true }), getURL: (p) => '/' + p },
    action: { openPopup: async () => {}, setIcon: async () => {}, setBadgeText: async () => {} },
    scripting: { executeScript: async () => {} },
  };
}

/**
 * Snapshot one page. Returns the static HTML (and any measurements).
 */
async function snapshot(ctx, baseUrl, distDir, locale, { page: file, kind, theme = 'light', viewport, after }) {
  const msgsPath = (l) => path.join(distDir, '_locales', l, 'messages.json');
  const read = (l) => {
    try {
      return JSON.parse(fs.readFileSync(msgsPath(l), 'utf8'));
    } catch {
      return {};
    }
  };
  const lang = locale.replace('_', '-');
  const pg = await ctx.newPage();
  await pg.setViewportSize(viewport);
  await pg.addInitScript(installStub, {
    msgs: read(locale),
    enMsgs: read('en'),
    lang,
    scenario: scenarioFor(kind, { theme }),
    tabs: TABS,
  });
  await pg.goto(`${baseUrl}/${file}`, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(500);
  let meta = {};
  if (after) meta = (await after(pg)) || {};
  const rtl = ['ar', 'fa', 'he', 'ur'].includes(locale);
  const html = await pg.evaluate(
    ({ lang, rtl, dist }) => {
      document.querySelectorAll('script, dialog').forEach((n) => n.remove());
      // outerHTML keeps attributes, not live state: copy checked-ness onto the markup.
      document.querySelectorAll('input[type=checkbox], input[type=radio]').forEach((i) => {
        if (i.checked) i.setAttribute('checked', '');
        else i.removeAttribute('checked');
      });
      document.documentElement.lang = lang;
      if (rtl) document.documentElement.dir = 'rtl';
      const style = document.createElement('style');
      style.textContent = '*{animation:none!important;transition:none!important}';
      document.head.append(style);
      let out = '<!DOCTYPE html>' + document.documentElement.outerHTML;
      out = out.split('href="css/').join(`href="${dist}/css/`).split('src="icons/').join(`src="${dist}/icons/`);
      return out;
    },
    { lang, rtl, dist: pathToFileURL(distDir).href },
  );
  await pg.close();
  return { html, meta };
}

/** Write ui/popup-*.html, ui/options.html, ui/welcome.html (+ ui/meta.json) for one locale. */
export async function snapshotUi(browser, baseUrl, distDir, locale, outUi) {
  fs.mkdirSync(outUi, { recursive: true });
  const ctx = await browser.newContext({ deviceScaleFactor: 2, colorScheme: 'light' });
  const popup = { width: 340, height: 600 };
  const wide = { width: 1200, height: 1500 };
  const write = (name, html) => fs.writeFileSync(path.join(outUi, name), html);

  write('popup-mem.html', (await snapshot(ctx, baseUrl, distDir, locale, { page: 'popup.html', kind: 'popup-mem', viewport: popup })).html);
  write('popup-run.html', (await snapshot(ctx, baseUrl, distDir, locale, { page: 'popup.html', kind: 'popup-run', viewport: popup })).html);

  const opts = await snapshot(ctx, baseUrl, distDir, locale, {
    page: 'options.html',
    kind: 'options',
    viewport: wide,
    after: async (pg) => {
      // Open the GitHub group so rows with both controls are visible.
      await pg.evaluate(() => document.querySelector('.tab-group__toggle')?.click());
      await pg.waitForTimeout(500);
      return pg.evaluate(() => ({ tabsTop: Math.round(document.getElementById('tabsPanel')?.getBoundingClientRect().top ?? 0) }));
    },
  });
  write('options.html', opts.html);
  fs.writeFileSync(path.join(outUi, 'meta.json'), JSON.stringify(opts.meta));

  write('welcome.html', (await snapshot(ctx, baseUrl, distDir, locale, { page: 'welcome.html', kind: 'welcome', viewport: { width: 1148, height: 1300 } })).html);
  await ctx.close();
}
