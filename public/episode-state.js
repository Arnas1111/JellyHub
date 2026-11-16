import {watchBadge} from './watch-state.js';
export function episodeState(item){
  const played=item.played??item.UserData?.Played??false,positionTicks=item.positionTicks??item.UserData?.PlaybackPositionTicks??0,runtimeTicks=item.runtimeTicks??item.RunTimeTicks??0;
  return {played,positionTicks,runtimeTicks,percent:played?100:runtimeTicks?Math.max(0,Math.min(100,positionTicks/runtimeTicks*100)):0,state:played?'watched':positionTicks>0?'watching':'unwatched'};
}
export function episodeStatus(item){const state=episodeState(item);return `<span class="episode-status">${watchBadge(state).replace('Watching','In progress')}${state.state==='watching'?`<progress value="${state.percent}" max="100" aria-label="Episode watch progress"></progress>`:''}</span>`}
export function episodeToggle(item,e){const state=episodeState(item),id=item.id||item.Id,season=item.season??item.ParentIndexNumber??1,episode=item.episode??item.IndexNumber??'?';return `<button type="button" class="episode-watched-toggle ${state.played?'is-watched':''}" data-episode-toggle="${e(id)}" aria-pressed="${state.played}" aria-label="Mark S${e(season)} E${e(episode)} as ${state.played?'unwatched':'watched'}" title="Mark ${state.played?'unwatched':'watched'}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/>${state.played?'<path d="m7 12 3 3 7-7"/>':'<path d="M8 12h8"/>'}</svg></button>`}
export function renderEpisodeList(episodes,e,prefs={}){
  return episodes.map(item=>{const hidden=prefs.spoilerGuard&&!episodeState(item).played;return `<article class="episode-row"><button class="episode" data-item="${e(item.Id)}"><div class="episode-image">${item.ImageTags?.Primary&&!hidden?`<img src="/api/image/${encodeURIComponent(item.Id)}" alt="" loading="lazy"/>`:e(item.IndexNumber||'▶')}</div><div><h3>${e(item.IndexNumber?item.IndexNumber+'. ':'')}${e(hidden?'Episode '+(item.IndexNumber||''):item.Name)}</h3><p>${e(hidden?'Episode details are hidden until watched.':item.Overview||'')}</p><span class="muted">${item.RunTimeTicks?Math.round(item.RunTimeTicks/600000000)+' min':''}</span>${episodeStatus(item)}</div></button>${episodeToggle(item,e)}</article>`}).join('')||'<p class="muted">No episodes available in this season.</p>';
}
function apply(item,state){if('Id'in item)item.UserData={...item.UserData,Played:state.played,PlaybackPositionTicks:state.positionTicks};else Object.assign(item,state)}
export function mountEpisodeTracking({root,api,seriesId,getEpisodes,renderEpisodes,escapeHTML:e,getSeason=()=>null,onInvalidate=()=>{}}){
  const controller=new AbortController();let disposed=false,version=0,progress;const pending=new Set();
  const feedback=message=>{const node=root.querySelector('[data-episode-feedback]');if(node)node.textContent=message};
  function paint(){
    const holder=root.querySelector('[data-series-progress]');if(!holder||!progress)return;
    const season=progress.seasons.find(item=>item.id===getSeason());
    holder.innerHTML=`<span><strong>${progress.watched} / ${progress.total}</strong> episodes watched${progress.inProgress?` · ${progress.inProgress} in progress`:''}</span><progress value="${progress.watched}" max="${Math.max(1,progress.total)}" aria-label="Show watch progress"></progress>${season?`<small>This season: ${season.watched} / ${season.total} watched</small>`:''}`;
  }
  function redraw(){const focused=root.contains(document.activeElement)?document.activeElement?.dataset?.episodeToggle:null;renderEpisodes();for(const button of root.querySelectorAll('[data-episode-toggle]')){button.disabled=pending.has(button.dataset.episodeToggle);if(focused===button.dataset.episodeToggle)button.focus({preventScroll:true})}}
  function sync(){if(!progress)return;const states=new Map(progress.episodes.map(item=>[item.id,item]));for(const episode of getEpisodes()){const state=states.get(episode.id||episode.Id);if(state)apply(episode,state)}redraw();paint()}
  async function load(){const generation=++version;try{const data=await api('/api/series-progress/'+encodeURIComponent(seriesId),{signal:controller.signal});if(disposed||generation!==version)return;progress=data;sync()}catch(error){if(disposed||generation!==version)return;const holder=root.querySelector('[data-series-progress]');if(holder&&!progress)holder.textContent='Watch progress unavailable';feedback(error.message)}}
  root.addEventListener('click',async event=>{
    const button=event.target.closest('[data-episode-toggle]');if(!button||button.disabled||pending.has(button.dataset.episodeToggle))return;event.preventDefault();event.stopPropagation();
    const item=getEpisodes().find(item=>(item.id||item.Id)===button.dataset.episodeToggle);if(!item)return;const old=episodeState(item),played=!old.played,id=button.dataset.episodeToggle;pending.add(id);button.disabled=true;feedback('');
    try{const result=await api('/api/user-item/'+encodeURIComponent(button.dataset.episodeToggle),{method:'PUT',body:JSON.stringify({played})});onInvalidate();if(disposed)return;apply(item,{played,positionTicks:result.userData?.PlaybackPositionTicks??(played?0:old.positionTicks)});redraw();await load()}catch(error){if(!disposed){feedback(error.message);button.disabled=false}}finally{pending.delete(id);if(!disposed)for(const control of root.querySelectorAll('[data-episode-toggle]'))if(control.dataset.episodeToggle===id)control.disabled=false}
  },{signal:controller.signal});
  load();return {load,sync,dispose(){disposed=true;version++;controller.abort()}};
}
