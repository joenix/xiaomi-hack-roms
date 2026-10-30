import {existsSync} from 'node:fs';
import {readdir} from 'node:fs/promises';
import path from 'node:path';
import {projectRoot,loadRomConfig} from './rom-config.mjs';
const {isExternal}=await loadRomConfig();
if(!isExternal)throw new Error('生产模式禁止 romsDir 设置为 public/roms：请改为项目外的 ROM 目录，避免 Vite 将 GB 级 ROM 打进 dist');
const p=path.join(projectRoot,'public','roms');
if(existsSync(p)&&(await readdir(p)).length)throw new Error('public/roms 非空：请移走这些 ROM 再构建，保证 dist 不带 ROM');
