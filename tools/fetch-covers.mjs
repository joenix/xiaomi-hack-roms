#!/usr/bin/env node
/** Hack-aware, resilient cover matching. Pure Node; never sends ROM bytes to the network. */
import {existsSync} from 'node:fs';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {catalogPath,publicRoot,projectRoot} from './rom-config.mjs';
import {loadRuntimeConfig,loadLocalEnv} from './runtime-config.mjs';
import {fetchBoxartIndex,selectBoxart,downloadBoxart} from './libretro-covers.mjs';
import {buildCoverQueries,readMdHeaderTitle} from './cover-identity.mjs';
import {findLaunchBoxLocal} from './launchbox-local.mjs';
import {fetchWithRetry,mediaType,classifyCoverError} from './cover-network.mjs';

const PLATFORM_IDS={FC:18,MD:29,SFC:19,GBA:24,PSP:38};
const STOP=/(?:小咪优化|汉化(?:版|补丁)?|中文版|修正(?:版)?|魔改|优化版|专家(?:模式|版)?|增强版|重制版|测试版|增值版|v\s?\d+(?:\.\d+)*|hack\b|\[(?:!|T[^\]]+|Rev[^\]]+)\])/ig;
export function cleanTitle(name){
  return String(name||'').replace(/\.(?:zip|7z|bin|md|gen|smd|sfc|smc|nes|gba|iso|cso|chd)$/i,'').replace(/^\[?(?:FC|MD|SFC|GBA|PSP)\]?[_\s-]*/i,'')
    .replace(STOP,' ').replace(/\[[^\]]*\]/g,' ').replace(/\((?:USA|Japan|Europe|Rev[^)]*|日版|美版)\)/ig,' ')
    .replace(/[_·—–]+/g,' ').replace(/\s+/g,' ').trim();
}
export function nameScore(query,candidate){
  const norm=s=>String(s).toLocaleLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]/gu,'');
  const a=norm(query),b=norm(candidate);if(!a||!b)return 0;if(a===b)return 1;
  if(a.length>=5&&b.length>=5&&(a.includes(b)||b.includes(a)))return Math.min(a.length,b.length)/Math.max(a.length,b.length)*0.95;
  const bg=s=>new Set([...s].slice(0,-1).map((_,i)=>s[i]+s[i+1]));
  const x=bg(a),y=bg(b);let n=0;for(const t of x)if(y.has(t))n++;
  return x.size+y.size?2*n/(x.size+y.size):0;
}
export function selectIgdb(results,title,platformId,minScore){
  return (results||[]).filter(x=>x.cover?.image_id && (x.platforms||[]).includes(platformId))
    .map(x=>({...x,score:nameScore(title,x.name)})).filter(x=>x.score>=minScore)
    .sort((a,b)=>b.score-a.score)[0]||null;
}
async function getIgdbToken(id,secret,settings){
  const u=new URL('https://id.twitch.tv/oauth2/token');
  u.searchParams.set('client_id',id);u.searchParams.set('client_secret',secret);u.searchParams.set('grant_type','client_credentials');
  const bytes=await fetchWithRetry(u,{...settings,headers:{'Accept':'application/json'}});
  const body=JSON.parse(bytes.toString('utf8'));
  if(!body.access_token)throw new Error('未能取得 IGDB token');return body.access_token;
}
async function lookupIgdb(query,platform,id,token,minScore,settings){
  const safe=query.replace(/["\\;\r\n]/g,' ').slice(0,100);
  const bytes=await fetchWithRetry('https://api.igdb.com/v4/games',{...settings,maxBytes:2*1024*1024,headers:{'Client-ID':id,Authorization:`Bearer ${token}`,'Content-Type':'text/plain'},
    // POST needs separate fetch options, supported by fetchWithRetry below.
    method:'POST',body:`search "${safe}"; fields name,cover.image_id,platforms; limit 25;`});
  const found=selectIgdb(JSON.parse(bytes.toString('utf8')),query,PLATFORM_IDS[platform],minScore);
  if(!found)return null;
  if(!/^[a-zA-Z0-9_-]+$/.test(found.cover.image_id))throw Error('无效的 IGDB 图片 ID');
  const image=await fetchWithRetry(`https://images.igdb.com/igdb/image/upload/t_cover_big_2x/${found.cover.image_id}.jpg`,settings);
  if(image.length<100||mediaType(image)!=='.jpg')throw Error('IGDB 返回的不是 JPEG 图片');
  return {bytes:image,matchedTitle:found.name,score:found.score,source:'igdb',ext:'.jpg',query};
}
function existingCover(game){
  if(!game.cover||typeof game.cover!=='string'||!game.cover.startsWith('covers/')||game.cover.includes('..')||game.cover.includes('\\'))return false;
  return existsSync(path.join(publicRoot,game.cover));
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function safeCopy(v){return String(v||'').slice(0,260);}
function reportError(error){
  const kind=classifyCoverError(error);
  return {kind,details:kind==='timeout'?'图片服务器请求超时':(kind==='network'?'网络连接失败':safeCopy(error?.message)),status:error?.status||null};
}
async function writeReport(filename,payload){
  const destination=path.join(projectRoot,'data',filename);await mkdir(path.dirname(destination),{recursive:true});
  const tmp=destination+'.tmp';await writeFile(tmp,JSON.stringify(payload,null,2)+'\n');await rename(tmp,destination);
}
/**
 * Sources tried in priority order. A locally exported LaunchBox image folder is opt-in:
 * LaunchBox has no documented public image-download API for independent bulk scrapers.
 */
export async function fetchMissingCovers({refresh=false,quiet=false}={}){
  loadLocalEnv();
  const {covers}=await loadRuntimeConfig();
  if(!covers.enabled){if(!quiet)console.log('🖼️ covers.enabled=false，跳过封面匹配');return {downloaded:0,skipped:0};}
  const games=JSON.parse(await readFile(catalogPath,'utf8'));
  if(!Array.isArray(games))throw Error('games.json 不是数组');
  const candidates=games.filter(g=>!existingCover(g)||(refresh&&g.coverSource?.provider));
  if(!candidates.length){
    await writeReport('unmatched-covers.json',{updatedAt:new Date().toISOString(),summary:{unmatched:0,downloaded:0,reused:0,skipped:games.length},items:[]});
    await writeReport('matched-covers.json',{updatedAt:new Date().toISOString(),items:games.filter(existingCover).map(g=>({platform:g.platform,rom:g.rom,title:g.title,source:g.coverSource?.provider||'manual',matchedTitle:g.coverSource?.matchedTitle||'',score:g.coverSource?.confidence||null,cover:g.cover}))});
    if(!quiet)console.log('🖼️ 所有游戏已有封面，无需联网');return {downloaded:0,reused:0,skipped:games.length};
  }
  const outputDir=path.join(publicRoot,'covers','auto');await mkdir(outputDir,{recursive:true});
  const sources=covers.sources;
  const timeoutMs=covers.timeoutMs,retries=covers.retries;
  const launchboxPath=covers.launchboxLocalDir?.startsWith('~/')?path.join(process.env.HOME||'',covers.launchboxLocalDir.slice(2)):covers.launchboxLocalDir;
  const settings={timeoutMs,retries};
  const indexMap=new Map(),sourceFailures=new Map(),identityResults=new Map(),reuseByBoxart=new Map(),consecutiveFailures=new Map();
  for(const game of games){
    if(!refresh&&game.coverSource?.matchedTitle&&existingCover(game)){
      const key=`${game.platform}/${game.coverSource.provider}/${game.coverSource.matchedTitle}`;
      reuseByBoxart.set(key,{cover:game.cover,coverSource:game.coverSource});
      // Prefer previously vetted identity matches for future versions of the same game.
      const identityKey=game.coverSource.identityQuery&&`${game.platform}/${game.coverSource.identityQuery}`;
      if(identityKey)identityResults.set(identityKey,{cover:game.cover,coverSource:game.coverSource});
    }
  }
  let token=null,clientId=null;
  if(sources.includes('igdb')){
    clientId=process.env.IGDB_CLIENT_ID;const secret=process.env.IGDB_CLIENT_SECRET;
    if(clientId&&secret){try{token=await getIgdbToken(clientId,secret,settings);}catch(e){sourceFailures.set('igdb',reportError(e));}}
    else sourceFailures.set('igdb',{kind:'not-configured',details:'缺少 IGDB_CLIENT_ID / IGDB_CLIENT_SECRET'});
  }
  const missing=[],matched=[];let downloaded=0,reused=0,skipped=0;
  for(const game of games){
    if(existingCover(game)&&!(refresh&&game.coverSource?.provider)){
      skipped++;matched.push({platform:game.platform,rom:game.rom,title:game.title,source:game.coverSource?.provider||'manual',matchedTitle:game.coverSource?.matchedTitle||'',score:game.coverSource?.confidence??null,cover:game.cover});continue;
    }
    const headerTitle=await readMdHeaderTitle(game);
    const {queries,reason,baseName}=buildCoverQueries(game,covers,headerTitle,cleanTitle);
    const override=covers.overrides?.[game.id]||covers.overrides?.[game.rom]||covers.overrides?.[game.sourceName]||{};
    const preferredRegion=['jp','us','any'].includes(override.region)?override.region:covers.region;
    if(!queries.length||!PLATFORM_IDS[game.platform]){skipped++;continue;}
    const identityQuery=queries[0];const identityKey=`${game.platform}/${identityQuery}`;
    const cached=identityResults.get(identityKey);
    if(cached){
      if(cached.cover&&existsSync(path.join(publicRoot,cached.cover))){game.cover=cached.cover;game.coverSource={...cached.coverSource};reused++;matched.push({rom:game.rom,source:'reuse',matchedTitle:cached.coverSource?.matchedTitle});continue;}
      missing.push({platform:game.platform,rom:game.rom,title:game.title,queries,reason:cached.kind,details:cached.details||'',identity:reason});skipped++;continue;
    }
    let result=null,usedSource='',networkError=null;
    for(const source of sources){
      if(sourceFailures.has(source)){
        if(!networkError)networkError=sourceFailures.get(source);
        continue;
      }
      const circuit=sourceFailures.get(`${source}:${game.platform}`);
      if(circuit){networkError=circuit;continue;}
      try{
        if(source==='launchbox-local'){
          if(!launchboxPath)continue;
          result=await findLaunchBoxLocal(path.resolve(launchboxPath),game.platform,queries,covers.minMatchScore);
        }else if(source==='libretro'){
          if(!indexMap.has(game.platform)){
            try{indexMap.set(game.platform,await fetchBoxartIndex(game.platform,{timeoutMs,retries,refresh}));}
            catch(error){sourceFailures.set(`libretro:${game.platform}`,reportError(error));}
          }
          const failure=sourceFailures.get(`libretro:${game.platform}`);
          if(failure){networkError=failure;continue;}
          for(const query of queries){
            const item=selectBoxart(indexMap.get(game.platform),query,{minMatchScore:covers.minMatchScore,region:preferredRegion});
            if(!item)continue;
            const boxartKey=`${game.platform}/libretro/${item.title}`;
            const old=reuseByBoxart.get(boxartKey);
            if(old&&existsSync(path.join(publicRoot,old.cover))){result={reused:true,...old,matchedTitle:item.title,score:item.score,source:'libretro',query};break;}
            const bytes=await downloadBoxart(game.platform,item,{timeoutMs:Math.max(35000,timeoutMs),retries});
            result={bytes,ext:'.png',matchedTitle:item.title,score:item.score,source:'libretro',query};break;
          }
        }else if(source==='igdb'&&token){
          for(const query of queries){result=await lookupIgdb(query,game.platform,clientId,token,covers.minMatchScore,settings);if(result)break;}
        }
        if(result){usedSource=source;consecutiveFailures.delete(`${source}:${game.platform}`);break;}
      }catch(error){
        networkError=reportError(error);
        const failureKey=`${source}:${game.platform}`;
        if(['timeout','network','rate-limit','server-error'].includes(networkError.kind)){
          const hits=(consecutiveFailures.get(failureKey)||0)+1;
          consecutiveFailures.set(failureKey,hits);
          if(hits>=2){
            sourceFailures.set(failureKey,{kind:'source-unavailable',details:`${source} 连续请求失败 ${hits} 次，已暂停本次批量下载（原始错误：${networkError.kind}）`});
          }
        }
        if(!quiet)console.warn(`  ⚠ ${source}/${game.platform}/${game.title}：${networkError.details}（${networkError.kind}）`);
      }
    }
    if(!result){
      const details=networkError?.details||'所有启用的来源均未找到满足阈值的封面';
      const kind=networkError?.kind||'not-found';
      identityResults.set(identityKey,{kind,details});
      missing.push({platform:game.platform,rom:game.rom,title:game.title,queries,reason:kind,details,identity:reason});
      skipped++;
      if(!quiet)console.log(`  未匹配 ${game.platform}/${game.title} → ${identityQuery}（${kind}）`);
      continue;
    }
    if(!result.reused){
      if(!result.bytes||result.bytes.length<100||!mediaType(result.bytes))throw new Error('封面文件格式无效');
      const digest=createHash('sha256').update(result.bytes).digest('hex').slice(0,16);
      const filename=`${game.platform.toLowerCase()}-${digest}${result.ext}`;
      const destination=path.join(outputDir,filename);
      if(!existsSync(destination))await writeFile(destination,result.bytes);
      result.cover=`covers/auto/${filename}`;
      downloaded++;
    }else reused++;
    game.cover=result.cover;
    game.coverSource={provider:result.source,matchedTitle:result.matchedTitle,confidence:Math.round(result.score*1000)/1000,query:result.query,identity:reason,identityQuery};
    identityResults.set(identityKey,{cover:game.cover,coverSource:game.coverSource});
    reuseByBoxart.set(`${game.platform}/${result.source}/${result.matchedTitle}`,{cover:game.cover,coverSource:game.coverSource});
    matched.push({platform:game.platform,rom:game.rom,source:usedSource,title:game.title,matchedTitle:result.matchedTitle,score:result.score,query:result.query});
    if(!quiet)console.log(`  ✓ ${game.platform}/${game.title} → ${result.matchedTitle} [${result.source}]`);
    if(usedSource==='igdb')await pause(350);
  }
  if(downloaded||reused){const tmp=catalogPath+'.tmp';await writeFile(tmp,JSON.stringify(games,null,2)+'\n');await rename(tmp,catalogPath);}
  await writeReport('unmatched-covers.json',{updatedAt:new Date().toISOString(),summary:{unmatched:missing.length,downloaded,reused,skipped},items:missing});
  await writeReport('matched-covers.json',{updatedAt:new Date().toISOString(),items:matched});
  if(!quiet)console.log(`🖼️ 封面更新完成：下载 ${downloaded}、复用 ${reused}、跳过 ${skipped}、仍未匹配 ${missing.length}；来源 ${sources.join(' → ')}`);
  return {downloaded,reused,skipped,unmatched:missing.length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  fetchMissingCovers({refresh:process.argv.includes('--refresh')}).catch(e=>{console.error('封面更新失败：'+e.message);process.exitCode=1;});
}
