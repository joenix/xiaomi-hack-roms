import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const css = readFileSync(join(root, 'src/style.css'), 'utf8');

// 协助防止后续改版又把整张卡片抬起。
test('hover 只缩放封面，卡片不移动或改变阴影和边框', () => {
  assert.doesNotMatch(css, /\.game-card:hover\s*\{[^}]*translateY\(/);
  assert.doesNotMatch(css, /\.game-card:hover\s*\{[^}]*(?:box-shadow|border-color|background):/);
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)\s*\{\s*\.game-card:hover \.cover-art img\s*\{\s*transform:\s*scale\(1\.05\);/);
  assert.match(css, /\.cover-art img\s*\{[^}]*object-fit:\s*cover;/s);
});

test('减少动效用户关闭过渡和动画', () => {
  assert.match(css, /@media\(prefers-reduced-motion:reduce\).*animation:none!important;transition:none!important/s);
});
