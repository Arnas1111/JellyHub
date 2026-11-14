import {createStaticAssets} from './static-assets.js';
import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createLogger, logLevels, requestContext, upstreamFailure } from './diagnostics.js';
import { brandingDefaults, createFeatures } from './features.js';
import { createMedia } from './media.js';
import { createPlayback } from './playback.js';
import { createPersonalization } from './personalization.js';
import { createCore, libraryItem, visibleItems } from './core.js';
import { createPlugins } from './plugins.js';
import { createExtensions } from './extensions.js';

const port = Number(process.env.PORT || 3000);
// Runtime settings: service addresses default to the user's existing Docker names.
// Only container plumbing (PORT, CONFIG_DIR and optional COOKIE_SECURE) needs env vars.
const configDir=process.env.CONFIG_DIR || '/config';
const configFile=path.join(configDir,'settings.json');
const defaults={
  ...brandingDefaults,
  userState:'{}',navigation:'[]',
  jellyfinUrl:process.env.JELLYFIN_URL||'http://jellyfin:8096',
  seerrUrl:process.env.SEERR_URL||'http://Seerr:5055',
  sonarrUrl:process.env.SONARR_URL||'http://sonarr:8989',
  radarrUrl:process.env.RADARR_URL||'http://radarr:7878',
  jellystatUrl:process.env.JELLYSTAT_URL||'http://jellystat:3000',
  maintainerrUrl:process.env.MAINTAINERR_URL||'http://Maintainerr:6246',
  seerrKey:process.env.SEERR_API_KEY||'',
  sonarrKey:process.env.SONARR_API_KEY||'',
  radarrKey:process.env.RADARR_API_KEY||'',
  logLevel:logLevels.includes(process.env.LOG_LEVEL)?process.env.LOG_LEVEL:'info'
};
let config={...defaults};
try{
  const saved=JSON.parse(fsSync.readFileSync(configFile,'utf8'));
  if(saved&&typeof saved==='object'&&!Array.isArray(saved))config={...config,...Object.fromEntries(Object.entries(saved).filter(([k,v])=>Object.hasOwn(defaults,k)&&typeof v==='string'))};
}catch(e){if(e.code!=='ENOENT')throw new Error(`Cannot load JellyHub settings (${e.code||e.name}). Check settings.json syntax and CONFIG_DIR read permissions.`)}
if(!logLevels.includes(config.logLevel))config.logLevel=defaults.logLevel;
const logger=createLogger(config.logLevel);
const integrations={
  seerr:{url:config.seerrUrl,key:config.seerrKey},
  sonarr:{url:config.sonarrUrl,key:config.sonarrKey,prefix:'/api/v3'},
  radarr:{url:config.radarrUrl,key:config.radarrKey,prefix:'/api/v3'},
  jellystat:{url:config.jellystatUrl},
  maintainerr:{url:config.maintainerrUrl}
};
function refreshIntegrations(){
  for(const name of ['seerr','sonarr','radarr','jellystat','maintainerr']){
    integrations[name].url=config[name+'Url'];
    if(Object.hasOwn(config,name+'Key'))integrations[name].key=config[name+'Key'];
  }
  maintainerrCache.value=null;maintainerrCache.expires=0;
}
const jellyfin=()=>config.jellyfinUrl.replace(/\/$/,'');
const settingUrls=['jellyfinUrl','seerrUrl','sonarrUrl','radarrUrl','jellystatUrl','maintainerrUrl'];
const settingKeys=['seerrKey','sonarrKey','radarrKey'];
function validServiceUrl(value){
  if(typeof value!=='string'||value.length>256)return false;
  try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.search&&!u.hash }catch{return false}
}
function storageFailure(error){
  const identity=`UID ${process.getuid?.()??'unknown'} / GID ${process.getgid?.()??'unknown'}`;
  return Object.assign(new Error(`Cannot save settings in ${configDir} (${error.code||'IO_ERROR'}). JellyHub runs as ${identity}. Mount JellyHub appdata read/write and allow this user to write to it. Restart the updated JellyHub image to initialize permissions; custom --user deployments must prepare directory ownership themselves. No settings were saved.`),{status:503,code:'CONFIG_NOT_WRITABLE'});
}
async function storageStatus(){
  const probe=path.join(configDir,`.write-check-${crypto.randomBytes(6).toString('hex')}`);
  try{await fs.mkdir(configDir,{recursive:true});await fs.writeFile(probe,'',{mode:0o600,flag:'wx'});await fs.rm(probe);return {writable:true}}
  catch(error){await fs.rm(probe,{force:true}).catch(()=>{});return {writable:false,code:error.code,message:storageFailure(error).message}}
}
let configSaveQueue=Promise.resolve();
async function saveConfig(patch){
  const previous=configSaveQueue;let release;configSaveQueue=new Promise(resolve=>release=resolve);
  await previous;
  try{
  const next={...config,...(typeof patch==='function'?patch(config):patch)};
  const tmp=path.join(configDir,`.settings-${crypto.randomBytes(6).toString('hex')}.tmp`);
  try{await fs.mkdir(configDir,{recursive:true});await fs.writeFile(tmp,JSON.stringify(next,null,2)+'\n',{mode:0o600,flag:'wx'});await fs.rename(tmp,configFile)}catch(e){await fs.rm(tmp,{force:true}).catch(()=>{});logger.log('error','settings.save_failed',{code:e.code,configDir});throw storageFailure(e)}
  config=next;refreshIntegrations();
  logger.setLevel(next.logLevel);logger.log('info','settings.saved');
  }finally{release()}
}
// Read-only Maintainerr adapter; never expose Maintainerr API directly to browsers.
// Its documented API has no native authentication. Cached results reduce load.
const maintainerrCache={value:null,expires:0,inFlight:null};
const DELETING_ACTIONS=new Set([0,1,2,5]);
async function maintainerrIndex(){
  if(!integrations.maintainerr.url)return {configured:false,byId:{},entries:[]};
  if(maintainerrCache.value&&Date.now()<maintainerrCache.expires)return maintainerrCache.value;
  if(maintainerrCache.inFlight)return maintainerrCache.inFlight;
  maintainerrCache.inFlight=(async()=>{
    const collections=await upstream(integrations.maintainerr.url,'api/collections/overlay-data',{timeout:12000});
    if(!Array.isArray(collections))throw new Error('Unexpected Maintainerr collections response');
    const byId={}; const entries=[];
    for(const c of collections){
      if(c.isActive===false||!DELETING_ACTIONS.has(Number(c.arrAction)))continue;
      // Maintainerr uses null as "due now" in its handler but no countdown in the UI.
      // Avoid false dates for collections without a configured delay.
      if(c.deleteAfterDays===null||c.deleteAfterDays===undefined||!Number.isFinite(Number(c.deleteAfterDays))||Number(c.deleteAfterDays)<0)continue;
      for(const media of (Array.isArray(c.media)?c.media:[])){
        if(!media?.mediaServerId||!media?.addDate)continue;
        const added=new Date(media.addDate).getTime();
        if(!Number.isFinite(added))continue;
        const at=new Date(added+Number(c.deleteAfterDays)*86400000);
        const entry={itemId:String(media.mediaServerId),collectionId:c.id,collection:c.title||'Maintainerr',deletionDate:at.toISOString(),action:Number(c.arrAction)};
        entries.push(entry);
        const old=byId[entry.itemId];
        if(!old||entry.deletionDate<old.deletionDate)byId[entry.itemId]=entry;
      }
    }
    return {configured:true,byId,entries,updatedAt:new Date().toISOString()};
  })();
  try{const result=await maintainerrCache.inFlight;maintainerrCache.value=result;maintainerrCache.expires=Date.now()+60000;return result}
  finally{maintainerrCache.inFlight=null}
}
const sessions = new Map(); // V0.1 single-instance memory; restart clears sessions
const attempts = new Map();
const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
const staticAssets=createStaticAssets();
const MAX_BODY=8192;
const json = (res,status,data,headers={}) => send(res,status,JSON.stringify(data),{'Content-Type':'application/json; charset=utf-8',...headers});
function send(res,status,body,headers={}) { res.writeHead(status,{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',...headers});res.end(body); }
function parseCookies(req) { return Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split('=').slice(0,2)).filter(x=>x.length===2)); }
function authHeader(session,deviceId) { return `MediaBrowser Client="JellyHub", Device="Web", DeviceId="${deviceId}", Version="0.1.0"${session?.token ? `, Token="${session.token}"` : ''}`; }
async function upstream(base, route, {headers={},method='GET',body,timeout=8000,expectJson=true}={}) {
  if (!base) throw new Error('Service not configured');
  const controller = new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);
  const target=new URL(route,base.endsWith('/')?base:base+'/');
  const endpoint=target.origin+target.pathname;
  const started=Date.now();
  const keyConfigured=!!headers['X-Api-Key'];
  let status;
  try {
    const response=await fetch(target,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal,redirect:'manual'});
    status=response.status;
    if(!response.ok)throw Object.assign(new Error('HTTP failure'),{code:'HTTP_ERROR'});
    const raw=await response.text();let data=null;
    if(raw&&expectJson){try{data=JSON.parse(raw)}catch{throw Object.assign(new Error('Invalid JSON response'),{code:'INVALID_RESPONSE'})}}
    logger.log('debug','upstream.completed',{endpoint,method,httpStatus:status,durationMs:Date.now()-started,keyConfigured});
    return data;
  } catch(error){
    const code=controller.signal.aborted?'TIMEOUT':error.code||error.cause?.code||'NETWORK_ERROR';
    const diagnostics=upstreamFailure({endpoint,method,status,code,durationMs:Date.now()-started,keyConfigured,requestId:requestContext.getStore()?.requestId});
    logger.log('warn','upstream.failed',diagnostics);
    throw Object.assign(new Error(diagnostics.message),{status:status>=400?status:502,code,diagnostics});
  } finally {clearTimeout(timer)}
}
const jf=(route,s,opts={})=>upstream(jellyfin(),route,{...opts,headers:{'Authorization':authHeader(s,s.deviceId),...(opts.body?{'Content-Type':'application/json'}:{}),...opts.headers}});
async function readBody(req,limit=MAX_BODY){let raw='';for await(const part of req){raw+=part;if(Buffer.byteLength(raw)>limit)throw Object.assign(new Error('Request too large'),{status:413})}let data;try{data=JSON.parse(raw||'{}')}catch{throw Object.assign(new Error('Invalid JSON'),{status:400})}if(!data||typeof data!=='object'||Array.isArray(data))throw Object.assign(new Error('JSON body must be an object'),{status:400});return data}
function cleanId(x){if(!/^[a-zA-Z0-9-]{1,80}$/.test(x||''))throw Object.assign(new Error('Invalid item id'),{status:400});return x}
function adminOnly(s){if(!s.admin)throw Object.assign(new Error('Administrator required'),{status:403})}
const featureAPI=createFeatures({getConfig:()=>config,saveConfig,jf,upstream,json,readBody,cleanId,send});
const mediaAPI=createMedia({jf,jellyfin,authHeader,json,cleanId,send,getConfig:()=>config});
const playbackAPI=createPlayback({jf,jellyfin,authHeader,json,readBody,cleanId,send,logger});
const personalizationAPI=createPersonalization({getConfig:()=>config,saveConfig,jf,json,readBody,cleanId});
const coreAPI=createCore({jf,json,readBody,cleanId,getConfig:()=>config,saveConfig});
const pluginAPI=createPlugins({jf,json,readBody,cleanId});
const extensionAPI=createExtensions({getConfig:()=>config,saveConfig,readBody,json});
const api = async(req,res,url)=>{
  const method=req.method;
  if(method!=='GET'){
    const origin=req.headers.origin;
    if(origin && origin!==`http://${req.headers.host}` && origin!==`https://${req.headers.host}`) return json(res,403,{error:'Origin rejected'});
  }
  if(await featureAPI(req,res,url,null))return;
  if(url.pathname==='/api/login' && method==='POST'){
    const ip=req.socket.remoteAddress||'unknown';const entry=attempts.get(ip)||{n:0,until:0};
    if(entry.n>=8&&Date.now()<entry.until)return json(res,429,{error:'Too many login attempts'});
    const {username,password}=await readBody(req);
    if(typeof username!=='string'||typeof password!=='string'||!username||username.length>128||password.length>1024)return json(res,400,{error:'Invalid credentials'});
    const deviceId=crypto.randomUUID();
    try {
      const result=await upstream(jellyfin(),'Users/AuthenticateByName',{method:'POST',body:{Username:username,Pw:password},headers:{'Authorization':authHeader(null,deviceId),'Content-Type':'application/json'}});
      if(!result.AccessToken||!result.User?.Id) throw new Error('Invalid login response');
      const sid=crypto.randomBytes(32).toString('hex');
      const session={token:result.AccessToken,deviceId,id:result.User.Id,admin:!!result.User.Policy?.IsAdministrator,name:result.User.Name,created:Date.now()};
      sessions.set(sid,session);attempts.delete(ip);
      return json(res,200,{user:{id:session.id,name:session.name,admin:session.admin}},{'Set-Cookie':`jh_sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${process.env.COOKIE_SECURE==='1'?'; Secure':''}`});
    }catch(e){attempts.set(ip,{n:entry.n+1,until:Date.now()+15*60_000});return json(res,401,{error:'Invalid login or Jellyfin unavailable'});}
  }
  const sid=parseCookies(req).jh_sid;const s=sessions.get(sid);
  if(!s||Date.now()-s.created>86400000){sessions.delete(sid);return json(res,401,{error:'Not authenticated'})}
  if(url.pathname.startsWith('/api/admin/')){
    const verified=await jf('Users/Me',s);
    s.admin=!!verified.Policy?.IsAdministrator;
    adminOnly(s);
  }
  if(await featureAPI(req,res,url,s))return;
  if(await mediaAPI(req,res,url,s))return;
  if(await playbackAPI(req,res,url,s))return;
  if(await personalizationAPI(req,res,url,s))return;
  if(await coreAPI(req,res,url,s))return;
  if(await pluginAPI(req,res,url,s))return;
  if(await extensionAPI(req,res,url,s))return;
  if(url.pathname==='/api/logout' && method==='POST'){
    sessions.delete(sid);
    jf('Sessions/Logout',s,{method:'POST'}).catch(()=>{});
    return json(res,200,{ok:true},{'Set-Cookie':'jh_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});
  }
  if(url.pathname==='/api/me') {
    const me=await jf('Users/Me',s);
    s.admin=!!me.Policy?.IsAdministrator; s.name=me.Name;
    return json(res,200,{id:me.Id,name:me.Name,admin:s.admin});
  }
  if(url.pathname==='/api/admin/logging'&&method==='PUT'){
    const {level}=await readBody(req);
    if(!logLevels.includes(level))return json(res,400,{error:'Invalid log level'});
    logger.setLevel(level);
    try{await saveConfig({logLevel:level});return json(res,200,{level,persisted:true})}
    catch(error){return json(res,200,{level,persisted:false,message:`Log level applied for this process only. ${error.message}`})}
  }
  if(url.pathname.startsWith('/api/admin/settings')){
    adminOnly(s);
    if(url.pathname==='/api/admin/settings'&&method==='GET'){
      return json(res,200,{urls:Object.fromEntries(settingUrls.map(k=>[k,config[k]])),keys:Object.fromEntries(settingKeys.map(k=>[k,!!config[k]])),logging:{level:logger.level,levels:logLevels},storage:await storageStatus()});
    }
    if(url.pathname==='/api/admin/settings'&&method==='PUT'){
      const incoming=await readBody(req);
      if(!incoming||typeof incoming!=='object'||Array.isArray(incoming)||!incoming.urls||!incoming.keys)return json(res,400,{error:'Invalid settings payload'});
      const next={logLevel:logger.level};
      for(const k of settingUrls){
        if(!Object.hasOwn(incoming.urls,k))continue;
        const v=incoming.urls[k];
        if(!validServiceUrl(v))return json(res,400,{error:`Invalid service address: ${k}`});
        next[k]=v.replace(/\/$/,'');
      }
      // Empty key preserves saved value; clearKeys intentionally removes it.
      for(const k of settingKeys){
        if(Object.hasOwn(incoming.keys,k)){
          if(typeof incoming.keys[k]!=='string'||incoming.keys[k].length>512)return json(res,400,{error:`Invalid key: ${k}`});
          if(incoming.keys[k].trim())next[k]=incoming.keys[k].trim();
        }
      }
      if(Array.isArray(incoming.clearKeys))for(const k of incoming.clearKeys){if(!settingKeys.includes(k))return json(res,400,{error:'Invalid clear key'});next[k]=''}
      await saveConfig(next);
      return json(res,200,{ok:true,urls:Object.fromEntries(settingUrls.map(k=>[k,config[k]])),keys:Object.fromEntries(settingKeys.map(k=>[k,!!config[k]]))});
    }
    if(url.pathname==='/api/admin/settings/test'&&method==='POST'){
      const input=await readBody(req);const {service}=input;
      const spec={jellyfin:['jellyfinUrl','System/Info/Public',null],seerr:['seerrUrl','api/v1/status',null],sonarr:['sonarrUrl','api/v3/system/status','sonarrKey'],radarr:['radarrUrl','api/v3/system/status','radarrKey'],jellystat:['jellystatUrl','',null],maintainerr:['maintainerrUrl','api/collections/overlay-data',null]}[service];
      if(!spec)return json(res,400,{error:'Unknown service'});
      if(input.url!==undefined&&!validServiceUrl(input.url))return json(res,400,{error:'Invalid service URL'});
      if(input.apiKey!==undefined&&(typeof input.apiKey!=='string'||input.apiKey.length>512))return json(res,400,{error:'Invalid API key'});
      const base=input.url??config[spec[0]];
      const key=input.clearKey?'':input.apiKey?.trim()||config[spec[2]]||'';
      const started=Date.now();
      const endpoint=new URL(spec[1],base.endsWith('/')?base:base+'/');
      if(spec[2]&&!key){
        const diagnostics=upstreamFailure({endpoint:endpoint.origin+endpoint.pathname,method:'GET',code:'MISSING_API_KEY',keyConfigured:false,durationMs:0,requestId:requestContext.getStore()?.requestId});
        logger.log('warn','connection.test_failed',{service,...diagnostics});
        return json(res,200,{status:'error',message:diagnostics.message,diagnostics});
      }
      try{
        await upstream(base,spec[1],{headers:spec[2]?{'X-Api-Key':key}:{},timeout:5000,expectJson:service!=='jellystat'});
        return json(res,200,{status:'connected',message:'Connection succeeded using the current form. Changes are saved only with Save settings.',diagnostics:{endpoint:endpoint.origin+endpoint.pathname,httpStatus:200,keyConfigured:!!key,durationMs:Date.now()-started,requestId:requestContext.getStore()?.requestId}});
      }catch(e){return json(res,200,{status:'error',message:e.message,diagnostics:e.diagnostics})}
    }
    return json(res,405,{error:'Method not allowed'});
  }
  if(url.pathname==='/api/removals'){
    // Logged-in library users can see scheduled removals. Actual library item
    // permissions remain enforced by the Jellyfin item endpoints.
    const index=await maintainerrIndex();
    const ids=[...new Set((url.searchParams.get('ids')||'').split(',').filter(Boolean))].slice(0,100);
    if(!ids.length)return json(res,200,{configured:index.configured,byId:{},updatedAt:index.updatedAt||null});
    for(const id of ids)cleanId(id);
    // Never expose collection membership for items the user cannot access.
    const matched=ids.filter(id=>index.byId[id]);
    const allowed=await Promise.all(matched.map(async id=>{
      try{const item=await jf(`Users/${s.id}/Items/${id}`,s);return item?.Id===id?id:null}
      catch{return null}
    }));
    const byId=Object.fromEntries(allowed.filter(Boolean).map(id=>[id,index.byId[id]]));
    return json(res,200,{configured:index.configured,byId,updatedAt:index.updatedAt||null});
  }
  if(url.pathname==='/api/admin/removals'){
    adminOnly(s);
    const index=await maintainerrIndex();
    return json(res,200,{configured:index.configured,entries:index.entries,updatedAt:index.updatedAt||null});
  }
  if(url.pathname==='/api/home'){
    const q=new URLSearchParams({Recursive:'true',IncludeItemTypes:'Movie,Series',SortBy:'DateCreated',SortOrder:'Descending',Limit:'32',Fields:'PrimaryImageAspectRatio,Overview,Genres,ProductionYear,CommunityRating,MediaSources',EnableUserData:'true'});
    const [recent,resume]=await Promise.allSettled([jf(`Users/${s.id}/Items?${q}`,s),jf(`Users/${s.id}/Items/Resume?Limit=18&MediaTypes=Video`,s)]);
    return json(res,200,{recent:recent.status==='fulfilled'?visibleItems(recent.value.Items||[],config,s.id).map(libraryItem):[],resume:resume.status==='fulfilled'?visibleItems(resume.value.Items||[],config,s.id).map(libraryItem):[],errors:[recent,resume].filter(x=>x.status==='rejected').map(x=>x.reason.message)});
  }
  if(url.pathname==='/api/items'){
    const q=new URLSearchParams({Recursive:'true',Limit:'60',Fields:'Overview,Genres,ProductionYear,CommunityRating',EnableUserData:'true',SortBy:'SortName'});
    const type=url.searchParams.get('type');if(['Movie','Series','Audio','MusicAlbum'].includes(type))q.set('IncludeItemTypes',type);
    const search=url.searchParams.get('q');if(search)q.set('SearchTerm',search.slice(0,120));
    const parent=url.searchParams.get('parent');if(parent)q.set('ParentId',cleanId(parent));
    return json(res,200,await jf(`Users/${s.id}/Items?${q}`,s));
  }
  if(url.pathname==='/api/views')return json(res,200,await jf(`Users/${s.id}/Views`,s));
  const item=url.pathname.match(/^\/api\/item\/([^/]+)$/);
  if(item)return json(res,200,await jf(`Users/${s.id}/Items/${cleanId(item[1])}`,s));
  const image=url.pathname.match(/^\/api\/image\/([^/]+)$/);
  if(image){
    const id=cleanId(image[1]);
    await jf(`Users/${s.id}/Items/${id}`,s);
    const imageUrl=new URL(`Items/${id}/Images/Primary?maxWidth=420&quality=80`,jellyfin()+'/');
    const r=await fetch(imageUrl,{headers:{Authorization:authHeader(s,s.deviceId)},signal:AbortSignal.timeout(6000)});
    if(!r.ok)return send(res,404,'Image unavailable');
    const buf=Buffer.from(await r.arrayBuffer());res.writeHead(200,{'Content-Type':r.headers.get('content-type')||'image/jpeg','Cache-Control':'private, no-cache','Vary':'Cookie','X-Content-Type-Options':'nosniff'});return res.end(buf);
  }
  if(url.pathname==='/api/admin/overview'){
    adminOnly(s);
    const services=Object.entries(integrations).map(([name,c])=>({name,configured:!!c.url,...(name==='jellystat'?{status:'adapter pending'}:{})}));
    const specs=[
      ['seerr', 'api/v1/request?take=20&skip=0&sort=added',{'X-Api-Key':integrations.seerr.key}],
      ['sonarr', `${(integrations.sonarr.prefix||'').replace(/^\//,'')}/queue?page=1&pageSize=20`,{'X-Api-Key':integrations.sonarr.key}],
      ['radarr', `${(integrations.radarr.prefix||'').replace(/^\//,'')}/queue?page=1&pageSize=20`,{'X-Api-Key':integrations.radarr.key}]
    ];
    const selectedService=url.searchParams.get('service');
    if(selectedService&&!specs.some(([name])=>name===selectedService))return json(res,400,{error:'Unknown integration'});
    const values=await Promise.all(specs.filter(([name])=>!selectedService||selectedService===name).map(async([name,route,headers])=>{
      const c=integrations[name];if(!c.url||!c.key)return {name,status:'not configured'};
      try {const data=await upstream(c.url,route,{headers});return {name,status:'connected',data:name==='seerr'?{requests:(data.results||[]).slice(0,12),total:data.pageInfo?.results??0}:{records:(data.records||[]).slice(0,12),total:data.totalRecords??0}}}catch(e){return {name,status:'error',message:e.message}}
    }));
    return json(res,200,{services,integrations:values});
  }
  return json(res,404,{error:'Unknown endpoint'});
};

const startupStorage=await storageStatus();
function urlRoute(value){return String(value||'').split('?')[0].replace(/(\/api\/playback\/)[a-f0-9]{48}/g,'$1[session]')}
if(!startupStorage.writable)logger.log('warn','config.not_writable',{code:startupStorage.code,configDir,message:startupStorage.message});
const server=http.createServer(async(req,res)=>requestContext.run({requestId:crypto.randomUUID()},async()=>{
  const requestId=requestContext.getStore().requestId;
  res.setHeader('X-Request-Id',requestId);
  const started=Date.now();
  res.on('finish',()=>logger.log('debug','request.completed',{method:req.method,path:urlRoute(req.url),status:res.statusCode,durationMs:Date.now()-started}));
  try {
    const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
    if(['/favicon.ico','/favicon.png','/favicon.svg','/branding-logo'].includes(url.pathname)&&await featureAPI(req,res,url,null))return;
    if(url.pathname==='/healthz' && ['GET','HEAD'].includes(req.method))return json(res,200,{status:'ok'});
    if(url.pathname.startsWith('/api/'))return await api(req,res,url);
    if(req.method!=='GET'&&req.method!=='HEAD')return send(res,405,'Method not allowed');
    const name=url.pathname==='/'?'index.html':url.pathname.replace(/^\//,'');
    const file=path.resolve(publicDir,name);
    if(!file.startsWith(publicDir))return send(res,403,'Forbidden');
    if(!await staticAssets(req,res,file))return send(res,404,'Not found');
  }catch(e){logger.log('error','request.failed',{code:e.code||'REQUEST_FAILED',status:e.status||502,...(e.publicMessage?{message:e.publicMessage}:{}),...(e.reason?{reason:e.reason}:{}),method:req.method,route:urlRoute(req.url)});if(res.headersSent){res.destroy();return}json(res,e.status||502,{error:e.message||'Request failed',code:e.code||'REQUEST_FAILED',requestId});}
}));
server.on('error',error=>{console.error(`JellyHub startup failed: ${error.message}`);process.exit(1)});
server.listen(port,'0.0.0.0',()=>console.log(`JellyHub running on :${server.address().port}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.close(()=>process.exit(0));server.closeIdleConnections();setTimeout(()=>process.exit(1),10000).unref()});
