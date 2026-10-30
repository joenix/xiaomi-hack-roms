#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {projectRoot} from './rom-config.mjs';
const dryRun=process.argv.includes('--dry-run');
try {
  // Full release: site first, content catalog last. Useful for initial deployment.
  execFileSync(process.execPath,['tools/scan-roms.mjs'],{cwd:projectRoot,stdio:'inherit'});
  execFileSync(process.execPath,['tools/check-public-roms.mjs'],{cwd:projectRoot,stdio:'inherit'});
  execFileSync('./node_modules/.bin/vite',['build'],{cwd:projectRoot,stdio:'inherit'});
  execFileSync(process.execPath,['tools/deploy-site.mjs',...(dryRun?['--dry-run']:[])],{cwd:projectRoot,stdio:'inherit'});
  execFileSync(process.execPath,['tools/publish.mjs',...(dryRun?['--dry-run']:[])],{cwd:projectRoot,stdio:'inherit'});
}catch(e){console.error('整体部署失败：',e.message);process.exitCode=1;}
