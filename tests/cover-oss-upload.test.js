import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {prepareCoverUploads,mergeCoverLinks,uploadCovers} from '../tools/upload-covers.mjs';

const cfg={deploy:{bucket:'test-bucket',region:'oss-cn-shanghai',baseUrl:'https://roms.example.com',multipartThresholdMB:16,coverUpload:{updateCatalog:true}}};
const game=(id,cover,gameId=42)=>({id,gameId,title:'测试',platform:'MD',rom:'roms/MD/test.bin',cover});
async function fixture(fn){
  const root=await mkdtemp(path.join(os.tmpdir(),'xiaomi-covers-upload-'));
  try {
    await mkdir(path.join(root,'auto'),{recursive:true});
    await writeFile(path.join(root,'auto','pic.png'),Buffer.from([137,80,78,71,3,2,1]));
    await fn(root);
  } finally {await rm(root,{recursive:true,force:true});}
}
function fakeClient(catalog, {failPut=false}={}) {
  const objects=new Map([['games.json',Buffer.from(JSON.stringify(catalog))]]);
  const calls=[];
  return {
    calls,objects,
    async head(key){calls.push(['head',key]);if(!objects.has(key))throw Object.assign(new Error('404'),{status:404});return {status:200};},
    async get(key){calls.push(['get',key]);if(!objects.has(key))throw Object.assign(new Error('404'),{status:404});return {content:objects.get(key)};},
    async put(key,file){calls.push(['put',key]);if(failPut)throw new Error('network down');objects.set(key,typeof file==='string'?await readFile(file):Buffer.from(file));return {};},
  };
}
test('封面上传：生成与 content-manifest 同样的内容哈希路径，多个 Hack 各自正确关联',async()=>{
  await fixture(async root=>{
    const games=[game('md-hack-1','covers/auto/pic.png'),game('md-hack-2','covers/auto/pic.png',43)];
    const result=await prepareCoverUploads(games,{root,cache:{}});
    assert.equal(result.links.length,2);
    assert.equal(result.objects.length,2);
    assert.match(result.objects[0].key,/^covers\/auto\/md-hack-1-[a-f0-9]{24}\.png$/);
    assert.equal(result.links[0].key,result.objects[0].key);
  });
});
test('封面上传：只修改线上 cover，不覆盖 OSS 的 ROM 路径和其他字段；第二次不重复上传',async()=>{
  await fixture(async root=>{
    const local=[game('md-hack-1','covers/auto/pic.png')];
    const online=[{...game('md-hack-1','covers/auto/old.png'),rom:'roms/MD/md-hack-1/hashed.bin',custom:'keep'},
      {...game('md-other','covers/auto/other.png',44),rom:'roms/MD/md-other/hashed.bin'}];
    const client=fakeClient(online);
    const options={client,config:cfg,gamesOverride:local,root,logger:{log(){}}};
    const first=await uploadCovers(options);
    assert.equal(first.uploaded,1);assert.equal(first.updated,1);
    let after=JSON.parse(client.objects.get('games.json').toString());
    assert.equal(after[0].rom,online[0].rom);assert.equal(after[0].custom,'keep');
    assert.match(after[0].cover,/^covers\/auto\/md-hack-1-[a-f0-9]{24}\.png$/);
    assert.deepEqual(after[1],online[1]);
    const second=await uploadCovers(options);
    assert.equal(second.uploaded,0);assert.equal(second.updated,0);
    assert.equal(client.calls.filter(c=>c[0]==='put'&&c[1]==='games.json').length,1);
  });
});
test('封面上传：远端首次没有 games.json 时阻止更新；允许 --files-only 上传文件',async()=>{
  await fixture(async root=>{
    const client=fakeClient([]);client.objects.delete('games.json');
    const local=[game('md-hack-1','covers/auto/pic.png')];
    await assert.rejects(uploadCovers({client,config:cfg,gamesOverride:local,root,logger:{log(){}}}),/先执行 pnpm publish/);
    assert.equal(client.calls.filter(c=>c[0]==='put').length,0);
    const result=await uploadCovers({client,config:cfg,gamesOverride:local,root,filesOnly:true,logger:{log(){}}});
    assert.equal(result.uploaded,1);assert.equal(result.updated,0);
  });
});
test('封面上传：远端 gameId 冲突停止，防止串错游戏',async()=>{
  await fixture(async root=>{
    const client=fakeClient([game('md-hack-1','',999)]);
    await assert.rejects(uploadCovers({client,config:cfg,gamesOverride:[game('md-hack-1','covers/auto/pic.png')],root,logger:{log(){}}}),/游戏 ID 冲突/);
    assert.equal(client.calls.filter(c=>c[0]==='put').length,0);
  });
});
test('封面上传：网络上传出错时不写入线上 games.json',async()=>{
  await fixture(async root=>{
    const client=fakeClient([game('md-hack-1','')],{failPut:true});
    await assert.rejects(uploadCovers({client,config:cfg,gamesOverride:[game('md-hack-1','covers/auto/pic.png')],root,logger:{log(){}}}),/network down/);
    assert.equal(client.calls.filter(c=>c[0]==='put'&&c[1]==='games.json').length,0);
  });
});
test('封面上传：拒绝路径穿越和无效格式',async()=>{
  await fixture(async root=>{
    await assert.rejects(prepareCoverUploads([game('id','covers/../private.png')],{root,cache:{}}),/不合法/);
    await assert.rejects(prepareCoverUploads([game('id','covers/auto/pic.svg')],{root,cache:{}}),/格式不支持/);
  });
});
test('封面上传：只在有变化时更新，预览不接触 OSS',async()=>{
  await fixture(async root=>{
    const client=fakeClient([game('md-hack-1','')]);
    const result=await uploadCovers({client,config:cfg,gamesOverride:[game('md-hack-1','covers/auto/pic.png')],root,dryRun:true,logger:{log(){}}});
    assert.equal(result.total,1);
    assert.equal(client.calls.length,0);
  });
});
