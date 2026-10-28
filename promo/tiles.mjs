// Render the two Chrome Web Store tiles (marquee 1400x560, small 440x280) with the
// shipped UI. Usage: node tiles.mjs   (needs `npm run build`; render.mjs also builds)
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { snapshotUi } from './snap.mjs';

const PROMO = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(PROMO, '..');
const DIST = path.join(ROOT, 'dist');
execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'ignore' });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const file = path.join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(0);
const BASE = `http://127.0.0.1:${server.address().port}`;

const build = path.join(PROMO, 'build', 'tiles');
fs.rmSync(build, { recursive: true, force: true });
fs.mkdirSync(build, { recursive: true });
const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
await snapshotUi(browser, BASE, DIST, 'en', path.join(build, 'ui'));

const abs = (html) => html
  .split('href="tiles.css"').join(`href="${pathToFileURL(path.join(PROMO, 'tiles.css')).href}"`)
  .split('src="../static/').join(`src="${pathToFileURL(path.join(ROOT, 'static')).href}/`);
for (const [name, w, h, out] of [['tile-marquee', 1400, 560, 'promo-marquee-1400x560.png'], ['tile-small', 440, 280, 'promo-small-440x280.png']]) {
  fs.writeFileSync(path.join(build, `${name}.html`), abs(fs.readFileSync(path.join(PROMO, `${name}.html`), 'utf8')));
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(path.join(build, `${name}.html`)).href, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(PROMO, 'out', out) });
  await ctx.close();
  console.log('✓ ' + out);
}
await browser.close();
server.close();
fs.rmSync(path.join(PROMO, 'build'), { recursive: true, force: true });
