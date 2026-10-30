import test from 'node:test';
import assert from 'node:assert/strict';
import {loadLibrary,resolveLibraryAsset} from '../src/library.js';
test('资源地址相对于 libraries，中文文件名安全编码，拒绝越界',()=>{
 const root='https://joenix.github.io/xiaomi-hack-roms-libraries/';
 assert.equal(resolveLibraryAsset('roms/MD/中文.bin',root),root+'roms/MD/%E4%B8%AD%E6%96%87.bin');
 for(const path of ['../other.bin','/roms/a.bin','roms/../a.bin','roms\\a.bin'])assert.throws(()=>resolveLibraryAsset(path,root));
});
test('配置驱动目录版本和游玩开关，配置请求绕过旧缓存',async()=>{
 const calls=[];
 const fetchImpl=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>url.includes('library.json?')?{schemaVersion:1,catalog:'catalogs/version.json',playerConfig:'config/player.json',playEnabled:false,notice:'维护中'}:[{id:'game',rom:'roms/MD/a.bin',cover:'covers/MD/a.png'}]};};
 const data=await loadLibrary({origin:'https://joenix.github.io',fetchImpl});
 assert.match(calls[0].url,/library.json\?t=\d+/);assert.equal(calls[0].options.cache,'no-store');
 assert.equal(data.catalogUrl,'https://joenix.github.io/xiaomi-hack-roms-libraries/catalogs/version.json');
 assert.equal(data.config.playEnabled,false);assert.equal(data.config.notice,'维护中');
});
test('资源配置请求失败或 schema 不兼容时明确报错',async()=>{
 await assert.rejects(loadLibrary({origin:'https://joenix.github.io',fetchImpl:async()=>({ok:false,status:404})}),/HTTP 404/);
 await assert.rejects(loadLibrary({origin:'https://joenix.github.io',fetchImpl:async()=>({ok:true,json:async()=>({schemaVersion:99})})}),/格式不正确/);
});
