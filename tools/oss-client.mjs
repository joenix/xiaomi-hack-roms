import { stat, readFile, writeFile, rm, mkdir, rename } from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {projectRoot} from './rom-config.mjs';
import {loadLocalEnv, loadRuntimeConfig} from './runtime-config.mjs';

export async function createOssClient() {
  loadLocalEnv();
  const {deploy}=await loadRuntimeConfig();
  if(!deploy.bucket || !deploy.baseUrl) throw new Error('请在 roms.config.json 设置 deploy.bucket 和 deploy.baseUrl');
  const accessKeyId=process.env.OSS_ACCESS_KEY_ID || process.env.ALIBABA_CLOUD_ACCESS_KEY_ID;
  const accessKeySecret=process.env.OSS_ACCESS_KEY_SECRET || process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
  if(!accessKeyId||!accessKeySecret)throw new Error('请在本地 .env.local 配置 OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET');
  let OSS;
  try{({default:OSS}=await import('ali-oss'));}catch{throw new Error('缺少 ali-oss，请先执行 pnpm install');}
  const client=new OSS({region:deploy.region,bucket:deploy.bucket,accessKeyId,accessKeySecret,authorizationV4:true,secure:true,timeout:180000});
  return {client,deploy};
}
export async function remoteExists(client,key) {
  try {await client.head(key);return true;}
  catch(err){if(err.status===404||err.statusCode===404||err.code==='NoSuchKey'||err.code==='NotFound')return false;throw err;}
}
export async function uploadFile(client, file, key, {mime, immutable=false, multipartThresholdMB=16}={}) {
  const size=(await stat(file)).size;
  const headers={'Cache-Control':immutable?'public, max-age=31536000, immutable':'no-cache, max-age=0, must-revalidate'};
  if(size>multipartThresholdMB*1024*1024){
    const dir=path.join(projectRoot,'.cache','multipart');
    await mkdir(dir,{recursive:true});
    const checkpointFile=path.join(dir,createHash('sha256').update(key).digest('hex')+'.json');
    let checkpoint;
    try {checkpoint=JSON.parse(await readFile(checkpointFile,'utf8'));} catch {}
    let pending=Promise.resolve();
    const options={parallel:3,partSize:8*1024*1024,mime,headers,
      async progress(_fraction, newCheckpoint){
        if (!newCheckpoint) return;
        checkpoint=newCheckpoint;
        // Serialize checkpoint writes so concurrent parts can't corrupt JSON.
        pending=pending.then(async()=>{
          const tmp=checkpointFile+'.tmp';
          await writeFile(tmp,JSON.stringify(newCheckpoint));
          await rename(tmp,checkpointFile);
        });
        await pending;
      },
    };
    if(checkpoint) options.checkpoint=checkpoint;
    try {
      await client.multipartUpload(key,file,options);
      await pending;
      await rm(checkpointFile,{force:true});
    } catch (error) {
      await pending;
      throw error; // checkpoint stays for next attempt
    }
  } else await client.put(key,file,{mime,headers});
}
export async function uploadJson(client,key,json) {
  const payload=Buffer.from(JSON.stringify(json,null,2)+'\n');
  await client.put(key,payload,{mime:'application/json; charset=utf-8',headers:{'Cache-Control':'no-cache, max-age=0, must-revalidate'}});
}
