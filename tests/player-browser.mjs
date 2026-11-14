import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { startPlaybackFixture } from './mock-jellyfin.mjs';

const fixture=await startPlaybackFixture();let browser;
async function assertEventually(predicate){for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,20))}assert.ok(predicate())}
try{
  browser=await chromium.launch(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{});
  const page=await browser.newPage();const errors=[],urls=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>urls.push(request.url()));
  await page.goto(fixture.base);await page.getByPlaceholder('Username',{exact:true}).fill('viewer');await page.getByPlaceholder('Password',{exact:true}).fill('fixture');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.locator('#rows [data-item="movie-direct"]').last().click();
  for(const item of ['movie-direct','movie-hls']){
    await page.goto(fixture.base+'/#item/'+item);await page.getByRole('button',{name:'Watch preview',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.detail-preview-player')?.videoWidth>0&&document.querySelector('.detail-preview-player').currentTime>.1);
    assert.equal(fixture.playbackInfo.at(-1).IsPlayback,false);assert.equal(fixture.reports.length,0,'Previews must not update watched/resume state');
    if(item==='movie-direct'){
      await page.locator('.detail-preview-player').evaluate(video=>video.currentTime=video.duration-.15);await page.getByText('Preview ended.',{exact:true}).waitFor();
      await page.getByRole('button',{name:'Watch preview',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.detail-preview-player')?.videoWidth>0);
    }
    const encodings=fixture.calls.filter(call=>call.path==='/Videos/ActiveEncodings').length;
    await page.getByRole('button',{name:'Close preview',exact:true}).click();await page.getByText('Preview closed.',{exact:true}).waitFor();
    if(item==='movie-hls')await assertEventually(()=>fixture.calls.filter(call=>call.path==='/Videos/ActiveEncodings').length>encodings);
  }
  fixture.setAllowed(false);await page.getByRole('button',{name:'Watch preview',exact:true}).click();await page.locator('#detail-preview').filter({hasText:'This account cannot play media.'}).waitFor();assert.equal(await page.getByRole('button',{name:'Watch preview',exact:true}).isEnabled(),true);fixture.setAllowed(true);
  await page.goto(fixture.base+'/#item/movie-direct');await page.getByRole('button',{name:'Resume',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.main-video')?.currentTime>2.1&&document.querySelector('.main-video').videoWidth>0);
  assert.equal(await page.locator('.player-method').textContent(),'Direct play');
  await page.getByRole('button',{name:'Skip intro',exact:true}).click();assert.ok(await page.locator('.main-video').evaluate(video=>video.currentTime>=3));
  await page.getByRole('button',{name:'Play or pause',exact:true}).click();assert.ok(await page.locator('.main-video').evaluate(video=>video.paused));
  const dragSeek=async(fraction)=>{
    const bar=page.locator('#playback-seek'),box=await bar.boundingBox();await page.mouse.move(box.x+box.width*.3,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width*fraction,box.y+box.height/2,{steps:5});
    const selected=Number(await bar.inputValue());await page.locator('.main-video').evaluate(video=>video.dispatchEvent(new Event('timeupdate')));
    assert.equal(Number(await bar.inputValue()),selected,'Playback ticks must not overwrite the position being dragged');
    await page.mouse.up();await page.waitForFunction(target=>Math.abs(document.querySelector('.main-video').currentTime-target)<.3,selected);
    assert.equal(await page.locator('.main-video').evaluate(video=>video.paused),true,'Seeking must preserve pause state');
  };
  await dragSeek(.7);await dragSeek(.45);
  const chosenPosition=await page.locator('.main-video').evaluate(video=>{const position=video.currentTime;video.dispatchEvent(new Event('loadedmetadata'));return position});
  assert.equal(await page.locator('.main-video').evaluate(video=>video.currentTime),chosenPosition,'Repeated metadata must not restore the original resume time');
  assert.equal(await page.locator('.main-video').evaluate(video=>video.paused),true);
  await page.locator('#playback-seek').focus();await page.keyboard.press('ArrowRight');await page.waitForFunction(previous=>document.querySelector('.main-video').currentTime>previous,chosenPosition);
  await page.getByRole('button',{name:'Bookmark this moment',exact:true}).click();await page.getByText('Bookmark saved at',{exact:false}).waitFor();
  assert.ok(fixture.reports.some(report=>report.path==='/Sessions/Playing'));
  await page.getByRole('button',{name:'Audio, subtitles and quality',exact:true}).click();await page.getByLabel('Subtitles',{exact:true}).selectOption('3');
  await page.waitForFunction(()=>document.querySelector('.main-video track')?.track?.mode==='showing');
  assert.match(await page.locator('.main-video track').getAttribute('src'),/^\/api\/playback\//);
  await page.getByRole('button',{name:'Audio, subtitles and quality',exact:true}).click();await page.getByLabel('Audio',{exact:true}).selectOption('2');
  await page.waitForFunction(()=>document.querySelector('.main-video')?.currentTime>3&&document.querySelector('.player-method')?.textContent==='Transcoding');
  assert.equal(fixture.playbackInfo.at(-1).AudioStreamIndex,2);
  assert.ok(fixture.calls.some(call=>/segment\d+\.ts$/.test(call.path)),'HLS.js must fetch real MPEG-TS segments through the private proxy');
  await page.getByRole('button',{name:'Play or pause',exact:true}).click();await dragSeek(.7);await dragSeek(.4);
  await page.mouse.move(40,40);await page.getByRole('button',{name:'Audio, subtitles and quality',exact:true}).click();await page.getByLabel('Quality',{exact:true}).selectOption('3000000');
  await page.waitForFunction(()=>document.querySelector('.main-video')?.currentTime>3&&document.querySelector('.player-loading')?.hidden);
  assert.equal(fixture.playbackInfo.at(-1).MaxStreamingBitrate,3000000);
  await page.setViewportSize({width:390,height:844});await page.mouse.move(10,10);for(const control of await page.locator('.player-controls button:visible').all()){const box=await control.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=391,'Mobile player controls must stay on screen')}
  await page.setViewportSize({width:1280,height:720});
  const screenshot=process.env.SCREENSHOT_PATH;if(screenshot)await page.screenshot({path:screenshot,fullPage:true});
  await page.getByRole('button',{name:'Return to details',exact:true}).click();await page.locator('.player-screen').waitFor({state:'detached'});await page.getByRole('heading',{name:'Direct Test Movie',exact:true}).waitFor();
  assert.ok(fixture.reports.some(report=>report.path==='/Sessions/Playing/Stopped'));assert.ok(fixture.calls.some(call=>call.path==='/Videos/ActiveEncodings'&&call.method==='DELETE'));
  await page.goto(fixture.base+'/#item/episode1');try{await page.getByRole('heading',{name:'The pilot',exact:true}).waitFor()}catch(error){console.error('Episode navigation state:',await page.evaluate(()=>({hash:location.hash,text:document.body.innerText})),errors,fixture.calls.slice(-12).map(call=>({path:call.path,method:call.method})));throw error}await page.getByRole('button',{name:'Resume',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.main-video')?.videoWidth>0);
  await page.getByRole('button',{name:'Episodes',exact:true}).click();await page.getByLabel('Episode season',{exact:true}).selectOption('season1');await page.locator('[data-episode="episode2"]').waitFor();
  await page.getByRole('button',{name:'Close panel',exact:true}).click();const beforeEnd=fixture.reports.filter(report=>report.path==='/Sessions/Playing/Stopped').length;
  await page.locator('.main-video').evaluate(video=>{video.currentTime=video.duration-.3;video.play()});await page.waitForFunction(()=>document.querySelector('.main-video')?.ended);await page.getByRole('button',{name:'Cancel autoplay',exact:true}).click();
  await page.waitForTimeout(300);assert.ok(fixture.reports.filter(report=>report.path==='/Sessions/Playing/Stopped').length>beforeEnd,'Natural completion must close the Jellyfin playback session');
  await page.goto(fixture.base+'/#item/movie-direct');await page.getByRole('heading',{name:'Direct Test Movie',exact:true}).waitFor();await page.getByRole('button',{name:'Resume',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.main-video')?.videoWidth>0);
  let releaseStop,reachedStop;const stopGate=new Promise(resolve=>releaseStop=resolve),stopReached=new Promise(resolve=>reachedStop=resolve);
  await page.route('**/api/playback/*/report',async route=>{if(route.request().postDataJSON()?.event==='stop'){reachedStop();await stopGate}await route.continue()});
  await page.getByRole('button',{name:'Return to details',exact:true}).click();await stopReached;await page.evaluate(()=>location.hash='item/episode2');await page.getByRole('heading',{name:'The next episode',exact:true}).waitFor();releaseStop();await page.waitForTimeout(250);
  assert.equal(new URL(page.url()).hash,'#item/episode2','A delayed player close must not overwrite a newer navigation');assert.equal(await page.locator('.player-screen').count(),0);await page.unroute('**/api/playback/*/report');
  await page.goto(fixture.base+'/#item/0123456789abcdef0123456789abcdef');await page.getByRole('heading',{name:'Direct Test Movie',exact:true}).waitFor();await page.getByRole('button',{name:'Resume',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.main-video')?.videoWidth>0&&document.querySelector('.main-video').currentTime>2);assert.equal(await page.locator('.player-method').textContent(),'Transcoding');
  assert.ok(urls.every(url=>!url.includes('must-never-reach-browser')&&!url.includes('secret-token-')),'Tokens must never appear in browser URLs');
  assert.deepEqual(errors,[]);
  console.log('Player browser checks passed: real MP4/HLS previews without watch-progress changes, preview cleanup, drag/keyboard seeking without snap-back, resume, native segment skip, pause, bookmarks, subtitles, audio/quality renegotiation and stop/encoding cleanup. Jellyfin API is simulated; fixtures generated locally.');
}finally{await browser?.close();await fixture.close()}
