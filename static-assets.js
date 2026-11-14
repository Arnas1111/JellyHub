import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {gzip,brotliCompress,constants} from 'node:zlib';
import {promisify} from 'node:util';
const gzipAsync=promisify(gzip),brotliAsync=promisify(brotliCompress);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const csp="default-src 'self'; img-src 'self' data:; media-src 'self' blob:; worker-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
export function createStaticAssets(){
  const cache=new Map();
  return async(req,res,file)=>{
    let stat;try{stat=await fs.stat(file)}catch{return false}if(!stat.isFile())return false;
    let entry=cache.get(file);if(!entry||entry.modified!==stat.mtimeMs||entry.size!==stat.size){
      const promise=fs.readFile(file).then(body=>({body,etag:`W/"${crypto.createHash('sha256').update(body).digest('hex').slice(0,32)}"`,compressed:new Map()}));
      entry={modified:stat.mtimeMs,size:stat.size,promise};if(cache.size>=64)cache.delete(cache.keys().next().value);cache.set(file,entry);
    }
    const asset=await entry.promise,extension=file.slice(file.lastIndexOf('.')),compressible=!!mime[extension]&&asset.body.length>=1024;
    const accepted=new Map(String(req.headers['accept-encoding']||'').toLowerCase().split(',').map(part=>{const [name,...params]=part.trim().split(';'),quality=params.find(value=>value.trim().startsWith('q='));return [name,quality?Number(quality.trim().slice(2)):1]}));
    const encoding=compressible&&(accepted.get('br')>0?'br':accepted.get('gzip')>0?'gzip':null);
    const headers={'Content-Type':mime[extension]||'application/octet-stream','X-Content-Type-Options':'nosniff','Content-Security-Policy':csp,'Cache-Control':'no-cache',ETag:asset.etag,Vary:'Accept-Encoding',...(encoding?{'Content-Encoding':encoding}:{})};
    if(String(req.headers['if-none-match']||'').split(',').map(value=>value.trim()).some(value=>value===asset.etag||value==='*')){res.writeHead(304,headers);res.end();return true}
    let body=asset.body;if(encoding){if(!asset.compressed.has(encoding))asset.compressed.set(encoding,encoding==='br'?brotliAsync(body,{params:{[constants.BROTLI_PARAM_QUALITY]:4}}):gzipAsync(body));body=await asset.compressed.get(encoding)}
    res.writeHead(200,{...headers,'Content-Length':body.length});res.end(req.method==='HEAD'?undefined:body);return true;
  };
}
