import {readFeaturedSnapshot,writeFeaturedSnapshot} from './featured-cache.js';
const INTERVAL=20000;

export function carouselPlaceholder(){
  return `<section class="featured is-loading" aria-label="Featured titles" aria-busy="true"><div class="feature-viewport"><div class="feature-track"><div class="feature-skeleton" aria-hidden="true"><span></span><strong></strong><p></p></div></div></div><div class="carousel-dots" role="group" aria-label="Choose a featured title"></div><div class="feature-progress" role="progressbar" aria-label="Time until next featured title" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="feature-progress-fill"></div></div><span class="sr-only">Loading featured titles</span></section>`;
}

export function createCarousel({root,api,isCurrent,onSelect,escapeHTML:e,metadata,cacheKey}){
  if(!root.querySelector('.featured'))root.innerHTML=carouselPlaceholder();
  const frame=root.querySelector('.featured'),track=root.querySelector('.feature-track'),dots=root.querySelector('.carousel-dots'),progress=root.querySelector('.feature-progress'),fill=root.querySelector('.feature-progress-fill');
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  let data,index=0,sequence=0,disposed=false,transitioning=false,elapsed=0,lastFrame=performance.now(),raf,hourTimer,controller,video,animation,pendingData;
  let hovered=root.matches(':hover')&&matchMedia('(hover: hover)').matches,inView=true;
  const images=new Map();
  let restorePending=false,artwork=null;
  const alive=()=>!disposed&&isCurrent();
  const paused=()=>hovered||document.hidden||!inView;
  const allowVideo=()=>!motion.matches&&!navigator.connection?.saveData;
  const stopVideo=()=>{controller?.abort();if(video){video.pause();video.classList.remove('is-playing');video.removeAttribute('src');video.load();video=null}};
  const playVideo=()=>{if(!paused()&&allowVideo())video?.play().catch(()=>{})};
  function resetClock(){elapsed=0;lastFrame=performance.now();updateProgress()}
  function updateProgress(){const value=Math.min(100,elapsed/INTERVAL*100);fill.style.transform=`scaleX(${value/100})`;const rounded=Math.floor(value);if(progress.getAttribute('aria-valuenow')!==String(rounded)){progress.setAttribute('aria-valuenow',String(rounded));progress.setAttribute('aria-valuetext',`${Math.ceil((INTERVAL-elapsed)/1000)} seconds until next title`)}}
  function remember(item,image){
    if(!cacheKey||restorePending||!alive()||data?.items[index]?.Id!==item.Id)return;
    writeFeaturedSnapshot(cacheKey,{...data,activeId:item.Id,artwork:artwork?.id===item.Id?artwork:null});
    if(!image.complete||!image.naturalWidth||image.src.startsWith('data:'))return;
    const version=sequence;
    try{
      const scale=Math.min(1,1280/image.naturalWidth,720/image.naturalHeight),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));const context=canvas.getContext('2d');context.fillStyle='#090b10';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
      canvas.toBlob(blob=>{if(!blob||blob.size>360000||!alive()||version!==sequence)return;const reader=new FileReader();reader.onload=()=>{if(!alive()||version!==sequence)return;artwork={id:item.Id,data:reader.result};writeFeaturedSnapshot(cacheKey,{...data,activeId:item.Id,artwork})};reader.readAsDataURL(blob)},'image/jpeg',.78);
    }catch{/* A metadata-only snapshot still removes the loading placeholder. */}
  }
  function imageFor(item,cachedImage){
    if(images.has(item.Id))return images.get(item.Id);
    const image=new Image();image.className='feature-backdrop';image.alt='';image.decoding='async';
    const ready=new Promise(resolve=>{image.onload=()=>{resolve(image);remember(item,image)};image.onerror=()=>{image.hidden=true;resolve(image)}});
    image.src=cachedImage||'/api/backdrop/'+encodeURIComponent(item.Id);
    const entry={image,ready};images.set(item.Id,entry);return entry;
  }
  function updateDots(){
    dots.replaceChildren();
    data.items.forEach((item,position)=>{
      const button=document.createElement('button');button.type='button';button.className='carousel-dot';button.setAttribute('aria-label',`Show featured title ${position+1}: ${item.Name}`);button.setAttribute('aria-current',position===index?'true':'false');button.disabled=transitioning;
      button.disabled=transitioning||restorePending;button.onclick=()=>show(position);dots.append(button);
    });
  }
  function createSlide(item,image){
    const slide=document.createElement('article');slide.className='feature-slide';slide.dataset.featureId=item.Id;
    slide.innerHTML=`<video class="feature-video" muted playsinline preload="metadata" aria-hidden="true" tabindex="-1"></video><div class="feature-shade"></div><div class="feature-copy"><span class="eyebrow">${data.source==='popular'?'Popular in your library':'From your library'}</span><h2 class="featured-title">${e(item.Name)}</h2>${metadata(item,e)}<p class="feature-overview">${e(item.Overview||'Find your next favorite in your library.')}</p><button class="feature-details" data-details><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle class="info-dot" cx="12" cy="7.5" r=".7"/></svg>More information</button></div>`;
    slide.prepend(image);slide.querySelector('[data-details]').onclick=()=>onSelect(item.Id);return slide;
  }
  async function preview(item,slide,version){
    if(!allowVideo()||!alive()||version!==sequence)return;
    const requestController=new AbortController();controller=requestController;
    try{
      const info=await api('/api/preview/'+encodeURIComponent(item.Id),{signal:requestController.signal});
      if(!info.playable||!alive()||version!==sequence||!allowVideo()||requestController.signal.aborted)return;
      const target=slide.querySelector('video');video=target;target.muted=true;target.src=info.url;
      target.onloadedmetadata=()=>{if(!alive()||version!==sequence)return;if(Number.isFinite(target.duration))target.currentTime=Math.min(info.startSeconds,Math.max(0,target.duration-1));playVideo()};
      target.onplaying=()=>{if(alive()&&version===sequence)target.classList.add('is-playing')};
      target.ontimeupdate=()=>{if(target.currentTime>info.startSeconds+info.clipSeconds)target.pause()};
      target.onerror=()=>target.classList.remove('is-playing');
    }catch{/* Artwork remains visible if negotiation, autoplay or decoding fails. */}
  }
  async function show(position,initial=false){
    if(!alive()||!data?.items.length||transitioning||restorePending||!initial&&position===index)return;
    transitioning=true;const previous=index;index=(position+data.items.length)%data.items.length;const item=data.items[index],version=++sequence;
    stopVideo();updateDots();
    const entry=imageFor(item);let imageTimeout;
    await Promise.race([entry.ready,new Promise(resolve=>imageTimeout=setTimeout(resolve,1500))]);clearTimeout(imageTimeout);
    if(!alive()||version!==sequence)return;
    const incoming=createSlide(item,entry.image),outgoing=track.querySelector('.feature-slide');
    frame.classList.remove('is-loading');frame.removeAttribute('aria-busy');frame.querySelector(':scope > .sr-only')?.remove();
    if(outgoing&&!motion.matches&&outgoing.dataset.featureId!==item.Id){
      // Two panels share one clipped viewport; the artwork, video and copy move together.
      const forward=index>previous||index===0&&previous===data.items.length-1;
      if(forward)track.append(incoming);else track.prepend(incoming);
      animation=track.animate([{transform:forward?'translateX(0)':'translateX(-100%)'},{transform:forward?'translateX(-100%)':'translateX(0)'}],{duration:650,easing:'cubic-bezier(.22,.61,.36,1)',fill:'forwards'});
      try{await animation.finished}catch{/* Navigation cancels an in-progress slide. */}
      if(!alive()||version!==sequence)return;
      track.replaceChildren(incoming);animation.cancel();animation=null;
    }else track.replaceChildren(incoming);
    transitioning=false;resetClock();updateDots();remember(item,entry.image);
    preview(item,incoming,version);
    if(data.items.length>1)imageFor(data.items[(index+1)%data.items.length]);
    if(pendingData&&!hovered){const next=pendingData;pendingData=null;apply(next)}
  }
  function apply(result){
    const previousId=data?.items[index]?.Id;
    data={...result,items:result.items.slice(0,8)};
    for(const id of images.keys())if(!data.items.some(item=>item.Id===id))images.delete(id);
    if(!data.items.length){writeFeaturedSnapshot(cacheKey,{items:[]});stopVideo();frame.classList.remove('is-loading');frame.removeAttribute('aria-busy');frame.querySelector(':scope > .sr-only')?.remove();track.innerHTML='<div class="feature-empty"><h2>Your next favorite is waiting.</h2><p class="muted">Featured titles appear here when media is available in your library.</p></div>';dots.replaceChildren();return}
    const position=data.items.findIndex(item=>item.Id===previousId);show(position<0?0:position,true);
  }
  async function refresh(){
    try{
      const result=await api('/api/featured');if(!alive())return;
      const wasRestoring=restorePending;restorePending=false;
      if(!wasRestoring&&(hovered||transitioning)&&data)pendingData=result;else apply(result);
      hourTimer=setTimeout(refresh,Math.max(1000,Math.min(3600000,result.reshuffleAt-Date.now()+1000)));
    }catch(error){if(!alive())return;if([401,403].includes(error.status)){writeFeaturedSnapshot(cacheKey,{items:[]});data=null;stopVideo();track.replaceChildren();dots.replaceChildren()}hourTimer=setTimeout(refresh,30000);if(!data){frame.classList.remove('is-loading');frame.removeAttribute('aria-busy');frame.querySelector(':scope > .sr-only')?.remove();track.innerHTML='<div class="feature-empty"><h2>Explore your library.</h2><p class="muted">Featured titles are temporarily unavailable.</p></div>'}}
  }
  function synchronize(){lastFrame=performance.now();if(paused())video?.pause();else playVideo()}
  const enter=event=>{if(event.pointerType!=='touch'){hovered=true;synchronize()}};
  const leave=event=>{if(event.pointerType!=='touch'){hovered=false;synchronize();if(pendingData&&!transitioning){const next=pendingData;pendingData=null;apply(next)}}};
  const reduced=()=>{if(!allowVideo())stopVideo()};
  root.addEventListener('pointerenter',enter);root.addEventListener('pointerleave',leave);document.addEventListener('visibilitychange',synchronize);motion.addEventListener('change',reduced);
  const observer=new IntersectionObserver(entries=>{inView=entries[0]?.isIntersecting??true;synchronize()},{threshold:.2});observer.observe(root);
  function tick(now){
    if(!alive())return;
    const delta=Math.max(0,now-lastFrame);lastFrame=now;
    if(data?.items.length>1&&!restorePending&&!paused()&&!transitioning){elapsed=Math.min(INTERVAL,elapsed+delta);updateProgress();if(elapsed>=INTERVAL)show((index+1)%data.items.length)}
    raf=requestAnimationFrame(tick);
  }
  const saved=readFeaturedSnapshot(cacheKey);
  if(saved){
    data=saved;artwork=saved.artwork;index=saved.items.findIndex(item=>item.Id===saved.activeId);restorePending=true;
    const item=data.items[index],entry=imageFor(item,artwork?.data);track.replaceChildren(createSlide(item,entry.image));frame.classList.remove('is-loading');frame.removeAttribute('aria-busy');frame.querySelector(':scope > .sr-only')?.remove();updateDots();
  }
  raf=requestAnimationFrame(tick);refresh();
  return ()=>{disposed=true;sequence++;cancelAnimationFrame(raf);clearTimeout(hourTimer);animation?.cancel();stopVideo();observer.disconnect();images.clear();root.removeEventListener('pointerenter',enter);root.removeEventListener('pointerleave',leave);document.removeEventListener('visibilitychange',synchronize);motion.removeEventListener('change',reduced)};
}
