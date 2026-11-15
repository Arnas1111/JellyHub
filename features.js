import {assignedRoles,rolePolicy,serializePolicyChange} from './roles.js';
import {createMyList} from './my-list.js';
import {featurePermissions} from './profiles.js';
import {visibleItems,libraryItem} from './core.js';
import crypto from 'node:crypto';

export const brandingDefaults={brandingTitle:'JellyHub',brandingName:'jellyhub.',brandingWelcome:'Discover your next favorite.',brandingAccent:'#9980ff',brandingFavicon:'',brandingLogo:''};
export const editablePolicies=['IsAdministrator','IsDisabled','IsHidden','EnableRemoteAccess','EnableMediaPlayback','EnableContentDownloading','EnableAudioPlaybackTranscoding','EnableVideoPlaybackTranscoding','EnableAllFolders'];
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const normalizedId=id=>String(id||'').replaceAll('-','').toLowerCase();
const numberId=id=>{const value=Number(id);if(!Number.isSafeInteger(value)||value<1)fail(400,'Invalid media ID');return value};
const userDto=user=>({id:user.Id,name:user.Name,policy:Object.fromEntries([...editablePolicies,'EnabledFolders'].map(k=>[k,user.Policy?.[k]??(k==='EnabledFolders'?[]:false)])),lastLogin:user.LastLoginDate||null});
const canRequest=(permissions,type)=>[2,32,type==='movie'?262144:524288].some(bit=>(permissions&bit)!==0);

function validateIcon(data){
  if(typeof data!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(data))fail(400,'Upload a PNG or ICO favicon.');
  const bytes=Buffer.from(data,'base64');
  if(bytes.length>65536)fail(413,'Favicon must be at most 64 KiB.');
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.length>=33&&bytes.toString('ascii',12,16)==='IHDR'){
    const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
    if(width<1||height<1||width>512||height>512)fail(400,'PNG favicon dimensions must be between 1 and 512 pixels.');
    return `data:image/png;base64,${bytes.toString('base64')}`;
  }
  if(bytes.length>=22&&bytes.readUInt32LE(0)===65536){
    const count=bytes.readUInt16LE(4);
    if(count<1||count>64||bytes.length<6+count*16)fail(400,'Invalid ICO directory.');
    for(let i=0;i<count;i++){
      const size=bytes.readUInt32LE(6+i*16+8),offset=bytes.readUInt32LE(6+i*16+12);
      if(size<1||offset<6+count*16||offset+size>bytes.length)fail(400,'Invalid ICO image data.');
    }
    return `data:image/x-icon;base64,${bytes.toString('base64')}`;
  }
  fail(400,'Only PNG and ICO favicons are supported. SVG and HTML uploads are not accepted.');
}

export function createFeatures({getConfig,saveConfig,jf,upstream,json,readBody,cleanId,send}){
  const branding=()=>{
    const c=getConfig();const favicon='/favicon.'+(c.brandingFavicon.startsWith('data:image/png')?'png':c.brandingFavicon?'ico':'svg')+'?v='+crypto.createHash('sha256').update(c.brandingFavicon).digest('hex').slice(0,12);return {title:c.brandingTitle,name:c.brandingName,welcome:c.brandingWelcome,accent:c.brandingAccent,favicon,logo:'/branding-logo?v='+crypto.createHash('sha256').update(c.brandingLogo||c.brandingFavicon).digest('hex').slice(0,12)};
  };
  const seerr=(route,headers={},opts={})=>{
    const c=getConfig();if(!c.seerrKey)fail(503,'Configure the Seerr API key under Administration → Seerr.');
    return upstream(c.seerrUrl,'api/v1/'+route,{...opts,headers:{'X-Api-Key':c.seerrKey,...headers,...(opts.body?{'Content-Type':'application/json'}:{})}});
  };
  async function seerrIdentity(session){
    // Resolve by immutable Jellyfin ID; never accept a browser-supplied Seerr user ID.
    let mapped;
    try{mapped=await seerr('user/jellyfin/'+encodeURIComponent(session.id))}
    catch(error){if(error.status===404)fail(403,'No matching Seerr account. Sign into Seerr with this Jellyfin account or ask an administrator to import it.');throw error}
    if(!Number.isSafeInteger(mapped?.id)||normalizedId(mapped.jellyfinUserId)!==normalizedId(session.id))fail(403,'Seerr did not return a matching Jellyfin account.');
    const headers={'X-Api-User':String(mapped.id)};
    const current=await seerr('auth/me',headers);
    if(current?.id!==mapped.id||normalizedId(current.jellyfinUserId)!==normalizedId(session.id))fail(403,'Seerr user impersonation could not be verified. Update Seerr before enabling requests.');
    return {id:Number(mapped.id),headers,permissions:Number(current.permissions)||0};
  }
  function catalogItem(item,type,permissions){
    const status=Number(item.mediaInfo?.status)||1;
    return {id:item.id,mediaType:type,title:item.title||item.name||'Untitled',overview:item.overview||'',year:(item.releaseDate||item.firstAirDate||'').slice(0,4),posterPath:/^\/[\w-]+\.(jpg|png)$/.test(item.posterPath||'')?item.posterPath:null,backdropPath:/^\/[\w-]+\.(jpg|png)$/.test(item.backdropPath||'')?item.backdropPath:null,genres:(item.genres||[]).map(g=>typeof g==='string'?g:g.name).filter(Boolean),rating:Number(item.voteAverage)||null,runtime:Number(item.runtime||item.episodeRunTime?.[0])||null,cast:(item.credits?.cast||[]).slice(0,12).map(person=>({name:person.name,role:person.character||''})),status,canRequest:canRequest(permissions,type)};
  }
  async function libraryMatches(session,ids){
    if(!ids.length)return [];
    const q=new URLSearchParams({Recursive:'true',IncludeItemTypes:'Movie,Series',Limit:'100',Fields:'ProviderIds,ProductionYear,Overview,Genres,CommunityRating,MediaSources',AnyProviderIdEquals:ids.map(id=>'tmdb.'+id).join(',')});
    return (await jf(`Users/${session.id}/Items?${q}`,session)).Items||[];
  }
  function attachLibrary(items,library){
    return items.map(item=>{const match=library.find(local=>String(local.ProviderIds?.Tmdb)===String(item.id)&&local.Type===(item.mediaType==='movie'?'Movie':'Series'));return {...item,libraryId:match?.Id||null}});
  }
  const myList=createMyList({jf,seerr,seerrIdentity,libraryMatches,catalogItem,json,getConfig});
  const pendingRequests=new Set();
  return async function handle(req,res,url,session){
    const route=url.pathname,method=req.method;
    if(route==='/api/branding'&&method==='GET'){json(res,200,branding());return true}
    if(['/favicon.ico','/favicon.png','/favicon.svg','/branding-logo'].includes(route)&&['GET','HEAD'].includes(method)){
      const icon=(route==='/branding-logo'&&getConfig().brandingLogo)||getConfig().brandingFavicon;
      if(icon){const [meta,data]=icon.split(',');send(res,200,Buffer.from(data,'base64'),{'Content-Type':meta.includes('image/png')?'image/png':'image/x-icon'});return true}
      send(res,200,'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#171e2c"/><text x="15" y="46" fill="#9980ff" font-family="sans-serif" font-size="48">j</text></svg>',{'Content-Type':'image/svg+xml'});return true;
    }
    if(!session)return false;
    if(await myList(req,res,url,session))return true;
    if(route==='/api/admin/branding/logo'){
      if(method==='DELETE')await saveConfig({brandingLogo:''});
      else if(method==='PUT'){
        const {data}=await readBody(req,2900000);
        if(typeof data!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(data))fail(400,'Upload a PNG logo.');
        const bytes=Buffer.from(data,'base64');
        if(bytes.length>2097152)fail(413,'Logo must be at most 2 MiB.');
        if(bytes.length<33||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString('ascii',12,16)!=='IHDR')fail(400,'Logo must be a PNG image.');
        if(!bytes.readUInt32BE(16)||!bytes.readUInt32BE(20)||bytes.readUInt32BE(16)>2048||bytes.readUInt32BE(20)>2048)fail(400,'Logo dimensions must be between 1 and 2048 pixels.');
        await saveConfig({brandingLogo:'data:image/png;base64,'+bytes.toString('base64')});
      }else fail(405,'Method not allowed');
      json(res,200,branding());return true;
    }
    if(route==='/api/admin/branding'){
      if(method==='GET'){json(res,200,branding());return true}
      if(method!=='PUT')fail(405,'Method not allowed');
      const input=await readBody(req),patch={};
      for(const [key,target,max] of [['title','brandingTitle',80],['name','brandingName',40],['welcome','brandingWelcome',160]]){
        if(typeof input[key]!=='string'||!input[key].trim()||input[key].length>max)fail(400,`Invalid ${key}; enter 1–${max} characters.`);
        patch[target]=input[key].trim();
      }
      if(!/^#[\da-f]{6}$/i.test(input.accent||''))fail(400,'Choose a valid accent color.');
      patch.brandingAccent=input.accent;
      await saveConfig(patch);json(res,200,branding());return true;
    }
    if(route==='/api/admin/branding/favicon'){
      if(method==='DELETE')await saveConfig({brandingFavicon:''});
      else if(method==='PUT'){const {data}=await readBody(req,100000);await saveConfig({brandingFavicon:validateIcon(data)})}
      else fail(405,'Method not allowed');
      json(res,200,branding());return true;
    }
    if(route==='/api/admin/users'&&method==='GET'){
      const [users,folders]=await Promise.all([jf('Users',session),jf('Library/VirtualFolders',session)]);
      json(res,200,{users:users.map(user=>({...userDto(user),features:featurePermissions(getConfig(),user.Id,!!user.Policy?.IsAdministrator)})),libraries:folders.map(f=>({id:f.ItemId,name:f.Name}))});return true;
    }
    const accessRoute=route.match(/^\/api\/admin\/users\/([^/]+)\/features$/);
    if(accessRoute&&method==='PUT'){
      const me=await jf('Users/Me',session);if(!me.Policy?.IsAdministrator)fail(403,'Administrator required');
      const id=cleanId(accessRoute[1]),input=await readBody(req);if(!input||Array.isArray(input)||!Object.keys(input).length||Object.entries(input).some(([key,value])=>!['requests','streams'].includes(key)||typeof value!=='boolean'))fail(400,'Choose valid JellyHub feature permissions.');
      const target=await jf('Users/'+id,session);
      await saveConfig(config=>{let state;try{state=JSON.parse(config.userState||'{}')}catch{state={}}const key=Object.keys(state).find(key=>normalizedId(key)===normalizedId(id))||id;state[key]={...state[key],featurePermissions:{...state[key]?.featurePermissions,...input}};return {userState:JSON.stringify(state)}});
      json(res,200,{features:featurePermissions(getConfig(),id,!!target.Policy?.IsAdministrator)});return true;
    }
    const userRoute=route.match(/^\/api\/admin\/users\/([^/]+)$/);
    if(userRoute&&method==='PUT'){
      return serializePolicyChange(async()=>{
      const id=cleanId(userRoute[1]),input=await readBody(req);
      if(typeof input.name!=='string'||!input.name.trim()||input.name.length>128||!input.policy||Array.isArray(input.policy))fail(400,'Enter a user name and valid policy.');
      const current=await jf('Users/'+id,session),policy={...current.Policy};
      for(const [key,value] of Object.entries(input.policy)){
        if(editablePolicies.includes(key)&&typeof value==='boolean')policy[key]=value;
        else if(key==='EnabledFolders'&&Array.isArray(value)&&value.length<=200&&value.every(x=>typeof x==='string'))policy.EnabledFolders=value.map(cleanId);
        else fail(400,'Unsupported user policy field: '+key);
      }
      const controlled=new Set(assignedRoles(getConfig(),id).flatMap(role=>Object.keys(role.policy))),effective=rolePolicy(getConfig(),id,current.Policy);
      for(const key of controlled)if(JSON.stringify(policy[key])!==JSON.stringify(effective[key]))fail(403,'This permission is managed by a role. Edit it under Administration > Users & roles.');
      if(normalizedId(id)===normalizedId(session.id)&&(policy.IsDisabled||!policy.IsAdministrator))fail(400,'Use another administrator account to disable or demote your current account.');
      if(policy.IsAdministrator&&policy.IsDisabled)fail(400,'An administrator cannot be disabled.');
      if(current.Policy?.IsAdministrator&&!policy.IsAdministrator){const users=await jf('Users',session);if(users.filter(u=>u.Policy?.IsAdministrator&&!u.Policy?.IsDisabled).length<=1)fail(400,'Keep at least one enabled administrator.')}
      const folders=await jf('Library/VirtualFolders',session);
      if((policy.EnabledFolders||[]).some(id=>!folders.some(f=>f.ItemId===id)))fail(400,'A selected library no longer exists. Refresh Users and try again.');
      // Keep Configuration intact: Jellyfin's rename endpoint also updates it.
      // Only update policy here; name is a separate, explicit save to avoid partial edits.
      if(input.name.trim()!==current.Name)fail(400,'Name changes use the separate Rename action. Save permissions first.');
      await jf(`Users/${id}/Policy`,session,{method:'POST',body:policy});
      json(res,200,{ok:true});return true;
      });
    }
    const rename=route.match(/^\/api\/admin\/users\/([^/]+)\/name$/);
    if(rename&&method==='PUT'){
      const id=cleanId(rename[1]),input=await readBody(req);
      if(typeof input.name!=='string'||!input.name.trim()||input.name.length>128)fail(400,'Enter a user name of 1–128 characters.');
      const current=await jf('Users/'+id,session);
      await jf('Users/'+id,session,{method:'POST',body:{...current,Name:input.name.trim()}});
      json(res,200,{ok:true});return true;
    }
    if(route==='/api/search'&&method==='GET'){
      const page=Number(url.searchParams.get('page')||1);if(!Number.isSafeInteger(page)||page<1||page>500)fail(400,'Search page must be between 1 and 500.');
      const query=(url.searchParams.get('q')||'').trim().slice(0,120);if(!query){json(res,200,{library:[],catalog:[],errors:[]});return true}
      const q=new URLSearchParams({Recursive:'true',IncludeItemTypes:'Movie,Series',SearchTerm:query,StartIndex:String((page-1)*60),Limit:'60',EnableTotalRecordCount:'true',Fields:'ProviderIds,ProductionYear,Overview'});
      const results=await Promise.allSettled([jf(`Users/${session.id}/Items?${q}`,session),(async()=>{if(!featurePermissions(getConfig(),session.id,session.admin).requests)return {items:[],pages:1};const identity=await seerrIdentity(session);const found=await seerr('search?'+new URLSearchParams({query,page:String(page)}),identity.headers);return {items:(found.results||[]).filter(i=>['movie','tv'].includes(i.mediaType)).map(i=>catalogItem(i,i.mediaType,identity.permissions)),pages:Math.min(500,Number(found.totalPages)||page)}})()]);
      const library=results[0].status==='fulfilled'?results[0].value.Items||[]:[];
      let catalog=[],matched=[];if(results[1].status==='fulfilled'){let matches=library;try{matches=[...library,...await libraryMatches(session,results[1].value.items.map(item=>item.id))]}catch{/* Search results still work if the optional cross-page matching query fails. */}catalog=attachLibrary(results[1].value.items,matches);const linked=new Set(catalog.map(item=>item.libraryId).filter(Boolean));matched=matches.filter(item=>linked.has(item.Id))}
      const localResults=[...new Map([...library,...matched].map(item=>[item.Id,item])).values()];
      const pages=Math.max(1,results[0].status==='fulfilled'?Math.ceil((results[0].value.TotalRecordCount||library.length)/60):1,results[1].status==='fulfilled'?results[1].value.pages:1);
      json(res,200,{library:localResults.map(libraryItem),catalog,catalogState:!featurePermissions(getConfig(),session.id,session.admin).requests?'disabled':results[1].status==='rejected'?'unavailable':catalog.length?'results':'empty',page,pages:Math.min(500,pages),errors:results.flatMap((r,i)=>r.status==='rejected'?[{source:i?'Seerr':'Jellyfin',message:r.reason.message}]:[])});return true;
    }
    if(route==='/api/discover'&&method==='GET'){
      if(!featurePermissions(getConfig(),session.id,session.admin).requests)fail(403,'Requests are disabled for this account.');
      const identity=await seerrIdentity(session);
      const [movies,shows]=await Promise.all(['movies','tv'].map(type=>seerr(`discover/${type}?page=1&sortBy=popularity.desc`,identity.headers)));
      const items=[...(movies.results||[]).map(i=>catalogItem(i,'movie',identity.permissions)),...(shows.results||[]).map(i=>catalogItem(i,'tv',identity.permissions))];
      const library=await libraryMatches(session,items.map(i=>i.id));
      const tagged=visibleItems(attachLibrary(items,library),getConfig(),session.id);json(res,200,{movies:tagged.filter(i=>i.mediaType==='movie'),shows:tagged.filter(i=>i.mediaType==='tv')});return true;
    }
    if(route==='/api/featured'&&method==='GET'){
      let items=[],source='library';
      try{
        if(!featurePermissions(getConfig(),session.id,session.admin).requests)throw Error('Requests disabled');
        const identity=await seerrIdentity(session);
        const popular=await Promise.all(['movies','tv'].map(type=>seerr('discover/'+type+'?page=1&sortBy=popularity.desc',identity.headers)));
        const wanted=popular.flatMap((data,index)=>(data.results||[]).map(item=>({id:String(item.id),type:index?'Series':'Movie'})));
        items=(await libraryMatches(session,wanted.map(item=>item.id))).filter(item=>wanted.some(w=>w.id===String(item.ProviderIds?.Tmdb)&&w.type===item.Type));
        if(items.length)source='popular';
      }catch{/* An unconfigured/unavailable Seerr must not prevent the library carousel. */}
      items=visibleItems(items,getConfig(),session.id);items=[...new Map(items.map(item=>[item.Id,item])).values()];
      let fillers=[];
      if(items.length<8){
        const q=new URLSearchParams({Recursive:'true',IncludeItemTypes:'Movie,Series',SortBy:'CommunityRating',SortOrder:'Descending',Limit:'30',Fields:'Overview,Genres,ProductionYear,CommunityRating'});
        try{fillers=(await jf(`Users/${session.id}/Items?${q}`,session)).Items||[]}catch(error){if(!items.length)throw error}
      }
      const hour=Math.floor(Date.now()/3600000);
      const score=item=>crypto.createHash('sha256').update(`${session.id}:${hour}:${item.Id}`).digest('hex');
      fillers=visibleItems(fillers,getConfig(),session.id);
      const selected=items.sort((a,b)=>score(a).localeCompare(score(b))).slice(0,8),seen=new Set(selected.map(item=>item.Id));
      for(const item of fillers.sort((a,b)=>score(a).localeCompare(score(b)))){if(selected.length>=8)break;if(!seen.has(item.Id)){selected.push(item);seen.add(item.Id);if(source==='popular')source='mixed'}}
      selected.sort((a,b)=>score(a).localeCompare(score(b)));
      const publicItems=selected.map(item=>Object.fromEntries(['Id','Name','Type','Overview','ProductionYear','OfficialRating','CommunityRating','RunTimeTicks','Genres','ImageTags','BackdropImageTags'].filter(key=>item[key]!==undefined).map(key=>[key,item[key]])));
      json(res,200,{items:publicItems,source,reshuffleAt:(hour+1)*3600000});return true;
    }
    const mediaRoute=route.match(/^\/api\/catalog\/(movie|tv)\/(\d+)$/);
    if(mediaRoute&&method==='GET'){
      const type=mediaRoute[1],id=numberId(mediaRoute[2]),identity=await seerrIdentity(session);
      const item=await seerr(`${type}/${id}`,identity.headers);
      const result=attachLibrary([catalogItem(item,type,identity.permissions)],await libraryMatches(session,[id]))[0];
      const seasonStatus=new Map((item.mediaInfo?.seasons||[]).map(s=>[s.seasonNumber,Number(s.status)]));
      json(res,200,{...result,seasons:(item.seasons||[]).filter(s=>s.seasonNumber>0).map(s=>({number:s.seasonNumber,name:s.name||'Season '+s.seasonNumber,requested:[2,3,5].includes(seasonStatus.get(s.seasonNumber))}))});return true;
    }
    if(route==='/api/requests'&&method==='POST'){
      const input=await readBody(req),type=input.mediaType,id=numberId(input.mediaId);
      if(!['movie','tv'].includes(type))fail(400,'Invalid media type');
      if(Object.keys(input).some(k=>!['mediaType','mediaId','seasons'].includes(k)))fail(400,'Unsupported request field');
      const identity=await seerrIdentity(session);
      if(!canRequest(identity.permissions,type))fail(403,'Your Seerr account does not have permission to request this media type.');
      const body={mediaType:type,mediaId:id};
      if(type==='tv'){
        if(!Array.isArray(input.seasons)||!input.seasons.length||input.seasons.length>100||input.seasons.some(n=>!Number.isSafeInteger(n)||n<1))fail(400,'Select at least one valid season.');
        const detail=await seerr(`tv/${id}`,identity.headers);
        if(input.seasons.some(n=>!detail.seasons?.some(s=>s.seasonNumber===n)))fail(400,'Unknown season selected');
        body.seasons=[...new Set(input.seasons)];
      }
      const key=session.id+':'+type+':'+id;if(pendingRequests.has(key))fail(409,'A request for this title is already being submitted.');
      pendingRequests.add(key);
      try{const result=await seerr('request',identity.headers,{method:'POST',body});json(res,201,{id:result.id,status:result.status})}
      catch(error){if([403,429].includes(error.status))fail(error.status,`Seerr rejected the request (HTTP ${error.status}). Check your request permissions and quota in Seerr.`);throw error}
      finally{pendingRequests.delete(key)}
      return true;
    }
    if(route==='/api/catalog/image'&&method==='GET'){
      const imagePath=url.searchParams.get('path');if(!/^\/[\w-]+\.(jpg|png)$/.test(imagePath||''))fail(400,'Invalid poster path');
      const image=await fetch('https://image.tmdb.org/t/p/'+(url.searchParams.get('wide')==='1'?'w1280':'w342')+imagePath,{signal:AbortSignal.timeout(6000),redirect:'error'});
      if(!image.ok)fail(404,'Poster unavailable');
      send(res,200,Buffer.from(await image.arrayBuffer()),{'Content-Type':'image/jpeg','Cache-Control':'private, max-age=3600'});return true;
    }
    return false;
  };
}
