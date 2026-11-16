import {mountChoice} from './choices.js';
// The video stays in this body-level host while page content is replaced.
export function createPlaybackWorkspace({api,escapeHTML:e,onPlay,onBrowse,onItem,getPreferences,getDetails}){
  let current,target,observer,seasonChoice;
  function position(){
    const slot=target?.querySelector('.watch-video-slot');if(!current||!slot?.isConnected)return;
    const box=slot.getBoundingClientRect();target.querySelector('.watch-layout').style.setProperty('--watch-player-height',box.height+'px');current.host.style.setProperty('--playback-left',box.left+'px');Object.assign(current.host.style,{left:box.left+window.scrollX+'px',top:box.top+window.scrollY+'px',width:box.width+'px',height:box.height+'px'});
  }
  function dock(){
    seasonChoice?.dispose();seasonChoice=null;
    observer?.disconnect();observer=null;target=null;if(!current)return;
    if(document.fullscreenElement&&current.host.contains(document.fullscreenElement))document.exitFullscreen().catch(()=>{});
    current.host.classList.add('player-docked');for(const key of ['left','top','width','height'])current.host.style[key]='';current.dispose?.setDocked(true);
  }
  function stop(){
    seasonChoice?.dispose();seasonChoice=null;
    const entry=current;if(!entry)return Promise.resolve();current=null;observer?.disconnect();observer=null;target=null;
    const stopped=entry.dispose?.();entry.host.remove();return Promise.resolve(stopped);
  }
  function tools(entry){
    const bar=document.createElement('div');bar.className='player-browse-tools';bar.innerHTML='<button type="button" data-watch-restore>Return to player</button><button type="button" data-watch-browse>Browse while watching</button>';
    bar.querySelector('[data-watch-restore]').onclick=()=>onPlay(entry.itemId);bar.querySelector('[data-watch-browse]').onclick=()=>onBrowse('home');entry.host.append(bar);
  }
  async function play(itemId,startTicks){
    if(current?.itemId===itemId&&startTicks===undefined)return;
    stop();const host=document.createElement('div');host.id='persistent-player';host.className='playback-host player-docked';const entry=current={itemId,host,info:null,queue:[],season:null};document.body.append(host);
    const {mountPlayer}=await import('./player.js');if(current!==entry)return;
    entry.dispose=mountPlayer({root:host,api,itemId,startTicks,escapeHTML:e,onPlay,
      onClose:()=>{if(current!==entry)return;const returnToDetails=target?.isConnected;stop();if(returnToDetails)onItem(entry.itemId)},
      onReady:info=>{if(current!==entry)return;entry.itemId=info.item.id;entry.info=info;entry.queue=info.episodes||[];entry.season=info.seasonId;paint(entry);getDetails('/api/details/'+encodeURIComponent(info.item.id)).then(details=>{if(current!==entry)return;entry.details=details;paintInfo(entry);if(!info.episodes.length)paintQueue(entry)}).catch(()=>{if(current!==entry)return;entry.details={similar:[],errors:['Similar titles are unavailable.']};if(!info.episodes.length)paintQueue(entry)})}
    });tools(entry);entry.dispose.setDocked(!target);position();
  }
  function paintInfo(entry){
    if(current!==entry||!target?.isConnected||!entry.info)return;const root=target.querySelector('.watch-information'),item=entry.info.item,details=entry.details?.item;
    root.innerHTML=`<div class="eyebrow">Now playing</div><h1>${e(item.series?item.series+' · '+item.name:item.name)}</h1><p class="muted">${[item.year,item.rating,...(item.genres||[])].filter(Boolean).map(e).join(' · ')}</p>${details?.Overview?`<p class="watch-overview">${e(details.Overview)}</p>`:''}<button class="ghost" data-watch-details>More information</button>`;root.querySelector('[data-watch-details]').onclick=()=>onItem(entry.itemId);
  }
  function episodeRows(entry,filter=''){
    const list=target?.querySelector('.watch-episode-list');if(!list||current!==entry)return;const prefs=getPreferences();
    list.innerHTML=entry.queue.filter(episode=>(prefs.spoilerGuard&&!episode.played?'Episode '+episode.episode:episode.name).toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase())).map(episode=>`<button class="watch-episode ${episode.id===entry.itemId?'current':''}" data-watch-episode="${e(episode.id)}" aria-current="${episode.id===entry.itemId?'true':'false'}"><span class="watch-episode-art">${episode.image&&(!prefs.spoilerGuard||episode.played)?`<img src="/api/image/${encodeURIComponent(episode.id)}" alt="" loading="lazy"/>`:`<span>${e(episode.episode||'▶')}</span>`}</span><span><small>S${episode.season||1} · E${episode.episode||'?'}</small><strong>${e(prefs.spoilerGuard&&!episode.played?'Episode '+episode.episode:episode.name)}</strong>${episode.played?'<small>Watched</small>':''}</span></button>`).join('')||'<p class="muted">No episodes found.</p>';
    list.querySelectorAll('[data-watch-episode]').forEach(button=>button.onclick=()=>onPlay(button.dataset.watchEpisode,0));
  }
  function paintQueue(entry){
    if(current!==entry||!target?.isConnected||!entry.info)return;const root=target.querySelector('.watch-queue');seasonChoice?.dispose();seasonChoice=null;
    if(!entry.info.seasons?.length&&!entry.queue.length){
      if(!entry.details){root.innerHTML='<h2>More like this</h2><div class="watch-related-loading" aria-busy="true"><span class="sr-only">Finding related titles</span></div>';return}
      const similar=entry.details.similar||[];root.innerHTML=`<h2>More like this</h2><div class="watch-related">${similar.slice(0,12).map(item=>`<button class="watch-recommendation" data-related="${e(item.Id)}"><span class="watch-related-art">${item.ImageTags?.Primary?`<img src="/api/image/${encodeURIComponent(item.Id)}?tag=${encodeURIComponent(item.ImageTags.Primary)}" alt="" loading="lazy"/>`:item.BackdropImageTags?.length?`<img src="/api/backdrop/${encodeURIComponent(item.Id)}" alt="" loading="lazy"/>`:e(item.Name.slice(0,1))}</span><span class="watch-related-copy"><strong>${e(item.Name)}</strong><small>${[item.ProductionYear,...(item.Genres||[]).slice(0,2)].filter(Boolean).map(e).join(' &middot; ')}</small></span></button>`).join('')||`<p class="muted">${entry.details.errors?.length?'Related titles are currently unavailable.':'No related titles available.'}</p>`}</div>`;
      root.querySelectorAll('[data-related]').forEach(button=>button.onclick=()=>onItem(button.dataset.related));root.querySelectorAll('.watch-related-art img').forEach(image=>image.onerror=()=>{image.parentElement.textContent=similar.find(item=>item.Id===image.closest('[data-related]').dataset.related)?.Name.slice(0,1)||''});return;
    }
    root.innerHTML=`<div class="watch-queue-header"><h2>Episodes</h2>${entry.info.seasons?.length?'<div class="watch-season"><span>Season</span><div id="watch-season-choice"></div></div>':''}<label class="sr-only" for="watch-episode-filter">Filter episodes</label><div class="watch-episode-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg><input class="input" id="watch-episode-filter" placeholder="Filter episodes" type="search"/></div></div><div class="watch-queue-scroll"><div class="watch-episode-list"></div><button class="ghost" data-watch-more ${entry.queue.length<100?'hidden':''}>Load more episodes</button></div><p class="feedback" role="status"></p>`;
    const filter=root.querySelector('#watch-episode-filter');filter.value=entry.filter||'';filter.oninput=()=>{entry.filter=filter.value;episodeRows(entry,filter.value)};episodeRows(entry,filter.value);
    let loading=false;
    const load=async(more=false)=>{
      if(loading)return;loading=true;const season=seasonChoice?.value||entry.season,button=root.querySelector('[data-watch-more]'),trigger=root.querySelector('.choice-trigger');button.disabled=true;if(trigger)trigger.disabled=true;
      try{const data=await api(`/api/playback/${entry.info.id}/episodes?`+new URLSearchParams({seasonId:season,start:String(more?entry.queue.length:0)}));if(current!==entry||!root.isConnected)return;entry.season=season;entry.queue=more?[...entry.queue,...data.episodes]:data.episodes;button.hidden=entry.queue.length>=data.total;episodeRows(entry,filter.value);if(!more)root.querySelector('.watch-queue-scroll').scrollTop=0;root.querySelector('.feedback').textContent=''}catch(error){if(root.isConnected){root.querySelector('.feedback').textContent=error.message;seasonChoice?.setValue(entry.season)}}finally{loading=false;button.disabled=false;if(trigger)trigger.disabled=false}
    };
    const choice=root.querySelector('#watch-season-choice');if(choice)seasonChoice=mountChoice(choice,{name:'watchSeason',label:'Watch season',options:entry.info.seasons.map(season=>({value:season.id,label:season.name})),value:entry.season,onChange:()=>load()});root.querySelector('[data-watch-more]').onclick=()=>load(true);
  }
  function paint(entry){paintInfo(entry);paintQueue(entry)}
  function show(root){
    if(!current)return;target=root;root.innerHTML='<section class="watch-layout"><div class="watch-video-slot" aria-label="Playback area"></div><aside class="watch-queue"><h2>Now playing</h2><p class="muted">Preparing playback...</p></aside></section><section class="watch-information"></section>';
    current.host.classList.remove('player-docked');current.dispose?.setDocked(false);observer?.disconnect();observer=new ResizeObserver(position);observer.observe(root.querySelector('.watch-video-slot'));position();paint(current);
  }
  window.addEventListener('resize',position);
  return {play,show,dock,stop,get active(){return !!current},get itemId(){return current?.itemId}};
}
