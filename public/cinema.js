import {renderEpisodeList} from './episode-state.js';
import {hlsLoadPolicies} from './playback-policy.js';
import { createCarousel, carouselPlaceholder } from './carousel.js';
export { carouselPlaceholder };
export const minutes=ticks=>ticks?Math.round(ticks/600000000)+' min':'';
export function metadata(item,escapeHTML){
  return `<div class="media-meta">${[item.ProductionYear,item.OfficialRating,item.CommunityRating?'★ '+Number(item.CommunityRating).toFixed(1):'',minutes(item.RunTimeTicks)].filter(Boolean).map(value=>`<span>${escapeHTML(value)}</span>`).join('')}</div>`;
}

export function mountCarousel(options){return createCarousel({...options,metadata})}

export function renderDetail(data,e,prefs={}){
  const item=data.item,genres=item.Genres||[];
  return `<button class="ghost" id="back">← Back</button><section class="detail-cinema"><img class="detail-backdrop" src="/api/backdrop/${encodeURIComponent(item.Id)}" alt=""/><div class="detail-shade"></div><div class="detail"><div class="poster">${item.ImageTags?.Primary?`<img src="/api/image/${encodeURIComponent(item.Id)}" alt="${e(item.Name)} poster"/>`:e(item.Name).slice(0,1)}</div><div class="detail-copy"><div class="eyebrow">${e(item.Type==='Series'?'Series':item.Type)}</div><h1 class="heading">${e(item.Name)}</h1>${metadata(item,e)}<div class="genre-tags">${genres.map(genre=>`<span>${e(genre)}</span>`).join('')}</div>${item.Taglines?.[0]?`<p class="tagline">${e(item.Taglines[0])}</p>`:''}<p class="detail-overview">${e(item.Overview||'No description available.')}</p><div class="detail-removal" data-removal-id="${e(item.Id)}"></div><div class="bar"><button class="primary" id="play-media">${item.Type==='Series'?'Play series':item.UserData?.PlaybackPositionTicks?'Resume':'Play'}</button>${item.UserData?.PlaybackPositionTicks?'<button class="ghost" id="play-beginning">Play from beginning</button>':''}<button class="ghost" id="watch-preview">Watch preview</button><button class="ghost" id="favorite-media">${item.UserData?.IsFavorite?'In My list':'Add to My list'}</button><button class="ghost" id="watched-media">${item.UserData?.Played?'Mark unwatched':'Mark watched'}</button></div><div id="detail-preview" class="feedback" role="status"></div><p class="muted playback-note">Playback uses your Jellyfin account and saves progress to the server.</p></div></div></section><section class="detail-facts"><div><h2>Cast & crew</h2>${data.people.length?data.people.map(person=>`${person.id?`<button class="cast-person" data-person="${e(person.id)}">${person.image?`<img loading="lazy" src="/api/image/${encodeURIComponent(person.id)}" alt=""/>`:''}<span><strong>${e(person.name)}</strong><small>${e(person.role||'')}</small></span></button>`:`<p><strong>${e(person.name)}</strong><span class="muted"> ${e(person.role||'')}</span></p>`}`).join(''):'<p class="muted">No cast information available.</p>'}</div><div><h2>More details</h2><p><span class="muted">Studios</span><br/>${e(data.studios.join(', ')||'—')}</p><p><span class="muted">Audio</span><br/>${e(data.technical.audio.join(', ')||'—')}</p><p><span class="muted">Subtitles</span><br/>${e(data.technical.subtitles.join(', ')||'—')}</p>${data.technical.video?`<p><span class="muted">Video</span><br/>${e([data.technical.video.codec,data.technical.video.height?data.technical.video.height+'p':'',data.technical.video.range].filter(Boolean).join(' · '))}</p>`:''}</div></section>${item.Type==='Series'?`<section id="series-episodes"><div class="series-watch-progress" data-series-progress aria-live="polite">Loading watch progress...</div><p class="feedback" data-episode-feedback role="status"></p><div class="section-head"><h2>Episodes</h2><label>Season <select class="input" id="season-picker">${data.seasons.map(season=>`<option value="${e(season.Id)}" ${season.Id===data.selectedSeason?'selected':''}>${e(season.Name)}</option>`).join('')}</select></label></div><div class="episode-list">${renderEpisodeList(data.episodes,e,prefs)}</div>${(data.episodeTotal||0)>100?`<nav class="pagination" aria-label="Episode pages"><button class="ghost" id="previous-episodes" ${!data.episodeStart?'disabled':''}>Previous episodes</button><span>${(data.episodeStart||0)+1}–${Math.min((data.episodeStart||0)+100,data.episodeTotal)} of ${data.episodeTotal}</span><button class="ghost" id="next-episodes" ${(data.episodeStart||0)+100>=data.episodeTotal?'disabled':''}>Next episodes</button></nav>`:''}</section>`:''}<div id="similar-titles"></div><section id="community-reviews"></section>${data.errors.map(message=>`<p class="notice">${e(message)}</p>`).join('')}`;
}

export function mountDetailPreview({api,itemId,root}){
  let video,hls,ticket,disposed=false;
  const button=root.querySelector('#watch-preview'),output=root.querySelector('#detail-preview');
  const releaseTicket=info=>{if(info)api(`/api/playback/${info.id}/report`,{method:'POST',body:JSON.stringify({event:'stop',positionTicks:0}),keepalive:true}).catch(()=>{})};
  const cleanup=()=>{
    hls?.destroy();hls=null;
    if(video){video.onloadedmetadata=video.ontimeupdate=video.onended=video.onerror=null;video.pause();video.removeAttribute('src');video.load();video=null}
    const prior=ticket;ticket=null;releaseTicket(prior);
  };
  const finish=message=>{cleanup();if(!disposed){output.textContent=message;button.disabled=false}};
  button.onclick=async()=>{
    button.disabled=true;cleanup();output.textContent='Preparing preview…';
    try{
      const info=await api('/api/playback/start',{method:'POST',body:JSON.stringify({itemId,preview:true,maxBitrate:6000000,subtitleIndex:-1})});
      if(disposed){releaseTicket(info);return}ticket=info;
      output.innerHTML='<video class="detail-preview-player" controls playsinline></video><button type="button" class="ghost" data-stop-preview>Close preview</button><span class="preview-status" role="status"></span>';
      video=output.querySelector('video');const target=video,status=output.querySelector('.preview-status');
      output.querySelector('[data-stop-preview]').onclick=()=>finish('Preview closed.');
      let initialPositionApplied=false;
      target.onloadedmetadata=()=>{
        if(disposed||target!==video)return;
        if(!initialPositionApplied){initialPositionApplied=true;target.currentTime=Number.isFinite(target.duration)?Math.min(info.startSeconds,Math.max(0,target.duration-1)):info.startSeconds}
        target.play().catch(()=>{if(target===video)status.textContent='Press Play to start the preview.'});
      };
      target.ontimeupdate=()=>{if(target.currentTime>=info.startSeconds+info.clipSeconds)finish('Preview ended.')};
      target.onended=()=>finish('Preview ended.');target.onerror=()=>finish('The preview could not be decoded. Try again or use the full player’s quality settings.');
      if(info.hls){
        const {default:Hls}=await import('./vendor/hls.min.mjs');if(disposed||target!==video)return;
        if(Hls.isSupported()){
          hls=new Hls({...hlsLoadPolicies(Hls),enableWorker:true,startPosition:info.startSeconds,maxBufferLength:10,maxMaxBufferLength:20,backBufferLength:0});
          hls.on(Hls.Events.ERROR,(_,error)=>{if(error.fatal)finish('Jellyfin could not deliver a playable preview. Try again or check its transcoding logs.')});
          hls.attachMedia(target);hls.loadSource(info.url);
        }else if(target.canPlayType('application/vnd.apple.mpegurl'))target.src=info.url;else throw Error('This browser does not support HLS previews.');
      }else target.src=info.url;
    }catch(error){finish(error.message)}
  };
  return ()=>{disposed=true;cleanup()};
}
