#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {projectRoot} from './rom-config.mjs';
async function main(){
  let data;try{data=JSON.parse(await readFile(path.join(projectRoot,'data','unmatched-covers.json'),'utf8'));}catch{console.log('还没有报告，先运行 pnpm roms:covers');return;}
  const counts={};for(const item of data.items||[])counts[item.reason]=(counts[item.reason]||0)+1;
  console.log(`未获取封面：${(data.items||[]).length}，分类：`+JSON.stringify(counts,null,2));
  for(const item of (data.items||[]).slice(0,30))console.log(`  ${item.platform}/${item.title||item.rom}  ${item.reason} ${item.details||''}`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
