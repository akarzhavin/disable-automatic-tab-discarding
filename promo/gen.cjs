'use strict';
const fs = require('fs');
const path = require('path');

const PROMO = __dirname;
const ROOT = path.join(PROMO, '..');
const STATIC = path.join(ROOT, 'static');
const LOCALES_DIR = path.join(STATIC, '_locales');

// ── i18n + output ────────────────────────────────────────────────────────
//   node gen.cjs <locale> [outDir]
// With no outDir the slides/ui are written in place (relative asset paths),
// matching the original layout. With an outDir, a fully self-contained build
// is written there using absolute asset paths — so many locales can be
// rendered in parallel without clobbering each other's shared files.
const LOCALE = process.argv[2] || 'en';
const OUT = process.argv[3] ? path.resolve(process.argv[3]) : PROMO;
const ABS = OUT !== PROMO;
const UI = path.join(OUT, 'ui');
fs.mkdirSync(UI, { recursive: true });

const uiCss = (n) => (ABS ? `${STATIC}/css/${n}` : `../../static/css/${n}`);
const uiIcon = (n) => (ABS ? `${STATIC}/icons/${n}` : `../../static/icons/${n}`);
const slideIcon = (n) => (ABS ? `${STATIC}/icons/${n}` : `../static/icons/${n}`);
const promoCssHref = ABS ? `${PROMO}/promo.css` : 'promo.css';
const uiHref = (n) => (ABS ? `${UI}/${n}` : `ui/${n}`);

const RTL = new Set(['ar', 'fa', 'he', 'ur', 'ps', 'sd', 'ug', 'yi']);
const isRTL = RTL.has(LOCALE);
const htmlLang = LOCALE.replace('_', '-');
const dirAttr = isRTL ? ' dir="rtl"' : '';

// Extension UI strings (static/_locales/<locale>/messages.json), English fallback.
function loadMessages(locale) {
  const read = (l) => {
    try { return JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, l, 'messages.json'), 'utf8')); }
    catch { return {}; }
  };
  const base = read('en');
  const loc = locale === 'en' ? base : read(locale);
  return (key, vars) => {
    const entry = loc[key] || base[key];
    let s = entry && entry.message != null ? entry.message : key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split('$' + k + '$').join(v);
    return s;
  };
}

// Bespoke promo marketing copy (promo-copy.json), English fallback.
function loadPromoCopy(locale) {
  const all = JSON.parse(fs.readFileSync(path.join(PROMO, 'promo-copy.json'), 'utf8'));
  const en = all.en;
  const loc = all[locale] || {};
  return (slide, field) => (loc[slide] && loc[slide][field] != null ? loc[slide][field] : en[slide][field]);
}

const t = loadMessages(LOCALE);
const p = loadPromoCopy(LOCALE);

// The UI pages (popup, settings, welcome) are NOT built here: render.mjs snapshots the
// real extension pages from dist/ into <build>/ui/ before this runs (see snap.mjs).
let UI_META = {};
try { UI_META = JSON.parse(fs.readFileSync(path.join(UI, 'meta.json'), 'utf8')); } catch {}

// ── Promo slides ─────────────────────────────────────────────────────────
const slideHead = `<!DOCTYPE html><html lang="${htmlLang}"${dirAttr}><head><meta charset="UTF-8" />
<link rel="stylesheet" href="${promoCssHref}" /></head>`;

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
            <img src="${slideIcon('icon32.png')}" width="20" height="20" alt="" />
            <span class="toolbar__badge">4</span>
          </div>
        </div>
        <iframe src="${uiHref(ui)}" scrolling="no"></iframe>
      </div>
    </div>
  </div>
</body></html>`;
}

// stack layout: copy top, wide window below (options)
function slideStack({ eyebrow, title, sub, ui, scale, accent, offset = 0 }) {
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
      <div class="window__bar"><span class="d red"></span><span class="d yel"></span><span class="d grn"></span><span class="window__url">${t('settingsTitle')}</span></div>
      <div class="window__view">
        <iframe src="${uiHref(ui)}" scrolling="no" style="width:1200px;transform:scale(${scale});transform-origin:top left;margin-top:-${Math.round(offset * scale)}px;"></iframe>
      </div>
    </div>
  </div>
</body></html>`;
}

fs.writeFileSync(path.join(OUT, 'slide2.html'), slideSide({
  accent: 'theme-1',
  eyebrow: p('slide1', 'eyebrow'),
  title: p('slide1', 'title'),
  sub: p('slide1', 'sub'),
  ui: 'popup-mem.html', frameClass: 'device--popup',
}));

// Keep running: the popup with its blue card and the list of held tabs.
fs.writeFileSync(path.join(OUT, 'slide3.html'), slideSide({
  accent: 'theme-2',
  eyebrow: p('slide2', 'eyebrow'),
  title: p('slide2', 'title'),
  sub: p('slide2', 'sub'),
  ui: 'popup-run.html', frameClass: 'device--popup',
}));

// Settings: the two mode cards at the top of the page.
fs.writeFileSync(path.join(OUT, 'slide4.html'), slideStack({
  accent: 'theme-3',
  eyebrow: p('slide3', 'eyebrow'),
  title: p('slide3', 'title'),
  sub: p('slide3', 'sub'),
  ui: 'options.html', scale: 0.92, offset: 0,
}));

// The tab list with its aligned columns.
fs.writeFileSync(path.join(OUT, 'slide5.html'), slideStack({
  accent: 'theme-4',
  eyebrow: p('slide4', 'eyebrow'),
  title: p('slide4', 'title'),
  sub: p('slide4', 'sub'),
  ui: 'options.html', scale: 0.92, offset: Math.max(0, (UI_META.tabsTop || 0) - 24),
}));

// Welcome slide — the real onboarding page framed in a browser window, no extra copy.
function slideWelcome({ accent, ui }) {
  return `${slideHead}
<body class="${accent || ''}">
  <div class="slide slide--welcome">
    <div class="bg"></div>
    <div class="window window--welcome">
      <div class="window__bar"><span class="d red"></span><span class="d yel"></span><span class="d grn"></span><span class="window__url">${t('welcomeTitle')}</span></div>
      <div class="window__view window__view--welcome">
        <iframe src="${uiHref(ui)}" scrolling="no" style="width:1148px;transform:scale(0.85);transform-origin:top center;"></iframe>
      </div>
    </div>
  </div>
</body></html>`;
}

// The closing slide: not a screenshot — the two modes explained as a poster.
const chipSvg = `<svg viewBox="0 0 24 24" fill="none"><rect x="6" y="6" width="12" height="12" rx="2.5" stroke="currentColor" stroke-width="1.6"/><rect x="9.5" y="9.5" width="5" height="5" rx="1" fill="currentColor"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const boltSvg = `<svg viewBox="0 0 24 24" fill="none"><path d="M13 3L5 13.5h6L10 21l8-10.5h-6L13 3z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
const okSvg = `<svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const dashSvg = `<svg viewBox="0 0 24 24" fill="none"><path d="M6 12h12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`;

function slideModes() {
  const card = (cls, icon, name, promise, gain, cost, forWhat) => `
      <article class="mode mode--${cls}">
        <div class="mode__art"><span class="ring r3"></span><span class="ring r2"></span><span class="ring r1"></span><span class="mode__icon">${icon}</span></div>
        <h2>${name}</h2>
        <p class="mode__promise">${promise}</p>
        <ul>
          <li class="gain"><i>${okSvg}</i><span>${gain}</span></li>
          <li class="cost"><i>${dashSvg}</i><span>${cost}</span></li>
        </ul>
        <p class="mode__for"><b>${t('wGoodFor')}</b> ${forWhat}</p>
      </article>`;
  return `${slideHead}
<body class="theme-6">
  <div class="slide slide--modes">
    <div class="bg"></div>
    <div class="modes__inner">
    <h1 class="modes__title">${t('heroTitle')}</h1>
    <div class="modes__row">
      ${card('mem', chipSvg, t('memoryTitle'), t('wMemPromise'), t('wMemGain1'), t('wMemCost'), t('wMemFor'))}
      <div class="modes__plus">+</div>
      ${card('run', boltSvg, t('runTitle'), t('wRunPromise'), t('wRunGain1'), t('wRunCost'), t('wRunFor'))}
    </div>
    <div class="modes__both">
      <span class="modes__chip">${chipSvg}</span><span class="modes__chip modes__chip--run">${boltSvg}</span>
      <p>${t('wBoth')}</p>
    </div>
    </div>
  </div>
  <script>
    // Long languages: shrink the poster's content until it fits the 800px frame.
    (function () {
      var inner = document.querySelector('.modes__inner'), z = 1;
      function fits() { return document.querySelector('.modes__both').getBoundingClientRect().bottom <= 780; }
      while (!fits() && z > 0.5) { z -= 0.03; inner.style.zoom = z; }
    })();
  </script>
</body></html>`;
}

fs.writeFileSync(path.join(OUT, 'slide1.html'), slideModes());

console.log('generated UI + slides for locale: ' + LOCALE);
