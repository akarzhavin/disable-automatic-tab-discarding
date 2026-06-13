'use strict';
const fs = require('fs');
const path = require('path');

const PROMO = __dirname;
const UI = path.join(PROMO, 'ui');

// Letter-tile favicon as a data URI (no network needed, looks like a real favicon)
const fav = (letter, color) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='36' height='36'>` +
      `<rect width='36' height='36' rx='8' fill='${color}'/>` +
      `<text x='18' y='25' font-family='-apple-system,Arial' font-size='20' font-weight='700' fill='#fff' text-anchor='middle'>${letter}</text>` +
    `</svg>`
  );

const FAV = {
  github: fav('G', '#24292f'),
  gmail: fav('M', '#ea4335'),
  docs: fav('D', '#1a73e8'),
  notion: fav('N', '#111111'),
  figma: fav('F', '#a259ff'),
  youtube: fav('Y', '#ff0000'),
  reddit: fav('R', '#ff4500'),
  jira: fav('J', '#0052cc'),
};

// shared <head> for a UI page; theme + one component sheet from the real extension
const uiHead = (componentCss, dark) => `<!DOCTYPE html>
<html lang="en"${dark ? ' data-theme="dark"' : ''}>
<head>
<meta charset="UTF-8" />
<link rel="stylesheet" href="../../static/css/theme.css" />
<link rel="stylesheet" href="../../static/css/${componentCss}" />
<style>
  *{animation:none!important;transition:none!important}
  html,body{background:transparent!important}
</style>
</head>`;

const sw = (checked, lg) =>
  `<label class="switch${lg ? ' switch--lg' : ''}"><input type="checkbox"${checked ? ' checked' : ''} /><span class="switch__track"><span class="switch__thumb"></span></span></label>`;

const gearSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 15a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" stroke-width="2"/><path d="M19.4 13a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 003.6 15a1.65 1.65 0 00-1.51-1H2a2 2 0 110-4h.09A1.65 1.65 0 003.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 008 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9c.2.6.74 1 1.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" stroke-width="2"/></svg>`;
const checkSvg = `<svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const moonSvg = `<svg viewBox="0 0 24 24" fill="none"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 109.8 9.8z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`;

// ── Popup UI ─────────────────────────────────────────────────────────────
function popup({ dark, host, hostFav, tabPath, count, siteOn, tabOn, noteState, noteText, pill }) {
  return `${uiHead('popup.css', dark)}
<body>
  <div class="app" id="app" data-enabled="true">
    <header class="header">
      <div class="brand">
        <img class="brand__logo" src="../../static/icons/icon48.png" alt="" width="22" height="22" />
        <span class="brand__name">Keep Tabs Alive</span>
      </div>
      ${sw(true, true)}
    </header>
    <section class="card status">
      <div class="status__main">
        <span class="status__count">${count}</span>
        <span class="status__label">tabs protected</span>
      </div>
      <div class="status__pill"><span class="dot"></span><span>${pill}</span></div>
    </section>
    <section class="card site">
      <div class="ctl">
        <div class="ctl__text">
          <span class="ctl__head"><span class="ctl__label">This website</span><span class="ctl__scope ctl__scope--site">Permanent</span></span>
          <span class="ctl__value"><img class="ctl__favicon" src="${hostFav}" width="14" height="14" /><span>${host}</span></span>
        </div>
        ${sw(siteOn)}
      </div>
      <div class="ctl">
        <div class="ctl__text">
          <span class="ctl__head"><span class="ctl__label">This tab</span><span class="ctl__scope ctl__scope--tab">Temporary</span></span>
          <span class="ctl__value"><span>${tabPath}</span></span>
        </div>
        ${sw(tabOn)}
      </div>
    </section>
    <section class="card note" data-state="${noteState}">
      <span class="note__icon">${noteState === 'on' ? checkSvg : moonSvg}</span>
      <span class="note__text">${noteText}</span>
    </section>
    <footer class="footer">
      <button class="link">${gearSvg}<span>Settings &amp; statistics</span></button>
    </footer>
  </div>
</body></html>`;
}

// ── Options building blocks ──────────────────────────────────────────────
const topbar = (themeActive) => `
  <header class="topbar">
    <div class="brand">
      <img class="brand__logo" src="../../static/icons/icon128.png" alt="" width="40" height="40" />
      <div>
        <h1 class="brand__name">Keep Tabs Alive</h1>
        <p class="brand__sub">Disable automatic tab discarding</p>
      </div>
    </div>
    <div class="topbar__controls">
      <button class="icon-btn"><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.7"/><path d="M9.5 9.2a2.5 2.5 0 014.9.8c0 1.7-2.4 2-2.4 3.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="16.6" r="1.1" fill="currentColor"/></svg></button>
      <div class="seg" role="radiogroup">
        <button class="seg__btn" role="radio" aria-checked="${themeActive === 'auto'}">Auto</button>
        <button class="seg__btn" role="radio" aria-checked="${themeActive === 'light'}">Light</button>
        <button class="seg__btn" role="radio" aria-checked="${themeActive === 'dark'}">Dark</button>
      </div>
      ${sw(true, true)}
    </div>
  </header>`;

const statbar = `
  <section class="panel statbar">
    <div class="stat"><span class="stat__num stat__num--accent">12</span><span class="stat__label">protected now</span></div>
    <div class="stat"><span class="stat__num">18</span><span class="stat__label">open tabs</span></div>
    <div class="stat"><span class="stat__num">3,482</span><span class="stat__label">protect operations</span></div>
    <div class="stat"><span class="stat__num">27</span><span class="stat__label">discards observed</span></div>
    <div class="statbar__meta"><span>since install</span><button class="linklike">Reset</button></div>
  </section>`;

const modesPanel = `
  <section class="panel">
    <div class="panel__head"><h2 class="panel__title">Protection mode</h2></div>
    <div class="modes">
      <label class="mode"><input type="radio" name="mode" checked /><div class="mode__body"><span class="mode__name">Protect everything</span><span class="mode__desc">Keep all tabs alive, except the sites you exclude.</span></div></label>
      <label class="mode"><input type="radio" name="mode" /><div class="mode__body"><span class="mode__name">Whitelist only</span><span class="mode__desc">Only keep the sites you list alive.</span></div></label>
    </div>
  </section>`;

const rulesPanel = `
  <section class="panel">
    <div class="panel__head"><h2 class="panel__title">Excluded sites</h2><span class="count-badge">2</span></div>
    <p class="panel__desc">These sites are allowed to be discarded. A domain also matches its subdomains — e.g. <code>example.com</code> covers <code>mail.example.com</code>.</p>
    <form class="adder"><input class="input" type="text" placeholder="example.com" /><button class="btn" type="button">Add</button></form>
    <ul class="domain-list">
      <li class="domain-row"><span class="domain-row__name">youtube.com</span><button class="domain-row__remove">Remove</button></li>
      <li class="domain-row"><span class="domain-row__name">reddit.com</span><button class="domain-row__remove">Remove</button></li>
    </ul>
  </section>`;

const tabRow = (favicon, title, host, on, tag) => `
        <li class="tab-row">
          <span class="tab-row__main">
            <img class="tab-row__favicon" src="${favicon}" />
            <span class="tab-row__text">
              <span class="tab-row__title">${title}</span>
              <span class="tab-row__sub"><span class="tab-row__host">${host}</span>${tag ? `<span class="minitag minitag--manual">${tag}</span>` : ''}</span>
            </span>
          </span>
          ${sw(on)}
        </li>`;

const chevron = `<svg class="tab-group__chevron" viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const pinSvg = `<svg viewBox="0 0 24 24" fill="none"><path d="M9 4h6l-1 6 3 3H7l3-3-1-6z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 16v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

const tabsPanel = `
  <main class="panel">
    <div class="panel__head">
      <h2 class="panel__title">Open tabs</h2>
      <span class="count-badge">18</span>
      <input class="input input--search" type="search" placeholder="Search tabs…" />
    </div>
    <p class="panel__desc">Flip a switch to keep that tab alive or let Chrome discard it. A manual switch overrides the site rules and lasts until the tab is closed.</p>
    <div class="tab-groups">
      <div class="tab-group is-expanded">
        <div class="tab-group__head">
          <button class="tab-group__toggle" aria-expanded="true">
            ${chevron}
            <span class="tab-group__icon"><img src="${FAV.github}" /></span>
            <span class="tab-group__host">github.com</span>
            <span class="tab-group__count">3</span>
          </button>
          <span class="tab-group__alive">Keep alive</span>
          ${sw(true)}
        </div>
        <ul class="tab-list">
          ${tabRow(FAV.github, 'anthropics/claude-code: Agentic coding tool', 'github.com', true, '')}
          ${tabRow(FAV.github, 'Pull requests · your work', 'github.com', true, 'This tab')}
          ${tabRow(FAV.github, 'Issues · keep-tabs-alive', 'github.com', true, '')}
        </ul>
      </div>
      <div class="tab-group">
        <div class="tab-group__head">
          <button class="tab-group__toggle" aria-expanded="false">
            ${chevron}
            <span class="tab-group__icon"><img src="${FAV.gmail}" /></span>
            <span class="tab-group__host">mail.google.com</span>
            <span class="tab-group__count">2</span>
          </button>
          <span class="tab-group__active"><span class="dot"></span>2</span>
          ${sw(true)}
        </div>
      </div>
      <div class="tab-group">
        <div class="tab-group__head">
          <button class="tab-group__toggle" aria-expanded="false">
            ${chevron}
            <span class="tab-group__icon"><img src="${FAV.docs}" /></span>
            <span class="tab-group__host">docs.google.com</span>
            <span class="tab-group__count">4</span>
          </button>
          <span class="tab-group__active"><span class="dot"></span>4</span>
          ${sw(true)}
        </div>
      </div>
      <div class="tab-group">
        <div class="tab-group__head">
          <button class="tab-group__toggle" aria-expanded="false">
            ${chevron}
            <span class="tab-group__icon"><img src="${FAV.youtube}" /></span>
            <span class="tab-group__host">youtube.com</span>
            <span class="tab-group__count">1</span>
          </button>
          <span class="tab-group__pins">${pinSvg}1</span>
          ${sw(false)}
        </div>
      </div>
    </div>
  </main>`;

function optionsPage({ dark, bands }) {
  return `${uiHead('options.css', dark)}
<body>
  <div class="page">
    ${bands.join('\n')}
  </div>
</body></html>`;
}

// ── Welcome / first-run page ─────────────────────────────────────────────
// Keeps the real page background (no transparent override) so it reads as a
// genuine browser tab inside the window frame.
function welcomePage({ dark }) {
  return `<!DOCTYPE html>
<html lang="en"${dark ? ' data-theme="dark"' : ''}>
<head>
<meta charset="UTF-8" />
<link rel="stylesheet" href="../../static/css/theme.css" />
<link rel="stylesheet" href="../../static/css/welcome.css" />
<style>*{animation:none!important;transition:none!important}</style>
</head>
<body>
  <main class="welcome">
    <header class="hero">
      <div class="hero__badge"><img src="../../static/icons/icon128.png" alt="" width="72" height="72" /></div>
      <p class="hero__eyebrow">Welcome</p>
      <h1 class="hero__title">Keep the tabs that matter</h1>
      <p class="hero__lead">Chrome quietly unloads idle tabs to save memory, then reloads them when you come back — losing your scroll position, forms and state. Tell Keep Tabs Alive which sites should always stay alive, and it leaves the rest to Chrome.</p>
    </header>
    <section class="cards">
      <article class="wcard">
        <span class="wcard__icon"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3l7 3v5c0 4.4-3 7.4-7 8.5C8 21.4 5 18.4 5 14V6l7-3z" fill="currentColor" opacity="0.16"/><path d="M12 3l7 3v5c0 4.4-3 7.4-7 8.5C8 21.4 5 18.4 5 14V6l7-3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        <h3 class="wcard__title">Tabs stay put</h3>
        <p class="wcard__text">No more surprise reloads. Open tabs keep their scroll position, unsaved forms and page state exactly where you left them.</p>
      </article>
      <article class="wcard">
        <span class="wcard__icon"><svg viewBox="0 0 24 24" fill="none"><rect x="3" y="7" width="18" height="10" rx="5" stroke="currentColor" stroke-width="1.6"/><circle cx="15" cy="12" r="2.6" fill="currentColor"/></svg></span>
        <h3 class="wcard__title">Per-tab switches</h3>
        <p class="wcard__text">The settings page lists every open tab with its own switch. Keep one tab alive or let another sleep — it overrides the rules just for that tab.</p>
      </article>
      <article class="wcard">
        <span class="wcard__icon"><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M3 12h18M12 3c2.5 2.4 2.5 15.6 0 18M12 3c-2.5 2.4-2.5 15.6 0 18" stroke="currentColor" stroke-width="1.6"/></svg></span>
        <h3 class="wcard__title">Site rules</h3>
        <p class="wcard__text">Protect everything except a few sites, or whitelist only the ones you choose. Rules match subdomains too — <code>example.com</code> covers all of it.</p>
      </article>
    </section>
    <section class="actions">
      <button class="btn btn--lg">Choose your sites</button>
      <p class="actions__note">Prefer to protect everything by default? You can switch modes in settings.</p>
    </section>
  </main>
</body></html>`;
}

// ── Write UI files ───────────────────────────────────────────────────────
fs.writeFileSync(path.join(UI, 'popup-on.html'), popup({
  dark: false, host: 'github.com', hostFav: FAV.github, tabPath: 'anthropics/claude-code: Agentic coding tool',
  count: 12, siteOn: true, tabOn: true, noteState: 'on',
  noteText: "This tab is protected — Chrome won't discard it.", pill: 'Protection on',
}));

fs.writeFileSync(path.join(UI, 'popup-excluded.html'), popup({
  dark: false, host: 'youtube.com', hostFav: FAV.youtube, tabPath: 'Rick Astley - Never Gonna Give You Up',
  count: 12, siteOn: false, tabOn: false, noteState: 'off',
  noteText: 'This site is excluded — Chrome may discard it to save memory.', pill: 'Protection on',
}));

fs.writeFileSync(path.join(UI, 'popup-dark.html'), popup({
  dark: true, host: 'notion.so', hostFav: FAV.notion, tabPath: 'Weekly planning — Notion',
  count: 12, siteOn: true, tabOn: true, noteState: 'on',
  noteText: "This tab is protected — Chrome won't discard it.", pill: 'Protection on',
}));

fs.writeFileSync(path.join(UI, 'options-tabs.html'), optionsPage({
  dark: false, bands: [topbar('light'), statbar, tabsPanel],
}));

fs.writeFileSync(path.join(UI, 'options-modes.html'), optionsPage({
  dark: false, bands: [topbar('light'), modesPanel, rulesPanel],
}));

fs.writeFileSync(path.join(UI, 'options-dark.html'), optionsPage({
  dark: true, bands: [topbar('dark'), statbar, tabsPanel],
}));

fs.writeFileSync(path.join(UI, 'welcome.html'), welcomePage({ dark: false }));

// ── Promo slides ─────────────────────────────────────────────────────────
const slideHead = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />
<link rel="stylesheet" href="promo.css" /></head>`;

// side layout: copy left, framed device right (popup)
function slideSide({ eyebrow, title, sub, ui, frameClass, accent }) {
  return `${slideHead}
<body class="${accent || ''}">
  <div class="slide slide--side">
    <div class="bg"></div>
    <div class="copy">
      <span class="eyebrow">${eyebrow}</span>
      <h1>${title}</h1>
      <p>${sub}</p>
    </div>
    <div class="stage">
      <div class="device ${frameClass}">
        <div class="toolbar">
          <div class="toolbar__ext">
            <img src="../static/icons/icon32.png" width="20" height="20" alt="" />
            <span class="toolbar__badge">12</span>
          </div>
        </div>
        <iframe src="ui/${ui}" scrolling="no"></iframe>
      </div>
    </div>
  </div>
</body></html>`;
}

// stack layout: copy top, wide window below (options)
function slideStack({ eyebrow, title, sub, ui, scale, accent }) {
  return `${slideHead}
<body class="${accent || ''}">
  <div class="slide slide--stack">
    <div class="bg"></div>
    <div class="copy">
      <span class="eyebrow">${eyebrow}</span>
      <h1>${title}</h1>
      <p>${sub}</p>
    </div>
    <div class="window">
      <div class="window__bar"><span class="d red"></span><span class="d yel"></span><span class="d grn"></span><span class="window__url">chrome-extension · Keep Tabs Alive — Settings</span></div>
      <div class="window__view">
        <iframe src="ui/${ui}" scrolling="no" style="width:1200px;transform:scale(${scale});transform-origin:top left;"></iframe>
      </div>
    </div>
  </div>
</body></html>`;
}

fs.writeFileSync(path.join(PROMO, 'slide1.html'), slideSide({
  accent: 'theme-1',
  eyebrow: 'KEEP TABS ALIVE',
  title: 'Stop Chrome from<br>reloading your tabs',
  sub: "Chrome's Memory Saver discards idle tabs and reloads them from scratch when you switch back. Keep the tabs that matter exactly where you left them.",
  ui: 'popup-on.html', frameClass: 'device--popup',
}));

fs.writeFileSync(path.join(PROMO, 'slide2.html'), slideStack({
  accent: 'theme-2',
  eyebrow: 'EVERY TAB, ONE PLACE',
  title: 'See and control every open tab',
  sub: 'A live list of all your tabs — grouped by site, searchable, with stats. Flip a switch to keep any tab alive, or let Chrome discard it.',
  ui: 'options-tabs.html', scale: 0.92,
}));

fs.writeFileSync(path.join(PROMO, 'slide3.html'), slideStack({
  accent: 'theme-3',
  eyebrow: 'YOUR RULES',
  title: 'Protect everything — or just what you choose',
  sub: 'Two modes plus per-site rules. Domain rules cover subdomains automatically, so example.com protects all of it.',
  ui: 'options-modes.html', scale: 0.92,
}));

fs.writeFileSync(path.join(PROMO, 'slide4.html'), slideSide({
  accent: 'theme-4',
  eyebrow: 'ONE CLICK',
  title: 'Per site or<br>per tab — instantly',
  sub: 'Protect or exclude the current site straight from the toolbar. Or override a single tab until you close it. Domain rules cover subdomains too.',
  ui: 'popup-excluded.html', frameClass: 'device--popup',
}));

fs.writeFileSync(path.join(PROMO, 'slide5.html'), slideSide({
  accent: 'theme-5',
  eyebrow: 'PRIVATE BY DESIGN',
  title: 'Lightweight, private,<br>in 50+ languages',
  sub: 'No tracking, no analytics, no servers — everything stays in your browser. Light, dark or auto theme, fully localized.',
  ui: 'popup-dark.html', frameClass: 'device--popup device--dark',
}));

// Welcome slide — the real onboarding page framed in a browser window, no extra copy.
function slideWelcome({ accent, ui }) {
  return `${slideHead}
<body class="${accent || ''}">
  <div class="slide slide--welcome">
    <div class="bg"></div>
    <div class="window window--welcome">
      <div class="window__bar"><span class="d red"></span><span class="d yel"></span><span class="d grn"></span><span class="window__url">Welcome — Keep Tabs Alive</span></div>
      <div class="window__view window__view--welcome">
        <iframe src="ui/${ui}" scrolling="no" style="width:1148px;transform:scale(0.85);transform-origin:top center;"></iframe>
      </div>
    </div>
  </div>
</body></html>`;
}

fs.writeFileSync(path.join(PROMO, 'slide6.html'), slideWelcome({
  accent: 'theme-2',
  ui: 'welcome.html',
}));

console.log('generated UI + slides');
