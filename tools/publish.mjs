#!/usr/bin/env node
/** Local -> OSS content release. Immutable ROMs first, catalog last. */
import { existsSync } from 'node:fs';
import { mkdir,readFile,writeFile,rename } from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {projectRoot,catalogPath,playerConfigPath,loadRomConfig} from './rom-config.mjs';
import {createContentPlan,loadHashCache,saveHashCache} from './content-manifest.mjs';
import {createOssClient,remoteExists,uploadFile,uploadJson} from './oss-client.mjs';
import {loadRuntimeConfig} from './runtime-config.mjs';
import {fetchMissingCovers} from './fetch-covers.mjs';

const statePath=path.join(projectRoot,'.cache','publish-state.json');
async function readState(){try{return JSON.parse(await readFile(statePath,'utf8'));}catch{return {uploaded:{}};}}
async function writeState(state){await mkdir(path.dirname(statePath),{recursive:true});const tmp=statePath+'.tmp';await writeFile(tmp,JSON.stringify(state,null,2));await rename(tmp,statePath);}
export async function preparePublication(gamesOverride) {
  const {romRoot}=await loadRomConfig();
  if(!gamesOverride && !existsSync(catalogPath))throw new Error('没有 games.json，请先运行 pnpm roms:scan');
  const games=gamesOverride || JSON.parse(await readFile(catalogPath,'utf8'));
  if(!Array.isArray(games))throw new Error('games.json 必须是数组');
  const cache=await loadHashCache();
  const plan=await createContentPlan(games,romRoot,cache);
  await saveHashCache(cache);
  return plan;
}
export async function publish({dryRun=false, skipCovers=false, gamesOverride}={}) {
  const extras=await loadRuntimeConfig();
  if(!skipCovers && extras.covers.fetchOnPublish && !dryRun) await fetchMissingCovers();
  const {games,objects}=await preparePublication(gamesOverride);
  const state=await readState();
  const target=`${extras.deploy.region}/${extras.deploy.bucket}`;
  if(state.target !== target){state.uploaded={};state.target=target;}
  const newObjects=objects.filter(o=>!state.uploaded?.[o.key] || extras.deploy.verifyRemote);
  console.log(`\n☁️ OSS 内容发布${dryRun?'（预览）':''}：${games.length} 款游戏，${objects.length} 个资源，待检查/上传 ${newObjects.length}`);
  for(const asset of newObjects.slice(0,12))console.log(`  • ${asset.key}`);
  if(newObjects.length>12)console.log(`  ……另有 ${newObjects.length-12} 个`);
  if(dryRun){console.log('未上传、未修改线上目录，预览不需要阿里云密钥。');return {games,objects,uploaded:0};}
  if(!extras.deploy.bucket || !extras.deploy.baseUrl)throw new Error('请先配置 deploy.bucket / deploy.baseUrl；仅本地预览可运行 pnpm publish -- --dry-run');
  const {client,deploy}=await createOssClient();
  let uploaded=0;
  for(const object of objects) {
    if(state.uploaded?.[object.key] && !deploy.verifyRemote)continue;
    if(await remoteExists(client,object.key)) {
      state.uploaded??={};state.uploaded[object.key]=object.sha256;await writeState(state);
      continue;
    }
    console.log(`  ↑ ${object.key}`);
    await uploadFile(client,object.path,object.key,{mime:object.mime,immutable:object.immutable,multipartThresholdMB:deploy.multipartThresholdMB});
    if(!await remoteExists(client,object.key))throw new Error(`上传后远端校验失败：${object.key}`);
    uploaded++;
    state.uploaded??={};state.uploaded[object.key]=object.sha256;await writeState(state);
  }
  // Commit point: only publish visible catalog after every referenced asset exists.
  const player=JSON.parse(await readFile(playerConfigPath,'utf8'));
  await uploadJson(client,'player-config.json',player);
  await uploadJson(client,'games.json',games);
  console.log(`✅ 已发布：新增上传 ${uploaded} 个资源。目录最后更新，线上 ${deploy.baseUrl}/games.json`);
  console.log('注意：CDN 需对 games.json / player-config.json 设置不缓存或短缓存；旧缓存可能需要刷新。');
  return {games,objects,uploaded};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))publish({dryRun:process.argv.includes('--dry-run'),skipCovers:process.argv.includes('--skip-covers')}).catch(e=>{console.error(`发布失败：${e.message}`);process.exitCode=1});
