#!/usr/bin/env node
import {scanOnce} from './scan-roms.mjs';
import {publish} from './publish.mjs';
const dryRun=process.argv.includes('--dry-run');
try {
  const result=await scanOnce({dryRun});
  await publish({dryRun,skipCovers:process.argv.includes('--skip-covers'),gamesOverride:dryRun?result.games:undefined});
}catch(e){console.error('发布失败：'+e.message);process.exitCode=1;}
