import crypto from 'node:crypto';
import {profileName,profileOf,featurePermissions} from './profiles.js';
const ACTIVE=120000,RECENT=300000;
const normalized=id=>String(id||'').replaceAll('-','').toLowerCase();
const validId=id=>typeof id==='string'&&/^[\w-]{1,128}$/.test(id);
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
export function recentPeople(sessions,now=Date.now()){
  const people=new Map();
  for(const session of sessions){
    if(!validId(session.UserId))continue;const key=normalized(session.UserId),activity=Math.max(Date.parse(session.LastActivityDate)||0,Date.parse(session.LastPlaybackCheckIn)||0);
    if(!activity||activity>now+60000||now-activity>RECENT)continue;
    const old=people.get(key)||{userId:session.UserId,name:String(session.UserName||'Member').slice(0,60),lastSeen:0,playing:null,imageTag:null};
    if(activity>=old.lastSeen){old.name=String(session.UserName||old.name).slice(0,60);old.lastSeen=activity}if(session.UserPrimaryImageTag)old.imageTag=session.UserPrimaryImageTag;
    if(validId(session.NowPlayingItem?.Id)){
      const rank=session.PlayState?.IsPaused?1:2;
      if(!old.playing||rank>old.playing.rank||rank===old.playing.rank&&activity>old.playing.at)old.playing={rank,at:activity,item:session.NowPlayingItem,paused:session.PlayState?.IsPaused===true};
    }
    people.set(key,old);
  }
  return [...people.values()].map(person=>({...person,state:person.playing?(person.playing.paused?'paused':'watching'):now-person.lastSeen>ACTIVE?'away':'online'}));
}
export function createPresence({getConfig,getHubSessions,jf,jellyfin,upstream,authHeader,json,send,now=Date.now}){
  const salt=crypto.randomBytes(32),nativeCache=new Map(),directoryCache=new Map(),avatars=new Map(),members=new Map();
  async function nativeSessions(viewer){
    const config=getConfig(),key=crypto.createHash('sha256').update(config.jellyfinUrl+':'+(config.registrationServiceKey||viewer.id+':'+viewer.admin)).digest('hex'),cached=nativeCache.get(key);if(cached&&cached.expires>now())return cached.work;
    const actor=config.registrationServiceKey?{token:config.registrationServiceKey,deviceId:'JellyHub-presence'}:null;
    const work=(actor?upstream(jellyfin(),'Sessions',{headers:{Authorization:authHeader(actor,actor.deviceId)}}):jf('Sessions',viewer)).then(data=>({sessions:(Array.isArray(data)?data:[]).slice(0,1000).map(session=>({UserId:session.UserId,UserName:session.UserName,LastActivityDate:session.LastActivityDate,LastPlaybackCheckIn:session.LastPlaybackCheckIn,UserPrimaryImageTag:session.UserPrimaryImageTag,NowPlayingItem:session.NowPlayingItem?{Id:session.NowPlayingItem.Id,Name:session.NowPlayingItem.Name,SeriesName:session.NowPlayingItem.SeriesName,Type:session.NowPlayingItem.Type}:null,PlayState:{IsPaused:session.PlayState?.IsPaused}})),partial:!actor&&!viewer.admin,available:true})).catch(()=>({sessions:[],partial:true,available:false}));
    if(nativeCache.size>=50)nativeCache.delete(nativeCache.keys().next().value);nativeCache.set(key,{expires:now()+10000,work});return work;
  }
  async function directory(viewer){
    const config=getConfig(),key=crypto.createHash('sha256').update(config.jellyfinUrl+':'+(config.registrationServiceKey||viewer.id+':'+viewer.admin)).digest('hex'),old=directoryCache.get(key);if(old&&old.expires>now())return old.work;
    const actor=config.registrationServiceKey?{token:config.registrationServiceKey,deviceId:'JellyHub-presence'}:null;
    const work=(actor?upstream(jellyfin(),'Users?isDisabled=false',{headers:{Authorization:authHeader(actor,actor.deviceId)}}):jf('Users?isDisabled=false',viewer)).then(data=>({users:(Array.isArray(data)?data:[]).filter(user=>validId(user.Id)&&user.Policy?.IsDisabled!==true).slice(0,1000).map(user=>({userId:user.Id,name:String(user.Name||'Member').slice(0,60),imageTag:user.PrimaryImageTag})),partial:!actor&&!viewer.admin})).catch(()=>({users:[],partial:true}));
    if(directoryCache.size>=50)directoryCache.delete(directoryCache.keys().next().value);directoryCache.set(key,{expires:now()+30000,work});return work;
  }
  async function presence(viewer){
    const [native,roster]=await Promise.all([nativeSessions(viewer),directory(viewer)]),hub=getHubSessions().filter(session=>session.created+86400000>now()).map(session=>({UserId:session.id,UserName:session.name,LastActivityDate:new Date(session.lastActivity||session.created).toISOString()})),people=recentPeople([...native.sessions,...hub],now()),canSeeTitles=featurePermissions(getConfig(),viewer.id,viewer.admin).streams;
    const activeIds=new Set(people.map(person=>normalized(person.userId))),known=new Map(roster.users.map(person=>[normalized(person.userId),person]));
    for(const session of getHubSessions())if(roster.partial&&validId(session.id)&&!known.has(normalized(session.id)))known.set(normalized(session.id),{userId:session.id,name:session.name||'Member'});
    const inactive=[...known.values()].filter(person=>!activeIds.has(normalized(person.userId))).map(person=>({...person,state:native.available&&!native.partial?'offline':'unknown',playing:null})).sort((a,b)=>a.name.localeCompare(b.name));
    const selected=[...people.sort((a,b)=>Number(!!b.playing)-Number(!!a.playing)||a.name.localeCompare(b.name)).slice(0,100),...inactive.slice(0,100)],output=new Array(selected.length);let cursor=0;
    await Promise.all(Array.from({length:Math.min(6,selected.length)},async()=>{while(cursor<selected.length){
      const index=cursor++,person=selected[index],id=crypto.createHmac('sha256',salt).update(normalized(person.userId)).digest('hex').slice(0,32);let activity=null;
      if(person.playing&&canSeeTitles){try{const item=viewer.admin?person.playing.item:await jf(`Users/${viewer.id}/Items/${person.playing.item.Id}`,viewer);activity={title:String(item.Name||'Video').slice(0,180),series:String(item.SeriesName||'').slice(0,120),itemId:person.playing.item.Id}}catch{/* Playback state is visible without exposing forbidden media titles. */}}
      const profile=profileOf(getConfig(),person.userId),version=crypto.createHash('sha256').update(String(profile.avatarVersion||person.imageTag||'default')).digest('hex').slice(0,12);
      members.set(id,{userId:person.userId,name:person.name,expires:now()+RECENT});output[index]={id,name:profileName(getConfig(),person.userId,person.name),state:person.state,activity,avatar:'/api/presence/avatar/'+id+'?v='+version};
    }}));for(const [key,value]of members)if(value.expires<now())members.delete(key);
    return {users:output.filter(user=>!['offline','unknown'].includes(user.state)),offline:output.filter(user=>user.state==='offline'),unknown:output.filter(user=>user.state==='unknown'),offlineCount:inactive.filter(user=>user.state==='offline').length,count:people.length,partial:native.partial||roster.partial,updated:new Date(now()).toISOString()};
  }
  async function avatar(userId,viewer){
    const config=getConfig(),version=profileOf(config,userId).avatarVersion||'',cacheKey=userId+':'+version,old=avatars.get(cacheKey);if(old&&old.expires>now())return old.work;
    const actor=config.registrationServiceKey?{token:config.registrationServiceKey,deviceId:'JellyHub-presence'}:viewer;
    const work=(async()=>{
      const response=await fetch(new URL(`Users/${userId}/Images/Primary?maxWidth=80&maxHeight=80&quality=80`,jellyfin()+'/'),{headers:{Authorization:authHeader(actor,actor.deviceId)},signal:AbortSignal.timeout(6000),redirect:'error'});
      if(!response.ok){await response.body?.cancel();return null}const type=response.headers.get('content-type')?.split(';')[0];if(!['image/png','image/jpeg','image/webp','image/gif'].includes(type)){await response.body?.cancel();return null}
      const reader=response.body.getReader(),chunks=[];let size=0;try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>1048576){await reader.cancel();return null}chunks.push(Buffer.from(value))}}finally{reader.releaseLock()}
      return {type,bytes:Buffer.concat(chunks)};
    })().catch(()=>null);if(avatars.size>=100)avatars.delete(avatars.keys().next().value);avatars.set(cacheKey,{expires:now()+30000,work});return work;
  }
  const handler=async(req,res,url,viewer)=>{
    if(req.method!=='GET')return false;
    if(url.pathname==='/api/presence'){json(res,200,await presence(viewer));return true}
    const match=url.pathname.match(/^\/api\/presence\/avatar\/([a-f0-9]{32})$/);if(match){const member=members.get(match[1]);if(!member||member.expires<now())fail(404,'Profile picture unavailable');const image=await avatar(member.userId,viewer);if(!image){send(res,204,'',{'Cache-Control':'private, max-age=30','Vary':'Cookie'});return true}send(res,200,image.bytes,{'Content-Type':image.type,'Cache-Control':'private, max-age=30','Vary':'Cookie'});return true}
    return false;
  };
  handler.reference=(userId,name='Member')=>{const id=crypto.createHmac('sha256',salt).update(normalized(userId)).digest('hex').slice(0,32);members.set(id,{userId,name,expires:now()+RECENT});return id};
  handler.member=async(id,viewer)=>{await presence(viewer);const member=members.get(id);if(!member||member.expires<now())fail(404,'Member unavailable.');const roster=await directory(viewer),person=roster.users.find(person=>normalized(person.userId)===normalized(member.userId))||(roster.partial?getHubSessions().find(person=>normalized(person.id)===normalized(member.userId)):null);if(!person)fail(404,'Member unavailable.');return {userId:member.userId,name:member.name||person.name||'Member'}};
  return handler;
}
