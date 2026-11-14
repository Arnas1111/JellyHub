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
  let user=null,testPayload,failedSave=false,level='info',requestPayload,policyPayload,iconUploaded=false;
  let branding={title:'JellyHub',name:'jellyhub.',welcome:'Discover your next favorite.',accent:'#9980ff',favicon:'/favicon.ico'};
  const libraryItem={Id:'visible',Name:'Test Movie',Type:'Movie',ImageTags:{Primary:'tag'}};
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
    if(url.pathname==='/api/admin/users')return reply({users:[{id:'viewer',name:'Viewer',policy:{IsAdministrator:false,EnableAllFolders:false,EnabledFolders:['movies']}}],libraries:[{id:'movies',name:'Movies'}]});
    if(url.pathname==='/api/admin/users/viewer'){policyPayload=body();return reply({ok:true})}
    return reply({error:'Unexpected mocked route '+url.pathname},404);
  });
  const adminTab=async name=>{await page.getByRole('button',{name,exact:true}).click();await page.locator('#admin-content h2').getByText(name==='Users'?'Jellyfin users':name,{exact:true}).waitFor()};
  async function login(name){await page.getByPlaceholder('Username',{exact:true}).fill(name);await page.getByPlaceholder('Password',{exact:true}).fill('secret');await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.getByRole('heading',{name:branding.welcome}).waitFor()}
  await page.goto(base);await login('admin');
  assert.equal(await page.getByText('Your media universe',{exact:false}).count(),0);
  await page.getByRole('heading',{name:'Popular movies'}).waitFor();
  if(process.env.SCREENSHOT_PATH)await page.screenshot({path:process.env.SCREENSHOT_PATH.replace('.png','-home.png'),fullPage:true});
  await page.locator('[data-item="visible"]').click();await page.getByRole('heading',{name:'Test Movie',exact:true}).waitFor();
  await page.locator('.detail-removal').getByText('3d until removal').waitFor();
  assert.equal(await page.locator('.detail>.poster').evaluate(el=>getComputedStyle(el).borderTopLeftRadius),'13px');
  assert.equal(await page.locator('.detail>.poster').evaluate(el=>getComputedStyle(el).overflow),'hidden');
  if(process.env.SCREENSHOT_PATH)await page.screenshot({path:process.env.SCREENSHOT_PATH.replace('.png','-detail.png'),fullPage:true});
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
  await adminTab('Users');await page.locator('[data-user="viewer"]').click();await page.getByLabel('Allow remote access',{exact:true}).check();await page.getByRole('button',{name:'Save permissions'}).click();await page.getByText('Permissions saved.',{exact:true}).waitFor();assert.equal(policyPayload.policy.EnableRemoteAccess,true);assert.deepEqual(policyPayload.policy.EnabledFolders,['movies']);
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Admin must fit mobile viewport');
  if(process.env.SCREENSHOT_PATH)await page.screenshot({path:process.env.SCREENSHOT_PATH,fullPage:true});
  await page.getByRole('button',{name:'Home',exact:true}).click();await page.locator('#universal-query').fill('Movie');await page.locator('#universal-search').getByRole('button',{name:'Search',exact:true}).click();await page.getByRole('heading',{name:'Discover & request'}).waitFor();await page.locator('[data-catalog-id="200"]').click();await page.getByRole('button',{name:'Request movie',exact:true}).click();await page.getByText('Request submitted for approval.',{exact:true}).waitFor();assert.deepEqual(requestPayload,{mediaType:'movie',mediaId:200});
  await page.getByRole('button',{name:'Home',exact:true}).first().click();await page.locator('[data-catalog-id="300"]').click();await page.getByLabel('Season 1',{exact:true}).check();await page.getByRole('button',{name:'Request selected seasons'}).click();await page.getByText('Request submitted for approval.',{exact:true}).waitFor();assert.deepEqual(requestPayload.seasons,[1]);
  await page.getByRole('button',{name:'Sign out',exact:false}).click();await login('viewer');assert.equal(await page.getByRole('button',{name:'Administration',exact:true}).count(),0);
  assert.deepEqual(errors,[]);
  console.log('Browser checks passed: Home discovery, unified search, movie/season requests, admin tabs, user permissions, branding/favicon, poster clipping, isolated connector saves, log levels and responsive layout. APIs mocked.');
}finally{await browser?.close();if(child.exitCode===null){const exit=once(child,'exit');child.kill();await exit}await rm(dir,{recursive:true,force:true})}
