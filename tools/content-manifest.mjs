/** Build deployable catalog with immutable content-addressed URLs.
 * Never copy local filesystem paths or access credentials into the catalog. */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { projectRoot, publicRoot, safeRomFile } from './rom-config.mjs';

const cacheFile = path.join(projectRoot, '.cache', 'file-hashes.json');
export const encodeKey = (s) => s.split('/').map(encodeURIComponent).join('/');
function extMime(ext) { return ({'.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.json':'application/json; charset=utf-8','.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.wasm':'application/wasm','.ico':'image/x-icon','.woff2':'font/woff2','.bin':'application/octet-stream','.zip':'application/zip','.iso':'application/octet-stream','.cso':'application/octet-stream','.chd':'application/octet-stream'})[ext.toLowerCase()] || 'application/octet-stream'; }
export function mimeOf(file) { return extMime(path.extname(file)); }
export function checkRelative(relative, prefix) {
  if (typeof relative !== 'string' || !relative.startsWith(prefix + '/') || relative.includes('\\') || relative.includes('\0') || relative.split('/').some(s => !s || s === '.' || s === '..')) throw new Error(`资源路径不合法：${relative}`);
  return relative.slice(prefix.length+1);
}
export async function loadHashCache() {
  try { return JSON.parse(await readFile(cacheFile, 'utf8')); } catch { return {}; }
}
export async function saveHashCache(cache) {
  await mkdir(path.dirname(cacheFile), {recursive:true});
  const tmp = cacheFile + '.tmp';
  await writeFile(tmp, JSON.stringify(cache, null, 2));
  await rename(tmp, cacheFile);
}
export async function digestFile(file, cache) {
  const s = await stat(file);
  const key = path.resolve(file);
  const old = cache[key];
  if (old && old.size === s.size && old.mtimeMs === s.mtimeMs && /^[a-f0-9]{64}$/.test(old.sha256)) return old.sha256;
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  const sha256 = hash.digest('hex');
  cache[key] = {sha256, size:s.size, mtimeMs:s.mtimeMs};
  return sha256;
}
export async function createContentPlan(games, romRoot, hashCache) {
  const objects = new Map();
  const published = [];
  for (const game of games) {
    if (!game || !/^[\w-]{1,128}$/.test(game.id) || !['FC','MD','SFC','GBA','PSP'].includes(game.platform)) throw new Error('非法的游戏 ID 或平台');
    const relative = checkRelative(game.rom, 'roms');
    if (relative.split('/')[0] !== game.platform) throw new Error('游戏 ROM 所属平台不匹配');
    const {full} = await safeRomFile(romRoot, relative);
    const sha = await digestFile(full, hashCache);
    const fileExt = path.extname(full).toLowerCase();
    const romKey = `roms/${game.platform}/${game.id}/${sha.slice(0, 24)}${fileExt}`;
    objects.set(romKey, {key:romKey, path:full, sha256:sha, mime:mimeOf(full), immutable:true});
    const next = {...game, rom: romKey};
    if (game.cover) {
      const coverRel = checkRelative(game.cover, 'covers');
      const coverFile = path.resolve(publicRoot, 'covers', ...coverRel.split('/'));
      if (!coverFile.startsWith(path.resolve(publicRoot,'covers')+path.sep)) throw new Error('封面路径超出目录');
      if (!existsSync(coverFile)) throw new Error(`封面不存在：${game.cover}`);
      const coverSha = await digestFile(coverFile, hashCache);
      const coverExt = path.extname(coverFile).toLowerCase();
      if (!['.png','.jpg','.jpeg','.webp'].includes(coverExt)) throw new Error('封面图片格式不支持');
      const coverKey = `covers/auto/${game.id}-${coverSha.slice(0, 24)}${coverExt}`;
      objects.set(coverKey, {key:coverKey, path:coverFile, sha256:coverSha, mime:mimeOf(coverFile), immutable:true});
      next.cover = coverKey;
    }
    if (game.bios) {
      const biosRel = checkRelative(game.bios, 'bios');
      const biosFull = path.resolve(publicRoot,'bios', ...biosRel.split('/'));
      if (!biosFull.startsWith(path.resolve(publicRoot,'bios')+path.sep) || !existsSync(biosFull)) throw new Error(`BIOS 不存在：${game.bios}`);
      const biosSha = await digestFile(biosFull, hashCache);
      const biosKey = `bios/${biosSha.slice(0,24)}${path.extname(biosFull).toLowerCase()}`;
      objects.set(biosKey, {key:biosKey, path:biosFull, sha256:biosSha, mime:mimeOf(biosFull), immutable:true});
      next.bios = biosKey;
    }
    published.push(next);
  }
  return {games:published, objects:[...objects.values()]};
}
