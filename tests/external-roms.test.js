import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { romRequestHandler } from '../tools/serve-roms.mjs';

const root = resolve(import.meta.dirname, '..');
function runCli(base, script) {
  const r = spawnSync(process.execPath, [join(base, 'tools', script)], { encoding: 'utf8' });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

test('配置外部 ROM 路径：扫描、保留 ID、流式读取和 Range', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'xiaomi-external-test-'));
  let server;
  try {
    const project = join(temp, 'project');
    const romRoot = join(temp, '中文游戏库');
    const romFile = join(romRoot, 'MD', '太阁 立志传#2.bin');
    const bytes = Buffer.from([4, 9, 16, 25, 36, 49, 64, 81]);
    mkdirSync(join(project, 'tools'), { recursive: true });
    mkdirSync(join(project, 'public'), { recursive: true });
    mkdirSync(join(romRoot, 'MD'), { recursive: true });
    writeFileSync(romFile, bytes);
    writeFileSync(join(project, 'package.json'), '{"type":"module"}');
    for (const f of ['rom-config.mjs', 'scan-roms.mjs']) {
      writeFileSync(join(project, 'tools', f), readFileSync(join(root, 'tools', f)));
    }
    writeFileSync(join(project, 'roms.config.json'), JSON.stringify({ romsDir: romRoot, scanIntervalMs: 1500, player: {volume: 0.3, controls:{platforms:{MD:{'0':{'0':{value:'x'}}}}}} }));
    runCli(project, 'scan-roms.mjs');
    const list = JSON.parse(readFileSync(join(project, 'public', 'games.json'), 'utf8'));
    assert.equal(list.length, 1);
    const publicConfig = readFileSync(join(project,'public','player-config.json'),'utf8');
    assert.equal(JSON.parse(publicConfig).volume,0.3);
    assert.equal(JSON.parse(publicConfig).controls.platforms.MD[0][0].value,'x');
    assert.equal(publicConfig.includes(romRoot), false, '公开配置不能泄露本机 ROM 绝对路径');
    assert.equal(list[0].rom, 'roms/MD/太阁 立志传#2.bin');
    assert.equal(list[0].platform, 'MD');
    const originalId = list[0].gameId;
    // 不改 ROM，只改统一配置时再次扫描也要更新公开配置，ID 不变化。
    writeFileSync(join(project, 'roms.config.json'), JSON.stringify({ romsDir: romRoot, scanIntervalMs: 1500, player: {volume:0.7, controls: { platforms: {MD:{'0':{'0':{value:'z'}}}} }} }));
    runCli(project, 'scan-roms.mjs');
    assert.equal(JSON.parse(readFileSync(join(project,'public','player-config.json'))).volume,0.7);
    assert.equal(JSON.parse(readFileSync(join(project,'public','player-config.json'))).controls.platforms.MD[0][0].value,'z');
    assert.equal(JSON.parse(readFileSync(join(project, 'public', 'games.json')))[0].gameId, originalId);

    const middleware = romRequestHandler({ romRoot });
    server = createServer((req, res) => middleware(req, res, () => res.writeHead(404).end()));
    await new Promise(ok => server.listen(0, '127.0.0.1', ok));
    const host = `http://127.0.0.1:${server.address().port}`;
    const romUrl = host + '/roms/MD/' + encodeURIComponent('太阁 立志传#2.bin');
    const head = await fetch(romUrl, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), String(bytes.length));
    const get = await fetch(romUrl);
    assert.equal(get.status, 200);
    assert.deepEqual(Buffer.from(await get.arrayBuffer()), bytes);
    const partial = await fetch(romUrl, { headers: { Range: 'bytes=2-4' } });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get('content-range'), 'bytes 2-4/8');
    assert.deepEqual(Buffer.from(await partial.arrayBuffer()), bytes.subarray(2, 5));
    assert.equal((await fetch(host + '/roms/MD/' + encodeURIComponent('ignore.txt'))).status, 404);
    assert.equal((await fetch(host + '/roms/PSP/' + encodeURIComponent('secret.bin'))).status, 404);
    await new Promise((ok, fail) => server.close(err => err ? fail(err) : ok())); server = null;

  } finally {
    if (server) await new Promise(ok => server.close(ok));
    rmSync(temp, { recursive: true, force: true });
  }
});

test('外部 ROM 目录不存在时明确报错，不能静默创建并清空目录', () => {
  const temp = mkdtempSync(join(tmpdir(), 'xiaomi-invalid-path-'));
  try {
    mkdirSync(join(temp, 'tools'), { recursive: true });
    mkdirSync(join(temp, 'public'), { recursive: true });
    writeFileSync(join(temp, 'package.json'), '{"type":"module"}');
    for (const f of ['rom-config.mjs', 'scan-roms.mjs']) {
      writeFileSync(join(temp, 'tools', f), readFileSync(join(root, 'tools', f)));
    }
    const missing = join(temp, 'not-here');
    writeFileSync(join(temp, 'roms.config.json'), JSON.stringify({ romsDir: missing }));
    const result = spawnSync(process.execPath, [join(temp, 'tools', 'scan-roms.mjs')], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ROM 目录不存在/);
    assert.equal(existsSync(missing), false);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
