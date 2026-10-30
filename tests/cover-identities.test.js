import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,copyFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {matchGameIdentity,buildCoverQueries} from '../tools/cover-identity.mjs';

const cases=[
 ['阿斯特堡的恶魔 秘籍版','Demons of Asteborg'],
 ['阿斯特博格兄弟 秘籍版','Astebros'],
 ['大航海时代2 意志之路1.9F5+ Gens可玩版v3','Daikoukai Jidai II'],
 ['斗技王 特殊名字全装备版','Tougiou King Colossus'],
 ['光明力量1-众神遗产 Alternate','Shining Force - Kamigami no Isan'],
 ['光明力量2 上帝之战','Shining Force II - Inishie no Fuuin'],
 ['光明力量2 意志之路2.2','Shining Force II - Inishie no Fuuin'],
 ['光之继承者-高清宽屏增值版','Story of Thor, The - Hikari o Tsugumono'],
 ['光之继承者-高清宽屏增值版v2','Story of Thor, The - Hikari o Tsugumono'],
 ['光之继承者-高清宽屏增值版v3','Story of Thor, The - Hikari o Tsugumono'],
 ['梦幻模拟战2-帝国之路·暗灭 秘籍修复版','Langrisser II'],
 ['梦幻模拟战2-帝国之路·暗灭·专家增值版','Langrisser II'],
 ['梦幻模拟战2-狮子骑士崛起·一周目PLUS增值版v1','Langrisser II'],
 ['梦幻模拟战2-狮子骑士崛起·一周目PLUS增值版v2','Langrisser II'],
 ['梦幻模拟战2-狮子骑士崛起·一周目PLUS增值版v3','Langrisser II'],
 ['梦幻模拟战2-狮子骑士崛起·一周目PLUS增值版v4','Langrisser II'],
 ['梦幻之星4 意志之路v2.2b','Phantasy Star IV'],
 ['怒之铁拳2 忍者神龟专家增值版','Bare Knuckle II - Shitou e no Requiem ~ Streets of Rage II'],
 ['太阁立志传 8类型直选','Taikou Risshiden'],
 ['太阁立志传 PRO','Taikou Risshiden'],
 ['太阁立志传 PRO','Taikou Risshiden'],
 ['太阁立志传 PRO','Taikou Risshiden'],
 ['太阁立志传 PRO','Taikou Risshiden'],
];
test('实际 23 个 MD Hack 文件名均解析成独立的原作名',()=>{
 assert.equal(cases.length,23);
 for(const [file,expected] of cases){
   assert.equal(matchGameIdentity('MD',file+' .bin')?.queries[0],expected,file);
 }
});
test('防止光明力量1/2、梦幻模拟战1/2和同名系列的错认',()=>{
 assert.equal(matchGameIdentity('MD','光明力量1-众神遗产.bin')?.queries[0],'Shining Force - Kamigami no Isan');
 assert.equal(matchGameIdentity('MD','光明力量2-上帝之战.bin')?.queries[0],'Shining Force II - Inishie no Fuuin');
 assert.equal(matchGameIdentity('MD','梦幻模拟战20.bin'),null);
 assert.equal(matchGameIdentity('MD','MD太阁立志传_小咪优化_v2.1.bin')?.queries[0],'Taikou Risshiden');
});
test('自定义别名最长前缀优先，精确 override 拥有最高优先级',()=>{
 const aliases={'光明力量':'Shining Force','光明力量2':'Shining Force II'};
 assert.equal(matchGameIdentity('MD','光明力量2 上帝之战.bin',aliases).queries[0],'Shining Force II');
 const game={id:'my-id',rom:'roms/MD/光明力量2.bin',platform:'MD',sourceName:'光明力量2 上帝之战.bin'};
 assert.deepEqual(buildCoverQueries(game,{aliases,overrides:{'my-id':{searchTitle:'Custom Cover'}}}).queries,['Custom Cover']);
});
test('Hack 多版本复用一次下载的封面文件',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'hack-boxarts-'));
 try{
   await mkdir(path.join(root,'tools'),{recursive:true});
   await mkdir(path.join(root,'public/covers/auto'),{recursive:true});
   await writeFile(path.join(root,'package.json'),'{"type":"module"}');
   const here=path.resolve(import.meta.dirname,'..');
   for(const name of ['rom-config.mjs','runtime-config.mjs','fetch-covers.mjs','libretro-covers.mjs','cover-identity.mjs','cover-network.mjs','launchbox-local.mjs'])await copyFile(path.join(here,'tools',name),path.join(root,'tools',name));
   await writeFile(path.join(root,'roms.config.json'),JSON.stringify({romsDir:'./local-roms',covers:{enabled:true,provider:'libretro'}}));
   const games=['太阁立志传 PRO','太阁立志传 8类型直选'].map((name,i)=>({id:'md-demo-'+i,sourceName:name+'.bin',title:name,platform:'MD',rom:'roms/MD/'+i+'.bin',format:'bin'}));
   await writeFile(path.join(root,'public/games.json'),JSON.stringify(games));
   const body=`<a href="Taikou%20Risshiden%20%28Japan%29.png">link</a>`+Array.from({length:15},(_,i)=>`<a href="Other%20Game%20${i}%20%28USA%29.png">x</a>`).join('');
   const png=[137,80,78,71,13,10,26,10,...Array(180).fill(5)];
   const script=`let img=0;globalThis.fetch=async(url)=>{if(String(url).endsWith('/Named_Boxarts/'))return new Response(${JSON.stringify(body)}); if(String(url).endsWith('.png')){img++;return new Response(Buffer.from(${JSON.stringify(png)}));}throw Error(url)}; const {fetchMissingCovers}=await import(${JSON.stringify('file://'+path.join(root,'tools/fetch-covers.mjs'))});const r=await fetchMissingCovers({quiet:true});if(r.downloaded!==1||r.reused!==1||img!==1)throw Error(JSON.stringify({r,img}));`;
   const result=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:root,encoding:'utf8'});
   assert.equal(result.status,0,result.stderr);
   const actual=JSON.parse(await readFile(path.join(root,'public/games.json'),'utf8'));
   assert.equal(actual[0].cover,actual[1].cover);
 }finally{await rm(root,{recursive:true,force:true});}
});
