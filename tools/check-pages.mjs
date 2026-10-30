/** Validate the catalog-only deployment artifact before it leaves this machine/CI. */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function checkPages(root = fileURLToPath(new URL('../dist/', import.meta.url))) {
  const allowed = new Set(['.html', '.js', '.css', '.json', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico', '.txt']);
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`发布包不允许符号链接：${full}`);
      if (/^(roms|bios|node_modules|\.git)$/i.test(entry.name)) throw new Error(`发布包含禁止目录：${full}`);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name !== '.nojekyll' && !allowed.has(path.extname(entry.name).toLowerCase())) throw new Error(`发布包含非网页资源：${full}`);
    }
  }
  await walk(root);
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  if (!html.includes('/xiaomi-hack-roms/assets/')) throw new Error('GitHub Pages 资源子路径不正确');
  const games = JSON.parse(await readFile(path.join(root, 'games.json'), 'utf8'));
  if (!Array.isArray(games)) throw new Error('游戏目录必须是数组');
  for (const game of games) {
    if (!game.cover) continue;
    const segments = game.cover.split('/');
    if (segments[0] !== 'covers' || segments.some(s => !s || s === '.' || s === '..' || s.includes('\\'))) throw new Error(`封面路径不安全：${game.cover}`);
    if (!(await stat(path.join(root, ...segments))).isFile()) throw new Error(`封面不存在：${game.cover}`);
  }
  console.log(`Pages 发布包检查通过：${games.length} 条目录记录，无 ROM / BIOS / 存档。`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await checkPages();
