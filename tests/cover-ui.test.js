import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const vue = readFileSync(join(root, 'src/App.vue'), 'utf8');
const css = readFileSync(join(root, 'src/style.css'), 'utf8');
const newStyle = css;

test('主机式横向封面带铺满图片', () => {
  assert.match(css, /\.game-grid\{display:flex/);
  assert.match(css, /\.game-rail\{[^}]*overflow-x:auto/);
  assert.match(css, /\.cover-art img\{[^}]*object-fit:cover/);
});

test('正常图片与占位图互斥；缺失或破图回退占位，不透出文字', () => {
  assert.match(vue, /v-if="!game\.cover \|\| failedCovers\.has\(game\.id\)" class="cover-fallback"/);
  assert.match(vue, /<div v-else class="cover-art">/);
  assert.match(vue, /@error="markFailedCover\(game\.id\)"/);
  assert.match(vue, /failedCovers\.value = new Set\(\[\.\.\.failedCovers\.value, gameId\]\)/);
  assert.doesNotMatch(vue, /hideFailedCover/);
});

test('长标题在详情完整换行，封面保持比例', () => {
  assert.match(newStyle, /h1\{[^}]*overflow-wrap:anywhere/s);
  assert.match(newStyle, /\.cover-art img\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;/s);
  assert.doesNotMatch(newStyle, /\.cover-art img\{[^}]*object-fit:\s*contain/);
  assert.doesNotMatch(newStyle, /background-image:var\(--cover-image\)/);
});
