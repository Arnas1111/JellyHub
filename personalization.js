import crypto from 'node:crypto';

export const preferenceDefaults={autoPause:false,autoResume:false,autoNext:true,autoSkipIntro:false,autoSkipOutro:false,spoilerGuard:false,qualityTags:true,showStartInfo:true,keyboard:true,subtitleSize:100,subtitleColor:'#ffffff',subtitleBackground:false,subtitlePosition:90,subtitleOutline:true,volume:80,muted:false,rate:1};
const boolKeys=Object.entries(preferenceDefaults).filter(([,value])=>typeof value==='boolean').map(([key])=>key);
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
function parseState(config){try{const value=JSON.parse(config.userState||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}catch{return {}}}
export function createPersonalization({getConfig,saveConfig,jf,json,readBody,cleanId}){
  const profile=userId=>parseState(getConfig())[userId]||{};
  // Older profiles inherited auto-pause without choosing it. Reset that old default once.
  const preferences=userId=>{const {backgroundPlaybackConfigured,...saved}=profile(userId).preferences||{};return {...preferenceDefaults,...saved,autoPause:backgroundPlaybackConfigured===true?saved.autoPause===true:false}};
  const update=(userId,mutate)=>saveConfig(config=>{const state=parseState(config);state[userId]=mutate(state[userId]||{});return {userState:JSON.stringify(state)}});
  return async(req,res,url,user)=>{
    const path=url.pathname;
    if(path==='/api/preferences'){
      if(req.method==='GET'){json(res,200,preferences(user.id));return true}
      if(req.method!=='PUT')fail(405,'Method not allowed');
      const input=await readBody(req),patch={};
      for(const [key,value]of Object.entries(input)){
        if(boolKeys.includes(key)&&typeof value==='boolean')patch[key]=value;
        else if(key==='subtitleColor'&&/^#[0-9a-f]{6}$/i.test(value))patch[key]=value;
        else if(['subtitleSize','subtitlePosition','volume','rate'].includes(key)&&typeof value==='number'&&Number.isFinite(value)){
          const range={subtitleSize:[50,200],subtitlePosition:[10,100],volume:[0,100],rate:[.25,3]}[key];if(value<range[0]||value>range[1])fail(400,'Invalid preference: '+key);patch[key]=value;
        }else fail(400,'Invalid preference: '+key);
      }
      await update(user.id,state=>({...state,preferences:{...state.preferences,...patch,...(Object.hasOwn(patch,'autoPause')?{backgroundPlaybackConfigured:true}:{})}}));json(res,200,preferences(user.id));return true;
    }
    if(path==='/api/bookmarks'){
      if(req.method==='GET'){
        const itemId=url.searchParams.get('itemId');if(itemId)cleanId(itemId);
        const saved=(profile(user.id).bookmarks||[]).filter(item=>!itemId||item.itemId===itemId);
        const ids=[...new Set(saved.map(item=>item.itemId))],allowed=new Set();
        await Promise.all(Array.from({length:Math.ceil(ids.length/100)},(_,index)=>ids.slice(index*100,index*100+100)).map(async chunk=>{
          const q=new URLSearchParams({Ids:chunk.join(','),Limit:'100',Recursive:'true'});const items=await jf(`Users/${user.id}/Items?${q}`,user);for(const item of items.Items||[])allowed.add(item.Id);
        }));
        json(res,200,{items:saved.filter(item=>allowed.has(item.itemId))});return true;
      }
      if(req.method!=='POST')fail(405,'Method not allowed');
      const input=await readBody(req),id=cleanId(input.itemId);
      if(!Number.isSafeInteger(input.positionTicks)||input.positionTicks<0||typeof input.label!=='string'||input.label.length>150)fail(400,'Invalid bookmark');
      const item=await jf(`Users/${user.id}/Items/${id}`,user);
      if(item.RunTimeTicks&&input.positionTicks>item.RunTimeTicks)fail(400,'Bookmark is beyond the end of this title');
      const bookmark={id:crypto.randomUUID(),itemId:id,name:item.Name,series:item.SeriesName||'',positionTicks:input.positionTicks,label:input.label.trim(),created:new Date().toISOString()};
      await update(user.id,state=>{const bookmarks=state.bookmarks||[];if(bookmarks.length>=500)fail(400,'Remove an older bookmark before adding more.');return {...state,bookmarks:[bookmark,...bookmarks]}});
      json(res,201,bookmark);return true;
    }
    const bookmark=path.match(/^\/api\/bookmarks\/([a-f0-9-]{36})$/);
    if(bookmark&&req.method==='DELETE'){await update(user.id,state=>({...state,bookmarks:(state.bookmarks||[]).filter(item=>item.id!==bookmark[1])}));json(res,200,{ok:true});return true}
    if(bookmark&&req.method==='PUT'){
      const input=await readBody(req);if(typeof input.label!=='string'||input.label.length>150)fail(400,'Bookmark label must be at most 150 characters');
      await update(user.id,state=>{if(!(state.bookmarks||[]).some(item=>item.id===bookmark[1]))fail(404,'Bookmark not found');return {...state,bookmarks:state.bookmarks.map(item=>item.id===bookmark[1]?{...item,label:input.label.trim()}:item)}});json(res,200,{ok:true});return true;
    }
    return false;
  };
}
