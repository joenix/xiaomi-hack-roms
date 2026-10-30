/** Optional locally-owned/exported LaunchBox 'Box - Front' images. No unofficial LaunchBox scraping. */
import {readdir,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {mediaType} from './cover-network.mjs';
function nameScore(a,b){
  const norm=s=>String(s).normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  a=norm(a);b=norm(b);if(!a||!b)return 0;
  if(a===b)return 1;
  if(a.length<4||b.length<4)return 0;
  const bigrams=s=>new Set([...s].slice(0,-1).map((_,i)=>s[i]+s[i+1]));
  const x=bigrams(a),y=bigrams(b);let n=0;for(const v of x)if(y.has(v))n++;
  return (2*n/(x.size+y.size))*(Math.min(a.length,b.length)/Math.max(a.length,b.length));
}
const dirs={FC:['Nintendo Entertainment System','Nintendo - Nintendo Entertainment System','FC'],MD:['Sega Genesis','Sega Mega Drive','Sega - Mega Drive - Genesis','MD'],SFC:['Super Nintendo Entertainment System','Nintendo - Super Nintendo Entertainment System','SFC'],GBA:['Nintendo Game Boy Advance','Nintendo - Game Boy Advance','GBA'],PSP:['Sony PSP','Sony PlayStation Portable','Sony - PlayStation Portable','PSP']};
const endings=/\s*(?:[-_](?:\d{1,3}|front|box|cover|box-front))+(?=\.(?:png|jpg|jpeg|webp)$)/ig;
function normalizeFile(s){return s.replace(/\.(png|jpe?g|webp)$/i,'').replace(/\s*\([^)]*\)/g,'').replace(endings,'').replace(/[-_]\d{1,3}$/,'').trim();}
async function listImages(root,depth=0){
  if(depth>3)return [];
  const out=[];let entries;
  try{entries=await readdir(root,{withFileTypes:true});}catch{return []}
  for(const entry of entries){
    const file=path.join(root,entry.name);
    if(entry.isSymbolicLink())continue;
    if(entry.isDirectory()){out.push(...await listImages(file,depth+1));continue;}
    if(entry.isFile()&&/\.(png|jpe?g|webp)$/i.test(entry.name))out.push(file);
  }return out;
}
function seriesNumber(value){
  const match=String(value).match(/(?:^|[\s:,_-])(?:([0-9]{1,2})|(VIII|VII|VI|IV|III|II|IX|V|I|X))(?=$|[\s:,_-])/i);
  const romans={I:1,II:2,III:3,IV:4,V:5,VI:6,VII:7,VIII:8,IX:9,X:10};
  return match ? Number(match[1])||romans[match[2]?.toUpperCase()] : null;
}
function compatibleTitle(a,b){const x=seriesNumber(a),y=seriesNumber(b);return x===y;}
export function chooseLocalCover(files,query,minScore=0.91){
  const ranked=files.filter(file=>compatibleTitle(query,normalizeFile(path.basename(file)))).map(file=>({file,score:nameScore(query,normalizeFile(path.basename(file)))}))
    .filter(row=>row.score>=minScore).sort((a,b)=>b.score-a.score);
  if(!ranked.length)return null;
  // Avoid guessing which game when similarly named files exist.
  if(ranked.length>1&&ranked[0].score<0.99&&ranked[0].score-ranked[1].score<0.06)return null;
  return ranked[0];
}
export async function findLaunchBoxLocal(installPath,platform,queries,minScore=0.9){
  if(!installPath)return null;
  const roots=(dirs[platform]||[platform]).map(d=>path.join(installPath,'Images',d,'Box - Front'));
  roots.push(path.join(installPath,platform),path.join(installPath,'Box - Front',platform));
  for(const root of roots){
    const files=await listImages(root);
    for(const query of queries){
      const found=chooseLocalCover(files,query,minScore);
      if(!found)continue;
      const s=await stat(found.file);if(s.size>12*1024*1024||s.size<100)continue;
      const bytes=await readFile(found.file);
      const ext=mediaType(bytes);if(!ext)continue;
      return {bytes,ext,matchedTitle:normalizeFile(path.basename(found.file)),score:found.score,source:'launchbox-local',query};
    }
  }
  return null;
}
