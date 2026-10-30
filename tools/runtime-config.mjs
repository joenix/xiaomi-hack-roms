/** Node-only publication options; never bundled into the browser. */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { projectRoot } from './rom-config.mjs';

export function loadLocalEnv() {
  const file = path.join(projectRoot, '.env.local');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!Object.hasOwn(process.env, match[1])) process.env[match[1]] = value;
  }
}
export function normalizeExtras(raw) {
  const covers = raw.covers || {};
  const deploy = raw.deploy || {};
  if (!['libretro','igdb'].includes(covers.provider || 'libretro')) throw new Error('covers.provider 仅支持 libretro / igdb');
  const allowedSources=['launchbox-local','libretro','igdb'];
  if(covers.sources!==undefined && (!Array.isArray(covers.sources)||covers.sources.some(s=>!allowedSources.includes(s))))throw new Error('covers.sources 应为 launchbox-local / libretro / igdb 的数组');
  if (deploy.provider && deploy.provider !== 'aliyun-oss') throw new Error('deploy.provider 仅支持 aliyun-oss');
  if (deploy.coverUpload !== undefined && (typeof deploy.coverUpload !== 'object' || !deploy.coverUpload || Array.isArray(deploy.coverUpload))) throw new Error('deploy.coverUpload 必须为对象');
  if (deploy.coverUpload?.updateCatalog !== undefined && typeof deploy.coverUpload.updateCatalog !== 'boolean') throw new Error('deploy.coverUpload.updateCatalog 必须为布尔值');
  const region = deploy.region || 'oss-cn-shanghai';
  const bucket = deploy.bucket || '';
  const baseUrl = deploy.baseUrl || '';
  if (!/^oss-[a-z]+-[a-z0-9-]+$/.test(region)) throw new Error('deploy.region 应为 oss-cn-shanghai 等 OSS region');
  if (bucket && !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('deploy.bucket 格式错误');
  if (baseUrl && (!/^https:\/\//.test(baseUrl) || !/^https:\/\/[^/]+\/?$/.test(baseUrl))) throw new Error('deploy.baseUrl 应为 HTTPS 站点根地址');
  return {
    covers: {
      enabled: covers.enabled !== false,
      provider: covers.provider || 'libretro',
      sources: Array.isArray(covers.sources)&&covers.sources.length?[...new Set(covers.sources)]:[covers.provider||'libretro'],
      launchboxLocalDir: typeof covers.launchboxLocalDir==='string'?covers.launchboxLocalDir.trim():'',
      timeoutMs: Number.isFinite(covers.timeoutMs)?Math.min(90000,Math.max(5000,covers.timeoutMs)):30000,
      retries: Number.isInteger(covers.retries)?Math.min(5,Math.max(0,covers.retries)):2,
      autoOnScan: covers.autoOnScan !== false,
      region: ['jp','us','any'].includes(covers.region) ? covers.region : 'jp',
      aliases: covers.aliases && typeof covers.aliases === 'object' && !Array.isArray(covers.aliases) ? covers.aliases : {},
      fetchOnPublish: covers.fetchOnPublish !== false,
      overwriteExisting: covers.overwriteExisting === true,
      minMatchScore: Number.isFinite(covers.minMatchScore) ? Math.min(1, Math.max(0.65, covers.minMatchScore)) : 0.90,
      overrides: covers.overrides && typeof covers.overrides === 'object' && !Array.isArray(covers.overrides) ? covers.overrides : {},
    },
    deploy: {
      provider: 'aliyun-oss', region, bucket, baseUrl,
      multipartThresholdMB: Number.isFinite(deploy.multipartThresholdMB) ? Math.max(1, deploy.multipartThresholdMB) : 16,
      verifyRemote: deploy.verifyRemote === true,
      coverUpload: {updateCatalog: deploy.coverUpload?.updateCatalog !== false},
    },
  };
}
export async function loadRuntimeConfig() {
  const file = path.join(projectRoot, 'roms.config.json');
  const data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  return normalizeExtras(data);
}
