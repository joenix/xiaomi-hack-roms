import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const vue = readFileSync(join(root, 'src/App.vue'), 'utf8');
const css = readFileSync(join(root, 'src/style.css'), 'utf8');
const newStyle = css.slice(css.indexOf('/* v0.8.3 — Cover gallery:'));

test('封面完整展示，卡片尺寸统一，保留移动端双列', () => {
  assert.ok(newStyle, '缺少新版封面样式');
  assert.match(newStyle, /\.cover-frame\s*\{[^}]*aspect-ratio:\s*3\s*\/\s*4/s);
  assert.match(newStyle, /\.cover-art img\s*\{[^}]*object-fit:\s*contain/s);
  assert.match(newStyle, /\.cover-art img\s*\{[^}]*max-width:\s*100%/s);
  assert.match(newStyle, /\.cover-art img\s*\{[^}]*max-height:\s*100%/s);
  assert.match(css, /@media\(max-width:650px\).*?\.game-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/s);
});

test('正常图片与占位图互斥；缺失或破图回退占位，不透出文字', () => {
  assert.match(vue, /v-if="!game\.cover \|\| failedCovers\.has\(game\.id\)" class="cover-fallback"/);
  assert.match(vue, /<div v-else class="cover-art">/);
  assert.match(vue, /@error="markFailedCover\(game\.id\)"/);
  assert.match(vue, /failedCovers\.value = new Set\(\[\.\.\.failedCovers\.value, gameId\]\)/);
  assert.doesNotMatch(vue, /hideFailedCover/);
});

test('长 Hack ROM 名称最多显示两行，图片不做强制缩放裁剪', () => {
  assert.match(newStyle, /\.game-info h3\s*\{[^}]*-webkit-line-clamp:\s*2/s);
  assert.match(newStyle, /\.cover-art img\s*\{[^}]*width:\s*auto;[^}]*height:\s*auto;/s);
  assert.doesNotMatch(newStyle, /object-fit:\s*cover/);
});
