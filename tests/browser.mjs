// Browser behavior is tested against isolated APIs. Live compatibility is a deployment check.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const dir=await mkdtemp(path.join(os.tmpdir(),'jellyhub-browser-'));
const child=spawn(process.execPath,[fileURLToPath(new URL('../server.js',import.meta.url))],{env:{...process.env,PORT:'0',CONFIG_DIR:dir}});
let browser;
try{
  const base=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('Startup timeout')),10000);
    child.on('exit',code=>{clearTimeout(timeout);reject(Error('Server exited '+code))});
    child.stdout.on('data',data=>{const match=String(data).match(/running on :(\d+)/);if(match){clearTimeout(timeout);resolve(`http://127.0.0.1:${match[1]}`)}});
  });
  browser=await chromium.launch(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{});
  const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const clip=Buffer.from(await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;const context=canvas.getContext('2d');context.fillStyle='#234c76';context.fillRect(0,0,160,90);
    const stream=canvas.captureStream(12),chunks=[];const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});
    const finished=new Promise(resolve=>{recorder.ondataavailable=event=>chunks.push(event.data);recorder.onstop=async()=>{stream.getTracks().forEach(track=>track.stop());resolve(Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())))}});
    recorder.start();let frame=0;const timer=setInterval(()=>{context.fillStyle=frame++%2?'#26475e':'#304961';context.fillRect(0,0,160,90)},80);setTimeout(()=>{clearInterval(timer);recorder.stop()},1200);return finished;
  }));
  let user=null,testPayload,failedSave=false,level='info',requestPayload,policyPayload,iconUploaded=false,releaseFeatured;
  const featuredReady=new Promise(resolve=>releaseFeatured=resolve);
  let branding={title:'JellyHub',name:'jellyhub.',welcome:'Discover your next favorite.',accent:'#9980ff',favicon:'/favicon.ico',logo:'/branding-logo'};
  const libraryItem={Id:'visible',Name:'Test Movie',Type:'Movie',ImageTags:{Primary:'tag'},RunTimeTicks:90000000000,UserData:{PlaybackPositionTicks:18000000000},ProductionYear:2026,Genres:['Adventure','Drama'],OfficialRating:'PG-13',CommunityRating:8.1,Overview:'A cinematic journey across an unfamiliar world.'};
  const seriesItem={Id:'series',Name:'Test Series',Type:'Series',ImageTags:{Primary:'tag'},Overview:'An unfolding story.',ProductionYear:2026};
  const episode={Id:'episode1',Name:'Pilot',Type:'Episode',SeriesName:'Test Series',IndexNumber:1,RunTimeTicks:18000000000,UserData:{PlaybackPositionTicks:6000000000}};
  const movie={id:200,mediaType:'movie',title:'New Movie',year:'2026',status:1,canRequest:true,seasons:[]};
  const show={id:300,mediaType:'tv',title:'New Show',status:1,canRequest:true,seasons:[{number:1,name:'Season 1',requested:false}]};
  const urls=Object.fromEntries(['jellyfin','seerr','sonarr','radarr','jellystat','maintainerr'].map(n=>[n+'Url','http://'+n+':3000']));
  const keys={seerrKey:false,sonarrKey:false,radarrKey:false};
  await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url());const body=()=>request.postDataJSON();
    const reply=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
    if(url.pathname==='/api/branding')return reply(branding);
    if(url.pathname==='/api/login'){user={id:body().username,name:body().username,admin:body().username==='admin'};return reply({user})}
    if(url.pathname==='/api/me')return reply(user||{error:'Not authenticated'},user?200:401);
    if(url.pathname==='/api/logout'){user=null;return reply({ok:true})}
    if(url.pathname==='/api/home')return reply({recent:[libraryItem],resume:[]});
    if(url.pathname==='/api/featured'){await featuredReady;return reply({items:[libraryItem,seriesItem,...Array.from({length:6},(_,index)=>({...libraryItem,Id:'featured'+index,Name:'Featured Movie '+(index+3)}))],source:'popular',reshuffleAt:Math.floor(Date.now()/3600000)*3600000+3600000})}
    if(url.pathname.startsWith('/api/preview/'))return reply({playable:true,url:'/api/preview-stream/test-clip',startSeconds:0,clipSeconds:20,container:'webm'});
    if(url.pathname==='/api/playback/start')return reply({id:'preview-test',url:'/api/preview-stream/test-clip',startSeconds:0,clipSeconds:20,hls:false});
    if(url.pathname==='/api/playback/preview-test/report')return reply({ok:true});
    if(url.pathname==='/api/preview-stream/test-clip')return route.fulfill({status:200,contentType:'video/webm',body:clip});
    if(url.pathname.startsWith('/api/backdrop/'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><defs><linearGradient id="g"><stop stop-color="#19354c"/><stop offset="1" stop-color="#7b4b5f"/></linearGradient></defs><path fill="url(#g)" d="M0 0h1920v1080H0z"/></svg>'});
    if(url.pathname==='/api/continue')return reply({Items:url.searchParams.get('type')==='Movie'?[libraryItem]:[episode]});
    if(url.pathname.startsWith('/api/details/')){
      const item=url.pathname.endsWith('series')?seriesItem:url.pathname.endsWith('episode1')?episode:libraryItem;
      return reply({item,people:[{name:'Actor One',role:'Lead'}],studios:['A Studio'],technical:{video:{codec:'h264',height:1080,range:'SDR'},audio:['English'],subtitles:['German']},seasons:item.Type==='Series'?[{Id:'season1',Name:'Season 1'},{Id:'season2',Name:'Season 2'}]:[],episodes:item.Type==='Series'?[{...episode,Name:url.searchParams.get('seasonId')==='season2'?'Second season premiere':'Pilot'}]:[],selectedSeason:url.searchParams.get('seasonId')||'season1',similar:[],errors:[]});
    }
    if(url.pathname==='/api/discover')return reply({movies:[movie],shows:[show]});
    if(url.pathname==='/api/search')return reply({library:[libraryItem],catalog:[movie,show],errors:[]});
    if(url.pathname==='/api/catalog/movie/200')return reply(movie);
    if(url.pathname==='/api/catalog/tv/300')return reply(show);
    if(url.pathname==='/api/requests'){requestPayload=body();return reply({id:7,status:1},201)}
    if(url.pathname==='/api/removals')return reply({byId:{visible:{collection:'Expiring',deletionDate:new Date(Date.now()+3*86400000).toISOString()}}});
    if(url.pathname==='/api/item/visible')return reply({...libraryItem,Overview:'Test description'});
    if(url.pathname==='/api/image/visible')return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l2kAAAAASUVORK5CYII=','base64')});
    if(url.pathname==='/api/items')return reply({Items:[libraryItem]});
    if(url.pathname==='/api/admin/overview')return reply({integrations:[{name:'seerr',status:'connected',data:{requests:[]}},{name:'sonarr',status:'connected',data:{records:[]}},{name:'radarr',status:'connected',data:{records:[]}}]});
    if(url.pathname==='/api/admin/settings/test'){testPayload=body();return testPayload.service==='radarr'?reply({status:'error',message:'Service returned HTTP 401.',diagnostics:{httpStatus:401,hint:'Verify the API key.'}}):reply({status:'connected',diagnostics:{httpStatus:200}})}
    if(url.pathname==='/api/admin/logging'){level=body().level;return reply({level,persisted:true})}
    if(url.pathname==='/api/admin/settings'){
      if(request.method()==='PUT'){
        if(failedSave)return reply({error:'Cannot save settings in /config (EACCES). Mount JellyHub appdata read/write.'},503);
        Object.assign(urls,body().urls);Object.entries(body().keys).forEach(([key,value])=>{if(value)keys[key]=true});return reply({ok:true});
      }
      return reply({urls,keys,logging:{level,levels:['silent','error','warn','info','debug']},storage:{writable:true}});
    }
    if(url.pathname==='/api/admin/branding'){if(request.method()==='PUT')branding={...branding,...body()};return reply(branding)}
    if(url.pathname==='/api/admin/branding/favicon'){iconUploaded=request.method()==='PUT'&&!!body().data;return reply({...branding,favicon:'/favicon.ico?v=uploaded'})}
    if(url.pathname==='/api/admin/branding/logo'){branding={...branding,logo:request.method()==='PUT'?'/branding-logo?v=uploaded':branding.favicon};return reply(branding)}
    if(url.pathname==='/api/admin/users')return reply({users:[{id:'viewer',name:'Viewer',policy:{IsAdministrator:false,EnableAllFolders:false,EnabledFolders:['movies']}}],libraries:[{id:'movies',name:'Movies'}]});
    if(url.pathname==='/api/admin/users/viewer'){policyPayload=body();return reply({ok:true})}
    return reply({error:'Unexpected mocked route '+url.pathname},404);
  });
  const adminTab=async name=>{await page.getByRole('button',{name,exact:true}).click();await page.locator('#admin-content h2').getByText(name==='Users'?'Jellyfin users':name,{exact:true}).waitFor()};
  async function login(name){await page.getByPlaceholder('Username',{exact:true}).fill(name);await page.getByPlaceholder('Password',{exact:true}).fill('secret');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:branding.welcome}).waitFor()}
  await page.goto(base);await login('admin');
  const reserved=await page.locator('.featured').boundingBox();const belowBefore=await page.locator('#discovery').boundingBox();
  assert.equal(reserved.height,480);assert.ok(await page.locator('.featured.is-loading').isVisible());releaseFeatured();
  await page.locator('.feature-slide').waitFor();
  assert.equal((await page.locator('.featured').boundingBox()).height,reserved.height);assert.ok(Math.abs((await page.locator('#discovery').boundingBox()).y-belowBefore.y)<1,'Featured content must not shift the following row');
  assert.equal(await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Search',exact:true}).count(),0);
  assert.equal(await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Music',exact:true}).count(),0);
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Movies',exact:true}).hover();assert.equal(await page.locator('[data-nav="movies"]').evaluate(el=>getComputedStyle(el).color),'rgb(255, 194, 48)');
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'TV Shows',exact:true}).hover();assert.equal(await page.locator('[data-nav="shows"]').evaluate(el=>getComputedStyle(el).color),'rgb(76, 200, 242)');await page.mouse.move(0,0);
  assert.ok(await page.locator('.brand-mark').isVisible());
  const iconResponse=await page.request.get(base+'/favicon.ico');
  assert.equal(iconResponse.status(),200);
  assert.ok(await page.locator('.brand-mark').evaluate(async image=>{try{await image.decode();return image.naturalWidth>0}catch{return false}}),'Sidebar brand image must decode: '+await iconResponse.text());
  await page.waitForFunction(()=>document.querySelector('.feature-video')?.currentTime>.1);
  assert.ok(await page.locator('.feature-video').evaluate(video=>video.muted&&video.videoWidth>0),'Generated WebM must decode as a muted preview');
  assert.equal(await page.locator('.carousel-dot').count(),8);assert.equal(await page.locator('.carousel-dot[aria-current="true"]').count(),1);assert.equal(await page.locator('.featured').evaluate(el=>getComputedStyle(el).borderRadius),'0px');
  assert.equal(await page.getByText('Artwork preview',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Pause carousel',exact:true}).count(),0);
  await page.locator('.featured').hover();assert.ok(await page.locator('.feature-video').evaluate(video=>video.paused));
  const frozen=await page.locator('.feature-progress').getAttribute('aria-valuenow');await page.waitForTimeout(250);assert.equal(await page.locator('.feature-progress').getAttribute('aria-valuenow'),frozen);await page.mouse.move(0,0);
  await page.getByRole('button',{name:'Show featured title 2: Test Series',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.feature-track').getAnimations().some(animation=>animation.playState==='running'));
  await page.waitForFunction(()=>document.querySelector('.feature-track').children.length===1);await page.getByRole('heading',{name:'Test Series',exact:true}).waitFor();
  await page.getByRole('button',{name:'Show featured title 1: Test Movie',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.feature-track').children.length===1);await page.mouse.move(0,0);
  assert.equal(await page.getByText('Your media universe',{exact:false}).count(),0);
  await page.getByRole('heading',{name:'Popular movies'}).waitFor();
  if(process.env.SCREENSHOT_PATH)await page.screenshot({path:process.env.SCREENSHOT_PATH.replace('.png','-home.png'),fullPage:true});
  await page.locator('[data-item="visible"]').click();await page.getByRole('heading',{name:'Test Movie',exact:true}).waitFor();
  await page.locator('.detail-removal').getByText('3d until removal').waitFor();
  await page.getByRole('heading',{name:'Cast & crew',exact:true}).waitFor();await page.getByText('Actor One',{exact:true}).waitFor();
  assert.equal(await page.locator('.detail>.poster').evaluate(el=>getComputedStyle(el).borderTopLeftRadius),'13px');
  assert.equal(await page.locator('.detail>.poster').evaluate(el=>getComputedStyle(el).overflow),'hidden');
  if(process.env.SCREENSHOT_PATH)await page.screenshot({path:process.env.SCREENSHOT_PATH.replace('.png','-detail.png'),fullPage:true});
  await page.getByRole('button',{name:'Watch preview',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.detail-preview-player')?.currentTime>.1);
  await page.getByRole('button',{name:'Movies',exact:true}).click();await page.locator('#continue-row').getByRole('heading',{name:'Continue watching'}).waitFor();assert.equal(await page.locator('#continue-row progress').count(),1);
  await page.getByRole('button',{name:'TV Shows',exact:true}).click();await page.locator('#continue-row [data-item="episode1"]').waitFor();
  await page.getByRole('button',{name:'Home',exact:true}).click();await page.getByRole('button',{name:'Show featured title 2: Test Series',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.feature-track').children.length===1);await page.getByRole('button',{name:'More information',exact:true}).click();await page.getByRole('heading',{name:'Episodes',exact:true}).waitFor();await page.locator('#season-picker').selectOption('season2');await page.getByRole('heading',{name:'1. Second season premiere',exact:true}).waitFor();
  await page.getByRole('button',{name:'Administration',exact:true}).click();await adminTab('Sonarr');
  assert.equal(await page.locator('.nav').getByRole('button',{name:'Connections'}).count(),0);
  assert.equal(await page.locator('.admin-tabs').evaluate(el=>getComputedStyle(el).display),'flex');
  await page.locator('[name="apiKey"]').fill('unsaved-test-key');await page.getByRole('button',{name:'Test connection',exact:true}).click();await page.locator('#connection-status').getByText('Connected',{exact:false}).waitFor();
  assert.equal(testPayload.apiKey,'unsaved-test-key');assert.equal(keys.sonarrKey,false);
  assert.equal(await page.locator('#connection-status').evaluate(el=>getComputedStyle(el).color),'rgb(152, 237, 191)');
  failedSave=true;await page.getByRole('button',{name:'Save settings',exact:true}).click();await page.locator('#save-status').getByText('Cannot save settings',{exact:false}).waitFor();assert.equal(await page.locator('[name="apiKey"]').inputValue(),'unsaved-test-key');
  failedSave=false;await page.getByRole('button',{name:'Save settings',exact:true}).click();await page.getByText('Settings saved.',{exact:true}).waitFor();assert.equal(keys.sonarrKey,true);
  await adminTab('Radarr');await page.getByRole('button',{name:'Test connection',exact:true}).click();await page.getByText('Service returned HTTP 401.',{exact:false}).waitFor();assert.equal(await page.locator('#connection-status').evaluate(el=>getComputedStyle(el).color),'rgb(255, 161, 161)');
  await adminTab('General');await page.locator('select[name="level"]').selectOption('debug');await page.getByRole('button',{name:'Apply log level'}).click();await page.getByText('Log level saved.',{exact:true}).waitFor();assert.equal(level,'debug');
  await adminTab('Branding');await page.getByLabel('Browser title').fill('My Cinema');await page.getByLabel('Sidebar text').fill('Cinema');await page.getByRole('button',{name:'Save branding',exact:true}).click();await page.getByText('Branding saved.',{exact:true}).waitFor();assert.equal(await page.title(),'My Cinema');assert.equal(await page.locator('[data-brand]').textContent(),'Cinema');
  await page.getByLabel('Favicon file',{exact:true}).setInputFiles({name:'favicon.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l2kAAAAASUVORK5CYII=','base64')});await page.getByRole('button',{name:'Upload favicon',exact:true}).click();await page.getByText('Favicon saved.',{exact:true}).waitFor();assert.equal(iconUploaded,true);
  await page.getByLabel('Logo file',{exact:true}).setInputFiles({name:'logo.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l2kAAAAASUVORK5CYII=','base64')});await page.getByRole('button',{name:'Upload logo',exact:true}).click();await page.getByText('Logo saved.',{exact:true}).waitFor();assert.match(await page.locator('.brand-mark').getAttribute('src'),/branding-logo/);
  await adminTab('Users');await page.locator('[data-user="viewer"]').click();await page.getByLabel('Allow remote access',{exact:true}).check();await page.getByRole('button',{name:'Save permissions'}).click();await page.getByText('Permissions saved.',{exact:true}).waitFor();assert.equal(policyPayload.policy.EnableRemoteAccess,true);assert.deepEqual(policyPayload.policy.EnabledFolders,['movies']);
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Admin must fit mobile viewport');
  if(process.env.SCREENSHOT_PATH)await page.screenshot({path:process.env.SCREENSHOT_PATH,fullPage:true});
  await page.getByRole('button',{name:'Home',exact:true}).click();await page.locator('#universal-query').fill('Movie');await page.locator('#universal-search').getByRole('button',{name:'Search',exact:true}).click();await page.getByRole('heading',{name:'Discover & request'}).waitFor();await page.locator('[data-catalog-id="200"]').click();await page.getByRole('button',{name:'Request movie',exact:true}).click();await page.getByText('Request submitted for approval.',{exact:true}).waitFor();assert.deepEqual(requestPayload,{mediaType:'movie',mediaId:200});
  await page.getByRole('button',{name:'Home',exact:true}).first().click();await page.locator('[data-catalog-id="300"]').click();await page.getByLabel('Season 1',{exact:true}).check();await page.getByRole('button',{name:'Request selected seasons'}).click();await page.getByText('Request submitted for approval.',{exact:true}).waitFor();assert.deepEqual(requestPayload.seasons,[1]);
  await page.getByRole('button',{name:'Sign out',exact:false}).click();await login('viewer');assert.equal(await page.getByRole('button',{name:'Administration',exact:true}).count(),0);
  await page.locator('.feature-slide').waitFor();await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>matchMedia('(prefers-reduced-motion: reduce)').matches&&document.querySelector('.feature-video')&&!document.querySelector('.feature-video').getAttribute('src'));assert.equal(await page.locator('.feature-video').getAttribute('src'),null);
  assert.deepEqual(errors,[]);
  console.log('Browser checks passed: stable carousel loading, eight dots, animated slide, hover pause, decoded video and reduced motion; Music removal and service-colored hovers; existing branding, details, request and admin flows. APIs mocked; video generated locally.');
}finally{await browser?.close();if(child.exitCode===null){const exit=once(child,'exit');child.kill();await exit}await rm(dir,{recursive:true,force:true})}
