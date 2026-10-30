import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkPages } from '../tools/check-pages.mjs';

test('Pages 包接受大厅并拒绝意外混入的 ROM', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaomi-pages-'));
  try {
    await writeFile(path.join(root, 'index.html'), '<script src="/xiaomi-hack-roms/assets/app.js"></script>');
    await writeFile(path.join(root, 'games.json'), '[]');
    await checkPages(root);
    await mkdir(path.join(root, 'roms'));
    await writeFile(path.join(root, 'roms', 'example.md'), 'sample ROM');
    await assert.rejects(checkPages(root), /禁止目录/);
  } finally { await rm(root, {recursive: true, force: true}); }
});
