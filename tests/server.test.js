import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverFile=fileURLToPath(new URL('../server.js',import.meta.url));

test('startup, authentication, media permissions, integrations and persisted settings',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'jellyhub-test-'));
  let revoked=false,overlayCalls=0;
  const calls=[];
  const upstream=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://mock');
    const token=req.headers.authorization||'';
    calls.push({path:url.pathname,token,key:req.headers['x-api-key']});
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data))};
    if(url.pathname==='/Users/AuthenticateByName'){
      let raw='';for await(const part of req)raw+=part;
      const {Username,Pw}=JSON.parse(raw);
      if(Pw!=='secret')return send(401,{});
      return send(200,{AccessToken:Username,User:{Id:Username,Name:Username,Policy:{IsAdministrator:Username==='admin'}}});
    }
    if(url.pathname==='/Users/Me')return send(200,{Id:token.includes('Token="admin"')?'admin':'viewer',Name:'Test',Policy:{IsAdministrator:token.includes('Token="admin"')&&!revoked}});
    if(url.pathname==='/Users/viewer/Items/hidden')return send(403,{});
    if(/^\/Users\/[^/]+\/Items\/(visible|hidden)$/.test(url.pathname))return send(200,{Id:url.pathname.split('/').at(-1),Name:'Movie'});
    if(url.pathname.endsWith('/Items/Resume'))return send(200,{Items:[{Id:'visible',Name:'Resume'}]});
    if(url.pathname.endsWith('/Items'))return send(200,{Items:[{Id:'visible',Name:'Movie'}]});
    if(url.pathname.endsWith('/Views'))return send(200,{Items:[]});
    if(url.pathname==='/Items/visible/Images/Primary'){res.writeHead(200,{'Content-Type':'image/jpeg'});return res.end('image')}
    if(url.pathname==='/api/collections/overlay-data'){
      overlayCalls++;
      return send(200,[{id:1,title:'Expiring',arrAction:0,isActive:true,deleteAfterDays:7,media:[{mediaServerId:'visible',addDate:'2026-01-01T00:00:00Z'},{mediaServerId:'hidden',addDate:'2026-01-01T00:00:00Z'}]},{id:2,title:'Inactive',isActive:false,arrAction:0,deleteAfterDays:1,media:[{mediaServerId:'visible',addDate:'2026-01-01T00:00:00Z'}]}]);
    }
    if(url.pathname==='/api/v1/request')return send(200,{results:[{id:1}],pageInfo:{results:1}});
    if(url.pathname==='/api/v3/queue')return send(200,{records:[{id:1}],totalRecords:1});
    if(['/System/Info/Public','/api/v1/status','/api/v3/system/status'].includes(url.pathname))return send(200,{Version:'mock'});
    if(url.pathname==='/Sessions/Logout')return send(200,{});
    return send(404,{});
  });
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const service=`http://127.0.0.1:${upstream.address().port}`;
  let child,base;
  async function start(){
    child=spawn(process.execPath,[serverFile],{cwd:dir,env:{...process.env,PORT:'0',CONFIG_DIR:dir,JELLYFIN_URL:service,MAINTAINERR_URL:service,SEERR_URL:service,SONARR_URL:service,RADARR_URL:service,SEERR_API_KEY:'request-secret',SONARR_API_KEY:'sonarr-secret',RADARR_API_KEY:'radarr-secret'}});
    let logs='';child.stderr.on('data',d=>logs+=d);
    base=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Startup timeout: '+logs)),10000);
      child.on('exit',code=>{clearTimeout(timer);reject(Error(`Exited ${code}: ${logs}`))});
      child.stdout.on('data',d=>{logs+=d;const match=logs.match(/running on :(\d+)/);if(match){clearTimeout(timer);resolve(`http://127.0.0.1:${match[1]}`)}});
    });
  }
  async function stop(){const exited=once(child,'exit');child.kill();await exited}
  t.after(async()=>{if(child?.exitCode===null)await stop();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));await rm(dir,{recursive:true,force:true})});
  await start();
  const request=async(route,{cookie,method='GET',body,headers={}}={})=>fetch(base+route,{method,headers:{...(cookie?{Cookie:cookie}:{}),...headers},body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});
  const login=async name=>{const r=await request('/api/login',{method:'POST',body:{username:name,password:'secret'}});assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);return r.headers.get('set-cookie').split(';')[0]};
  await t.test('static files resolve when launched outside the repository; health does not require backends',async()=>{
    for(const route of ['/','/app.js','/styles.css','/healthz'])assert.equal((await request(route)).status,200,route);
    assert.match(await (await request('/')).text(),/id="app"/);
    assert.equal((await request('/server.js')).status,404);
    assert.equal((await request('/api/me')).status,401);
    assert.equal((await request('/api/login',{method:'POST',body:'{'})).status,400);
    assert.equal((await request('/api/login',{method:'POST',body:'x'.repeat(9000)})).status,413);
    assert.equal((await request('/api/login',{method:'POST',body:{username:'viewer',password:'wrong'}})).status,401);
  });
  const viewer=await login('viewer');const admin=await login('admin');
  await t.test('user-scoped media and administrator access checks',async()=>{
    for(const route of ['/api/home','/api/items?type=Movie','/api/views','/api/item/visible','/api/image/visible'])assert.equal((await request(route,{cookie:viewer})).status,200,route);
    assert.equal((await request('/api/item/hidden',{cookie:viewer})).status,403);
    assert.equal((await request('/api/image/hidden',{cookie:viewer})).status,403);
    for(const route of ['/api/admin/settings','/api/admin/overview','/api/admin/removals'])assert.equal((await request(route,{cookie:viewer})).status,403,route);
    assert.equal((await request('/api/admin/settings',{cookie:admin,method:'PUT',headers:{Origin:'http://evil.example'},body:{urls:{},keys:{}}})).status,403);
  });
  await t.test('Maintainerr countdown, caching and item permission filtering',async()=>{
    const result=await (await request('/api/removals?ids=visible,hidden',{cookie:viewer})).json();
    assert.deepEqual(Object.keys(result.byId),['visible']);
    assert.equal(result.byId.visible.deletionDate,'2026-01-08T00:00:00.000Z');
    await request('/api/removals?ids=visible',{cookie:viewer});assert.equal(overlayCalls,1);
    assert.equal((await (await request('/api/admin/removals',{cookie:admin})).json()).entries.length,2);
  });
  await t.test('integration requests use server-side keys; revoked admins lose access',async()=>{
    const overview=await (await request('/api/admin/overview',{cookie:admin})).json();
    assert.ok(overview.integrations.every(i=>i.status==='connected'));
    assert.ok(calls.some(c=>c.path==='/api/v1/request'&&c.key==='request-secret'));
    revoked=true;
    for(const route of ['/api/admin/settings','/api/admin/overview','/api/admin/removals'])assert.equal((await request(route,{cookie:admin})).status,403);
    revoked=false;
  });
  await t.test('settings validate, redact secrets, test connections and survive restart',async()=>{
    const invalid=await request('/api/admin/settings',{cookie:admin,method:'PUT',body:{urls:{seerrUrl:'file:///etc/passwd'},keys:{}}});assert.equal(invalid.status,400);
    const saved=await request('/api/admin/settings',{cookie:admin,method:'PUT',body:{urls:{seerrUrl:service},keys:{seerrKey:'persisted-secret'}}});assert.equal(saved.status,200);
    assert.equal((await saved.json()).keys.seerrKey,true);
    assert.doesNotMatch(await (await request('/api/admin/settings',{cookie:admin})).text(),/persisted-secret/);
    const tested=await (await request('/api/admin/settings/test',{cookie:admin,method:'POST',body:{service:'sonarr'}})).json();assert.equal(tested.status,'connected');
    await request('/api/admin/settings',{cookie:admin,method:'PUT',body:{urls:{},keys:{seerrKey:''}}});
    assert.equal(JSON.parse(await readFile(path.join(dir,'settings.json'))).seerrKey,'persisted-secret');
    await stop();await start();
    assert.equal((await request('/api/me',{cookie:admin})).status,401);
    const newAdmin=await login('admin');
    assert.equal((await (await request('/api/admin/settings',{cookie:newAdmin})).json()).keys.seerrKey,true);
    await request('/api/admin/overview',{cookie:newAdmin});assert.ok(calls.some(c=>c.key==='persisted-secret'));
    await request('/api/admin/settings',{cookie:newAdmin,method:'PUT',body:{urls:{},keys:{},clearKeys:['seerrKey']}});
    assert.equal(JSON.parse(await readFile(path.join(dir,'settings.json'))).seerrKey,'');
    await request('/api/logout',{cookie:newAdmin,method:'POST'});
    assert.equal((await request('/api/me',{cookie:newAdmin})).status,401);
  });
});

test('corrupt persisted settings fail visibly instead of silently discarding credentials',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'jellyhub-invalid-'));
  try{
    await writeFile(path.join(dir,'settings.json'),'{invalid');
    const child=spawn(process.execPath,[serverFile],{env:{...process.env,CONFIG_DIR:dir,PORT:'0'}});
    let stderr='';child.stderr.on('data',d=>stderr+=d);
    const [code]=await once(child,'exit');assert.notEqual(code,0);assert.match(stderr,/SyntaxError/);
  }finally{await rm(dir,{recursive:true,force:true})}
});
