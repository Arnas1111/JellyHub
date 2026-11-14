import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { startPlaybackFixture } from './mock-jellyfin.mjs';

const fixture=await startPlaybackFixture();let browser;
try{
  browser=await chromium.launch(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{});
  const page=await browser.newPage();const errors=[],urls=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>urls.push(request.url()));
  await page.goto(fixture.base);await page.getByPlaceholder('Username',{exact:true}).fill('viewer');await page.getByPlaceholder('Password',{exact:true}).fill('fixture');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.locator('#rows [data-item="movie-direct"]').last().click();await page.getByRole('button',{name:'Resume',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.main-video')?.currentTime>2.1&&document.querySelector('.main-video').videoWidth>0);
  assert.equal(await page.locator('.player-method').textContent(),'Direct play');
  await page.getByRole('button',{name:'Skip intro',exact:true}).click();assert.ok(await page.locator('.main-video').evaluate(video=>video.currentTime>=3));
  await page.getByRole('button',{name:'Play or pause',exact:true}).click();assert.ok(await page.locator('.main-video').evaluate(video=>video.paused));
  await page.getByRole('button',{name:'Bookmark this moment',exact:true}).click();await page.getByText('Bookmark saved at',{exact:false}).waitFor();
  assert.ok(fixture.reports.some(report=>report.path==='/Sessions/Playing'));
  await page.getByRole('button',{name:'Audio, subtitles and quality',exact:true}).click();await page.getByLabel('Subtitles',{exact:true}).selectOption('3');
  await page.waitForFunction(()=>document.querySelector('.main-video track')?.track?.mode==='showing');
  assert.match(await page.locator('.main-video track').getAttribute('src'),/^\/api\/playback\//);
  await page.getByRole('button',{name:'Audio, subtitles and quality',exact:true}).click();await page.getByLabel('Audio',{exact:true}).selectOption('2');
  await page.waitForFunction(()=>document.querySelector('.main-video')?.currentTime>3&&document.querySelector('.player-method')?.textContent==='Transcoding');
  assert.equal(fixture.playbackInfo.at(-1).AudioStreamIndex,2);
  assert.ok(fixture.calls.some(call=>/segment\d+\.ts$/.test(call.path)),'HLS.js must fetch real MPEG-TS segments through the private proxy');
  await page.mouse.move(40,40);await page.getByRole('button',{name:'Audio, subtitles and quality',exact:true}).click();await page.getByLabel('Quality',{exact:true}).selectOption('3000000');
  await page.waitForFunction(()=>document.querySelector('.main-video')?.currentTime>3&&document.querySelector('.player-loading')?.hidden);
  assert.equal(fixture.playbackInfo.at(-1).MaxStreamingBitrate,3000000);
  await page.setViewportSize({width:390,height:844});await page.mouse.move(10,10);for(const control of await page.locator('.player-controls button:visible').all()){const box=await control.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=391,'Mobile player controls must stay on screen')}
  await page.setViewportSize({width:1280,height:720});
  const screenshot=process.env.SCREENSHOT_PATH;if(screenshot)await page.screenshot({path:screenshot,fullPage:true});
  await page.getByRole('button',{name:'Return to details',exact:true}).click();await page.getByRole('heading',{name:'Direct Test Movie',exact:true}).waitFor();
  assert.ok(fixture.reports.some(report=>report.path==='/Sessions/Playing/Stopped'));assert.ok(fixture.calls.some(call=>call.path==='/Videos/ActiveEncodings'&&call.method==='DELETE'));
  await page.goto(fixture.base+'/#item/episode1');await page.getByRole('button',{name:'Resume',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.main-video')?.videoWidth>0);
  await page.getByRole('button',{name:'Episodes',exact:true}).click();await page.getByLabel('Episode season',{exact:true}).selectOption('season1');await page.locator('[data-episode="episode2"]').waitFor();
  await page.getByRole('button',{name:'Close panel',exact:true}).click();const beforeEnd=fixture.reports.filter(report=>report.path==='/Sessions/Playing/Stopped').length;
  await page.locator('.main-video').evaluate(video=>{video.currentTime=video.duration-.3;video.play()});await page.waitForFunction(()=>document.querySelector('.main-video')?.ended);await page.getByRole('button',{name:'Cancel autoplay',exact:true}).click();
  await page.waitForTimeout(300);assert.ok(fixture.reports.filter(report=>report.path==='/Sessions/Playing/Stopped').length>beforeEnd,'Natural completion must close the Jellyfin playback session');
  assert.ok(urls.every(url=>!url.includes('must-never-reach-browser')&&!url.includes('secret-token-')),'Tokens must never appear in browser URLs');
  assert.deepEqual(errors,[]);
  console.log('Player browser checks passed: real MP4/HLS decode, resume, native segment skip, pause, bookmark persistence, subtitle delivery, audio/quality renegotiation and stop/encoding cleanup. Jellyfin API is simulated; fixtures generated locally.');
}finally{await browser?.close();await fixture.close()}
