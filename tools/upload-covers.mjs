#!/usr/bin/env node
/** Only upload cover images and optionally update the cover field of ONLINE games.json.
 * This is intentionally independent of ROM upload/build/deployment. */
import {existsSync} from 'node:fs';
import {readFile, realpath, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {catalogPath,coverRoot} from './rom-config.mjs';
import {checkRelative,digestFile,loadHashCache,saveHashCache,mimeOf} from './content-manifest.mjs';
import {createOssClient,remoteExists,uploadFile,uploadJson} from './oss-client.mjs';
import {loadRuntimeConfig} from './runtime-config.mjs';

const VALID_IMAGE_EXTENSIONS=new Set(['.png','.jpg','.jpeg','.webp']);

export async function prepareCoverUploads(games, {root=coverRoot, cache={}}={}) {
  if(!Array.isArray(games))throw new Error('本地 games.json 必须是数组');
  const rootReal=await realpath(root).catch(()=>null);
  const objects=new Map();
  const links=[];
  const ids=new Set();
  for(const game of games) {
    if(!game||!/^[\w-]{1,128}$/.test(game.id)||!['FC','MD','SFC','GBA','PSP'].includes(game.platform))throw new Error('本地 games.json 包含无效的游戏 ID 或平台');
    if(ids.has(game.id))throw new Error(`重复的游戏 ID：${game.id}`);
    ids.add(game.id);
    if(!game.cover)continue;
    const relative=checkRelative(game.cover,'covers');
    const extension=path.extname(relative).toLowerCase();
    if(!VALID_IMAGE_EXTENSIONS.has(extension))throw new Error(`封面格式不支持：${game.cover}`);
    const absolute=path.resolve(root,...relative.split('/'));
    if(!rootReal)throw new Error('封面目录不存在：public/covers');
    const fileReal=await realpath(absolute).catch(()=>null);
    if(!fileReal)throw new Error(`本地封面不存在：${game.cover}，请先执行 pnpm roms:scan 或检查文件`);
    if(!fileReal.startsWith(rootReal+path.sep))throw new Error(`封面超出 public/covers 目录：${game.cover}`);
    if(!(await stat(fileReal)).isFile())throw new Error(`封面不是普通文件：${game.cover}`);
    const sha256=await digestFile(fileReal,cache);
    // Match tools/content-manifest.mjs exactly so a future `pnpm publish` uses the same URL.
    const key=`covers/auto/${game.id}-${sha256.slice(0,24)}${extension}`;
    objects.set(key,{key,path:fileReal,sha256,mime:mimeOf(fileReal),immutable:true});
    links.push({id:game.id,platform:game.platform,gameId:game.gameId,key});
  }
  return {objects:[...objects.values()],links};
}

export function mergeCoverLinks(remoteGames, links) {
  if(!Array.isArray(remoteGames))throw new Error('线上 games.json 格式不正确：应当为数组');
  const byId=new Map();
  for(const remote of remoteGames){
    if(!remote||typeof remote.id!=='string'||byId.has(remote.id))throw new Error('线上 games.json 包含无效或重复游戏 ID');
    byId.set(remote.id,remote);
  }
  let updated=0;
  const missing=[];
  const mismatched=[];
  const merged=remoteGames.map(g=>({...g}));
  const position=new Map(merged.map((g,i)=>[g.id,i]));
  for(const link of links){
    const existing=byId.get(link.id);
    if(!existing){missing.push(link.id);continue;}
    // Avoid patching the cover of a different game when IDs were accidentally reused.
    if(existing.platform!==link.platform || (existing.gameId!=null && link.gameId!=null && existing.gameId!==link.gameId)){
      mismatched.push(link.id);continue;
    }
    if(existing.cover!==link.key){merged[position.get(link.id)].cover=link.key;updated++;}
  }
  return {games:merged,updated,missing,mismatched};
}

export function readOssCatalog(response){
  const content=response?.content;
  if(typeof content!=='string' && !Buffer.isBuffer(content) && !(content instanceof Uint8Array))throw new Error('OSS 返回的 games.json 不是可读取的 JSON 内容');
  let parsed;
  try{parsed=JSON.parse(Buffer.isBuffer(content)||content instanceof Uint8Array?Buffer.from(content).toString('utf8'):content);}catch{throw new Error('无法解析 OSS 上的 games.json');}
  if(!Array.isArray(parsed))throw new Error('OSS games.json 应当是数组');
  return parsed;
}

async function getRemoteCatalog(client) {
  try{return readOssCatalog(await client.get('games.json'));}
  catch(error){
    if([404,'NoSuchKey','NotFound'].includes(error.status)||[404,'NoSuchKey','NotFound'].includes(error.code)||error.statusCode===404)
      throw new Error('OSS 尚无 games.json：首次上线先执行 pnpm publish；以后新增封面使用 pnpm covers:upload');
    throw error;
  }
}

export async function uploadCovers({dryRun=false,filesOnly=false,client:givenClient=null,config=null,gamesOverride=null,root=coverRoot,logger=console}={}) {
  const {deploy}=config || await loadRuntimeConfig();
  if(!existsSync(catalogPath) && !gamesOverride)throw new Error('找不到 public/games.json，请先执行 pnpm roms:scan');
  const games=gamesOverride??JSON.parse(await readFile(catalogPath,'utf8'));
  const cache=await loadHashCache();
  const {objects,links}=await prepareCoverUploads(games,{root,cache});
  if(root===coverRoot)await saveHashCache(cache);
  logger.log(`🖼️ 本地扫描：${games.length} 款游戏，${links.length} 条封面引用，${objects.length} 个待核对 OSS 对象${dryRun?'（预览）':''}`);
  if(dryRun){for(const asset of objects.slice(0,20))logger.log('  • '+asset.key);logger.log('预览结束：未访问 OSS、未修改线上目录。');return {total:objects.length,uploaded:0,updated:0};}
  if(objects.length===0){logger.log('没有可上传的封面。先执行 pnpm roms:covers，或把图片放入 public/covers 并更新 games.json。');return {total:0,uploaded:0,updated:0};}
  const {client,deploy:remoteDeploy}=givenClient?{client:givenClient,deploy}:await createOssClient();
  if(!remoteDeploy.bucket)throw new Error('请配置 roms.config.json 中的 deploy.bucket');
  const updateCatalog=!filesOnly && remoteDeploy.coverUpload.updateCatalog;
  // Read catalog before upload to fail early if the bucket has not been published yet.
  let plannedLinks=links;
  if(updateCatalog){
    const online=await getRemoteCatalog(client);
    const diff=mergeCoverLinks(online,links);
    if(diff.mismatched.length)throw new Error(`线上游戏 ID 冲突，已停止：${diff.mismatched.join(', ')}。请先检查并执行 pnpm publish`);
    if(diff.missing.length)logger.log(`⚠ 线上目录没有 ${diff.missing.length} 个游戏：${diff.missing.slice(0,6).join(', ')}${diff.missing.length>6?' …':''}。新增游戏需要先 pnpm publish。`);
    const onlineIds=new Set(online.map(g=>g.id));
    plannedLinks=links.filter(g=>onlineIds.has(g.id));
  }
  const keys=new Set(plannedLinks.map(l=>l.key));
  const candidates=updateCatalog?objects.filter(o=>keys.has(o.key)):objects;
  let uploaded=0,skipped=0;
  for(const obj of candidates){
    if(await remoteExists(client,obj.key)){skipped++;continue;}
    logger.log(`  ↑ ${obj.key}`);
    await uploadFile(client,obj.path,obj.key,{mime:obj.mime,immutable:true,multipartThresholdMB:remoteDeploy.multipartThresholdMB});
    if(!await remoteExists(client,obj.key))throw new Error(`封面上传后校验失败：${obj.key}`);
    uploaded++;
  }
  let updated=0;
  if(updateCatalog){
    // Re-read latest published catalog instead of overwriting ROM URLs with local paths.
    const latest=await getRemoteCatalog(client);
    const merged=mergeCoverLinks(latest,plannedLinks);
    if(merged.mismatched.length)throw new Error('发布期间线上目录发生游戏 ID 冲突，请重新执行');
    if(merged.updated){await uploadJson(client,'games.json',merged.games);updated=merged.updated;}
  }
  logger.log(`✅ 封面同步完成：新增上传 ${uploaded}，远端已存在 ${skipped}，线上更新引用 ${updated}。`);
  if(updated)logger.log('提示：CDN 的 games.json 请使用短缓存；若看不到新封面，请刷新该文件缓存。');
  return {total:candidates.length,uploaded,skipped,updated};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  uploadCovers({dryRun:process.argv.includes('--dry-run'),filesOnly:process.argv.includes('--files-only')}).catch(error=>{console.error(`❌ 封面同步失败：${error.message}`);process.exitCode=1;});
}
