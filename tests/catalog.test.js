import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const games = JSON.parse(readFileSync(join(root, 'public/games.json'), 'utf8'));
const systems = new Set(['FC', 'MD', 'SFC', 'GBA', 'PSP']);

test('游戏目录有效、五个平台、ID 不重复', () => {
  assert.equal(new Set(games.map((game) => game.id)).size, games.length);
  assert.equal(new Set(games.map((game) => game.gameId)).size, games.length);
  for (const game of games) {
    assert.match(game.id, /^[\w-]+$/);
    assert.ok(Number.isSafeInteger(game.gameId) && game.gameId > 0);
    assert.ok(game.title);
    assert.ok(systems.has(game.platform));
    assert.match(game.core, /^[a-z0-9_]+$/i);
    for (const field of [game.rom, game.cover].filter(Boolean)) {
      assert.ok(!field.includes('..') && !field.startsWith('/') && !field.includes('://'), `非法路径: ${field}`);
    }
    if (game.cover) assert.ok(existsSync(join(root, 'public', game.cover)), `找不到封面: ${game.cover}`);
  }
});

test('扫描生成、保留人工修改、不同光盘轨道不误入、删除同步', () => {
  // 临时独立工程：不修改真实项目里的 games.json/rom 文件
  const folder = mkdtempSync(join(tmpdir(), 'xiaomi-roms-test-'));
  try {
    mkdirSync(join(folder, 'tools'), { recursive: true });
    mkdirSync(join(folder, 'public/roms/MD/太阁系列'), { recursive: true });
    mkdirSync(join(folder, 'public/roms/PSP'), { recursive: true });
    mkdirSync(join(folder, 'public/covers/MD'), { recursive: true });
    writeFileSync(join(folder, 'package.json'), '{"type":"module"}');
    writeFileSync(join(folder, 'tools/scan-roms.mjs'), readFileSync(join(root, 'tools/scan-roms.mjs')));
    writeFileSync(join(folder, 'tools/rom-config.mjs'), readFileSync(join(root, 'tools/rom-config.mjs')));
    const md = join(folder, 'public/roms/MD/太阁系列/太阁立志传_小咪优化_v2.1.bin');
    writeFileSync(md, Buffer.from([1,2,3,4]));
    writeFileSync(join(folder, 'public/roms/PSP/game.pbp'), 'FILE "game.bin" BINARY');
    writeFileSync(join(folder, 'public/roms/PSP/game.zip'), Buffer.from([1,2,3]));
    writeFileSync(join(folder, 'public/covers/MD/太阁立志传_小咪优化_v2.1.webp'), Buffer.from([82,73,70,70]));
    const run = () => {
      const result = spawnSync(process.execPath, [join(folder, 'tools/scan-roms.mjs')], { encoding: 'utf8' });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      return JSON.parse(readFileSync(join(folder, 'public/games.json'), 'utf8'));
    };
    const scanned = run();
    assert.equal(scanned.length, 1, 'PSP 不兼容格式不可被误收录');
    assert.equal(scanned[0].platform, 'MD');
    assert.equal(scanned[0].folder, '太阁系列');
    assert.equal(scanned[0].format, 'bin');
    assert.equal(scanned[0].sourceName, '太阁立志传_小咪优化_v2.1.bin');
    assert.equal(scanned[0].sizeBytes, 4);
    assert.ok(!Number.isNaN(Date.parse(scanned[0].modifiedAt)));
    assert.equal('genre' in scanned[0], false);
    assert.equal('type' in scanned[0], false);
    assert.equal(scanned[0].cover, 'covers/MD/太阁立志传_小咪优化_v2.1.webp');
    assert.equal(scanned[0].rom, 'roms/MD/太阁系列/太阁立志传_小咪优化_v2.1.bin');
    const before = scanned[0];
    before.title = '亲自编辑的名称';
    before.bios = 'bios/my-ps.bin';
    writeFileSync(join(folder, 'public/games.json'), JSON.stringify(scanned, null, 2));
    const rescan = run();
    assert.equal(rescan.length, 1);
    assert.equal(rescan[0].title, '亲自编辑的名称');
    assert.equal(rescan[0].bios, 'bios/my-ps.bin');
    assert.equal(rescan[0].id, before.id);
    assert.equal(rescan[0].gameId, before.gameId);
    rmSync(md);
    assert.deepEqual(run(), []);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});


test('PSP 扫描可收录 ISO/CSO/CHD，但不把 ZIP/PBP 当成可玩格式', () => {
  const folder = mkdtempSync(join(tmpdir(), 'xiaomi-psp-test-'));
  try {
    mkdirSync(join(folder, 'tools'), { recursive: true });
    mkdirSync(join(folder, 'public/roms/PSP'), { recursive: true });
    writeFileSync(join(folder, 'package.json'), '{"type":"module"}');
    for (const fn of ['rom-config.mjs', 'scan-roms.mjs']) writeFileSync(join(folder, 'tools', fn), readFileSync(join(root, 'tools', fn)));
    for (const ext of ['iso','cso','chd','zip','pbp']) writeFileSync(join(folder, 'public/roms/PSP', 'example.' + ext), Buffer.from([1,2,3]));
    const result = spawnSync(process.execPath,[join(folder,'tools/scan-roms.mjs')],{encoding:'utf8'});
    assert.equal(result.status, 0, result.stderr);
    const list = JSON.parse(readFileSync(join(folder,'public/games.json'),'utf8'));
    assert.deepEqual(list.map(g => g.format).sort(), ['chd','cso','iso']);
    assert.ok(list.every(g=>g.platform==='PSP' && g.core==='psp'));
  } finally {rmSync(folder,{recursive:true,force:true});}
});
