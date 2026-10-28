// Render the promo screenshot series with Playwright's bundled Chromium.
//
//   node render.mjs                 # all locales, parallelism = CPU cores (max 8)
//   node render.mjs ru de fr        # only the given locales
//   node render.mjs -j 4 ru de      # cap parallelism at 4 concurrent pages
//
// Playwright drives its OWN bundled "Chrome for Testing" with an isolated,
// throwaway profile — it never touches your installed Google Chrome.
//
// For each locale it regenerates a self-contained build (node gen.cjs <locale>
// <buildDir>), screenshots slides 1-6 at deviceScaleFactor 2 (2560x1600) into
// shots/<locale>/, then downscales each to 1280x800 (Chrome Web Store size)
// into out/<locale>/.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import { snapshotUi } from './snap.mjs';

const PROMO = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(PROMO, '..');
const LOCALES_DIR = path.join(ROOT, 'static', '_locales');
const SLIDES = [1, 2, 3, 4, 5];

let argv = process.argv.slice(2);
let jobs = Math.min(os.cpus().length, 8);
if (argv[0] === '-j') { jobs = parseInt(argv[1], 10); argv = argv.slice(2); }
const locales = argv.length
  ? argv
  : fs.readdirSync(LOCALES_DIR).filter((d) => fs.statSync(path.join(LOCALES_DIR, d)).isDirectory());

// The UI in the slides is the shipped extension: build it, serve dist/, snapshot the pages.
const DIST = path.join(ROOT, 'dist');
execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'ignore' });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const file = path.join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(0);
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });

async function renderLocale(loc) {
  const build = path.join(PROMO, 'build', loc);
  fs.rmSync(build, { recursive: true, force: true });
  fs.mkdirSync(build, { recursive: true });
  fs.mkdirSync(path.join(PROMO, 'shots', loc), { recursive: true });
  fs.mkdirSync(path.join(PROMO, 'out', loc), { recursive: true });
  await snapshotUi(browser, BASE, DIST, loc, path.join(build, 'ui'));
  execFileSync('node', [path.join(PROMO, 'gen.cjs'), loc, build], { stdio: 'ignore' });

  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  for (const n of SLIDES) {
    const url = pathToFileURL(path.join(build, `slide${n}.html`)).href;
    await page.goto(url, { waitUntil: 'networkidle' });
    const shot = path.join(PROMO, 'shots', loc, `slide${n}.png`);
    await page.screenshot({ path: shot });
    execFileSync('sips', ['-z', '800', '1280', shot, '--out',
      path.join(PROMO, 'out', loc, `screenshot-${n}.png`)], { stdio: 'ignore' });
  }
  await ctx.close();
  fs.rmSync(build, { recursive: true, force: true });
  console.log('✓ ' + loc);
}

console.log(`rendering ${locales.length} locale(s) with ${jobs} parallel pages…`);
let next = 0;
async function worker() {
  while (next < locales.length) {
    const loc = locales[next++];
    try { await renderLocale(loc); }
    catch (e) { console.error('✗ ' + loc + ': ' + e.message); }
  }
}
await Promise.all(Array.from({ length: Math.min(jobs, locales.length) }, worker));
await browser.close();
server.close();
try { fs.rmdirSync(path.join(PROMO, 'build')); } catch {}
console.log('done');
