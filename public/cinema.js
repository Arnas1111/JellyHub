export const minutes=ticks=>ticks?Math.round(ticks/600000000)+' min':'';
export function metadata(item,escapeHTML){
  return `<div class="media-meta">${[item.ProductionYear,item.OfficialRating,item.CommunityRating?'★ '+Number(item.CommunityRating).toFixed(1):'',minutes(item.RunTimeTicks)].filter(Boolean).map(value=>`<span>${escapeHTML(value)}</span>`).join('')}</div>`;
}

// Only one visible preview is allowed to run. Call the returned disposer on navigation.
export function mountCarousel({root,api,isCurrent,onSelect,escapeHTML:e}){
  let data=null,index=0,sequence=0,disposed=false,timer,hourTimer,controller,playing=true,inView=true;
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  let enabled=!motion.matches&&!navigator.connection?.saveData;
  let video;
  const stopVideo=()=>{controller?.abort();if(video){video.pause();video.classList.remove('is-playing');video.removeAttribute('src');video.load();video=null}};
  function controls(){
    const pause=root.querySelector('[data-pause]');if(pause){pause.textContent=enabled?'Pause carousel':'Play carousel';pause.setAttribute('aria-pressed',String(!enabled))}
  }
  async function slide(next){
    stopVideo();if(disposed||!isCurrent()||!data?.items.length)return;
    index=(next+data.items.length)%data.items.length;const item=data.items[index],version=++sequence;
    root.innerHTML=`<section class="featured" aria-label="Featured titles"><img class="feature-backdrop" src="/api/backdrop/${encodeURIComponent(item.Id)}" alt=""/><video class="feature-video" muted playsinline preload="metadata" aria-hidden="true" tabindex="-1"></video><div class="feature-shade"></div><div class="feature-copy"><span class="eyebrow">${data.source==='popular'?'Popular in your library':'From your library'}</span><h2 class="featured-title">${e(item.Name)}</h2>${metadata(item,e)}<p class="feature-overview">${e(item.Overview||'Find your next favorite in your library.')}</p><button class="primary" data-details>More information</button><p class="preview-caption" aria-live="polite"></p></div><div class="carousel-controls"><button class="ghost" data-prev aria-label="Previous featured title">‹</button><span>${index+1} / ${data.items.length}</span><button class="ghost" data-next aria-label="Next featured title">›</button><button class="ghost" data-pause></button></div></section>`;
    controls();root.querySelector('[data-details]').onclick=()=>onSelect(item.Id);
    root.querySelector('[data-prev]').onclick=()=>slide(index-1);root.querySelector('[data-next]').onclick=()=>slide(index+1);
    root.querySelector('[data-pause]').onclick=()=>{enabled=!enabled;controls();if(enabled)slide(index);else stopVideo()};
    if(!enabled||document.hidden||!inView)return;
    controller=new AbortController();
    try{
      const info=await api('/api/preview/'+encodeURIComponent(item.Id),{signal:controller.signal});
      if(disposed||!isCurrent()||version!==sequence||!enabled)return;
      if(!info.playable){root.querySelector('.preview-caption').textContent='Artwork preview';return}
      video=root.querySelector('video');const target=video;target.muted=true;target.src=info.url;
      target.onloadedmetadata=()=>{if(Number.isFinite(target.duration))target.currentTime=Math.min(info.startSeconds,Math.max(0,target.duration-1));target.play().catch(()=>{if(target.isConnected)root.querySelector('.preview-caption').textContent='Artwork preview'})};
      target.onplaying=()=>{if(target.isConnected){target.classList.add('is-playing');root.querySelector('.preview-caption').textContent='Muted preview'}};
      target.ontimeupdate=()=>{if(target.currentTime>info.startSeconds+info.clipSeconds)target.pause()};
      target.onerror=()=>{if(target.isConnected){target.classList.remove('is-playing');root.querySelector('.preview-caption').textContent='Artwork preview'}};
    }catch(error){if(!disposed&&isCurrent()&&version===sequence&&error.name!=='AbortError')root.querySelector('.preview-caption').textContent='Artwork preview'}
  }
  async function refresh(){
    try{const result=await api('/api/featured');if(disposed||!isCurrent())return;data=result;if(!data.items.length){root.innerHTML='';return}await slide(0);hourTimer=setTimeout(refresh,Math.max(1000,Math.min(3600000,result.reshuffleAt-Date.now()+1000)))}
    catch{if(!disposed&&isCurrent())root.innerHTML=''}
  }
  const visibility=()=>{playing=!document.hidden;if(!playing)video?.pause();else if(enabled&&inView)video?.play().catch(()=>{})};
  const reduced=()=>{if(motion.matches){enabled=false;stopVideo();controls()}};
  document.addEventListener('visibilitychange',visibility);motion.addEventListener('change',reduced);
  const observer=new IntersectionObserver(entries=>{const was=inView;inView=entries[0]?.isIntersecting??true;if(!inView)video?.pause();else if(!was&&enabled&&!document.hidden)video?.play().catch(()=>{})},{threshold:.2});observer.observe(root);
  timer=setInterval(()=>{if(enabled&&playing&&inView&&data?.items.length>1)slide(index+1)},20000);
  refresh();
  return ()=>{disposed=true;sequence++;clearInterval(timer);clearTimeout(hourTimer);stopVideo();observer.disconnect();document.removeEventListener('visibilitychange',visibility);motion.removeEventListener('change',reduced)};
}

export function renderDetail(data,e){
  const item=data.item,genres=item.Genres||[];
  return `<button class="ghost" id="back">← Back</button><section class="detail-cinema"><img class="detail-backdrop" src="/api/backdrop/${encodeURIComponent(item.Id)}" alt=""/><div class="detail-shade"></div><div class="detail"><div class="poster">${item.ImageTags?.Primary?`<img src="/api/image/${encodeURIComponent(item.Id)}" alt="${e(item.Name)} poster"/>`:e(item.Name).slice(0,1)}</div><div class="detail-copy"><div class="eyebrow">${e(item.Type==='Series'?'Series':item.Type)}</div><h1 class="heading">${e(item.Name)}</h1>${metadata(item,e)}<div class="genre-tags">${genres.map(genre=>`<span>${e(genre)}</span>`).join('')}</div>${item.Taglines?.[0]?`<p class="tagline">${e(item.Taglines[0])}</p>`:''}<p class="detail-overview">${e(item.Overview||'No description available.')}</p><div class="detail-removal" data-removal-id="${e(item.Id)}"></div><div class="bar"><button class="primary" id="watch-preview">Watch preview</button></div><div id="detail-preview" class="feedback" role="status"></div><p class="muted playback-note">Full playback is coming next. Previews currently support compatible direct-play files.</p></div></div></section><section class="detail-facts"><div><h2>Cast & crew</h2>${data.people.length?data.people.map(person=>`<p><strong>${e(person.name)}</strong><span class="muted"> ${e(person.role||'')}</span></p>`).join(''):'<p class="muted">No cast information available.</p>'}</div><div><h2>More details</h2><p><span class="muted">Studios</span><br/>${e(data.studios.join(', ')||'—')}</p><p><span class="muted">Audio</span><br/>${e(data.technical.audio.join(', ')||'—')}</p><p><span class="muted">Subtitles</span><br/>${e(data.technical.subtitles.join(', ')||'—')}</p>${data.technical.video?`<p><span class="muted">Video</span><br/>${e([data.technical.video.codec,data.technical.video.height?data.technical.video.height+'p':'',data.technical.video.range].filter(Boolean).join(' · '))}</p>`:''}</div></section>${item.Type==='Series'?`<section id="series-episodes"><div class="section-head"><h2>Episodes</h2><label>Season <select class="input" id="season-picker">${data.seasons.map(season=>`<option value="${e(season.Id)}" ${season.Id===data.selectedSeason?'selected':''}>${e(season.Name)}</option>`).join('')}</select></label></div><div class="episode-list">${data.episodes.map(episode=>`<button class="episode" data-item="${e(episode.Id)}"><div class="episode-image">${episode.ImageTags?.Primary?`<img src="/api/image/${encodeURIComponent(episode.Id)}" alt="" loading="lazy"/>`:e(episode.IndexNumber||'▶')}</div><div><h3>${e(episode.IndexNumber?episode.IndexNumber+'. ':'')}${e(episode.Name)}</h3><p>${e(episode.Overview||'')}</p><span class="muted">${e(minutes(episode.RunTimeTicks))}${episode.UserData?.Played?' · Watched':''}</span></div></button>`).join('')||'<p class="muted">No episodes available in this season.</p>'}</div></section>`:''}<div id="similar-titles"></div>${data.errors.map(message=>`<p class="notice">${e(message)}</p>`).join('')}`;
}

export function mountDetailPreview({api,itemId,root}){
  let video,disposed=false,clipTimer;
  root.querySelector('#watch-preview').onclick=async()=>{
    const button=root.querySelector('#watch-preview'),output=root.querySelector('#detail-preview');button.disabled=true;output.textContent='Preparing preview…';
    try{const info=await api('/api/preview/'+encodeURIComponent(itemId));if(disposed)return;if(!info.playable){output.textContent=info.reason;button.disabled=false;return}
      output.innerHTML='<video class="detail-preview-player" controls muted playsinline></video>';video=output.querySelector('video');video.muted=true;video.src=info.url;
      const finish=()=>{clearTimeout(clipTimer);clipTimer=null;if(disposed)return;video.pause();video.removeAttribute('src');video.load();output.textContent='Preview ended.';button.disabled=false};
      video.onloadedmetadata=()=>{video.currentTime=Number.isFinite(video.duration)?Math.min(info.startSeconds,Math.max(0,video.duration-1)):info.startSeconds;video.play().catch(()=>{})};
      video.onplaying=()=>{if(!clipTimer)clipTimer=setTimeout(finish,info.clipSeconds*1000)};
      video.onended=finish;video.ontimeupdate=()=>{if(video.currentTime>info.startSeconds+info.clipSeconds)finish()};video.onerror=()=>{clearTimeout(clipTimer);if(!disposed){output.textContent='This preview cannot play in this browser.';button.disabled=false}};
    }catch(error){if(!disposed){output.textContent=error.message;button.disabled=false}}
  };
  return ()=>{disposed=true;clearTimeout(clipTimer);if(video){video.pause();video.removeAttribute('src');video.load()}};
}
