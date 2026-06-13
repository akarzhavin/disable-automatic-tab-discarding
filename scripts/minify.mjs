// Production minifier for the built `dist/` extension.
// Minifies JS (per-file, ESM imports preserved), CSS, and JSON in place.
// HTML is left untouched on purpose — the files are tiny and collapsing
// whitespace around inline elements can change rendering.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(DIST);
let before = 0, after = 0;

// JS + CSS via esbuild (transform, no bundling -> module graph stays intact)
for (const file of files) {
  const ext = extname(file);
  if (ext !== '.js' && ext !== '.css') continue;
  const src = readFileSync(file, 'utf8');
  before += Buffer.byteLength(src);
  const res = await build({
    stdin: { contents: src, loader: ext.slice(1), resolveDir: DIST },
    write: false,
    minify: true,
    format: ext === '.js' ? 'esm' : undefined,
    target: ext === '.js' ? 'es2022' : undefined,
    legalComments: 'none',
  });
  const min = res.outputFiles[0].text;
  writeFileSync(file, min);
  after += Buffer.byteLength(min);
}

// JSON (manifest + _locales) -> strip all insignificant whitespace
for (const file of files) {
  if (extname(file) !== '.json') continue;
  const src = readFileSync(file, 'utf8');
  before += Buffer.byteLength(src);
  const min = JSON.stringify(JSON.parse(src));
  writeFileSync(file, min);
  after += Buffer.byteLength(min);
}

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log(`minified: ${kb(before)} -> ${kb(after)}  (-${(100 * (1 - after / before)).toFixed(1)}%)`);
