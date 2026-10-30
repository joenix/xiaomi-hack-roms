/**
 * 仅在 Vite 开发环境中提供外置 ROM 目录的只读文件服务。
 * 发布的网站仍是完整静态站点，不需要 Node 服务器。
 */
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { loadRomConfig, safeRomFile } from './rom-config.mjs';
import { SYSTEMS } from './scan-roms.mjs';

function parseRequestPath(url) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(url || '/', 'http://localhost').pathname); }
  catch { return { error: 400 }; }
  if (!pathname.startsWith('/roms/')) return null;
  const relative = pathname.slice('/roms/'.length);
  const segments = relative.split('/');
  const platform = segments[0];
  if (segments.length < 2 || !SYSTEMS[platform] ||
      segments.some(p => !p || p === '.' || p === '..' || p.includes('\\') || p.includes('\0'))) return { error: 404 };
  if (!SYSTEMS[platform].extensions.includes(path.extname(relative).toLowerCase())) return { error: 404 };
  return { relative };
}

function byteRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2]) || size < 1) throw new Error('Range 格式不正确');
  let start, end;
  if (!match[1]) {
    const length = Number(match[2]);
    if (!Number.isSafeInteger(length) || length === 0) throw new Error('Range 无效');
    start = Math.max(0, size - length);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) throw new Error('Range 超出文件范围');
  return { start, end: Math.min(end, size - 1) };
}

export function romRequestHandler(config) {
  return async (req, res, next) => {
    const parsed = parseRequestPath(req.url);
    if (!parsed) return next();
    if (parsed.error) { res.writeHead(parsed.error).end(); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
    try {
      const { full, stat } = await safeRomFile(config.romRoot, parsed.relative);
      let range;
      try { range = byteRange(req.headers.range, stat.size); }
      catch { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end(); return; }
      const start = range?.start ?? 0;
      const end = range?.end ?? stat.size - 1;
      res.writeHead(range ? 206 : 200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': end - start + 1,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {}),
      });
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = createReadStream(full, { start, end });
      stream.on('error', (err) => { console.error('ROM 流读取失败：', err); res.destroy(err); });
      stream.pipe(res);
    } catch (err) {
      const code = err?.code === 'ENOENT' || err?.code === 'ENOTDIR' ? 404 : 403;
      res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }).end(code === 404 ? 'ROM 不存在' : 'ROM 文件不允许访问');
    }
  };
}

export function externalRomsPlugin() {
  return {
    name: 'xiaomi-external-roms',
    async configureServer(server) {
      const config = await loadRomConfig();
      if (!config.isExternal) return;
      server.middlewares.use(romRequestHandler(config));
      console.log(`\n🎮 开发服务器从本地目录直接读取 ROM：${config.romRoot}（无需复制）`);
    },
  };
}
