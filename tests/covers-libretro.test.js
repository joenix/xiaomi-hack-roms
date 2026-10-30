import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {parseBoxartIndex,selectBoxart,compatibleSeries,fetchBoxartIndex,downloadBoxart,boxartUrl,LIBRETRO_DIRS} from '../tools/libretro-covers.mjs';
import {normalizeExtras} from '../tools/runtime-config.mjs';
import {cleanTitle} from '../tools/fetch-covers.mjs';
const directoryHTML=(names)=>`<html><body>${names.map(n=>`<a href="${encodeURIComponent(n)}">${n}</a>`).join('\n')}</body></html>`;
const image=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(120,7)]);
const response=(body,status=200)=>new Response(body,{status});

test('默认配置无须密钥即可启用 Libretro，五个平台都有目录',()=>{
  const extras=normalizeExtras({covers:{enabled:true}});
  assert.equal(extras.covers.provider,'libretro');
  assert.equal(extras.covers.autoOnScan,true);
  assert.deepEqual(Object.keys(LIBRETRO_DIRS).sort(),['FC','GBA','MD','PSP','SFC']);
});
test('安全解析目录与 URL，排除目录穿越、外链和非图片',()=>{
  const names=['Sonic The Hedgehog (USA).png','Taikou Risshiden (Japan).png'];
  const html=directoryHTML(names)+`<a href="../secret.png">x</a><a href="https://wrong.example/a.png">x</a><a href="hijack.jpg">x</a>`;
  const parsed=parseBoxartIndex(html);
  assert.deepEqual(parsed.map(x=>x.name),names);
  assert.match(boxartUrl('MD',parsed[0]),/^https:\/\/thumbnails\.libretro\.com\/Sega%20-%20Mega%20Drive%20-%20Genesis\/Named_Boxarts\//);
  assert.throws(()=>boxartUrl('MD',{name:'bad',href:'..%2Fabc.png'}));
});
test('MD 游戏名清洗并精确匹配，不能给同系列错误作品贴图',()=>{
  assert.equal(cleanTitle('MD太阁立志传_小咪优化_v2.1.bin'),'太阁立志传');
  const entries=parseBoxartIndex(directoryHTML(['Taikou Risshiden (Japan).png','Sonic The Hedgehog 2 (USA).png','Sonic The Hedgehog 3 (USA).png']));
  const taiko=selectBoxart(entries,'Taikou Risshiden');
  assert.equal(taiko.name,'Taikou Risshiden (Japan).png');
  const sonic=selectBoxart(entries,'Sonic the Hedgehog 2');
  assert.equal(sonic.name,'Sonic The Hedgehog 2 (USA).png');
  assert.equal(selectBoxart(entries,'Langrisser II'),null);
});
test('同名不同地区优先日本封面，但排除 Beta/复刻变体',()=>{
  const entries=parseBoxartIndex(directoryHTML(['Sonic The Hedgehog (USA).png','Sonic The Hedgehog (Japan).png','Sonic The Hedgehog (Japan) (Beta).png']));
  assert.equal(selectBoxart(entries,'Sonic the Hedgehog',{region:'jp'}).name,'Sonic The Hedgehog (Japan).png');
  assert.equal(selectBoxart(entries,'Sonic the Hedgehog',{region:'us'}).name,'Sonic The Hedgehog (USA).png');
});
test('索引只查一次、本地缓存复用、离线时可退回缓存',async()=>{
  const folder=await mkdtemp(path.join(os.tmpdir(),'cover-index-'));
  const entries=['Sonic The Hedgehog (USA).png', 'Taikou Risshiden (Japan).png', ...Array.from({length:12},(_,i)=>`Game ${i} (USA).png`)];
  let hits=0;
  const network=async()=>{hits++;return response(directoryHTML(entries));};
  try{
    const first=await fetchBoxartIndex('MD',{cacheDir:folder,fetchImpl:network});
    assert.equal(first.length,entries.length);
    const second=await fetchBoxartIndex('MD',{cacheDir:folder,fetchImpl:async()=>{throw Error('SHOULD NOT FETCH');}});
    assert.deepEqual(second,first);
    assert.equal(hits,1);
    const third=await fetchBoxartIndex('MD',{cacheDir:folder,refresh:true,fetchImpl:async()=>{throw Error('offline');}});
    assert.deepEqual(third,first);
  }finally{await rm(folder,{recursive:true,force:true});}
});
test('下载封面时校验 PNG 文件头，拒绝 HTML 伪装',async()=>{
  const entry=parseBoxartIndex(directoryHTML(['Sonic The Hedgehog (USA).png']))[0];
  assert.deepEqual(await downloadBoxart('MD',entry,{fetchImpl:async()=>response(image)}),image);
  await assert.rejects(downloadBoxart('MD',entry,{fetchImpl:async()=>response(Buffer.alloc(140,1))}),/合法 PNG/);
});

test('封面不能跨系列版本号误匹配，即使文本相似度超过 90%',()=>{
  for(const [query,other] of [['Langrisser II','Langrisser III (USA).png'],['Sonic the Hedgehog 2','Sonic the Hedgehog 3 (USA).png'],['Phantasy Star IV','Phantasy Star II (USA).png'],['Sonic the Hedgehog','Sonic the Hedgehog 2 (USA).png']]){
    assert.equal(compatibleSeries(query,other),false);
    assert.equal(selectBoxart([{name:other,href:encodeURIComponent(other)}],query,{minMatchScore:.9}),null);
  }
  assert.equal(compatibleSeries('Phantasy Star IV','Phantasy Star IV (Japan) (Rev A).png'),true);
});
