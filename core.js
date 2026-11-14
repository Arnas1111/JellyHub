const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
export function libraryItem(item){
  const result=Object.fromEntries(['Id','Name','Type','Overview','ProductionYear','OfficialRating','CommunityRating','RunTimeTicks','Genres','ImageTags','BackdropImageTags','SeriesId','SeriesName','IndexNumber','ParentIndexNumber','UserData','ChildCount'].filter(key=>item[key]!==undefined).map(key=>[key,item[key]]));
  const streams=item.MediaStreams||item.MediaSources?.[0]?.MediaStreams||[],video=streams.find(s=>s.Type==='Video'),audio=streams.find(s=>s.Type==='Audio');
  const tags=[];if(video?.Height)tags.push(video.Height>=2160?'4K':video.Height>=1080?'1080p':video.Height>=720?'720p':'SD');
  if(video?.VideoRange&&video.VideoRange!=='SDR')tags.push(video.VideoRangeType||video.VideoRange);if(audio?.Profile?.includes('Atmos')||audio?.DisplayTitle?.includes('Atmos'))tags.push('Atmos');else if(audio?.Channels>=8)tags.push('7.1');else if(audio?.Channels>=6)tags.push('5.1');
  result.QualityTags=tags.slice(0,3);return result;
}
function stateOf(config,user){try{return JSON.parse(config.userState||'{}')[user]||{}}catch{return {}}}
export function visibleItems(items,config,userId){const hidden=new Set(stateOf(config,userId).hiddenItems||[]);return items.filter(item=>!hidden.has(item.Id)&&!hidden.has(item.SeriesId)&&!hidden.has(item.libraryId))}
export function createCore({jf,json,readBody,cleanId,getConfig,saveConfig}){
  return async(req,res,url,user)=>{
    const route=url.pathname;
    if(route==='/api/library-views'&&req.method==='GET'){
      const data=await jf(`Users/${user.id}/Views`,user);json(res,200,{views:(data.Items||[]).filter(item=>!['music','musicvideos','books','audiobooks','photos'].includes(item.CollectionType)).map(item=>({id:item.Id,name:item.Name,type:item.CollectionType||'mixed'}))});return true;
    }
    if(route==='/api/browse'&&req.method==='GET'){
      const type=url.searchParams.get('type')||'Movie';if(!['Movie','Series','BoxSet','Movie,Series'].includes(type))fail(400,'Invalid library type');
      const start=Number(url.searchParams.get('start')||0),limit=Number(url.searchParams.get('limit')||60);if(!Number.isSafeInteger(start)||start<0||start>500000||!Number.isSafeInteger(limit)||limit<1||limit>100)fail(400,'Invalid page');
      const sort=url.searchParams.get('sort')||'SortName';if(!['SortName','DateCreated','PremiereDate','CommunityRating','Random','DatePlayed','ProductionYear'].includes(sort))fail(400,'Invalid sort order');
      const q=new URLSearchParams({Recursive:'true',IncludeItemTypes:type,StartIndex:String(start),Limit:String(limit),SortBy:sort,SortOrder:url.searchParams.get('order')==='desc'?'Descending':'Ascending',Fields:'Overview,Genres,ProductionYear,CommunityRating,MediaSources',EnableUserData:'true',EnableTotalRecordCount:'true'});
      const search=(url.searchParams.get('q')||'').slice(0,120);if(search)q.set('SearchTerm',search);
      const parent=url.searchParams.get('parent');if(parent){q.set('ParentId',cleanId(parent));await jf(`Users/${user.id}/Items/${cleanId(parent)}`,user)}
      const person=url.searchParams.get('person');if(person)q.set('PersonIds',cleanId(person));
      const genre=url.searchParams.get('genre');if(genre)q.set('Genres',genre.slice(0,80));
      const year=url.searchParams.get('year');if(year){if(!/^\d{4}$/.test(year))fail(400,'Invalid year');q.set('Years',year)}
      const filter=url.searchParams.get('filter');if(filter){if(!['IsFavorite','IsPlayed','IsUnplayed'].includes(filter))fail(400,'Invalid filter');q.set('Filters',filter)}
      const hidden=stateOf(getConfig(),user.id).hiddenItems||[];if(hidden.length)q.set('ExcludeItemIds',hidden.join(','));
      const data=await jf(`Users/${user.id}/Items?${q}`,user);json(res,200,{Items:(data.Items||[]).map(libraryItem),TotalRecordCount:data.TotalRecordCount??data.Items?.length??0,StartIndex:start});return true;
    }
    if(route==='/api/library-filters'&&req.method==='GET'){
      const type=url.searchParams.get('type')||'Movie';if(!['Movie','Series'].includes(type))fail(400,'Invalid library type');
      const q=new URLSearchParams({UserId:user.id,IncludeItemTypes:type});const data=await jf('Items/Filters2?'+q,user);
      json(res,200,{genres:(data.Genres||[]).map(g=>typeof g==='string'?g:g.Name).filter(Boolean),years:data.Years||[]});return true;
    }
    if(route==='/api/next-up'&&req.method==='GET'){
      const q=new URLSearchParams({UserId:user.id,Limit:'24',Fields:'Overview,MediaSources',EnableUserData:'true'});const data=await jf('Shows/NextUp?'+q,user);json(res,200,{Items:visibleItems(data.Items||[],getConfig(),user.id).map(libraryItem)});return true;
    }
    if(route==='/api/account'&&req.method==='GET'){
      const me=await jf('Users/Me',user);json(res,200,{id:me.Id,name:me.Name,hasPassword:me.HasPassword,configuration:{AudioLanguagePreference:me.Configuration?.AudioLanguagePreference||'',SubtitleLanguagePreference:me.Configuration?.SubtitleLanguagePreference||'',SubtitleMode:me.Configuration?.SubtitleMode||'Default'},canEdit:me.Policy?.EnableUserPreferenceAccess!==false});return true;
    }
    if(route==='/api/account/password'&&req.method==='PUT'){
      const input=await readBody(req);if(typeof input.currentPassword!=='string'||input.currentPassword.length>1024||typeof input.newPassword!=='string'||input.newPassword.length<8||input.newPassword.length>1024)fail(400,'Enter the current password and a new password of 8–1024 characters.');
      await jf('Users/Password',user,{method:'POST',body:{CurrentPw:input.currentPassword,NewPw:input.newPassword,ResetPassword:false}});json(res,200,{ok:true});return true;
    }
    if(route==='/api/account/configuration'&&req.method==='PUT'){
      const input=await readBody(req),allowed=['AudioLanguagePreference','SubtitleLanguagePreference','SubtitleMode'];
      if(Object.keys(input).some(key=>!allowed.includes(key))||Object.values(input).some(value=>typeof value!=='string'||value.length>40))fail(400,'Invalid playback language preference');
      if(input.SubtitleMode&&!['Default','Always','OnlyForced','None','Smart'].includes(input.SubtitleMode))fail(400,'Invalid subtitle mode');
      const me=await jf('Users/Me',user);await jf(`Users/${user.id}/Configuration`,user,{method:'POST',body:{...me.Configuration,...input}});json(res,200,{ok:true});return true;
    }
    const person=route.match(/^\/api\/person\/([^/]+)$/);
    if(person&&req.method==='GET'){
      const id=cleanId(person[1]),item=await jf(`Users/${user.id}/Items/${id}`,user);if(item.Type!=='Person')fail(400,'This item is not a person');
      json(res,200,{id,name:item.Name,overview:item.Overview||'',birthday:item.PremiereDate||null,deathday:item.EndDate||null,birthplace:item.ProductionLocations?.[0]||'',image:!!item.ImageTags?.Primary});return true;
    }
    const itemRoute=route.match(/^\/api\/user-item\/([^/]+)$/);
    if(itemRoute&&req.method==='PUT'){
      const id=cleanId(itemRoute[1]),input=await readBody(req),keys=Object.keys(input);
      if(keys.length!==1||!['favorite','played','hidden'].includes(keys[0])||typeof input[keys[0]]!=='boolean')fail(400,'Choose one user-item action');
      await jf(`Users/${user.id}/Items/${id}`,user);
      const key=keys[0],value=input[key];
      if(key==='hidden'){
        await saveConfig(config=>{let all;try{all=JSON.parse(config.userState||'{}')}catch{all={}}const state=all[user.id]||{},items=new Set(state.hiddenItems||[]);value?items.add(id):items.delete(id);if(items.size>1000)fail(400,'Hidden list is full');all[user.id]={...state,hiddenItems:[...items]};return {userState:JSON.stringify(all)}});
        json(res,200,{ok:true});return true;
      }
      const data=await jf(`Users/${user.id}/${key==='favorite'?'FavoriteItems':'PlayedItems'}/${id}`,user,{method:value?'POST':'DELETE'});json(res,200,{ok:true,userData:data});return true;
    }
    if(route==='/api/hidden-items'&&req.method==='GET'){
      const ids=stateOf(getConfig(),user.id).hiddenItems||[];
      if(!ids.length){json(res,200,{Items:[]});return true}
      const q=new URLSearchParams({Ids:ids.slice(0,100).join(','),Limit:'100',Recursive:'true',Fields:'Overview'});const data=await jf(`Users/${user.id}/Items?${q}`,user);json(res,200,{Items:(data.Items||[]).map(libraryItem)});return true;
    }
    return false;
  };
}
