import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const css = readFileSync(join(root, 'src/style.css'), 'utf8');

// 协助防止后续改版又把整张卡片抬起、或将封面强行裁切。
test('hover 只缩放封面，卡片不移动或改变阴影和边框', () => {
  assert.doesNotMatch(css, /\.game-card:hover\s*\{[^}]*translateY\(/);
  assert.doesNotMatch(css, /\.game-card:hover\s*\{[^}]*(?:box-shadow|border-color|background):/);
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)\s*\{\s*\.game-card:hover \.cover-art img\s*\{\s*transform:\s*scale\(1\.05\);/);
  assert.match(css, /\.cover-art img\s*\{[^}]*object-fit:\s*contain;/s);
});

test('hover 动画不影响手机和减少动效用户', () => {
  assert.match(css, /\.play-overlay\{[^}]*transition:none/s);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.cover-art img\s*\{\s*transition: none;/);
  assert.match(css, /\.game-card:hover \.cover-art img,\s*\.game-card:focus-visible \.cover-art img\s*\{ transform: none; \}/);
  assert.match(css, /@media\(max-width:650px\).*?\.play-overlay\{opacity:1;transform:none/s);
});
