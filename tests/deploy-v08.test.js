import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createContentPlan} from '../tools/content-manifest.mjs';
import {allowedSiteKey} from '../tools/deploy-site.mjs';
import {cleanTitle,nameScore} from '../tools/fetch-covers.mjs';
import {normalizeExtras} from '../tools/runtime-config.mjs';

const game=(rom)=>({id:'md-taiko-test',gameId:123,title:'太阁立志传',platform:'MD',rom,cover:'',format:'bin',sizeBytes:8});
test('内容发布：同 ROM 得到稳定不可变 URL，修改内容后 URL 改变，源清单不被污染', async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'xiaomi-publish-'));
  try {
    await mkdir(path.join(root,'MD'));
    const f=path.join(root,'MD','太阁.bin');
    await writeFile(f,Buffer.from([1,2,3]));
    const original=game('roms/MD/太阁.bin');
    const first=await createContentPlan([original],root,{});
    const second=await createContentPlan([original],root,{});
    assert.equal(first.games[0].rom,second.games[0].rom);
    assert.match(first.games[0].rom,/^roms\/MD\/md-taiko-test\/[a-f0-9]{24}\.bin$/);
    assert.equal(original.rom,'roms/MD/太阁.bin');
    await writeFile(f,Buffer.from([1,2,4]));
    const third=await createContentPlan([original],root,{});
    assert.notEqual(first.games[0].rom,third.games[0].rom);
    assert.equal(third.games[0].gameId,123);
  } finally {await rm(root,{recursive:true,force:true});}
});
test('内容发布：拒绝 ../ 路径和平台不匹配 ROM', async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'xiaomi-invalid-'));
  try {
    await assert.rejects(createContentPlan([game('roms/MD/../private.bin')],root,{}),/不合法/);
    await assert.rejects(createContentPlan([game('roms/FC/demo.nes')],root,{}),/平台不匹配/);
  } finally {await rm(root,{recursive:true,force:true});}
});
test('站点单独发布：排除本地 ROM、封面缓存、游戏 JSON 和播放器 JSON',()=>{
  for(const key of ['roms/MD/big.bin','covers/auto/a.jpg','games.json','player-config.json','bios/test.bin'])assert.equal(allowedSiteKey(key),false);
  for(const key of ['index.html','play/index.html','assets/main-abc.js','covers/hero-sonic-stage.webp','emulatorjs/data/loader.js'])assert.equal(allowedSiteKey(key),true);
});
test('IGDB 查询标题清洗和匹配不能凭空猜名称',()=>{
  assert.equal(cleanTitle('太阁立志传_小咪优化_v2.1.bin'),'太阁立志传');
  assert.equal(nameScore('Sonic The Hedgehog','Sonic the Hedgehog'),1);
  assert.ok(nameScore('Sonic','Crash Bandicoot')<0.5);
});
test('阿里云配置：不向配置对象添加私密凭证字段',()=>{
  const extras=normalizeExtras({deploy:{region:'oss-cn-shanghai',bucket:'xiaomi-roms-prod',baseUrl:'https://roms.example.com'},covers:{enabled:true}});
  assert.equal(extras.deploy.bucket,'xiaomi-roms-prod');
  assert.equal(extras.covers.enabled,true);
  assert.equal(JSON.stringify(extras).includes('OSS_ACCESS_KEY_SECRET'),false);
  assert.throws(()=>normalizeExtras({deploy:{baseUrl:'http://bad.com'}}),/HTTPS/);
});
