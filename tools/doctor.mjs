#!/usr/bin/env node
/** 只读检查本地 ROM 与 JSON 的一致性，不修改任何文件。 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRomConfig, catalogPath, projectRoot, safeRomFile } from './rom-config.mjs';
import { SYSTEMS } from './scan-roms.mjs';

export async function diagnose() {
  const { romRoot, isExternal } = await loadRomConfig();
  const issues = [];
  const results = [];
  console.log('\n小咪 Hack Roms · 启动诊断');
  console.log(`ROM 目录：${romRoot}`);
  console.log(`读取方式：${isExternal ? 'Vite 外部目录中间件' : 'public/roms 静态目录'}`);
  if (!existsSync(romRoot)) issues.push('ROM 根目录不存在，请检查 roms.config.json 的 romsDir。');
  if (!existsSync(catalogPath)) issues.push('未找到 public/games.json，请运行 npm run roms:scan。');
  if (!issues.length) {
    let games;
    try { games = JSON.parse(await readFile(catalogPath, 'utf8')); }
    catch (error) { issues.push(`games.json 无法解析：${error.message}`); }
    if (games && !Array.isArray(games)) issues.push('games.json 必须是数组');
    if (Array.isArray(games)) {
      console.log(`收录条目：${games.length}`);
      for (const game of games) {
        if (game.placeholder) {
          results.push({ title: game.title, status: 'PREVIEW', detail: '仅有封面，没有 ROM' });
          continue;
        }
        const rel = String(game.rom || '');
        const segments = rel.split('/');
        if (!rel.startsWith('roms/') || !SYSTEMS[segments[1]]) {
          results.push({ title: game.title, status: 'ERROR', detail: `路径或平台不正确：${rel}` });
          continue;
        }
        try {
          const { stat } = await safeRomFile(romRoot, segments.slice(1).join('/'));
          if (!stat.size) throw new Error('文件大小为 0');
          results.push({ title: game.title, status: 'OK', detail: `${(stat.size / 1024 / 1024).toFixed(2)} MB` });
        } catch (error) {
          results.push({ title: game.title, status: 'ERROR', detail: `${rel} (${error.code || error.message})` });
        }
      }
    }
  }
  console.log('\nROM 检查结果：');
  for (const result of results) console.log(`  [${result.status}] ${result.title} · ${result.detail}`);
  const ready = results.filter(r => r.status === 'OK').length;
  const preview = results.filter(r => r.status === 'PREVIEW').length;
  const broken = results.filter(r => r.status === 'ERROR').length;
  console.log(`\n实际可访问 ROM：${ready} · 演示卡片：${preview} · 文件异常：${broken}`);
  if (preview) issues.push('检测到演示卡片：演示卡片不能游玩，需导入真实 ROM 并重新扫描。');
  if (!ready) issues.push('没有可加载的 ROM，请检查路径并执行 npm run roms:scan。');
  if (broken) issues.push('有 ROM 地址与实际文件不匹配，请重新扫描后检查配置。');
  const localLoader = path.join(projectRoot, 'public', 'emulatorjs', 'data', 'loader.js');
  console.log(`EmulatorJS：${existsSync(localLoader) ? '使用本地 data 资源（仍需完整依赖）' : '使用官方 CDN（需要浏览器能够访问 cdn.emulatorjs.org）'}`);
  if (issues.length) console.log('\n需要处理：\n' + issues.map(i => '  - ' + i).join('\n'));
  else console.log('\n✓ ROM 文件与目录一致。提示：这并不代表已经验证模拟器核心能运行。');
  return { ready, preview, broken, issues, results };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  diagnose().then(({ issues }) => { if (issues.length) process.exitCode = 1; }).catch(error => { console.error(`诊断失败：${error.message}`); process.exitCode = 1; });
}
