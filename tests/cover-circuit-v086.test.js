import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile,readFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
const here=path.resolve(import.meta.dirname,'..');

test('服务器离线时只试两个不同的游戏，不对整批 ROM 连续发出 aborted',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'xiaomi-cover-breaker-'));
 try{
  await mkdir(path.join(root,'tools'),{recursive:true});await mkdir(path.join(root,'public','covers','auto'),{recursive:true});
  await writeFile(path.join(root,'package.json'),'{"type":"module"}');
  for(const name of ['rom-config.mjs','runtime-config.mjs','fetch-covers.mjs','libretro-covers.mjs','cover-identity.mjs','cover-network.mjs','launchbox-local.mjs'])await copyFile(path.join(here,'tools',name),path.join(root,'tools',name));
  await writeFile(path.join(root,'roms.config.json'),JSON.stringify({romsDir:'./local-roms',covers:{enabled:true,sources:['libretro'],retries:0}}));
  const games=['光明力量1-众神遗产 Alternate','光明力量2 上帝之战','梦幻模拟战2 暗灭','太阁立志传 PRO','太阁立志传 8类型直选'].map((n,i)=>({id:'md-'+i,title:n,sourceName:n+'.bin',platform:'MD',rom:'roms/MD/'+i+'.bin',format:'bin'}));
  await writeFile(path.join(root,'public/games.json'),JSON.stringify(games));
  const names=['Shining Force (Japan)','Shining Force II (Japan)','Langrisser II (Japan)','Taikou Risshiden (Japan)',...Array.from({length:12},(_,i)=>'Misc Game '+i+' (USA)')];
  const body=names.map(s=>`<a href="${encodeURIComponent(s+'.png')}">x</a>`).join('');
  const script=`let images=0,index=0;globalThis.fetch=async(url)=>{let s=String(url);if(s.endsWith('/Named_Boxarts/')){index++;return new Response(${JSON.stringify(body)});}images++;throw Error('Connection closed');};const {fetchMissingCovers}=await import('file://${path.join(root,'tools','fetch-covers.mjs')}');const result=await fetchMissingCovers({quiet:true});if(images!==2||index!==1)throw Error(JSON.stringify({images,index,result}));`;
  const proc=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:root,encoding:'utf8'});
  assert.equal(proc.status,0,proc.stderr);
  const report=JSON.parse(await readFile(path.join(root,'data/unmatched-covers.json'),'utf8'));
  assert.equal(report.items.length,5);
  assert.equal(report.items[2].reason,'source-unavailable');
  assert.equal(report.items[4].reason,'source-unavailable');
 }finally{await rm(root,{recursive:true,force:true});}
});
