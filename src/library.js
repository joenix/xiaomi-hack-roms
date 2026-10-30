/** Shared resource-library contract for the lobby and the player. */
export function resolveLibraryAsset(relative, root) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0') || relative.split('/').some(p => !p || p === '.' || p === '..')) throw Error('资源路径不合法');
  const base = new URL(root);
  const url = new URL(relative.split('/').map(encodeURIComponent).join('/'), base);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw Error('资源必须位于指定资源库内');
  return url.href;
}
export async function loadLibrary({ origin, fetchImpl = fetch }) {
  const resourceRoot = new URL('/xiaomi-hack-roms-libraries/', origin);
  const manifestUrl = new URL('library.json', resourceRoot);
  manifestUrl.searchParams.set('t', Date.now());
  async function json(url) {
    const response = await fetchImpl(url.href || url, { cache: 'no-store' });
    if (!response.ok) throw Error(`资源库请求失败：HTTP ${response.status}`);
    return response.json();
  }
  const config = await json(manifestUrl);
  if (config?.schemaVersion !== 1 || typeof config.playEnabled !== 'boolean' || typeof config.notice !== 'string') throw Error('资源库 library.json 配置格式不正确');
  const catalogUrl = resolveLibraryAsset(config.catalog, resourceRoot);
  const playerConfigUrl = resolveLibraryAsset(config.playerConfig, resourceRoot);
  const games = await json(catalogUrl);
  if (!Array.isArray(games)) throw Error('资源库游戏目录必须为数组');
  for (const game of games) {
    resolveLibraryAsset(game.rom, resourceRoot);
    if (game.cover) resolveLibraryAsset(game.cover, resourceRoot);
  }
  return {config, games, resourceRoot, catalogUrl, playerConfigUrl};
}
