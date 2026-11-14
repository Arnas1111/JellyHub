import { mountCarousel, carouselPlaceholder, renderDetail, mountDetailPreview } from './cinema.js';
import { renderAdministration } from './admin.js';

const root=document.querySelector('#app');
let disposePage=()=>{};
function releasePage(){disposePage();disposePage=()=>{}}
const brandMarkup=()=>`<div class="brand" data-brand><img class="brand-mark" src="${escapeHTML(state.branding.logo||state.branding.favicon)}" alt=""/><span data-brand-text>${escapeHTML(state.branding.name)}</span></div>`;
const state={user:null,page:'home',adminTab:'general',cache:new Map(),removals:{},revision:0,branding:{title:'JellyHub',name:'jellyhub.',welcome:'Discover your next favorite.',accent:'#9980ff',favicon:'/favicon.svg',logo:'/branding-logo'}};
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(url,opts={}){
  const response=await fetch(url,{credentials:'same-origin',...opts,headers:{'Content-Type':'application/json',...opts.headers}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error((data.error||'Request failed')+(data.requestId?' [Request '+data.requestId+']':''));
  return data;
}
function cached(key,ttl=45000){
  const user=state.user,found=state.cache.get(key);
  if(found&&Date.now()-found.at<ttl)return Promise.resolve(found.value);
  return api(key).then(value=>{if(state.user===user)state.cache.set(key,{at:Date.now(),value});return value});
}
function applyBranding(value){
  state.branding=value;document.title=value.title;
  document.documentElement.style.setProperty('--accent',value.accent);
  document.querySelector('link[rel="icon"]').href=value.favicon;
  document.querySelectorAll('[data-brand-text]').forEach(el=>el.textContent=value.name);document.querySelectorAll('.brand-mark').forEach(el=>el.src=value.logo||value.favicon);
}
function shell(){
  releasePage();
  const nav=[['home','Home'],['movies','Movies'],['shows','TV Shows'],...(state.user.admin?[['admin','Administration']]:[])];
  root.innerHTML=`<div class="layout"><aside class="side">${brandMarkup()}<nav class="nav" aria-label="Main navigation">${nav.map(([id,label])=>`<button data-nav="${id}" class="${id===state.page?'active':''}">${label}</button>`).join('')}</nav></aside><main class="main"><header class="top"><div class="topright"><span class="pill">${escapeHTML(state.user.name)}</span><button class="linkbutton" id="logout">Sign out ↗</button></div></header><div id="content"></div></main></div>`;
  document.querySelectorAll('[data-nav]').forEach(btn=>btn.onclick=()=>navigate(btn.dataset.nav));
  document.querySelector('#logout').onclick=async()=>{try{await api('/api/logout',{method:'POST'})}finally{state.revision++;login()}};
}
function login(message=''){
  releasePage();
  state.user=null;state.cache.clear();state.removals={};
  root.innerHTML=`<div class="login"><section class="login-card">${brandMarkup()}<h1>Welcome back.</h1><p>Use your existing Jellyfin account.</p><form id="login"><input class="input" name="username" autocomplete="username" placeholder="Username" required/><input class="input" name="password" type="password" autocomplete="current-password" placeholder="Password" required/><button class="primary">Sign in</button><div class="error" id="login-error">${escapeHTML(message)}</div></form></section></div>`;
  document.querySelector('#login').onsubmit=async event=>{
    event.preventDefault();const fields=new FormData(event.currentTarget),btn=event.currentTarget.querySelector('button');btn.disabled=true;
    try{await api('/api/login',{method:'POST',body:JSON.stringify(Object.fromEntries(fields))});state.user=await api('/api/me');navigate('home')}
    catch(error){document.querySelector('#login-error').textContent=error.message}finally{btn.disabled=false}
  };
}
const content=html=>{releasePage();document.querySelector('#content').innerHTML=html};
const errorHTML=error=>`<p class="error">${escapeHTML(error.message)}</p>`;
function removalBadge(id){const entry=state.removals[id];if(!entry)return '';const days=Math.max(0,Math.ceil((Date.parse(entry.deletionDate)-Date.now())/86400000));return `<span class="removal-badge" title="${escapeHTML(entry.collection)}">${days?days+'d until removal':'Removal due'}</span>`}
async function loadRemovals(){
  const revision=state.revision,ids=[...new Set([...document.querySelectorAll('[data-removal-id]')].map(el=>el.dataset.removalId))];if(!ids.length)return;
  try{const data=await cached('/api/removals?ids='+encodeURIComponent(ids.join(',')),60000);if(revision!==state.revision)return;for(const id of ids)delete state.removals[id];Object.assign(state.removals,data.byId);document.querySelectorAll('[data-removal-id]').forEach(el=>el.innerHTML=removalBadge(el.dataset.removalId))}catch{/* Countdown failures must not block library browsing. */}
}
function mediaTile(item){
  const progress=item.RunTimeTicks?Math.min(100,Math.max(0,Number(item.UserData?.PlaybackPositionTicks||0)/item.RunTimeTicks*100)):0;
  const title=escapeHTML(item.Name||'Unknown');return `<button class="tile" data-item="${escapeHTML(item.Id)}"><div class="poster">${item.ImageTags?.Primary?`<img loading="lazy" src="/api/image/${encodeURIComponent(item.Id)}" alt=""/>`:title.slice(0,1)}<span class="removal-overlay" data-removal-id="${escapeHTML(item.Id)}">${removalBadge(item.Id)}</span>${progress?`<progress class="watch-progress" value="${progress}" max="100" aria-label="Watch progress"></progress>`:''}</div><div class="tile-info"><div class="title">${title}</div><div class="sub">${escapeHTML(item.SeriesName||item.ProductionYear||item.Type||'')}</div></div></button>`;
}
function catalogTile(item){
  const label=item.libraryId?'In your library':[2,3].includes(item.status)?'Requested':item.status===5?'Managed by Seerr':'Discover';
  return `<button class="tile" data-catalog-type="${item.mediaType}" data-catalog-id="${item.id}" ${item.libraryId?`data-item="${escapeHTML(item.libraryId)}"`:''}><div class="poster">${item.posterPath?`<img loading="lazy" src="/api/catalog/image?path=${encodeURIComponent(item.posterPath)}" alt=""/>`:escapeHTML(item.title).slice(0,1)}</div><div class="tile-info"><div class="title">${escapeHTML(item.title)}</div><div class="sub">${escapeHTML(item.year)} · ${item.mediaType==='movie'?'Movie':'TV'}</div><span class="availability">${label}</span></div></button>`;
}
function bindTiles(){
  document.querySelectorAll('[data-item]').forEach(el=>el.onclick=()=>showItem(el.dataset.item));
  document.querySelectorAll('[data-catalog-id]:not([data-item])').forEach(el=>el.onclick=()=>showCatalog(el.dataset.catalogType,el.dataset.catalogId));
}
const section=(title,items,renderer=mediaTile)=>`<section><div class="section-head"><h2>${title}</h2></div>${items.length?`<div class="grid shelf">${items.map(renderer).join('')}</div>`:'<p class="muted">No titles found.</p>'}</section>`;
const searchForm=query=>`<form id="universal-search" class="universal-search" role="search"><label class="sr-only" for="universal-query">Search movies and shows</label><input class="input" id="universal-query" name="q" type="search" maxlength="120" placeholder="Search movies and shows in your library and beyond" value="${escapeHTML(query)}"/><button class="primary">Search</button></form>`;
function bindSearch(){document.querySelector('#universal-search').onsubmit=event=>{event.preventDefault();search(new FormData(event.currentTarget).get('q'))}}
async function home(){
  const revision=state.revision;
  content(`<div class="home-intro"><h1 class="heading">${escapeHTML(state.branding.welcome)}</h1><p class="muted">Your library and your next request, in one place.</p>${searchForm('')}</div><div id="featured">${carouselPlaceholder()}</div><div id="discovery"><p class="loader">Loading recommendations…</p></div><div id="rows"><p class="loader">Loading your library…</p></div>`);bindSearch();
  disposePage=mountCarousel({root:document.querySelector('#featured'),api,isCurrent:()=>revision===state.revision,onSelect:showItem,escapeHTML});
  await Promise.all([
    (async()=>{try{const data=await cached('/api/home');if(revision!==state.revision)return;document.querySelector('#rows').innerHTML=section('Continue watching',data.resume)+section('Recently added',data.recent)+(data.errors?.length?`<p class="error">${escapeHTML(data.errors.join('; '))}</p>`:'');bindTiles();loadRemovals()}catch(error){if(revision===state.revision)document.querySelector('#rows').innerHTML=errorHTML(error)}})(),
    (async()=>{try{const data=await cached('/api/discover');if(revision!==state.revision)return;document.querySelector('#discovery').innerHTML=section('Popular movies',data.movies,catalogTile)+section('Popular shows',data.shows,catalogTile);bindTiles()}catch(error){if(revision===state.revision)document.querySelector('#discovery').innerHTML=`<p class="notice">Recommendations unavailable: ${escapeHTML(error.message)}</p>`}})()
  ]);
}
async function search(query=''){
  state.page='home';const revision=++state.revision;shell();content(`<div class="home-intro"><h1 class="heading">${escapeHTML(state.branding.welcome)}</h1>${searchForm(query)}</div><button class="ghost" id="browse-home">← Back to browsing</button><div id="search-results">${query?'<p class="loader">Searching…</p>':'<p class="muted">Search your Jellyfin library and Seerr’s movie and TV catalog.</p>'}</div>`);bindSearch();document.querySelector('#browse-home').onclick=()=>navigate('home');if(!query.trim())return;
  try{const result=await cached('/api/search?q='+encodeURIComponent(query));if(revision!==state.revision)return;document.querySelector('#search-results').innerHTML=section('In your library',result.library)+section('Discover & request',result.catalog.filter(i=>!i.libraryId),catalogTile)+result.errors.map(error=>`<p class="notice">${escapeHTML(error.source)}: ${escapeHTML(error.message)}</p>`).join('');bindTiles();loadRemovals()}
  catch(error){if(revision===state.revision)document.querySelector('#search-results').innerHTML=errorHTML(error)}
}
async function library(type,query=''){
  const revision=++state.revision,label={Movie:'Movies',Series:'TV Shows',Audio:'Music'}[type];
  content(`<h1 class="heading">${label}</h1>${type==='Audio'?'':'<div id="continue-row"><p class="loader">Loading Continue Watching…</p></div>'}<form id="library-filter" class="bar"><label class="sr-only" for="filter">Search ${label}</label><input class="input" id="filter" name="q" placeholder="Search ${label.toLowerCase()}" value="${escapeHTML(query)}"/><button class="primary">Search</button></form><div id="items"><p class="loader">Loading…</p></div>`);
  document.querySelector('#library-filter').onsubmit=event=>{event.preventDefault();library(type,new FormData(event.currentTarget).get('q'))};
  const tasks=[(async()=>{try{const data=await cached('/api/items?type='+type+'&q='+encodeURIComponent(query));if(revision!==state.revision)return;document.querySelector('#items').innerHTML=`<div class="grid">${(data.Items||[]).map(mediaTile).join('')}</div>`;bindTiles();loadRemovals()}catch(error){if(revision===state.revision)document.querySelector('#items').innerHTML=errorHTML(error)}})()];
  if(type!=='Audio')tasks.push((async()=>{try{const data=await cached('/api/continue?type='+type,15000);if(revision!==state.revision)return;document.querySelector('#continue-row').innerHTML=section('Continue watching',data.Items);bindTiles();loadRemovals()}catch(error){if(revision===state.revision)document.querySelector('#continue-row').innerHTML=errorHTML(error)}})());
  await Promise.all(tasks);
}
async function showItem(id,seasonId=''){
  const revision=++state.revision;state.page='detail';shell();content('<p class="loader">Loading details…</p>');
  try{
    const data=await cached('/api/details/'+encodeURIComponent(id)+(seasonId?'?seasonId='+encodeURIComponent(seasonId):''),30000);if(revision!==state.revision)return;
    content(renderDetail(data,escapeHTML));document.querySelector('#back').onclick=()=>navigate('home');
    document.querySelector('#similar-titles').innerHTML=section('More like this',data.similar);
    const picker=document.querySelector('#season-picker');if(picker)picker.onchange=()=>showItem(id,picker.value);
    disposePage=mountDetailPreview({api,itemId:id,root:document.querySelector('#content')});bindTiles();loadRemovals();
  }catch(error){if(revision===state.revision)content(errorHTML(error))}
}
async function showCatalog(type,id){
  const revision=++state.revision;state.page='detail';shell();content('<p class="loader">Loading details…</p>');
  try{
    const item=await api(`/api/catalog/${type}/${id}`);if(revision!==state.revision)return;
    if(item.libraryId)return showItem(item.libraryId);
    const blocked=type==='movie'&&[2,3,5].includes(item.status);
    content(`<button class="ghost" id="back">← Home</button><section class="detail-cinema">${item.backdropPath?`<img class="detail-backdrop" src="/api/catalog/image?wide=1&path=${encodeURIComponent(item.backdropPath)}" alt=""/>`:''}<div class="detail-shade"></div><div class="detail"><div class="poster">${item.posterPath?`<img src="/api/catalog/image?path=${encodeURIComponent(item.posterPath)}" alt="${escapeHTML(item.title)} poster"/>`:escapeHTML(item.title).slice(0,1)}</div><div class="detail-copy"><div class="eyebrow">${type==='movie'?'Movie':'TV Show'}</div><h1 class="heading">${escapeHTML(item.title)}</h1><div class="media-meta"><span>${escapeHTML(item.year)}</span>${item.rating?`<span>★ ${Number(item.rating).toFixed(1)}</span>`:''}${item.runtime?`<span>${item.runtime} min</span>`:''}</div><div class="genre-tags">${(item.genres||[]).map(genre=>`<span>${escapeHTML(genre)}</span>`).join('')}</div><p class="detail-overview">${escapeHTML(item.overview)}</p><form id="request-form">${type==='tv'?`<fieldset class="season-options"><legend>Seasons to request</legend>${item.seasons.map(season=>`<label class="key-clear"><input type="checkbox" name="season" value="${season.number}" ${season.requested?'disabled':''}/><span>${escapeHTML(season.name)}${season.requested?' · Already requested/available':''}</span></label>`).join('')||'<p>No seasons available.</p>'}</fieldset>`:''}<button class="primary" ${!item.canRequest||blocked?'disabled':''}>${blocked?'Already requested or available':'Request '+(type==='movie'?'movie':'selected seasons')}</button>${!item.canRequest?'<p class="muted">Your Seerr account does not have request permission.</p>':''}<p id="request-status" class="feedback" role="status"></p></form></div></div></section>${item.cast?.length?`<section class="detail-facts"><div><h2>Cast</h2>${item.cast.map(person=>`<p><strong>${escapeHTML(person.name)}</strong> ${escapeHTML(person.role)}</p>`).join('')}</div></section>`:''}`);
    document.querySelector('#back').onclick=()=>navigate('home');
    document.querySelector('#request-form').onsubmit=async event=>{
      event.preventDefault();const form=event.currentTarget,btn=form.querySelector('button'),output=document.querySelector('#request-status');btn.disabled=true;output.textContent='Submitting…';output.dataset.state='pending';
      try{const result=await api('/api/requests',{method:'POST',body:JSON.stringify({mediaType:type,mediaId:Number(id),...(type==='tv'?{seasons:new FormData(form).getAll('season').map(Number)}:{})})});state.cache.clear();output.dataset.state='success';output.textContent=result.status===1?'Request submitted for approval.':'Request submitted.';btn.textContent='Requested'}
      catch(error){output.dataset.state='error';output.textContent=error.message;btn.disabled=false}
    };
  }catch(error){if(revision===state.revision)content(errorHTML(error))}
}
function navigate(page){
  state.revision++;state.page=page;shell();
  if(page==='home')home();else if(page==='movies')library('Movie');else if(page==='shows')library('Series');
  else if(page==='admin'&&state.user.admin)renderAdministration({state,api,escapeHTML,applyBranding,navigate});
}
(async()=>{
  try{applyBranding(await api('/api/branding'))}catch{/* Keep defaults if branding is unavailable. */}
  try{state.user=await api('/api/me');navigate('home')}catch{login()}
})();
