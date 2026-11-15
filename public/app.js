import {createPlaybackWorkspace} from './watch.js';
import {adminCrown} from './avatars.js';
import {paintPresence} from './presence.js';
import {mountLogin} from './login.js';
import {renderStreams} from './streams.js';
import {renderMyList,renderRequests} from './my-list.js';
import {watchBadge} from './watch-state.js';
import {availabilityBadge} from './availability.js';
import {clearFeaturedSnapshots} from './featured-cache.js';
import {loadExtensions,pagesFor,getPage} from './extensions.js';
import { mountCarousel, carouselPlaceholder, renderDetail, mountDetailPreview } from './cinema.js';
import { renderLibrary } from './library.js';
import { renderAccount } from './account.js';

const root=document.querySelector('#app');
let disposePage=()=>{};
let streamCountTimer,streamCountController,streamCountEpoch=0;
function stopStreamCount(){clearTimeout(streamCountTimer);streamCountTimer=null;streamCountEpoch++;streamCountController?.abort();streamCountController=null;state.streamCount=null;state.presence=null}
async function refreshStreamCount(){
  if(!state.user||streamCountController)return;clearTimeout(streamCountTimer);streamCountTimer=null;
  if(document.hidden){streamCountTimer=setTimeout(refreshStreamCount,15000);return}
  const epoch=streamCountEpoch,controller=new AbortController();streamCountController=controller;
  try{
    const [count,presence]=await Promise.allSettled([api('/api/active-streams/count',{signal:controller.signal}),api('/api/presence',{signal:controller.signal})]);if(epoch!==streamCountEpoch)return;
    state.streamCount=count.status==='fulfilled'&&Number.isSafeInteger(count.value.count)&&count.value.count>=0?count.value.count:null;
    state.presence=presence.status==='fulfilled'?presence.value:null;paintPresence(document.querySelector('#online-users'),state.presence,escapeHTML,showItem,showMember);
  }catch{if(epoch===streamCountEpoch){state.streamCount=null;state.presence=null;paintPresence(document.querySelector('#online-users'),null,escapeHTML,showItem,showMember)}}
  finally{
    if(epoch===streamCountEpoch){streamCountController=null;document.querySelectorAll('.stream-count').forEach(badge=>{badge.textContent=state.streamCount??'';badge.hidden=!(state.streamCount>0)});const button=document.querySelector('[data-nav="streams"]');if(button)button.setAttribute('aria-description',state.streamCount===null?'Active stream count unavailable':state.streamCount+' active '+(state.streamCount===1?'stream':'streams'));if(state.user)streamCountTimer=setTimeout(refreshStreamCount,15000)}
  }
}
const playbackWorkspace=createPlaybackWorkspace({api,escapeHTML:value=>escapeHTML(value),onPlay:startPlayback,onBrowse:navigate,onItem:id=>{invalidate();showItem(id)},getPreferences:()=>state.preferences||{},getDetails:path=>cached(path,30000)});
function releasePage(){playbackWorkspace.dock();disposePage();disposePage=()=>{};document.querySelectorAll('.item-actions').forEach(dialog=>dialog.remove())}
const brandMarkup=()=>`<div class="brand" data-brand><img class="brand-mark" src="${escapeHTML(state.branding.logo||state.branding.favicon)}" alt=""/><span data-brand-text>${escapeHTML(state.branding.name)}</span></div>`;
const state={user:null,page:'home',adminTab:'general',cache:new Map(),removals:{},revision:0,branding:{title:'JellyHub',name:'jellyhub.',welcome:'Discover your next favorite.',accent:'#9980ff',favicon:'/favicon.svg',logo:'/branding-logo'}};
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(url,opts={}){
  const response=await fetch(url,{credentials:'same-origin',...opts,headers:{'Content-Type':'application/json',...opts.headers}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(Error((data.error||'Request failed')+(data.requestId?' [Request '+data.requestId+']':'')),{status:response.status});
  return data;
}
const pending=new Map();let cacheEpoch=0;
function invalidate(){cacheEpoch++;state.cache.clear();pending.clear()}
function cached(key,ttl=45000){
  const user=state.user,epoch=cacheEpoch,found=state.cache.get(key);
  if(found&&Date.now()-found.at<ttl)return Promise.resolve(found.value);
  if(pending.has(key))return pending.get(key);
  const work=api(key).then(value=>{if(state.user===user&&epoch===cacheEpoch){if(state.cache.size>=150)state.cache.delete(state.cache.keys().next().value);state.cache.set(key,{at:Date.now(),value})}return value}).finally(()=>{if(pending.get(key)===work)pending.delete(key)});pending.set(key,work);return work;
}
function applyBranding(value){
  state.branding=value;document.title=value.title;
  document.documentElement.style.setProperty('--accent',value.accent);
  document.querySelector('link[rel="icon"]').href=value.favicon;
  document.querySelectorAll('[data-brand-text]').forEach(el=>el.textContent=value.name);document.querySelectorAll('.brand-mark').forEach(el=>el.src=value.logo||value.favicon);
}
function shell(){
  releasePage();
  const nav=[['home','Home'],['movies','Movies'],['shows','TV Shows'],['favorites','My list'],...(state.user.permissions?.requests!==false?[['requests','Requests']]:[]),['streams','Active Streams'],...pagesFor(state.user).map(page=>[page.id,page.title]),...(state.user.admin?[['admin','Administration']]:[])];
  root.innerHTML=`<div class="layout"><aside class="side">${brandMarkup()}<nav class="nav" aria-label="Main navigation">${nav.map(([id,label])=>`<button data-nav="${id}" ${id==='streams'?`aria-label="Active Streams" ${!state.user.permissions?.streams&&!state.user.admin?'disabled title="Permission required to view stream details"':'title="View active streams"'}`:''} class="${(id===state.page||id==='movies'&&state.page==='collections')?'active':''}">${label}${id==='streams'?`<span class="stream-count" aria-hidden="true" ${state.streamCount>0?'':'hidden'}>${state.streamCount??''}</span>`:''}</button>`).join('')}${(state.navigation||[]).map(link=>`<a class="custom-link" href="${escapeHTML(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(link.title)}</a>`).join('')}</nav><div class="social-nav"><h2 class="presence-heading">Community</h2><button class="social-chat-link ${state.page==='chat'?'active':''}" data-nav="chat">Chat</button></div><section class="sidebar-users" id="online-users" aria-label="Users"></section></aside><main class="main"><header class="top"><div class="topright"><button class="profile-button" id="account" aria-label="Open profile for ${escapeHTML(state.user.name)}"><span class="avatar-wrap">${state.user.avatar?`<img class="profile-avatar" src="${escapeHTML(state.user.avatar)}" alt=""/>`:`<span class="profile-avatar profile-fallback" aria-hidden="true">${escapeHTML(state.user.name.slice(0,1))}</span>`}${adminCrown(state.user.admin)}</span><span data-profile-name>${escapeHTML(state.user.name)}</span></button><button class="linkbutton" id="logout">Sign out ↗</button></div></header><div id="content"></div></main></div>`;
  document.querySelectorAll('[data-nav]').forEach(btn=>btn.onclick=()=>navigate(btn.dataset.nav));
  paintPresence(document.querySelector('#online-users'),state.presence,escapeHTML,showItem,showMember);
  if(!streamCountTimer&&!streamCountController)refreshStreamCount();
  document.querySelector('#account').onclick=()=>navigate('account');document.querySelector('#account').onpointerenter=()=>Promise.all(['/api/profile','/api/account','/api/preferences','/api/bookmarks','/api/hidden-items','/api/profile/presets'].map(path=>cached(path,30000).catch(()=>{})));
  document.querySelector('#logout').onclick=async()=>{try{await Promise.race([playbackWorkspace.stop(),new Promise(resolve=>setTimeout(resolve,1500))]);await api('/api/logout',{method:'POST'})}finally{state.revision++;history.replaceState(null,'','#home');state.page='home';state.adminTab='general';login()}};
}
function login(message=''){
  playbackWorkspace.stop();
  stopStreamCount();
  releasePage();
  clearFeaturedSnapshots();state.chatDrafts={};state.chatAttempts={};state.user=null;invalidate();state.removals={};state.navigation=[];state.items?.clear();
  disposePage=mountLogin({root,api,brandMarkup,escapeHTML,message,onSignIn:async values=>{await api('/api/login',{method:'POST',body:JSON.stringify(values)});state.user=await api('/api/me');await loadUserContext();restoreRoute()}});
}
const content=html=>{releasePage();document.querySelector('#content').innerHTML=html};
const errorHTML=error=>`<p class="error">${escapeHTML(error.message)}</p>`;
function removalBadge(id){const entry=state.removals[id];if(!entry)return '';const days=Math.max(0,Math.ceil((Date.parse(entry.deletionDate)-Date.now())/86400000));return `<span class="removal-badge" title="${escapeHTML(entry.collection)}">${days?days+'d until removal':'Removal due'}</span>`}
async function loadRemovals(){
  const revision=state.revision,ids=[...new Set([...document.querySelectorAll('[data-removal-id]')].map(el=>el.dataset.removalId))];if(!ids.length)return;
  try{const data=await cached('/api/removals?ids='+encodeURIComponent(ids.join(',')),60000);if(revision!==state.revision)return;for(const id of ids)delete state.removals[id];Object.assign(state.removals,data.byId);document.querySelectorAll('[data-removal-id]').forEach(el=>el.innerHTML=removalBadge(el.dataset.removalId))}catch{/* Countdown failures must not block library browsing. */}
}
function mediaTile(item,options={}){
  if(state.preferences?.spoilerGuard&&item.Type==='Episode'&&!item.UserData?.Played)item={...item,Name:'Episode '+(item.IndexNumber||''),ImageTags:{}};
  const progress=item.RunTimeTicks?Math.min(100,Math.max(0,Number(item.UserData?.PlaybackPositionTicks||0)/item.RunTimeTicks*100)):0;
  state.items??=new Map();if(state.items.size>=1000)state.items.delete(state.items.keys().next().value);state.items.set(item.Id,item);
  const title=escapeHTML(item.Name||'Unknown');return `<article class="tile-card"><button class="tile" data-item="${escapeHTML(item.Id)}"><div class="poster">${item.ImageTags?.Primary?`<img loading="lazy" src="/api/image/${encodeURIComponent(item.Id)}" alt=""/>`:title.slice(0,1)}<span class="removal-overlay" data-removal-id="${escapeHTML(item.Id)}">${removalBadge(item.Id)}</span>${progress?`<progress class="watch-progress" value="${progress}" max="100" aria-label="Watch progress"></progress>`:''}</div><div class="tile-info"><div class="title">${title}</div><div class="sub">${escapeHTML(item.SeriesName||item.ProductionYear||item.Type||'')}</div>${state.preferences?.qualityTags!==false&&(item.QualityTags||[]).length?`<div class="quality-tags">${item.QualityTags.map(tag=>`<span>${escapeHTML(tag)}</span>`).join('')}</div>`:''}${availabilityBadge('library')}${item.WatchStatus||options.showWatchStatus||item.UserData?.Played||progress?watchBadge(item.WatchStatus||{state:item.UserData?.Played?'watched':progress?'watching':'unwatched'}):''}</div></button><button class="tile-menu" data-actions="${escapeHTML(item.Id)}" aria-label="Actions for ${title}" title="Title actions">•••</button></article>`;
}
function catalogTile(item){
  const kind=item.libraryId?'library':[2,3].includes(item.status)?'requested':item.status===5?'managed':'discover';
  return `<button class="tile" data-catalog-type="${item.mediaType}" data-catalog-id="${item.id}" ${item.libraryId?`data-item="${escapeHTML(item.libraryId)}"`:''}><div class="poster">${item.posterPath?`<img loading="lazy" src="/api/catalog/image?path=${encodeURIComponent(item.posterPath)}" alt=""/>`:escapeHTML(item.title).slice(0,1)}</div><div class="tile-info"><div class="title">${escapeHTML(item.title)}</div><div class="sub">${escapeHTML(item.year)} · ${item.mediaType==='movie'?'Movie':'TV'}</div>${availabilityBadge(kind)}</div></button>`;
}
let prefetchCount=0;
function bindTiles(){
  document.querySelectorAll('[data-item]').forEach(el=>{el.onclick=()=>{const item=state.items?.get(el.dataset.item);if(item?.Type==='BoxSet'){state.page='collections';library('Movie,Series','',{parent:item.Id,label:item.Name})}else showItem(el.dataset.item)};el.onpointerenter=()=>{clearTimeout(el.prefetchTimer);el.prefetchTimer=setTimeout(()=>{if(prefetchCount>=2||!el.isConnected)return;prefetchCount++;cached('/api/details/'+encodeURIComponent(el.dataset.item),30000).catch(()=>{}).finally(()=>prefetchCount--)},180)};el.onpointerleave=()=>clearTimeout(el.prefetchTimer)});
  document.querySelectorAll('[data-actions]').forEach(el=>el.onclick=()=>itemActions(el.dataset.actions));
  document.querySelectorAll('[data-catalog-id]:not([data-item])').forEach(el=>el.onclick=()=>showCatalog(el.dataset.catalogType,el.dataset.catalogId));
}
function itemActions(id){
  const item=state.items?.get(id);if(!item)return;document.querySelector('.item-actions')?.remove();
  const dialog=document.createElement('dialog');dialog.className='item-actions';dialog.innerHTML=`<h2>${escapeHTML(item.Name)}</h2><div class="action-options"><button class="ghost" data-action="favorite">${item.UserData?.IsFavorite?'Remove from My list':'Add to My list'}</button><button class="ghost" data-action="played">Mark as ${item.UserData?.Played?'unwatched':'watched'}</button><button class="ghost" data-action="hidden">Hide from browsing</button></div><p class="error" role="alert"></p><button class="linkbutton" data-close>Close</button>`;document.body.append(dialog);dialog.showModal();dialog.onclose=()=>dialog.remove();dialog.querySelector('[data-close]').onclick=()=>dialog.close();
  dialog.querySelectorAll('[data-action]').forEach(button=>button.onclick=async()=>{const action=button.dataset.action,value=action==='hidden'?true:!item.UserData?.[action==='favorite'?'IsFavorite':'Played'];button.disabled=true;try{await api('/api/user-item/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify({[action]:value})});invalidate();dialog.close();navigate(state.page==='detail'?'home':state.page)}catch(error){dialog.querySelector('.error').textContent=error.message;button.disabled=false}});
}
const section=(title,items,renderer=mediaTile)=>`<section><div class="section-head"><h2>${title}</h2></div>${items.length?`<div class="grid shelf">${items.map(renderer).join('')}</div>`:'<p class="muted">No titles found.</p>'}</section>`;
const searchForm=query=>`<form id="universal-search" class="universal-search" role="search"><label class="sr-only" for="universal-query">Search movies and shows</label><input class="input" id="universal-query" name="q" type="search" maxlength="120" placeholder="${state.user.permissions?.requests===false?'Search movies and shows':'Search movies and shows on the server and beyond'}" value="${escapeHTML(query)}"/><button class="primary">Search</button></form>`;
function bindSearch(){document.querySelector('#universal-search').onsubmit=event=>{event.preventDefault();search(new FormData(event.currentTarget).get('q'))}}
function recordRoute(route){if(location.hash.slice(1)!==route)history.pushState(null,'','#'+route)}
async function home(){
  const revision=state.revision;
  content(`<div class="home-intro"><h1 class="sr-only">Home</h1>${searchForm('')}</div><div id="featured">${carouselPlaceholder()}</div><div id="discovery"><p class="loader">Loading recommendations…</p></div><div id="next-up"></div><div id="rows"><p class="loader">Loading server media…</p></div>`);bindSearch();
  disposePage=mountCarousel({root:document.querySelector('#featured'),api,isCurrent:()=>revision===state.revision,onSelect:showItem,escapeHTML,cacheKey:state.user.id});
  await Promise.all([
    (async()=>{try{const data=await cached('/api/next-up',15000);if(revision!==state.revision)return;document.querySelector('#next-up').innerHTML=section('Next up',data.Items);bindTiles();loadRemovals()}catch{/* Optional row; other home data remains available. */}})(),
    (async()=>{try{const data=await cached('/api/home');if(revision!==state.revision)return;document.querySelector('#rows').innerHTML=section('Continue watching',data.resume)+section('Recently added',data.recent)+(data.errors?.length?`<p class="error">${escapeHTML(data.errors.join('; '))}</p>`:'');bindTiles();loadRemovals()}catch(error){if(revision===state.revision)document.querySelector('#rows').innerHTML=errorHTML(error)}})(),
    (async()=>{if(state.user.permissions?.requests===false){document.querySelector('#discovery').replaceChildren();return}try{const data=await cached('/api/discover');if(revision!==state.revision)return;document.querySelector('#discovery').innerHTML=section('Popular movies',data.movies,catalogTile)+section('Popular shows',data.shows,catalogTile);bindTiles()}catch(error){if(revision===state.revision)document.querySelector('#discovery').innerHTML=`<p class="notice">Recommendations unavailable: ${escapeHTML(error.message)}</p>`}})()
  ]);
}
async function search(query='',page=1){
  recordRoute('search/'+encodeURIComponent(query)+(page>1?'?page='+page:''));
  state.page='home';const revision=++state.revision;shell();content(`<div class="home-intro"><h1 class="sr-only">Search</h1>${searchForm(query)}</div><button class="ghost" id="browse-home">← Back to browsing</button><div id="search-results">${query?'<p class="loader">Searching…</p>':'<p class="muted">Search server media and requestable movies and shows.</p>'}</div>`);bindSearch();document.querySelector('#browse-home').onclick=()=>navigate('home');if(!query.trim())return;
  try{const result=await cached('/api/search?q='+encodeURIComponent(query)+'&page='+page);if(revision!==state.revision)return;document.querySelector('#search-results').innerHTML=result.errors.map(error=>`<p class="notice">${escapeHTML(error.source)}: ${escapeHTML(error.message)}</p>`).join('')+section('On server',result.library)+(state.user.permissions?.requests===false?'':section('Discover & request',result.catalog.filter(i=>!i.libraryId),catalogTile)+(result.catalogState==='empty'?'<p class="muted catalog-search-status">Seerr returned no matching titles. Try the same search in Seerr to check its catalog search.</p>':''))+((result.pages||1)>1?`<nav class="pagination" aria-label="Search pages"><button class="ghost" id="search-previous" ${page===1?'disabled':''}>Previous results</button><span>Page ${page} of ${result.pages}</span><button class="ghost" id="search-next" ${page>=result.pages?'disabled':''}>Next results</button></nav>`:'');for(const [id,delta]of [['#search-previous',-1],['#search-next',1]]){const button=document.querySelector(id);if(button)button.onclick=()=>search(query,page+delta)}bindTiles();loadRemovals()}
  catch(error){if(revision===state.revision)document.querySelector('#search-results').innerHTML=errorHTML(error)}
}
async function library(type,query='',options={}){
  const params=new URLSearchParams({q:query,...Object.fromEntries(Object.entries(options).map(([key,value])=>[key,String(value)]))});recordRoute('library/'+encodeURIComponent(type)+'?'+params);
  const revision=++state.revision;
  return renderLibrary({state,api,cached,content,escapeHTML,mediaTile,bindTiles,loadRemovals,section,isCurrent:()=>revision===state.revision,reload:library,collections:()=>navigate('collections'),movies:()=>navigate('movies'),setDispose:fn=>disposePage=fn},type,query,options);
}
async function showItem(id,seasonId='',episodeStart=0){
  const detailQuery=new URLSearchParams();if(seasonId)detailQuery.set('seasonId',seasonId);if(episodeStart)detailQuery.set('episodeStart',String(episodeStart));recordRoute('item/'+encodeURIComponent(id)+(detailQuery.size?'?'+detailQuery:''));
  const revision=++state.revision;state.page='detail';shell();content('<p class="loader">Loading details…</p>');
  try{
    const data=await cached('/api/details/'+encodeURIComponent(id)+(detailQuery.size?'?'+detailQuery:''),30000);if(revision!==state.revision)return;
    content(renderDetail(data,escapeHTML,state.preferences));document.querySelector('#back').onclick=()=>navigate('home');
    document.querySelector('#similar-titles').innerHTML=section('More like this',data.similar);
    document.querySelectorAll('[data-person]').forEach(button=>button.onclick=()=>showPerson(button.dataset.person));
    if(['Movie','Series'].includes(data.item.Type))import('./reviews.js').then(({mountReviews})=>{if(revision===state.revision)mountReviews({root:document.querySelector('#community-reviews'),api,itemId:id,escapeHTML,isCurrent:()=>revision===state.revision})}).catch(()=>{});else document.querySelector('#community-reviews')?.remove();
    for(const [selector,delta]of [['#previous-episodes',-100],['#next-episodes',100]]){const button=document.querySelector(selector);if(button)button.onclick=()=>showItem(id,data.selectedSeason,Math.max(0,(data.episodeStart||0)+delta))}
    for(const [selector,key,field]of [['#favorite-media','favorite','IsFavorite'],['#watched-media','played','Played']]){const button=document.querySelector(selector);button.onclick=async()=>{const old=data.item.UserData?.[field]||false,newValue=!old,oldText=button.textContent;button.disabled=true;button.textContent=key==='favorite'?(newValue?'In My list':'Add to My list'):(newValue?'Mark unwatched':'Mark watched');try{await api('/api/user-item/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify({[key]:newValue})});data.item.UserData={...data.item.UserData,[field]:newValue};invalidate()}catch(error){button.textContent=oldText;document.querySelector('#detail-preview').textContent=error.message}finally{button.disabled=false}}}
    const picker=document.querySelector('#season-picker');if(picker)picker.onchange=()=>showItem(id,picker.value);
    disposePage=mountDetailPreview({api,itemId:id,root:document.querySelector('#content')});document.querySelector('#play-media').onclick=()=>startPlayback(id);const beginning=document.querySelector('#play-beginning');if(beginning)beginning.onclick=()=>startPlayback(id,0);bindTiles();loadRemovals();
  }catch(error){if(revision===state.revision)content(errorHTML(error))}
}
async function showPerson(id){
  recordRoute('person/'+encodeURIComponent(id));
  const revision=++state.revision;state.page='person';shell();content('<p class="loader">Loading person…</p>');
  try{const [person,titles]=await Promise.all([cached('/api/person/'+encodeURIComponent(id)),cached('/api/browse?type=Movie,Series&person='+encodeURIComponent(id)+'&limit=100')]);if(revision!==state.revision)return;content(`<button class="ghost" id="person-back">Home</button><section class="person-detail">${person.image?`<img src="/api/image/${encodeURIComponent(id)}" alt=""/>`:''}<div><h1 class="heading">${escapeHTML(person.name)}</h1><p class="muted">${escapeHTML(person.birthplace)}</p><p>${escapeHTML(person.overview)}</p></div></section>${section('On server',titles.Items)}`);document.querySelector('#person-back').onclick=()=>navigate('home');bindTiles();loadRemovals()}catch(error){if(revision===state.revision)content(errorHTML(error))}
}
async function showCatalog(type,id){
  recordRoute('catalog/'+type+'/'+id);
  const revision=++state.revision;state.page='detail';shell();content('<p class="loader">Loading details…</p>');
  try{
    const item=await api(`/api/catalog/${type}/${id}`);if(revision!==state.revision)return;
    if(item.libraryId)return showItem(item.libraryId);
    const blocked=type==='movie'&&[2,3,5].includes(item.status);
    content(`<button class="ghost" id="back">← Home</button><section class="detail-cinema">${item.backdropPath?`<img class="detail-backdrop" src="/api/catalog/image?wide=1&path=${encodeURIComponent(item.backdropPath)}" alt=""/>`:''}<div class="detail-shade"></div><div class="detail"><div class="poster">${item.posterPath?`<img src="/api/catalog/image?path=${encodeURIComponent(item.posterPath)}" alt="${escapeHTML(item.title)} poster"/>`:escapeHTML(item.title).slice(0,1)}</div><div class="detail-copy"><div class="eyebrow">${type==='movie'?'Movie':'TV Show'}</div><h1 class="heading">${escapeHTML(item.title)}</h1><div class="media-meta"><span>${escapeHTML(item.year)}</span>${item.rating?`<span>★ ${Number(item.rating).toFixed(1)}</span>`:''}${item.runtime?`<span>${item.runtime} min</span>`:''}</div><div class="genre-tags">${(item.genres||[]).map(genre=>`<span>${escapeHTML(genre)}</span>`).join('')}</div><p class="detail-overview">${escapeHTML(item.overview)}</p><form id="request-form">${type==='tv'?`<fieldset class="season-options"><legend>Seasons to request</legend>${item.seasons.map(season=>`<label class="key-clear"><input type="checkbox" name="season" value="${season.number}" ${season.requested?'disabled':''}/><span>${escapeHTML(season.name)}${season.requested?' · Already requested/available':''}</span></label>`).join('')||'<p>No seasons available.</p>'}</fieldset>`:''}<button class="primary" ${!item.canRequest||blocked?'disabled':''}>${blocked?'Already requested or available':'Request '+(type==='movie'?'movie':'selected seasons')}</button>${!item.canRequest?'<p class="muted">Your Seerr account does not have request permission.</p>':''}<p id="request-status" class="feedback" role="status"></p></form></div></div></section>${item.cast?.length?`<section class="detail-facts"><div><h2>Cast</h2>${item.cast.map(person=>`<p><strong>${escapeHTML(person.name)}</strong> ${escapeHTML(person.role)}</p>`).join('')}</div></section>`:''}`);
    document.querySelector('#back').onclick=()=>navigate('home');
    document.querySelector('#request-form').onsubmit=async event=>{
      event.preventDefault();const form=event.currentTarget,btn=form.querySelector('button'),output=document.querySelector('#request-status');btn.disabled=true;output.textContent='Submitting…';output.dataset.state='pending';
      try{const result=await api('/api/requests',{method:'POST',body:JSON.stringify({mediaType:type,mediaId:Number(id),...(type==='tv'?{seasons:new FormData(form).getAll('season').map(Number)}:{})})});invalidate();output.dataset.state='success';output.textContent=result.status===1?'Request submitted for approval.':'Request submitted.';btn.textContent='Requested'}
      catch(error){output.dataset.state='error';output.textContent=error.message;btn.disabled=false}
    };
  }catch(error){if(revision===state.revision)content(errorHTML(error))}
}
async function showMyList(options={}){
  const revision=++state.revision;state.page='favorites';const params=new URLSearchParams(Object.entries(options).map(([key,value])=>[key,String(value)]));recordRoute('favorites'+(params.size?'?'+params:''));shell();return renderMyList({state,api,cached,content,escapeHTML,mediaTile,bindTiles,loadRemovals,isCurrent:()=>revision===state.revision,reload:showMyList,onItem:showItem,onCatalog:showCatalog,invalidate,setDispose:fn=>disposePage=fn},options);
}
async function showRequests(options={}){
  if(state.user.permissions?.requests===false){content('<h1 class="heading">Requests</h1><p class="notice">Requests are disabled for this account.</p>');return}
  const revision=++state.revision;state.page='requests';const params=new URLSearchParams(Object.entries(options).map(([key,value])=>[key,String(value)]));recordRoute('requests'+(params.size?'?'+params:''));shell();return renderRequests({api,cached,content,escapeHTML,isCurrent:()=>revision===state.revision,reload:showRequests,onItem:showItem,onCatalog:showCatalog,onPlay:startPlayback,setDispose:fn=>disposePage=fn},options);
}
async function showStreams(){
  const revision=++state.revision;state.page='streams';recordRoute('streams');shell();return renderStreams({api,content,escapeHTML,isCurrent:()=>revision===state.revision,setDispose:fn=>disposePage=fn});
}
async function showMember(id){const revision=state.revision,user=state.user,button=document.querySelector('[data-member="'+id+'"]')||document.querySelector('[data-presence-id="'+id+'"]');button?.setAttribute('aria-busy','true');try{const {openMember}=await import('./member-profile.js');if(revision!==state.revision||user!==state.user)return;return await openMember({id,api,escapeHTML,onMessage:showChat,onItem:showItem,isCurrent:()=>revision===state.revision&&user===state.user})}finally{button?.removeAttribute('aria-busy')}}
async function showChat(roomId='general'){
  if(state.page==='chat'&&disposePage.switchRoom){recordRoute('chat'+(roomId==='general'?'':'?room='+encodeURIComponent(roomId)));disposePage.switchRoom(roomId);return}
  const revision=++state.revision,epoch=streamCountEpoch;state.page='chat';recordRoute('chat'+(roomId==='general'?'':'?room='+encodeURIComponent(roomId)));shell();content('<p class="loader">Loading chat…</p>');
  try{const {mountChat}=await import('./chat.js');if(revision!==state.revision)return;disposePage=mountChat({root:document.querySelector('#content'),api,escapeHTML,roomId,onRoom:showChat,onMember:showMember,getDraft:id=>state.chatDrafts?.[id]||'',onDraft:(value,id)=>{if(epoch===streamCountEpoch)(state.chatDrafts||={})[id]=value},getAttempt:id=>state.chatAttempts?.[id],onAttempt:(value,id)=>{if(epoch===streamCountEpoch)(state.chatAttempts||={})[id]=value}})}catch(error){if(revision===state.revision)content(errorHTML(error))}
}
async function startPlayback(itemId,startTicks){
  recordRoute('play/'+encodeURIComponent(itemId)+(startTicks!==undefined?'?startTicks='+startTicks:''));
  state.revision++;state.page='player';shell();const pending=playbackWorkspace.play(itemId,startTicks);playbackWorkspace.show(document.querySelector('#content'));try{await pending}catch(error){if(state.page==='player')content(errorHTML(error))}
}

function navigate(page){
  if(page==='admin'&&state.adminTab==='roles')state.adminTab='users';
  if(page==='chat'&&state.page==='chat'&&disposePage.switchRoom)return showChat();
  recordRoute(page==='admin'?'admin/'+state.adminTab:page);
  state.revision++;state.page=page;shell();
  if(page==='home')home();else if(page==='movies')library('Movie');else if(page==='shows')library('Series');
  else if(page==='collections')library('BoxSet');else if(page==='favorites')showMyList();else if(page==='requests')showRequests();else if(page==='streams')showStreams();else if(page==='chat')showChat();
  else if(page==='account'){const revision=state.revision;renderAccount({api,cached,state,content,escapeHTML,onProfile:updateProfile,isCurrent:()=>revision===state.revision,onPlay:startPlayback,onItem:showItem,onInvalidate:()=>{invalidate();loadUserContext()}})}
  else if(getPage(page,state.user)){try{const dispose=getPage(page,state.user).mount({root:document.querySelector('#content'),api,user:{...state.user},escapeHTML,navigate,onItem:showItem,onPlay:startPlayback});disposePage=typeof dispose==='function'?dispose:()=>{}}catch(error){content(errorHTML(error))}}
  else if(page==='admin'&&state.user.admin){const revision=state.revision;import('./admin.js').then(({renderAdministration})=>{if(revision===state.revision)renderAdministration({state,api,escapeHTML,applyBranding,navigate})}).catch(error=>{if(revision===state.revision)content(errorHTML(error))})}
}
function restoreRoute(){
  if(!state.user)return;
  try{const path=location.hash.slice(1)||'home',[route,query='']=path.split('?'),parts=route.split('/').map(decodeURIComponent),params=new URLSearchParams(query);
    if(parts[0]==='item'&&parts[1])return showItem(parts[1],params.get('seasonId')||'',Number(params.get('episodeStart')||0));
    if(parts[0]==='play'&&parts[1])return startPlayback(parts[1],params.has('startTicks')?Number(params.get('startTicks')):undefined);
    if(parts[0]==='catalog'&&['movie','tv'].includes(parts[1])&&/^\d+$/.test(parts[2]||''))return showCatalog(parts[1],parts[2]);
    if(parts[0]==='person'&&parts[1])return showPerson(parts[1]);
    if(parts[0]==='search')return search(parts[1]||'',Number(params.get('page')||1));
    if(parts[0]==='library'&&['Movie','Series','BoxSet','Movie,Series'].includes(parts[1])){state.revision++;state.page=parts[1]==='Movie'?'movies':parts[1]==='Series'?'shows':parts[1]==='BoxSet'||params.has('parent')?'collections':'favorites';shell();const options=Object.fromEntries(params);delete options.q;if(options.start)options.start=Number(options.start);return library(parts[1],params.get('q')||'',options)}
    if(parts[0]==='favorites')return params.get('source')==='requests'?showRequests({scope:'mine',filter:params.get('requestFilter')||'all'}):showMyList(Object.fromEntries(params));
    if(parts[0]==='chat')return showChat(params.get('room')||'general');
    if(parts[0]==='requests')return showRequests(Object.fromEntries(params));
    if(parts[0]==='admin'&&state.user.admin){state.adminTab=parts[1]||'general';return navigate('admin')}
    if(['home','movies','shows','collections','favorites','requests','streams','chat','account'].includes(parts[0])||getPage(parts[0],state.user))return navigate(parts[0]);
  }catch{/* A malformed deep link returns to Home. */}
  navigate('home');
}
window.addEventListener('hashchange',restoreRoute);
function updateProfile(profile){state.user={...state.user,name:profile.displayName,avatar:profile.avatar,username:profile.username};document.querySelectorAll('[data-profile-name]').forEach(element=>element.textContent=profile.displayName);const button=document.querySelector('#account');if(button){button.setAttribute('aria-label','Open profile for '+profile.displayName);let image=button.querySelector('img');if(!image){image=document.createElement('img');image.className='profile-avatar';image.alt='';button.querySelector('.profile-fallback')?.remove();(button.querySelector('.avatar-wrap')||button).prepend(image)}image.src=profile.avatar}}
async function loadUserContext(){const user=state.user;const [navigation,preferences]=await Promise.all([api('/api/navigation').catch(()=>({links:[]})),api('/api/preferences').catch(()=>({}))]);if(state.user!==user)return;state.navigation=navigation.links;state.preferences=preferences}
(async()=>{
  try{await loadExtensions()}catch(error){console.error('Native extensions:',error.message)}
  try{applyBranding(await api('/api/branding'))}catch{/* Keep defaults if branding is unavailable. */}
  try{state.user=await api('/api/me');await loadUserContext();restoreRoute()}catch{login()}
})();
