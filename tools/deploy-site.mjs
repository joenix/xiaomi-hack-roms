#!/usr/bin/env node
/** Upload only static website files (never ROMs or catalog/player JSON). */
import {existsSync} from 'node:fs';
import {readdir,stat,readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {projectRoot} from './rom-config.mjs';
import {loadHashCache,saveHashCache,digestFile,mimeOf} from './content-manifest.mjs';
import {createOssClient,uploadFile} from './oss-client.mjs';
const dist=path.join(projectRoot,'dist');
const statePath=path.join(projectRoot,'.cache','site-state.json');
async function walk(dir, relative=''){
  const out=[];
  for(const entry of await readdir(dir,{withFileTypes:true})){
    const sub=[relative,entry.name].filter(Boolean).join('/');
    if(entry.isDirectory())out.push(...await walk(path.join(dir,entry.name),sub));
    else if(entry.isFile())out.push({key:sub,file:path.join(dir,entry.name)});
  }return out;
}
export function allowedSiteKey(key) {
  if(key==='games.json'||key==='player-config.json'||key.startsWith('roms/')||key.startsWith('covers/auto/')||key.startsWith('bios/'))return false;
  if(key.startsWith('.')||key.includes('/.'))return false;
  return true;
}
async function readState(){try{return JSON.parse(await readFile(statePath,'utf8'));}catch{return {};}}
async function saveState(s){await mkdir(path.dirname(statePath),{recursive:true});const tmp=statePath+'.tmp';await writeFile(tmp,JSON.stringify(s,null,2));await rename(tmp,statePath);}
export async function deploySite({dryRun=false}={}){
  if(!existsSync(dist))throw new Error('dist 不存在，请先运行 pnpm build');
  const files=(await walk(dist)).filter(f=>allowedSiteKey(f.key));
  const cache=await loadHashCache();const state=await readState();
  const {deploy:config}=await (await import('./runtime-config.mjs')).loadRuntimeConfig();
  const target=`${config.region}/${config.bucket}`;
  if(state.__target!==target){for(const k of Object.keys(state))delete state[k];state.__target=target;}
  const updates=[];
  for(const f of files){const sha=await digestFile(f.file,cache);if(state[f.key]!==sha)updates.push({...f,sha});}
  await saveHashCache(cache);
  console.log(`🌐 网站文件 ${files.length} 个，需要上传 ${updates.length} 个${dryRun?'（预览）':''}`);
  for(const f of updates.slice(0,12))console.log('  • '+f.key);
  if(dryRun)return {updates};
  const {client,deploy}=await createOssClient();
  const pages=[];
  for(const f of updates){
    if(f.key==='index.html'||f.key==='play/index.html'){pages.push(f);continue;}
    await uploadFile(client,f.file,f.key,{mime:mimeOf(f.file),immutable:f.key.startsWith('assets/'),multipartThresholdMB:deploy.multipartThresholdMB});
    state[f.key]=f.sha;await saveState(state);
  }
  // HTML last, after referenced JS/CSS files. Existing objects are not deleted.
  for(const f of pages){await uploadFile(client,f.file,f.key,{mime:mimeOf(f.file),immutable:false});state[f.key]=f.sha;await saveState(state);}
  console.log(`✅ 网站文件已发布。资源目录 games.json 和 ROM 未触碰。`);
  return {updates};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))deploySite({dryRun:process.argv.includes('--dry-run')}).catch(e=>{console.error(`网站发布失败：${e.message}`);process.exitCode=1});
