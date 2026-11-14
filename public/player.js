const paths={play:'M8 5l11 7-11 7Z',pause:'M8 5v14M16 5v14',back:'m14 6-6 6 6 6',volume:'m4 10 4 0 5-4v12l-5-4H4ZM17 8q5 4 0 8',expand:'M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5',close:'m6 6 12 12M18 6 6 18',next:'m5 5 10 7-10 7ZM19 5v14',chapters:'M5 5h14M5 12h14M5 19h14',settings:'M5 7h14M5 17h14M9 4v6m6 4v6',pip:'M3 4h18v16H3ZM12 11h7v7h-7Z',bookmark:'M7 4h10v16l-5-4-5 4Z'};
const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]}"/></svg>`;
const button=(action,label,name)=>`<button type="button" class="player-icon" data-action="${action}" aria-label="${label}" title="${label}">${icon(name)}</button>`;
const defaults={autoPause:true,autoResume:false,autoNext:true,autoSkipIntro:false,autoSkipOutro:false,spoilerGuard:false,showStartInfo:true,keyboard:true,volume:80,muted:false,rate:1,subtitleSize:100,subtitleColor:'#ffffff',subtitleBackground:false,subtitleOutline:true};
const clock=seconds=>{const value=Math.max(0,Math.floor(seconds||0));return (value>=3600?Math.floor(value/3600)+':':'')+String(Math.floor(value/60)%60).padStart(2,'0')+':'+String(value%60).padStart(2,'0')};
const ticks=seconds=>Math.max(0,Math.round((seconds||0)*10000000));

export function mountPlayer({root,api,itemId,onClose,onPlay,escapeHTML:e,startTicks}){
  let endedReport=false;
  let info,hls,prefs={...defaults},disposed=false,started=false,restarting=false,reportQueue=Promise.resolve(),hideTimer,reportTimer,nextTimer,startInfoTimer,holdTimer,priorRate,suppressClick=false,wasPlaying=false,autoSkipped=new Set(),bookmarks=[],nextCancelled=false;
  let options={itemId,...(startTicks!==undefined?{startTicks}:{})};
  const oldOverflow=document.body.style.overflow;document.body.style.overflow='hidden';
  const background=[...document.querySelectorAll('.side,.top')].map(element=>({element,inert:element.inert}));background.forEach(({element})=>element.inert=true);
  root.innerHTML=`<section class="player-screen" role="dialog" aria-modal="true" aria-label="Video player"><video class="main-video" playsinline preload="metadata"></video><div class="player-vignette"></div><header class="player-top">${button('back','Return to details','back')}<div><span class="player-series"></span><h1 class="player-title">Preparing playback…</h1></div><span class="player-method"></span></header><div class="player-loading" role="status">Negotiating playback with Jellyfin…</div><div class="player-notice" role="status"></div><div class="player-start-info" hidden></div><div class="player-skip" hidden><button class="ghost" data-action="skip-segment"></button></div><div class="player-next" hidden><span>Up next</span><h2></h2><p></p><button class="primary" data-action="next">Play next episode</button><button class="ghost" data-action="cancel-next">Cancel autoplay</button></div><aside class="player-panel" hidden></aside><footer class="player-controls"><div class="player-timeline"><div class="player-markers"></div><label class="sr-only" for="playback-seek">Playback position</label><input id="playback-seek" type="range" min="0" max="1" value="0" step=".1"/></div><div class="player-toolbar"><div class="player-left">${button('toggle','Play or pause','play')}<button class="player-icon" data-action="rewind" aria-label="Back 10 seconds"><span class="player-seek-icon">−10</span></button><button class="player-icon" data-action="forward" aria-label="Forward 10 seconds"><span class="player-seek-icon">+10</span></button>${button('mute','Mute or unmute','volume')}<label class="sr-only" for="playback-volume">Volume</label><input id="playback-volume" type="range" min="0" max="100" value="80"/><span class="player-time">00:00 / 00:00</span></div><div class="player-right">${button('bookmark','Bookmark this moment','bookmark')}${button('chapters','Chapters','chapters')}${button('episodes','Episodes','next')}${button('settings','Audio, subtitles and quality','settings')}${button('pip','Picture in picture','pip')}${button('fullscreen','Fullscreen','expand')}</div></div></footer></section>`;
  const screen=root.querySelector('.player-screen'),video=root.querySelector('video'),seek=root.querySelector('#playback-seek'),volume=root.querySelector('#playback-volume'),panel=root.querySelector('.player-panel'),loading=root.querySelector('.player-loading'),notice=root.querySelector('.player-notice');
  const position=()=>Number.isFinite(video.currentTime)?video.currentTime:info?.startSeconds||0;
  const runtime=()=>info?.runtimeSeconds||Number.isFinite(video.duration)&&video.duration||0;
  const nextEpisode=()=>{if(!info)return null;if(info.nextEpisode)return info.nextEpisode;const index=info.episodes.findIndex(item=>item.id===info.item.id);return index>=0?info.episodes[index+1]||null:null};
  const notify=text=>{notice.textContent=text;clearTimeout(notice.timer);notice.timer=setTimeout(()=>notice.textContent='',5000)};
  const showControls=()=>{screen.classList.remove('controls-hidden');clearTimeout(hideTimer);if(!video.paused&&panel.hidden)hideTimer=setTimeout(()=>{if(!screen.contains(document.activeElement)||document.activeElement===video)screen.classList.add('controls-hidden')},3500)};
  function queueReport(event,keepalive=false){
    if(!info||endedReport)return Promise.resolve();const id=info.id;const body={event,positionTicks:ticks(position()),paused:video.paused,muted:video.muted,volume:Math.round(video.volume*100),rate:video.playbackRate};
    reportQueue=reportQueue.catch(()=>{}).then(()=>api(`/api/playback/${id}/report`,{method:'POST',body:JSON.stringify(body),keepalive}));
    return reportQueue;
  }
  function destroyMedia(){hls?.destroy();hls=null;video.pause();video.removeAttribute('src');video.querySelectorAll('track').forEach(track=>track.remove());video.load()}
  async function stopCurrent(){
    clearInterval(reportTimer);reportTimer=null;clearInterval(nextTimer);nextTimer=null;
    if(!info)return;const pending=queueReport('stop',true).catch(()=>{});info=null;destroyMedia();await pending;
  }
  function setSubtitles(){
    video.querySelectorAll('track').forEach(track=>track.remove());
    if(info?.subtitle){const track=document.createElement('track');track.kind='subtitles';track.src=info.subtitle;track.srclang=info.tracks.find(t=>t.type==='Subtitle'&&t.index===info.subtitleIndex)?.language||'und';track.label='Selected subtitles';track.default=true;video.append(track);track.onload=()=>{track.track.mode='showing';for(const cue of track.track.cues||[]){cue.snapToLines=false;cue.line=prefs.subtitlePosition??90}}}
    video.style.setProperty('--subtitle-size',`${prefs.subtitleSize}%`);video.style.setProperty('--subtitle-color',prefs.subtitleColor);video.classList.toggle('subtitle-background',prefs.subtitleBackground);video.classList.toggle('subtitle-outline',prefs.subtitleOutline);
  }
  function markers(){
    const container=root.querySelector('.player-markers');container.replaceChildren();
    for(const chapter of info?.chapters||[]){const marker=document.createElement('span');marker.className='chapter-marker';marker.style.left=Math.min(100,chapter.startTicks/10000000/runtime()*100)+'%';marker.title=chapter.name;container.append(marker)}
    for(const bookmark of bookmarks.filter(b=>b.itemId===info?.item.id)){const marker=document.createElement('span');marker.className='bookmark-marker';marker.style.left=Math.min(100,bookmark.positionTicks/10000000/runtime()*100)+'%';marker.title=bookmark.label||'Bookmark';container.append(marker)}
  }
  async function begin(patch={}){
    if(restarting||disposed)return;restarting=true;loading.hidden=false;loading.textContent='Preparing your stream…';panel.hidden=true;
    try{
      await stopCurrent();endedReport=false;options={...options,...patch};started=false;autoSkipped=new Set();nextCancelled=false;root.querySelector('.player-next').hidden=true;
      const probe=document.createElement('video');
      const data=await api('/api/playback/start',{method:'POST',body:JSON.stringify({...options,hevc:!!probe.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"'),av1:!!probe.canPlayType('video/mp4; codecs="av01.0.05M.08"')})});
      if(disposed){api(`/api/playback/${data.id}/report`,{method:'POST',body:JSON.stringify({event:'stop',positionTicks:ticks(data.startSeconds)})}).catch(()=>{});return}
      info=data;root.querySelector('.player-title').textContent=data.item.name;root.querySelector('.player-series').textContent=data.item.series;root.querySelector('.player-method').textContent=data.method==='DirectPlay'?'Direct play':data.method==='DirectStream'?'Direct stream':'Transcoding';
      options.itemId=data.item.id;seek.max=String(runtime()||1);seek.value=String(data.startSeconds);video.volume=prefs.volume/100;video.muted=prefs.muted;video.playbackRate=prefs.rate;volume.value=String(prefs.volume);setSubtitles();markers();
      root.querySelector('[data-action="episodes"]').hidden=!data.episodes.length;root.querySelector('[data-action="chapters"]').hidden=!data.chapters.length;
      if(data.hls&&!video.canPlayType('application/vnd.apple.mpegurl')){
        const {default:Hls}=await import('./vendor/hls.min.mjs');if(disposed)return;
        if(!Hls.isSupported())throw Error('This browser does not support the negotiated HLS stream.');
        let networkRecoveries=0,mediaRecoveries=0;
        hls=new Hls({enableWorker:true,startPosition:data.startSeconds,maxBufferLength:30,maxMaxBufferLength:60,backBufferLength:30});hls.attachMedia(video);hls.loadSource(data.url);
        hls.on(Hls.Events.ERROR,(_,error)=>{if(!error.fatal)return;if(error.type===Hls.ErrorTypes.NETWORK_ERROR&&networkRecoveries++<3){hls.startLoad();notify('Reconnecting to Jellyfin…')}else if(error.type===Hls.ErrorTypes.MEDIA_ERROR&&mediaRecoveries++<2)hls.recoverMediaError();else showFailure('The stream could not be decoded or reconnected. Try another quality or audio track.')});
      }else video.src=data.url;
      reportTimer=setInterval(()=>{if(started)queueReport('progress').catch(()=>notify('Watch progress could not be saved. Check the Jellyfin connection.'))},10000);
    }catch(error){if(!disposed)showFailure(error.message)}finally{restarting=false}
  }
  function showFailure(message){loading.hidden=false;loading.replaceChildren();const text=document.createElement('p');text.textContent=message;const retry=document.createElement('button');retry.className='primary';retry.textContent='Retry playback';retry.onclick=()=>begin({startTicks:ticks(position())});loading.append(text,retry);if(info?.method==='DirectPlay'){const compatible=document.createElement('button');compatible.className='ghost';compatible.textContent='Use compatible playback';compatible.onclick=()=>begin({forceTranscode:true,startTicks:ticks(position())});loading.append(compatible)}showControls()}
  function seekTo(seconds){const target=Math.max(0,Math.min(runtime()-.1,seconds));if(!Number.isFinite(target))return;video.currentTime=target;seek.value=String(target);if(started)queueReport('progress').catch(()=>{});showControls()}
  function toggle(){if(!info)return;if(video.ended){begin({startTicks:0});return}if(video.paused)video.play().catch(()=>notify('Press Play to start playback.'));else video.pause()}
  async function saveBookmark(){if(!info)return;try{const bookmark=await api('/api/bookmarks',{method:'POST',body:JSON.stringify({itemId:info.item.id,positionTicks:ticks(position()),label:''})});bookmarks.unshift(bookmark);markers();notify('Bookmark saved at '+clock(position()))}catch(error){notify(error.message)}}
  function showPanel(kind){
    if(!info)return;showControls();panel.hidden=false;
    if(kind==='settings'){
      panel.innerHTML=`<div class="player-panel-heading"><h2>Playback settings</h2>${button('close-panel','Close panel','close')}</div><label>Quality<select name="quality" aria-label="Quality"><option value="120000000">Original / Auto</option><option value="12000000">High · 12 Mbps</option><option value="6000000">Balanced · 6 Mbps</option><option value="3000000">Data saver · 3 Mbps</option><option value="1000000">Low · 1 Mbps</option></select></label><label>Version<select name="source" aria-label="Version">${info.sources.map(source=>`<option value="${e(source.id)}" ${source.id===info.sourceId?'selected':''}>${e(source.name)}</option>`).join('')}</select></label><label>Audio<select name="audio" aria-label="Audio">${info.tracks.filter(track=>track.type==='Audio').map(track=>`<option value="${track.index}" ${track.index===info.audioIndex?'selected':''}>${e(track.title)}</option>`).join('')}</select></label><label>Subtitles<select name="subtitles" aria-label="Subtitles"><option value="-1">Off</option>${info.tracks.filter(track=>track.type==='Subtitle').map(track=>`<option value="${track.index}" ${track.index===info.subtitleIndex?'selected':''}>${e(track.title)}${track.text?'':' · Burn in'}</option>`).join('')}</select></label><label>Speed<select name="rate" aria-label="Speed">${[.5,.75,1,1.25,1.5,1.75,2].map(rate=>`<option ${rate===video.playbackRate?'selected':''}>${rate}</option>`).join('')}</select></label><label class="key-clear"><input type="checkbox" name="auto-skip" ${prefs.autoSkipIntro?'checked':''}/> Automatically skip intros/recaps</label><label class="key-clear"><input type="checkbox" name="auto-next" ${prefs.autoNext?'checked':''}/> Play next episode automatically</label><small>Jellyfin controls which formats, tracks and qualities are available.</small>`;
      panel.querySelector('[name="quality"]').value=String(options.maxBitrate||120000000);
      panel.querySelector('[name="quality"]').onchange=event=>begin({maxBitrate:Number(event.target.value),forceTranscode:Number(event.target.value)<120000000,startTicks:ticks(position())});
      panel.querySelector('[name="source"]').onchange=event=>begin({sourceId:event.target.value,startTicks:ticks(position()),audioIndex:undefined,subtitleIndex:-1});
      panel.querySelector('[name="audio"]').onchange=event=>begin({audioIndex:Number(event.target.value),forceTranscode:true,startTicks:ticks(position())});
      panel.querySelector('[name="subtitles"]').onchange=event=>{const index=Number(event.target.value),track=info.tracks.find(track=>track.type==='Subtitle'&&track.index===index);begin({subtitleIndex:index,burnSubtitles:track&&!track.text,forceTranscode:!!track&&!track.text||options.forceTranscode,startTicks:ticks(position())})};
      panel.querySelector('[name="rate"]').onchange=event=>{video.playbackRate=Number(event.target.value);prefs.rate=video.playbackRate;savePreferences({rate:prefs.rate})};
      panel.querySelector('[name="auto-skip"]').onchange=event=>{prefs.autoSkipIntro=event.target.checked;savePreferences({autoSkipIntro:prefs.autoSkipIntro})};
      panel.querySelector('[name="auto-next"]').onchange=event=>{prefs.autoNext=event.target.checked;savePreferences({autoNext:prefs.autoNext})};
    }else if(kind==='episodes')panel.innerHTML=`<div class="player-panel-heading"><h2>Episodes</h2>${button('close-panel','Close panel','close')}</div>${info.seasons?.length?`<label>Season<select class="input" aria-label="Episode season">${info.seasons.map(season=>`<option value="${e(season.id)}" ${season.id===info.seasonId?'selected':''}>${e(season.name)}</option>`).join('')}</select></label>`:''}<div class="player-episode-list">${info.episodes.map(episode=>`<button class="player-episode ${episode.id===info.item.id?'current':''}" data-episode="${e(episode.id)}">${episode.image&&(!prefs.spoilerGuard||episode.played)?`<img src="/api/image/${encodeURIComponent(episode.id)}" alt="" loading="lazy"/>`:''}<span><small>S${episode.season||1} · E${episode.episode||'?'}</small><strong>${e(prefs.spoilerGuard&&!episode.played?'Episode '+episode.episode:episode.name)}</strong></span></button>`).join('')}</div><button class="ghost" data-more-episodes ${info.episodes.length<100?'hidden':''}>Load more episodes</button>`;
    else panel.innerHTML=`<div class="player-panel-heading"><h2>Chapters</h2>${button('close-panel','Close panel','close')}</div>${info.chapters.map(chapter=>`<button class="player-chapter" data-seek="${chapter.startTicks/10000000}"><span>${clock(chapter.startTicks/10000000)}</span>${e(prefs.spoilerGuard?'Chapter '+(chapter.index+1):chapter.name)}</button>`).join('')}`;
    if(kind==='episodes'){
      const season=panel.querySelector('[aria-label="Episode season"]'),more=panel.querySelector('[data-more-episodes]');let offset=info.episodes.length;
      const load=async(append=false)=>{const ticketId=info.id,seasonId=season?.value||info.seasonId;more.disabled=true;try{const data=await api('/api/playback/'+ticketId+'/episodes?seasonId='+encodeURIComponent(seasonId)+'&start='+(append?offset:0));if(disposed||!info||info.id!==ticketId||panel.hidden)return;info.episodes=append?[...info.episodes,...data.episodes]:data.episodes;info.seasonId=seasonId;showPanel('episodes');panel.querySelector('[data-more-episodes]').hidden=info.episodes.length>=data.total}catch(error){notify(error.message);more.disabled=false}};
      if(season)season.onchange=()=>load();if(more)more.onclick=()=>load(true);
    }
    panel.querySelectorAll('[data-episode]').forEach(button=>button.onclick=()=>onPlay(button.dataset.episode));panel.querySelectorAll('[data-seek]').forEach(button=>button.onclick=()=>{seekTo(Number(button.dataset.seek));panel.hidden=true});
  }
  function savePreferences(patch){api('/api/preferences',{method:'PUT',body:JSON.stringify(patch)}).catch(()=>notify('This preference could not be saved.'))}
  function checkSegments(){
    if(!info)return;const current=ticks(position()),segment=info.segments.find(segment=>current>=segment.startTicks&&current<segment.endTicks-5000000),box=root.querySelector('.player-skip');
    if(!segment){box.hidden=true;return}
    const type=String(segment.type),key=segment.id||type+segment.startTicks;
    const auto=(prefs.autoSkipIntro&&['Intro','Recap'].includes(type)||prefs.autoSkipOutro&&type==='Outro')&&!autoSkipped.has(key);
    if(auto){autoSkipped.add(key);seekTo(segment.endTicks/10000000);return}
    box.hidden=false;box.querySelector('button').textContent='Skip '+type.toLowerCase();box.querySelector('button').onclick=()=>{autoSkipped.add(key);seekTo(segment.endTicks/10000000);box.hidden=true};
  }
  function showNext(ended=false){
    const next=nextEpisode();if(!next||nextCancelled)return;const box=root.querySelector('.player-next');box.hidden=false;box.querySelector('h2').textContent=prefs.spoilerGuard&&!next.played?'Next episode':next.name;
    if(ended&&prefs.autoNext&&!nextTimer){let remaining=8;box.querySelector('p').textContent=`Starting in ${remaining} seconds`;nextTimer=setInterval(()=>{remaining--;box.querySelector('p').textContent=`Starting in ${remaining} seconds`;if(remaining<=0){clearInterval(nextTimer);nextTimer=null;onPlay(next.id)}},1000)}
  }
  video.onloadedmetadata=()=>{if(!info)return;seek.max=String(runtime());if(info.startSeconds>0&&Math.abs(video.currentTime-info.startSeconds)>2)video.currentTime=info.startSeconds;video.play().catch(()=>{loading.hidden=true;notify('Press Play to start playback.');showControls()})};
  video.onplaying=()=>{
    if(!info)return;loading.hidden=true;root.querySelector('[data-action="toggle"]').innerHTML=icon('pause');
    if(!started){started=true;queueReport('start').catch(()=>notify('Playback started, but Jellyfin could not record the session.'));if(prefs.showStartInfo){const card=root.querySelector('.player-start-info');card.textContent=[info.item.rating,...info.item.genres].filter(Boolean).join(' · ');card.hidden=!card.textContent;startInfoTimer=setTimeout(()=>card.hidden=true,6000)}}showControls();
  };
  video.onpause=()=>{if(disposed||!screen.isConnected)return;root.querySelector('[data-action="toggle"]').innerHTML=icon('play');screen.classList.add('is-paused');showControls();if(started&&!restarting)queueReport('progress').catch(()=>{})};
  video.addEventListener('playing',()=>screen.classList.remove('is-paused'));
  video.onwaiting=()=>{if(info&&!video.paused){loading.hidden=false;loading.textContent='Buffering…'}};
  video.ontimeupdate=()=>{if(!info)return;seek.value=String(position());root.querySelector('.player-time').textContent=clock(position())+' / '+clock(runtime());checkSegments();if(runtime()-position()<90)showNext()};
  video.onended=()=>{clearInterval(reportTimer);reportTimer=null;if(started){queueReport('stop',true).catch(()=>{});endedReport=true}showNext(true);showControls()};
  video.onerror=()=>{if(!info||restarting)return;showFailure('This stream could not play. Try a lower quality or a different audio track.')};
  seek.oninput=()=>{root.querySelector('.player-time').textContent=clock(Number(seek.value))+' / '+clock(runtime());showControls()};seek.onchange=()=>seekTo(Number(seek.value));
  volume.oninput=()=>{video.volume=Number(volume.value)/100;video.muted=false;prefs.volume=Number(volume.value);showControls()};volume.onchange=()=>savePreferences({volume:Number(volume.value)});
  root.addEventListener('click',async event=>{
    const action=event.target.closest('[data-action]')?.dataset.action;if(!action)return;
    if(action==='back'){await Promise.race([stopCurrent(),new Promise(resolve=>setTimeout(resolve,1500))]);onClose()}
    else if(action==='toggle')toggle();else if(action==='rewind')seekTo(position()-10);else if(action==='forward')seekTo(position()+10);
    else if(action==='mute'){video.muted=!video.muted;prefs.muted=video.muted;savePreferences({muted:prefs.muted})}
    else if(action==='fullscreen'){try{if(document.fullscreenElement)await document.exitFullscreen();else if(screen.requestFullscreen)await screen.requestFullscreen();else video.webkitEnterFullscreen?.()}catch{notify('Fullscreen is unavailable in this browser.')}}
    else if(action==='pip'){try{if(document.pictureInPictureElement)await document.exitPictureInPicture();else await video.requestPictureInPicture()}catch{notify('Picture in picture is unavailable in this browser.')}}
    else if(action==='settings'||action==='episodes'||action==='chapters')showPanel(action);
    else if(action==='close-panel'){panel.hidden=true;showControls()}
    else if(action==='bookmark')saveBookmark();else if(action==='next'){const next=nextEpisode();if(next)onPlay(next.id)}
    else if(action==='cancel-next'){nextCancelled=true;clearInterval(nextTimer);nextTimer=null;root.querySelector('.player-next').hidden=true}
  });
  video.onclick=()=>{if(suppressClick){suppressClick=false;return}toggle()};screen.onpointermove=showControls;screen.onfocusin=showControls;
  video.onpointerdown=event=>{if(event.button!==0)return;holdTimer=setTimeout(()=>{suppressClick=true;priorRate=video.playbackRate;video.playbackRate=2;notify('2× speed')},500)};
  const releaseHold=()=>{clearTimeout(holdTimer);if(priorRate){video.playbackRate=priorRate;priorRate=null}};video.onpointerup=releaseHold;video.onpointercancel=releaseHold;video.onpointerleave=releaseHold;
  const keyboard=event=>{
    if(event.key==='Tab'){
      const controls=[...screen.querySelectorAll('button,input,select')].filter(element=>!element.disabled&&element.getClientRects().length&&getComputedStyle(element).visibility!=='hidden');if(controls.length){const first=controls[0],last=controls.at(-1);if(event.shiftKey&&(document.activeElement===first||!screen.contains(document.activeElement))){event.preventDefault();last.focus()}else if(!event.shiftKey&&(document.activeElement===last||!screen.contains(document.activeElement))){event.preventDefault();first.focus()}}return;
    }
    if(!prefs.keyboard||event.ctrlKey||event.altKey||event.metaKey||/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)||document.activeElement?.isContentEditable)return;
    const key=event.key.toLowerCase();if([' ','k','arrowleft','arrowright','arrowup','arrowdown','f','m','e','b','n','c','?','mediaplaypause','mediastop'].includes(key))event.preventDefault();
    if(key==='arrowup'||key==='arrowdown'){video.volume=Math.max(0,Math.min(1,video.volume+(key==='arrowup'?.05:-.05)));volume.value=String(Math.round(video.volume*100));savePreferences({volume:Number(volume.value)});showControls();return}
    if(key==='mediaplaypause'){toggle();return}if(key==='mediastop'){root.querySelector('[data-action="back"]').click();return}
    if(key===' '||key==='k')toggle();else if(key==='arrowleft')seekTo(position()-10);else if(key==='arrowright')seekTo(position()+10);else if(key==='f')root.querySelector('[data-action="fullscreen"]').click();else if(key==='m')root.querySelector('[data-action="mute"]').click();else if(key==='e')showPanel('episodes');else if(key==='b')saveBookmark();else if(key==='n')root.querySelector('[data-action="next"]').click();else if(key==='c')showPanel('settings');else if(key==='?')notify('Space/K play · ←/→ seek · F fullscreen · M mute · E episodes · C settings · B bookmark · N next');else if(key==='escape'&&!panel.hidden)panel.hidden=true;showControls();
  };
  const visibility=()=>{if(document.hidden&&prefs.autoPause){wasPlaying=!video.paused;video.pause()}else if(!document.hidden&&prefs.autoResume&&wasPlaying){video.play().catch(()=>{});wasPlaying=false}};
  const pagehide=()=>{queueReport('stop',true).catch(()=>{})};
  document.addEventListener('keydown',keyboard);document.addEventListener('visibilitychange',visibility);window.addEventListener('pagehide',pagehide);
  Promise.all([api('/api/preferences').catch(()=>defaults),api('/api/bookmarks?itemId='+encodeURIComponent(itemId)).catch(()=>({items:[]}))]).then(([preferences,saved])=>{if(disposed)return;prefs={...defaults,...preferences};bookmarks=saved.items;begin()});
  return ()=>{disposed=true;stopCurrent().catch(()=>{});clearTimeout(hideTimer);clearTimeout(startInfoTimer);clearTimeout(holdTimer);clearTimeout(notice.timer);clearInterval(nextTimer);document.removeEventListener('keydown',keyboard);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('pagehide',pagehide);document.body.style.overflow=oldOverflow;background.forEach(({element,inert})=>element.inert=inert);if(document.fullscreenElement===screen)document.exitFullscreen().catch(()=>{})};
}
