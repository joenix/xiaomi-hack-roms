#!/usr/bin/env node
/**
 * 小咪 Hack Roms · 静态目录生成器
 * ROM 根目录由项目根目录的 roms.config.json 决定，执行 npm run roms:scan。
 * 已有游戏按 rom 相对路径匹配并保留你修改的元数据；从目录中删除的 ROM 将从生成目录中移除。
 */
import { createHash } from 'node:crypto';
import { existsSync, realpathSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicRoot, catalogPath, coverRoot, playerConfigPath, loadRomConfig, safeRomFile } from './rom-config.mjs';

export const SYSTEMS = Object.freeze({
  FC: { core: 'nes', extensions: ['.nes', '.zip', '.7z'] },
  MD: { core: 'segaMD', extensions: ['.bin', '.md', '.gen', '.smd', '.zip', '.7z'] },
  SFC: { core: 'snes', extensions: ['.sfc', '.smc', '.zip', '.7z'] },
  GBA: { core: 'gba', extensions: ['.gba', '.zip', '.7z'] },
  PSP: { core: 'psp', extensions: ['.iso', '.cso', '.chd'] },
});
const IMAGE_EXTS = ['.webp', '.png', '.jpg', '.jpeg'];
const EOL = '\n';

function hash(s) { return createHash('sha256').update(s).digest('hex'); }
function sortNames(a, b) { return a.localeCompare(b, 'zh-CN', { numeric: true, sensitivity: 'base' }); }
function friendlyBaseName(base, system) {
  return base
    .replace(new RegExp(`^\\[?${system}\\]?[_\\s\\-]+`, 'i'), '')
    .replace(new RegExp(`^${system}(?=[\\u3400-\\u9fff])`, 'i'), '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function inferredName(fileStem, platform) {
  const full = friendlyBaseName(fileStem, platform);
  const split = full.match(/^(.*?)(?:\s+[·–—-]\s+|\s+(?=小咪优化|Hack\b|v\d+))(.*)$/i);
  return { title: (split?.[1] || full || fileStem).trim(), subtitle: (split?.[2] || '').trim() };
}
function slugify(string, platform) {
  const english = string.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
  return `${platform.toLowerCase()}-${english || 'rom'}`;
}
function validPublicPath(relative) { return !relative.split('/').some((part) => part === '..') && !relative.includes('\\'); }
function publicRel(full) { return path.relative(publicRoot, full).split(path.sep).join('/'); }
function romRel(romRoot, full) { return 'roms/' + path.relative(romRoot, full).split(path.sep).join('/'); }
async function walk(dir) {
  if (!existsSync(dir)) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries.sort((a,b) => sortNames(a.name,b.name))) {
    if (entry.name.startsWith('.') || entry.name.startsWith('._')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...await walk(full));
    else if (entry.isFile()) results.push(full);
  }
  return results;
}
async function oldCatalog() {
  if (!existsSync(catalogPath)) return [];
  try {
    const data = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (err) {
    throw new Error(`已有 games.json 解析失败，请先修复或备份：${err.message}`);
  }
}
async function findCover(platform, fileStem, id, previous) {
  if (previous?.cover && existsSync(path.join(publicRoot, previous.cover))) return previous.cover;
  // 同名封面：covers/MD/<ROM文件名>.webp 或 covers/<ID>.webp
  for (const pathname of [path.join(coverRoot, platform, fileStem), path.join(coverRoot, id)]) {
    for (const ext of IMAGE_EXTS) {
      if (existsSync(pathname + ext)) return publicRel(pathname + ext);
    }
  }
  return ''; // 无图时前端用平台色块，不能伪造封面
}
function makeNumericId(key, reserved) {
  let salt = 0;
  while (true) {
    const n = (parseInt(hash(key + (salt ? `:${salt}` : '')).slice(0, 8), 16) % 2000000000) + 1;
    if (!reserved.has(n)) return n;
    salt += 1;
  }
}
async function scanOnce({ silent = false, dryRun = false } = {}) {
  const { romRoot, isExternal, player } = await loadRomConfig();
  if (!existsSync(romRoot)) {
    if (isExternal) throw new Error(`指定的 ROM 目录不存在：${romRoot}。请检查 roms.config.json 的 romsDir。`);
    await fs.mkdir(romRoot, { recursive: true });
  }
  const previousList = await oldCatalog();
  const previousByPath = new Map(previousList.filter((item) => item.rom).map((item) => [item.rom, item]));
  const files = [];
  const skipped = [];
  for (const [platform, setting] of Object.entries(SYSTEMS)) {
    for (const full of await walk(path.join(romRoot, platform))) {
      const ext = path.extname(full).toLowerCase();
      if (!setting.extensions.includes(ext)) {
        if (platform === 'PSP' && ['.pbp', '.zip', '.7z'].includes(ext)) {
          skipped.push(`${romRel(romRoot, full)}（PSP 首版只自动收录 ISO / CSO / CHD，请转换为兼容格式）`);
        }
        continue;
      }
      const { stat } = await safeRomFile(romRoot, path.relative(romRoot, full).split(path.sep).join('/'));
      if (stat.size === 0) { skipped.push(`${romRel(romRoot, full)}（空文件）`); continue; }
      files.push({ full, platform, core: setting.core, stat });
    }
  }
  files.sort((a,b) => sortNames(romRel(romRoot, a.full), romRel(romRoot, b.full)));
  const usedIds = new Set();
  const usedNumericIds = new Set();
  // 优先保留旧 ID，避免新内容抢占原游戏存档身份
  for (const file of files) {
    const prev = previousByPath.get(romRel(romRoot, file.full));
    if (prev?.id && !usedIds.has(prev.id)) { file.keepId = prev.id; usedIds.add(prev.id); }
    if (Number.isSafeInteger(prev?.gameId) && prev.gameId > 0 && !usedNumericIds.has(prev.gameId)) {
      file.keepGameId = prev.gameId; usedNumericIds.add(prev.gameId);
    }
  }
  const games = [];
  for (const [index, file] of files.entries()) {
    const rom = romRel(romRoot, file.full);
    if (!validPublicPath(rom)) throw new Error(`不允许的目录路径：${rom}`);
    const prev = previousByPath.get(rom);
    const parsed = path.parse(file.full);
    const stem = parsed.name;
    const inferred = inferredName(stem, file.platform);
    const slugBase = slugify(inferred.title, file.platform);
    let id = file.keepId || `${slugBase}-${hash(rom).slice(0, 8)}`;
    while (!file.keepId && usedIds.has(id)) id = `${slugBase}-${hash(rom + games.length).slice(0, 10)}`;
    usedIds.add(id);
    const gameId = file.keepGameId || makeNumericId(rom, usedNumericIds);
    usedNumericIds.add(gameId);
    const folder = path.relative(path.join(romRoot, file.platform), path.dirname(file.full)).split(path.sep).join('/');
    const cover = await findCover(file.platform, stem, id, prev);
    // 仅发布文件系统能确认的元数据。不会虚构玩法分类、改版类型或人气。
    games.push({
      id,
      gameId,
      title: prev?.title || inferred.title,
      subtitle: prev?.subtitle ?? inferred.subtitle,
      platform: file.platform,
      core: prev?.core || file.core,
      rom,
      cover,
      ...(cover && prev?.cover === cover && prev?.coverSource ? { coverSource: prev.coverSource } : {}),
      sourceName: path.basename(file.full),
      format: parsed.ext.toLowerCase().replace(/^\./, ''),
      folder: folder === '.' ? '' : folder,
      sizeBytes: file.stat.size,
      modifiedAt: file.stat.mtime.toISOString(),
      ...(prev?.bios ? { bios: prev.bios } : {}),
    });
  }
  const out = JSON.stringify(games, null, 2) + EOL;
  const before = existsSync(catalogPath) ? await fs.readFile(catalogPath, 'utf8') : '';
  const changed = before !== out;
  if (changed && !dryRun) {
    const tmp = `${catalogPath}.tmp`;
    await fs.writeFile(tmp, out, 'utf8');
    await fs.rename(tmp, catalogPath);
  }
  // 根目录统一配置只在本机读取，浏览器仅能看到安全的播放器选项。
  // 绝不把 romsDir（可能含用户家目录）发布到 public/。
  const publicPlayerSettings = JSON.stringify(player, null, 2) + EOL;
  if (!dryRun && (!existsSync(playerConfigPath) || await fs.readFile(playerConfigPath, 'utf8') !== publicPlayerSettings)) {
    const tempPath = `${playerConfigPath}.tmp`;
    await fs.writeFile(tempPath, publicPlayerSettings, 'utf8');
    await fs.rename(tempPath, playerConfigPath);
  }
  if (!silent) {
    console.log(`\n🎮 小咪 Hack Roms 扫描完成：${games.length} 个游戏${changed ? (dryRun ? '（预览，不写入）' : '，已更新 games.json') : '，目录未变化'}`);
    for (const system of Object.keys(SYSTEMS)) console.log(`  ${system.padEnd(3)}  ${games.filter((game) => game.platform === system).length}`);
    if (skipped.length) {
      console.log(`\n⚠ 跳过 ${skipped.length} 个未自动收录的文件：`);
      for (const item of skipped.slice(0, 12)) console.log(`  - ${item}`);
      if (skipped.length > 12) console.log(`  ...其余 ${skipped.length - 12} 个`);
    }
    if (!games.length) console.log(`\n提示：请检查配置的 ROM 目录 ${romRoot} 下是否有 FC、MD、SFC、GBA 或 PSP 平台子目录。`);
  }
  return { games, changed, skipped };
}

async function main() {
  const flags = new Set(process.argv.slice(2));
  const config = await loadRomConfig();
  if (!existsSync(config.romRoot)) {
    if (config.isExternal) throw new Error(`指定的 ROM 目录不存在：${config.romRoot}。请检查 roms.config.json。`);
    await fs.mkdir(config.romRoot, { recursive: true });
  }
  if (!config.isExternal) await Promise.all(Object.keys(SYSTEMS).map((name) => fs.mkdir(path.join(config.romRoot, name), { recursive: true })));
  async function fetchCoversIfEnabled(){
    if (flags.has('--no-covers') || flags.has('--dry-run')) return;
    const configFile = path.join(projectRootForCovers(), 'roms.config.json');
    if (!existsSync(configFile)) return;
    const raw = JSON.parse(await fs.readFile(configFile, 'utf8'));
    if (raw.covers?.enabled !== true || raw.covers?.autoOnScan === false) return;
    const {fetchMissingCovers} = await import('./fetch-covers.mjs');
    try {await fetchMissingCovers();}catch(e){console.warn('⚠ 自动封面检查失败（不影响 ROM 扫描）：'+e.message);}
  }
  function projectRootForCovers(){ return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); }
  if (!flags.has('--watch')) {
    await scanOnce({ dryRun: flags.has('--dry-run') });
    await fetchCoversIfEnabled();
    return;
  }
  console.log(`正在监听 ROM 目录 ${config.romRoot}（每 ${config.scanIntervalMs} 毫秒检查一次）。按 Ctrl+C 退出。`);
  let previousSignature = '';
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      const { romRoot } = await loadRomConfig();
      if (!existsSync(romRoot)) throw new Error(`ROM 目录不存在：${romRoot}`);
      const stats = [romRoot, JSON.stringify((await loadRomConfig()).player)];
      for (const platform of Object.keys(SYSTEMS)) {
        for (const f of await walk(path.join(romRoot, platform))) {
          const stat = await fs.stat(f);
          stats.push(`${romRel(romRoot, f)}:${stat.size}:${stat.mtimeMs}`);
        }
      }
      const signature = hash(stats.join('\n'));
      if (signature !== previousSignature) {
        previousSignature = signature;
        await scanOnce();
        await fetchCoversIfEnabled();
      }
    } catch (err) { console.error('扫描失败：', err.message); }
    finally { running = false; }
  }
  await tick();
  setInterval(tick, config.scanIntervalMs);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(`扫描失败：${err.message}`); process.exitCode = 1; });
}
export { scanOnce, inferredName };
