import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {startPlaybackFixture} from './mock-jellyfin.mjs';
const fixture=await startPlaybackFixture();let browser,release;
try{
  browser=await chromium.launch(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{});const page=await browser.newPage();
  await page.goto(fixture.base);await page.getByPlaceholder('Username').fill('viewer');await page.getByPlaceholder('Password',{exact:true}).fill('test');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.evaluate(async()=>{
    const {createCarousel}=await import('/carousel.js');const host=document.createElement('div');host.id='async-carousel';document.body.append(host);window.pendingPreview=false;
    window.disposeAsyncCarousel=createCarousel({root:host,isCurrent:()=>true,onSelect:()=>{},escapeHTML:value=>value,metadata:()=>'',api:async path=>{if(path==='/api/featured')return {items:[{Id:'movie-direct',Name:'Delayed preview',Type:'Movie'}],source:'library',reshuffleAt:Date.now()+3600000};window.pendingPreview=true;await new Promise(resolve=>window.releasePreview=resolve);return {playable:true,url:'/api/preview-stream/should-not-load',startSeconds:0,clipSeconds:20}}});
  });
  await page.waitForFunction(()=>window.pendingPreview);await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);await page.evaluate(()=>window.releasePreview());await page.waitForTimeout(100);
  assert.equal(await page.locator('#async-carousel video').getAttribute('src'),null,'A pending preview must not start after reduced motion is enabled');await page.evaluate(()=>{window.disposeAsyncCarousel();document.querySelector('#async-carousel').remove()});
  console.log('Carousel async check passed: late preview negotiation respects changed reduced-motion preference.');
}finally{await browser?.close();await fixture.close()}
