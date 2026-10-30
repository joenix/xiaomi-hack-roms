import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fetchWithRetry,classifyCoverError,mediaType} from '../tools/cover-network.mjs';
import {chooseLocalCover,findLaunchBoxLocal} from '../tools/launchbox-local.mjs';
import {normalizeExtras} from '../tools/runtime-config.mjs';
const image=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(150,7)]);
test('单请求独立超时且超时后重试成功',async()=>{
 let calls=0;
 const bytes=await fetchWithRetry('https://example.com/image',{timeoutMs:15,retries:2,baseDelayMs:0,wait:async()=>{},fetchImpl:async(_url,{signal})=>{
  calls++;if(calls===1)return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})),{once:true}));
  return new Response(image);
 }});
 assert.deepEqual(bytes,image);assert.equal(calls,2);
});
test('404 不反复请求；429 重试',async()=>{
 let calls=0;
 await assert.rejects(fetchWithRetry('https://example.com',{retries:3,wait:async()=>{},fetchImpl:async()=>{calls++;return new Response('not found',{status:404});}}),e=>e.status===404);
 assert.equal(calls,1);
 calls=0;
 const out=await fetchWithRetry('https://example.com',{retries:2,wait:async()=>{},fetchImpl:async()=>{calls++;return calls===1?new Response('Too Many',{status:429}):new Response(image);}});
 assert.deepEqual(out,image);assert.equal(calls,2);
});
test('对远端内容大小、图片格式作校验',async()=>{
 await assert.rejects(fetchWithRetry('https://example.com',{maxBytes:10,fetchImpl:async()=>new Response(image)}),/上限/);
 assert.equal(mediaType(image),'.png');assert.equal(mediaType(Buffer.from('<html>')) ,null);
 assert.equal(classifyCoverError(Object.assign(new Error('This operation was aborted'),{name:'AbortError'})),'timeout');
});
test('可从用户本地导出的 LaunchBox 封面目录查找游戏并校验签名',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'launchbox-import-'));
 try{
  const dir=path.join(root,'Images','Sega Genesis','Box - Front');await mkdir(dir,{recursive:true});
  const cover=path.join(dir,'Langrisser II-01.png');await writeFile(cover,image);
  assert.equal(chooseLocalCover([cover],'Langrisser II')?.score,1);
  const found=await findLaunchBoxLocal(root,'MD',['Langrisser II'],.9);
  assert.equal(found?.source,'launchbox-local');assert.equal(found?.ext,'.png');assert.deepEqual(found?.bytes,image);
  assert.equal(await findLaunchBoxLocal(root,'MD',['Langrisser III'],.9),null);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('可配置双来源和有限重试，凭据不需要在公开 JSON 中出现',()=>{
 const extras=normalizeExtras({covers:{sources:['launchbox-local','libretro'],launchboxLocalDir:'~/LaunchBox',timeoutMs:25000,retries:3}});
 assert.deepEqual(extras.covers.sources,['launchbox-local','libretro']);assert.equal(extras.covers.timeoutMs,25000);assert.equal(extras.covers.retries,3);
});
