import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startPlaybackFixture} from './mock-jellyfin.mjs';

const fixture=await startPlaybackFixture();let browser;
try{
  browser=await chromium.launch(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{});
  const page=await browser.newPage({viewport:{width:1600,height:1000},reducedMotion:'reduce'});
  await page.goto(fixture.base);await page.getByPlaceholder('Username',{exact:true}).fill('viewer');await page.getByPlaceholder('Password',{exact:true}).fill('fixture');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.locator('#rows').waitFor();
  const play=async()=>{await page.goto(fixture.base+'/#play/movie-hls');await page.waitForFunction(()=>document.querySelector('.main-video')?.videoWidth>0&&!document.querySelector('.main-video').paused);await page.locator('.main-video').evaluate(video=>video.loop=true)};
  const hidden=async value=>page.evaluate(value=>{Object.defineProperty(document,'hidden',{configurable:true,value});document.dispatchEvent(new Event('visibilitychange'))},value);
  const save=async patch=>page.evaluate(async patch=>{const response=await fetch('/api/preferences',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(patch)});if(!response.ok)throw Error('Preference save failed')},patch);
  await play();await hidden(true);assert.equal(await page.locator('.main-video').evaluate(v=>v.paused),false,'Default playback must continue in another tab');await hidden(false);
  const aligned=async mode=>{
    await page.locator('.main-video').evaluate(v=>v.pause());await page.locator('.player-screen').focus();
    const buttons=page.locator('.player-icon:visible');assert.ok(await buttons.count()>0);
    for(const button of await buttons.all()){
      const before=await button.boundingBox();await button.hover();await button.focus();
      const geometry=await button.evaluate(el=>{const b=el.getBoundingClientRect(),s=el.querySelector('svg')?.getBoundingClientRect();return {name:el.getAttribute('aria-label'),button:{x:b.x,y:b.y,width:b.width,height:b.height},dx:s?Math.abs(s.x+s.width/2-b.x-b.width/2):Infinity,dy:s?Math.abs(s.y+s.height/2-b.y-b.height/2):Infinity,fits:s&&s.width<=b.width&&s.height<=b.height}});
      assert.ok(geometry.dx<.6&&geometry.dy<.6&&geometry.fits,mode+': '+JSON.stringify(geometry));
      assert.deepEqual(geometry.button,before,mode+': hover/focus must not shift '+geometry.name);
    }
  };
  for(const name of ['Chapters','Episodes','Audio, subtitles and quality']){const button=page.getByRole('button',{name,exact:true});await button.click();await page.locator('.player-panel').waitFor({state:'visible'});assert.equal(await button.getAttribute('aria-expanded'),'true');await button.click();await page.locator('.player-panel').waitFor({state:'hidden'});assert.equal(await button.getAttribute('aria-expanded'),'false')}
  await page.getByRole('button',{name:'Chapters',exact:true}).click();await page.getByRole('button',{name:'Audio, subtitles and quality',exact:true}).click();await page.getByRole('heading',{name:'Playback settings',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Chapters',exact:true}).getAttribute('aria-expanded'),'false');await page.locator('[data-action=close-panel]').click();
  await aligned('embedded');await page.locator('[data-action=mute]').click();await page.locator('[data-icon=muted]').waitFor();
  await page.locator('[data-action=settings]').click();await page.locator('.player-panel').waitFor({state:'visible'});await aligned('settings panel');await page.locator('[data-action=close-panel]').click();
  await page.screenshot({path:'.tools/player-controls-desktop.png',fullPage:true});
  await page.locator('[data-action=fullscreen]').click();await page.waitForFunction(()=>!!document.fullscreenElement);await page.locator('[data-icon=collapse]').waitFor();await aligned('fullscreen');await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Browse while watching',exact:true}).click();await page.locator('#persistent-player.player-docked').waitFor();await aligned('mini player');
  await page.setViewportSize({width:390,height:844});await aligned('mobile mini player');await page.getByRole('button',{name:'Return to player',exact:true}).click();await page.locator('.watch-video-slot').waitFor();await aligned('mobile embedded');await page.screenshot({path:'.tools/player-controls-mobile.png',fullPage:true});
  // The optional pause setting still works when a user explicitly enables it.
  await save({autoPause:true,autoResume:true});await page.reload();await page.waitForFunction(()=>document.querySelector('.main-video')?.videoWidth>0&&!document.querySelector('.main-video').paused);await page.locator('.main-video').evaluate(v=>v.loop=true);
  await hidden(true);assert.equal(await page.locator('.main-video').evaluate(v=>v.paused),true);await hidden(false);await page.waitForFunction(()=>!document.querySelector('.main-video').paused);
  await page.locator('.main-video').evaluate(v=>v.pause());await hidden(true);await hidden(false);assert.equal(await page.locator('.main-video').evaluate(v=>v.paused),true,'Returning to a tab must preserve a manual pause');
  // Mouse focus left on the screen or a clicked button must not pin overlays open.
  await page.setViewportSize({width:1600,height:1000});await page.clock.install();await page.locator('.main-video').evaluate(v=>v.play());
  const fade=async()=>{await page.clock.runFor(100);await page.clock.runFor(4000);await page.clock.runFor(250);const state=await page.evaluate(()=>({panel:document.querySelector('.player-panel').hidden,focused:document.activeElement.outerHTML.slice(0,100),hidden:document.querySelector('.player-screen').classList.contains('controls-hidden'),playing:!document.querySelector('.main-video').paused,videoOpacity:getComputedStyle(document.querySelector('.main-video')).opacity,overlays:[...document.querySelectorAll('.player-top,.player-controls,.player-vignette,.player-start-info,.player-skip,.player-next,.player-notice,.player-browse-tools')].map(el=>({name:el.className,opacity:getComputedStyle(el).opacity}))}));assert.equal(state.hidden,true,JSON.stringify(state));assert.equal(state.playing,true,JSON.stringify(state));assert.equal(state.videoOpacity,'1');for(const overlay of state.overlays)assert.equal(overlay.opacity,'0',overlay.name)};
  const reveal=async()=>{await page.locator('.main-video').dispatchEvent('pointermove');await page.clock.runFor(250);assert.equal(await page.locator('.player-controls').evaluate(el=>getComputedStyle(el).opacity),'1')};
  await page.locator('.player-screen').focus();await reveal();await fade();await reveal();
  await page.locator('[data-action=fullscreen]').click();await page.waitForFunction(()=>!!document.fullscreenElement);await fade();await reveal();await page.keyboard.press('Escape');
  await page.locator('[data-action=settings]').click();await page.clock.runFor(4000);assert.equal(await page.locator('.player-screen').evaluate(el=>el.classList.contains('controls-hidden')),false,'Open settings must remain usable');await page.locator('[data-action=close-panel]').click();await fade();await reveal();
  await page.locator('[data-action=toggle]').focus();await page.keyboard.press('Tab');await page.clock.runFor(4000);assert.equal(await page.locator('.player-controls').evaluate(el=>getComputedStyle(el).opacity),'1','Keyboard-focused controls must stay visible');await reveal();await fade();await reveal();
  await page.locator('#playback-seek').dispatchEvent('pointerdown');await page.clock.runFor(4000);assert.equal(await page.locator('.player-screen').evaluate(el=>el.classList.contains('controls-hidden')),false,'Timeline dragging must not fade');await page.locator('#playback-seek').dispatchEvent('pointercancel');await fade();await reveal();
  await page.getByRole('button',{name:'Browse while watching',exact:true}).click();await page.locator('#persistent-player.player-docked').waitFor();await reveal();await fade();await reveal();await page.locator('.main-video').evaluate(v=>v.pause());await page.clock.runFor(4000);assert.equal(await page.locator('.player-controls').evaluate(el=>getComputedStyle(el).opacity),'1','Paused playback must show controls');
  console.log('Player controls passed: centered SVGs and stable hover/focus in embedded, fullscreen, mini and mobile modes; state icons; background playback; complete overlay idle fading, pointer restore, keyboard access, scrubbing and pause visibility. Jellyfin simulated.');
}finally{await browser?.close();await fixture.close()}
