// UI tests use mocked APIs; live-service compatibility is a separate deployment check.
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
    child.stdout.on('data',d=>{const match=String(d).match(/running on :(\d+)/);if(match){clearTimeout(timeout);resolve(`http://127.0.0.1:${match[1]}`)}});
  });
  browser=await chromium.launch(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{});
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let user=null,saved=false,releaseHome,testPayload,failedSave=false,level='info';
  const urls=Object.fromEntries(['jellyfin','seerr','sonarr','radarr','jellystat','maintainerr'].map(n=>[n+'Url','http://'+n+':3000']));
  await page.route('**/api/**',async route=>{
    const request=route.request();const url=new URL(request.url());
    const reply=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
    if(url.pathname==='/api/login'){const body=request.postDataJSON();user={id:body.username,name:body.username,admin:body.username==='admin'};return reply({user})}
    if(url.pathname==='/api/me')return reply(user||{error:'Not authenticated'},user?200:401);
    if(url.pathname==='/api/logout'){user=null;return reply({ok:true})}
    if(url.pathname==='/api/home'){
      if(releaseHome){await new Promise(resolve=>releaseHome=resolve);releaseHome=false}
      return reply({recent:[{Id:'visible',Name:'Test Movie',Type:'Movie'}],resume:[]});
    }
    if(url.pathname==='/api/removals')return reply({byId:{visible:{collection:'Expiring',deletionDate:new Date(Date.now()+3*86400000).toISOString()}}});
    if(url.pathname==='/api/item/visible')return reply({Id:'visible',Name:'Test Movie',Type:'Movie',Overview:'Test description'});
    if(url.pathname==='/api/items')return reply({Items:[{Id:'visible',Name:'Test Movie',Type:'Movie'}]});
    if(url.pathname==='/api/admin/settings/test'){
      testPayload=request.postDataJSON();
      return testPayload.service==='radarr'?reply({status:'error',message:'Service returned HTTP 401.',diagnostics:{code:'HTTP_ERROR',httpStatus:401,hint:'Verify the API key.',requestId:'test-request'}}):reply({status:'connected',diagnostics:{httpStatus:200}});
    }
    if(url.pathname==='/api/admin/logging'){level=request.postDataJSON().level;return reply({level,persisted:true})}
    if(url.pathname==='/api/admin/settings'){
      if(request.method()==='PUT'){
        const body=request.postDataJSON();assert.equal(body.keys.seerrKey,'test-key');
        if(failedSave)return reply({error:'Cannot save settings in /config (EACCES). Mount JellyHub appdata read/write.'},503);
        saved=true;Object.assign(urls,body.urls);
        return reply({ok:true});
      }
      return reply({urls,keys:{seerrKey:saved,sonarrKey:false,radarrKey:false},logging:{level,levels:['silent','error','warn','info','debug']},storage:{writable:!failedSave,message:'Appdata is not writable.'}});
    }
    return reply({error:'Unexpected mocked route'},404);
  });
  async function login(name){await page.getByPlaceholder('Username',{exact:true}).fill(name);await page.getByPlaceholder('Password',{exact:true}).fill('secret');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:`Good to see you, ${name}.`}).waitFor()}
  await page.goto(base);await login('admin');
  await page.getByRole('button',{name:'Test Movie'}).click();
  await page.getByRole('heading',{name:'Test Movie',exact:true}).waitFor();
  await page.locator('.detail-removal').getByText('3d until removal').waitFor();
  await page.getByText('Playback is not implemented', {exact:false}).waitFor();
  await page.getByRole('button',{name:'Connections'}).click();
  await page.locator('input[name="seerrKey"]').fill('test-key');
  await page.locator('input[name="sonarrKey"]').fill('unsaved-test-key');
  await page.locator('[data-test="sonarr"]').click();await page.locator('[data-status="sonarr"]').getByText('Connected',{exact:true}).waitFor();
  assert.equal(testPayload.apiKey,'unsaved-test-key');assert.equal(saved,false);
  assert.equal(await page.locator('[data-status="sonarr"]').evaluate(el=>getComputedStyle(el).color),'rgb(152, 237, 191)');
  await page.locator('[data-test="radarr"]').click();await page.locator('[data-status="radarr"]').getByText('Service returned HTTP 401.',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-status="radarr"]').evaluate(el=>getComputedStyle(el).color),'rgb(255, 161, 161)');
  assert.equal(await page.locator('.key-clear').first().evaluate(el=>getComputedStyle(el).display),'flex');
  failedSave=true;
  await page.getByRole('button',{name:'Save settings',exact:true}).click();await page.locator('#save-status').getByText('Cannot save settings',{exact:false}).waitFor();
  assert.equal(await page.locator('input[name="seerrKey"]').inputValue(),'test-key','Failed saves must preserve entered keys');
  failedSave=false;
  await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await page.getByText('Settings saved.',{exact:true}).waitFor();assert.equal(saved,true);
  assert.equal(await page.locator('input[name="seerrKey"]').inputValue(),'');
  await page.locator('select[name="level"]').selectOption('debug');await page.getByRole('button',{name:'Apply log level'}).click();await page.getByText('Log level saved.',{exact:true}).waitFor();assert.equal(level,'debug');
  await page.locator('[data-test="sonarr"]').click();await page.locator('[data-status="sonarr"]').getByText('Connected',{exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Connections must fit a mobile viewport');
  if(process.env.SCREENSHOT_PATH)await page.screenshot({path:process.env.SCREENSHOT_PATH,fullPage:true});
  // A delayed home response must not replace the page after navigation.
  releaseHome=true;
  await page.getByRole('button',{name:'Home',exact:false}).click();
  await page.getByRole('button',{name:'Connections'}).click();
  await page.getByRole('heading',{name:'Connections',exact:true}).waitFor();
  if(typeof releaseHome==='function')releaseHome();
  await page.getByRole('button',{name:'Sign out',exact:false}).click();
  await login('viewer');assert.equal(await page.getByRole('button',{name:'Connections'}).count(),0);assert.equal(await page.getByRole('button',{name:'Administration'}).count(),0);
  await page.getByRole('button',{name:'Movies',exact:false}).click();await page.getByRole('button',{name:'Test Movie'}).waitFor();
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile page must fit viewport');
  assert.deepEqual(errors,[]);
  console.log('Browser checks passed: login, media detail, countdown, unsaved-key tests, success/error colors, checkbox alignment, failed-save input preservation, log level, user navigation and mobile width. APIs mocked.');
}finally{
  await browser?.close();
  if(child.exitCode===null){const exit=once(child,'exit');child.kill();await exit}
  await rm(dir,{recursive:true,force:true});
}
