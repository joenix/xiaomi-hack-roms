import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
const here=path.resolve(import.meta.dirname,'..');
const image=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(200,7)]);

test('CLI 扫描 -> 无密钥匹配 -> 本地落盘 -> 重复扫描保留来源和不重下载',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'xiaomi-cover-integration-'));
  try{
    await mkdir(path.join(root,'tools'),{recursive:true});
    await mkdir(path.join(root,'public/covers/auto'),{recursive:true});
    await mkdir(path.join(root,'local-roms/MD'),{recursive:true});
    await writeFile(path.join(root,'package.json'),'{"type":"module"}');
    for(const file of ['rom-config.mjs','runtime-config.mjs','fetch-covers.mjs','libretro-covers.mjs','scan-roms.mjs','cover-identity.mjs','cover-network.mjs','launchbox-local.mjs'])await copyFile(path.join(here,'tools',file),path.join(root,'tools',file));
    await writeFile(path.join(root,'roms.config.json'),JSON.stringify({romsDir:'./local-roms',covers:{enabled:true,provider:'libretro',aliases:{'太阁立志传':'Taikou Risshiden'},minMatchScore:0.90}}));
    await writeFile(path.join(root,'local-roms/MD/MD太阁立志传_小咪优化_v2.1.bin'),Buffer.from([1,2,3]));
    const scan=()=>spawnSync(process.execPath,['tools/scan-roms.mjs','--no-covers'],{cwd:root,encoding:'utf8'});
    assert.equal(scan().status,0);
    const modulePath=path.join(root,'tools/fetch-covers.mjs');
    const body=`<html>${['Taikou Risshiden (Japan).png',...Array.from({length:11},(_,i)=>`Demo Game ${i} (USA).png`)].map(s=>`<a href="${encodeURIComponent(s)}">${s}</a>`).join('')}</html>`;
    const code=`
      globalThis.fetch = async (url) => {\n
        if (String(url).endsWith('/Named_Boxarts/')) return new Response(${JSON.stringify(body)});\n
        if (String(url).endsWith('.png')) return new Response(Buffer.from(${JSON.stringify([...image])}));\n
        throw new Error('Unexpected URL: '+url);\n
      };\n
      const {fetchMissingCovers}=await import(${JSON.stringify('file://'+modulePath)});\n
      const first=await fetchMissingCovers({quiet:true});\n
      const second=await fetchMissingCovers({quiet:true});\n
      if(first.downloaded!==1||second.downloaded!==0)throw Error('unexpected counts '+JSON.stringify({first,second}));\n
    `;
    const fetched=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:root,encoding:'utf8'});
    assert.equal(fetched.status,0,fetched.stderr);
    let [game]=JSON.parse(await readFile(path.join(root,'public/games.json'),'utf8'));
    assert.ok(game.cover.startsWith('covers/auto/'));
    assert.equal(game.coverSource.provider,'libretro');
    assert.equal(game.coverSource.matchedTitle,'Taikou Risshiden (Japan)');
    assert.equal(scan().status,0);
    [game]=JSON.parse(await readFile(path.join(root,'public/games.json'),'utf8'));
    assert.equal(game.coverSource.provider,'libretro','scan should preserve source metadata');
  }finally{await rm(root,{recursive:true,force:true});}
});
