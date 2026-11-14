import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverFile=fileURLToPath(new URL('../server.js',import.meta.url));

test('startup, authentication, media permissions, integrations and persisted settings',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'jellyhub-test-'));
  let revoked=false,overlayCalls=0,playbackAllowed=true,unsupportedVideo=false;
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
    if(url.pathname==='/Users/Me')return send(200,{Id:token.includes('Token="admin"')?'admin':'viewer',Name:'Test',Policy:{IsAdministrator:token.includes('Token="admin"')&&!revoked,EnableMediaPlayback:playbackAllowed}});
    if(url.pathname==='/Users/viewer/Items/hidden')return send(403,{});
    if(/^\/Users\/[^/]+\/Items\/(visible|hidden|series|episode1|maintenance)$/.test(url.pathname))return send(200,{Id:url.pathname.split('/').at(-1),Name:'Movie',Type:url.pathname.endsWith('maintenance')?'BoxSet':url.pathname.endsWith('series')?'Series':url.pathname.endsWith('episode1')?'Episode':'Movie',RunTimeTicks:90000000000,Path:'/private/movie.mp4',People:[{Name:'An Actor',Role:'Lead',Type:'Actor'}],Studios:[{Name:'A Studio'}],MediaStreams:[{Type:'Video',Codec:'h264',Height:1080},{Type:'Audio',Language:'eng'},{Type:'Subtitle',Language:'deu'}]});
    if(url.pathname.endsWith('/Items/Resume'))return send(200,{Items:[url.searchParams.get('IncludeItemTypes')==='Episode'?{Id:'episode1',Name:'Episode',Type:'Episode',SeriesName:'A Show'}:{Id:'visible',Name:'Resume',Type:'Movie'}]});
    if(url.pathname==='/Shows/series/Seasons')return send(200,{Items:[{Id:'season1',Name:'Season 1',Type:'Season'}]});
    if(url.pathname==='/Shows/series/Episodes')return send(200,{Items:[{Id:'episode1',Name:'Pilot',Type:'Episode',Path:'/private/episode.mp4'}]});
    if(url.pathname.endsWith('/Similar'))return send(200,{Items:[{Id:'visible',Name:'Related movie',Type:'Movie'}]});
    if(url.pathname==='/Items/visible/PlaybackInfo'||url.pathname==='/Items/episode1/PlaybackInfo'){
      let raw='';for await(const part of req)raw+=part;calls.at(-1).body=JSON.parse(raw);
      return send(200,{MediaSources:[{Id:'source1',Container:unsupportedVideo?'mkv':'mp4',SupportsDirectPlay:true,Path:'/private/movie.mp4',MediaStreams:[{Type:'Video',Codec:'h264',BitDepth:8,VideoRange:'SDR'},{Type:'Audio',Codec:'aac'}]}]});
    }
    if(url.pathname==='/Videos/visible/stream'){
      calls.at(-1).range=req.headers.range;assert.equal(url.searchParams.get('Static'),'true');
      const bytes=Buffer.from('0123456789');const ranged=!!req.headers.range;
      res.writeHead(ranged?206:200,{'Content-Type':'video/mp4','Content-Length':ranged?4:10,'Accept-Ranges':'bytes',...(ranged?{'Content-Range':'bytes 0-3/10'}:{})});return res.end(req.method==='HEAD'?undefined:ranged?bytes.subarray(0,4):bytes);
    }
    if(url.pathname.endsWith('/Items')){if(url.searchParams.get('IncludeItemTypes')==='BoxSet')return send(200,{Items:[{Id:'genuine',Name:'Film Collection',Type:'BoxSet'},...(url.searchParams.get('ExcludeItemIds')?.includes('maintenance')?[]:[{Id:'maintenance',Name:'Basic Movies',Type:'BoxSet'}])],TotalRecordCount:url.searchParams.get('ExcludeItemIds')?.includes('maintenance')?1:2});return send(200,{Items:[{Id:'visible',Name:'Movie'}]})}
    if(url.pathname.endsWith('/Views'))return send(200,{Items:[]});
    if(url.pathname==='/Items/visible/Images/Primary'){res.writeHead(200,{'Content-Type':'image/jpeg'});return res.end('image')}
    if(url.pathname==='/api/collections/overlay-data'){
      overlayCalls++;
      return send(200,[{id:1,mediaServerId:'maintenance',title:'Expiring',arrAction:0,isActive:true,deleteAfterDays:7,media:[{mediaServerId:'visible',addDate:'2026-01-01T00:00:00Z'},{mediaServerId:'hidden',addDate:'2026-01-01T00:00:00Z'}]},{id:2,title:'Inactive',isActive:false,arrAction:0,deleteAfterDays:1,media:[{mediaServerId:'visible',addDate:'2026-01-01T00:00:00Z'}]}]);
    }
    if(url.pathname==='/api/v1/request')return send(200,{results:[{id:1}],pageInfo:{results:1}});
    if(url.pathname==='/api/v3/queue')return send(200,{records:[{id:1}],totalRecords:1});
    if(url.pathname==='/api/v3/system/status'&&!['sonarr-secret','radarr-secret','unsaved-secret'].includes(req.headers['x-api-key']))return send(401,{error:`Rejected key: ${req.headers['x-api-key']}`});
    if(url.pathname==='/html/api/v3/system/status'){res.writeHead(200,{'Content-Type':'text/html'});return res.end('<html>Login page</html>')}
    if(url.pathname==='/redirect/api/v3/system/status'){res.writeHead(302,{Location:'/api/v3/system/status'});return res.end()}
    if(['/System/Info/Public','/api/v1/status','/api/v3/system/status'].includes(url.pathname))return send(200,{Version:'mock'});
    if(url.pathname==='/Sessions/Logout')return send(200,{});
    return send(404,{});
  });
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const service=`http://127.0.0.1:${upstream.address().port}`;
  let child,base,logs='';
  async function start(){
    child=spawn(process.execPath,[serverFile],{cwd:dir,env:{...process.env,PORT:'0',CONFIG_DIR:dir,JELLYFIN_URL:service,MAINTAINERR_URL:service,SEERR_URL:service,SONARR_URL:service,RADARR_URL:service,SEERR_API_KEY:'request-secret',SONARR_API_KEY:'sonarr-secret',RADARR_API_KEY:'radarr-secret'}});
    logs='';child.stderr.on('data',d=>logs+=d);
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
    assert.equal((await request('/api/login',{method:'POST',body:'null'})).status,400);
    assert.equal((await request('/api/login',{method:'POST',body:'x'.repeat(9000)})).status,413);
    assert.equal((await request('/api/login',{method:'POST',body:{username:'viewer',password:'wrong'}})).status,401);
  });
  await t.test('static player assets negotiate compression and revalidate unchanged files',async()=>{
    const plain=await request('/vendor/hls.min.mjs',{headers:{'Accept-Encoding':'identity'}}),source=await plain.text();assert.match(plain.headers.get('content-type'),/javascript/);const size=Number(plain.headers.get('content-length'));assert.ok(size>500000);
    for(const encoding of ['br','gzip']){const compressed=await request('/vendor/hls.min.mjs',{headers:{'Accept-Encoding':encoding}});assert.equal(compressed.headers.get('content-encoding'),encoding);assert.ok(Number(compressed.headers.get('content-length'))<size/2);assert.equal(await compressed.text(),source);assert.equal(compressed.headers.get('vary'),'Accept-Encoding');assert.match(compressed.headers.get('content-security-policy'),/worker-src 'self' blob:/);const cached=await request('/vendor/hls.min.mjs',{headers:{'Accept-Encoding':encoding,'If-None-Match':compressed.headers.get('etag')}});assert.equal(cached.status,304);assert.equal(await cached.text(),'')}
    const disabled=await request('/vendor/hls.min.mjs',{headers:{'Accept-Encoding':'br;q=0,gzip;q=0'}});assert.equal(disabled.headers.get('content-encoding'),null);assert.equal(await disabled.text(),source);
    const head=await request('/vendor/hls.min.mjs',{method:'HEAD',headers:{'Accept-Encoding':'identity'}});assert.equal(Number(head.headers.get('content-length')),size);assert.equal(await head.text(),'');assert.match((await request('/extensions/manifest.json')).headers.get('content-type'),/application\/json/);
  });
  const viewer=await login('viewer');const admin=await login('admin');
  await t.test('user-scoped media and administrator access checks',async()=>{
    for(const route of ['/api/home','/api/items?type=Movie','/api/views','/api/item/visible','/api/image/visible'])assert.equal((await request(route,{cookie:viewer})).status,200,route);
    assert.equal((await request('/api/item/hidden',{cookie:viewer})).status,403);
    assert.equal((await request('/api/image/hidden',{cookie:viewer})).status,403);
    for(const route of ['/api/admin/settings','/api/admin/overview','/api/admin/removals','/api/admin/branding','/api/admin/users'])assert.equal((await request(route,{cookie:viewer})).status,403,route);
    for(const route of ['/api/admin/branding/favicon','/api/admin/users/viewer'])assert.equal((await request(route,{cookie:viewer,method:'PUT',body:{}})).status,403,route);
    assert.equal((await request('/api/admin/settings',{cookie:admin,method:'PUT',headers:{Origin:'http://evil.example'},body:{urls:{},keys:{}}})).status,403);
  });
  await t.test('Maintainerr countdown, caching and item permission filtering',async()=>{
    const result=await (await request('/api/removals?ids=visible,hidden',{cookie:viewer})).json();
    assert.deepEqual(Object.keys(result.byId),['visible']);
    assert.equal(result.byId.visible.deletionDate,'2026-01-08T00:00:00.000Z');
    await request('/api/removals?ids=visible',{cookie:viewer});assert.equal(overlayCalls,1);
    assert.equal((await (await request('/api/admin/removals',{cookie:admin})).json()).entries.length,2);
  });
  await t.test('library-specific continue rows and enriched details preserve item permissions and hide file paths',async()=>{
    const movie=await (await request('/api/continue?type=Movie',{cookie:viewer})).json();assert.equal(movie.Items[0].Type,'Movie');
    const shows=await (await request('/api/continue?type=Series',{cookie:viewer})).json();assert.equal(shows.Items[0].Type,'Episode');
    const detail=await (await request('/api/details/visible',{cookie:viewer})).json();assert.equal(detail.people[0].name,'An Actor');assert.equal(detail.technical.video.height,1080);assert.doesNotMatch(JSON.stringify(detail),/private\/movie|"Path"/);
    const series=await (await request('/api/details/series',{cookie:viewer})).json();assert.equal(series.seasons[0].Id,'season1');assert.equal(series.episodes[0].Name,'Pilot');
    assert.equal((await request('/api/details/series?seasonId=foreign',{cookie:viewer})).status,400);
    assert.equal((await request('/api/details/hidden',{cookie:viewer})).status,403);
    assert.equal((await request('/api/continue?type=invalid',{cookie:viewer})).status,400);
  });
  await t.test('Maintainerr management collections are excluded from browsing and denied to normal users',async()=>{
    for(const cookie of [viewer,admin]){const data=await (await request('/api/browse?type=BoxSet',{cookie})).json();assert.deepEqual(data.Items.map(item=>item.Id),['genuine']);assert.equal(data.TotalRecordCount,1)}
    for(const route of ['/api/item/maintenance','/api/details/maintenance','/api/image/maintenance'])assert.equal((await request(route,{cookie:viewer})).status,403,route);
    assert.equal((await request('/api/item/maintenance',{cookie:admin})).status,200);assert.equal((await request('/api/browse?type=Movie,Series&parent=maintenance',{cookie:admin})).status,403);assert.equal((await request('/api/admin/management-collections',{cookie:viewer})).status,403);
    assert.deepEqual(JSON.parse(await readFile(path.join(dir,'settings.json'),'utf8')).managementCollections,'["maintenance"]');
  });
  await t.test('preview negotiation and range streaming keep tokens private and reject cross-session access',async()=>{
    const preview=await (await request('/api/preview/visible',{cookie:viewer})).json();assert.equal(preview.playable,true);assert.equal(preview.clipSeconds,20);assert.doesNotMatch(JSON.stringify(preview),/source1|private|Token|AccessToken/);
    const info=calls.find(c=>c.path==='/Items/visible/PlaybackInfo');assert.equal(info.body.EnableTranscoding,false);assert.equal(info.body.AutoOpenLiveStream,false);assert.equal(info.body.IsPlayback,false);
    const stream=await request(preview.url,{cookie:viewer,headers:{Range:'bytes=0-3'}});assert.equal(stream.status,206);assert.equal(stream.headers.get('content-range'),'bytes 0-3/10');assert.equal(await stream.text(),'0123');assert.ok(calls.some(c=>c.range==='bytes=0-3'));
    assert.equal((await request(preview.url,{cookie:admin})).status,403);assert.equal((await request(preview.url)).status,401);
    assert.equal((await request(preview.url,{cookie:viewer,headers:{Range:'bytes=0-1,5-6'}})).status,416);
    assert.equal((await request('/api/preview/hidden',{cookie:viewer})).status,403);
    playbackAllowed=false;assert.equal((await request('/api/preview/visible',{cookie:viewer})).status,403);assert.equal((await request(preview.url,{cookie:viewer})).status,403);playbackAllowed=true;
    unsupportedVideo=true;assert.equal((await (await request('/api/preview/visible',{cookie:viewer})).json()).playable,false);unsupportedVideo=false;
    assert.ok(!calls.some(c=>/Sessions\/Playing|ActiveEncodings/.test(c.path)),'Previews must not report watch progress or start transcoding');
  });
  await t.test('integration requests use server-side keys; revoked admins lose access',async()=>{
    const overview=await (await request('/api/admin/overview',{cookie:admin})).json();
    assert.ok(overview.integrations.every(i=>i.status==='connected'));
    assert.ok(calls.some(c=>c.path==='/api/v1/request'&&c.key==='request-secret'));
    revoked=true;
    for(const route of ['/api/admin/settings','/api/admin/overview','/api/admin/removals','/api/admin/branding','/api/admin/users'])assert.equal((await request(route,{cookie:admin})).status,403);
    revoked=false;
  });
  await t.test('current form keys, missing keys, rejected keys, URL bases and safe diagnostics',async()=>{
    const logging=await request('/api/admin/logging',{cookie:admin,method:'PUT',body:{level:'debug'}});
    assert.equal((await logging.json()).persisted,true);
    assert.equal((await request('/api/admin/logging',{cookie:viewer,method:'PUT',body:{level:'debug'}})).status,403);
    assert.equal((await request('/api/admin/logging',{cookie:admin,method:'PUT',body:{level:'bogus'}})).status,400);
    const testConnection=async body=>(await request('/api/admin/settings/test',{cookie:admin,method:'POST',body:{service:'sonarr',...body}})).json();
    const unsaved=await testConnection({apiKey:'  unsaved-secret  '});assert.equal(unsaved.status,'connected');
    assert.equal(JSON.parse(await readFile(path.join(dir,'settings.json'))).sonarrKey,'sonarr-secret');
    const count=calls.length;const missing=await testConnection({clearKey:true});
    assert.equal(missing.diagnostics.code,'MISSING_API_KEY');assert.equal(calls.length,count+1,'Only administrator verification should reach upstream');
    const rejected=await testConnection({apiKey:'wrong-secret'});
    assert.equal(rejected.status,'error');assert.equal(rejected.diagnostics.httpStatus,401);assert.equal(rejected.diagnostics.keyConfigured,true);
    assert.match(rejected.diagnostics.hint,/API key/);assert.ok(rejected.diagnostics.requestId);
    assert.doesNotMatch(JSON.stringify(rejected),/wrong-secret/);
    const html=await testConnection({url:service+'/html',apiKey:'unsaved-secret'});assert.equal(html.diagnostics.code,'INVALID_RESPONSE');
    const redirect=await testConnection({url:service+'/redirect',apiKey:'unsaved-secret'});assert.equal(redirect.diagnostics.httpStatus,302);
    assert.match(redirect.diagnostics.hint,/redirect/);
    const unreachable=await testConnection({url:'http://127.0.0.1:1',apiKey:'unsaved-secret'});assert.equal(unreachable.status,'error');assert.ok(unreachable.diagnostics.code);
    // Logs must never contain credentials, cookies, request bodies or upstream response bodies.
    assert.doesNotMatch(logs,/unsaved-secret|wrong-secret|sonarr-secret|radarr-secret|request-secret|Token=|jh_sid=|Login page/);
    assert.match(logs,/upstream.failed/);
    const settings=await (await request('/api/admin/settings',{cookie:admin})).json();assert.equal(settings.logging.level,'debug');assert.equal(settings.storage.writable,true);
  });
  await t.test('unwritable appdata returns actionable diagnostics and permits temporary debug logging',{skip:process.platform==='win32'||process.getuid?.()===0},async()=>{
    await chmod(dir,0o500);
    try{
      const settings=await (await request('/api/admin/settings',{cookie:admin})).json();assert.equal(settings.storage.writable,false);
      const failed=await request('/api/admin/settings',{cookie:admin,method:'PUT',body:{urls:{},keys:{seerrKey:'must-not-save'}}});
      assert.equal(failed.status,503);const body=await failed.json();assert.equal(body.code,'CONFIG_NOT_WRITABLE');assert.match(body.error,/UID.*read\/write/);assert.ok(body.requestId);
      assert.notEqual(JSON.parse(await readFile(path.join(dir,'settings.json'))).seerrKey,'must-not-save');
      const result=await (await request('/api/admin/logging',{cookie:admin,method:'PUT',body:{level:'debug'}})).json();assert.equal(result.persisted,false);assert.equal(result.level,'debug');assert.match(result.message,/process only/);
    }finally{await chmod(dir,0o700)}
  });
  await t.test('settings validate, redact secrets, test connections and survive restart',async()=>{
    const invalid=await request('/api/admin/settings',{cookie:admin,method:'PUT',body:{urls:{seerrUrl:'file:///etc/passwd'},keys:{}}});assert.equal(invalid.status,400);
    const saved=await request('/api/admin/settings',{cookie:admin,method:'PUT',body:{urls:{seerrUrl:service},keys:{seerrKey:'persisted-secret'}}});assert.equal(saved.status,200);
    assert.equal((await saved.json()).keys.seerrKey,true);
    assert.doesNotMatch(await (await request('/api/admin/settings',{cookie:admin})).text(),/persisted-secret/);
    const tested=await (await request('/api/admin/settings/test',{cookie:admin,method:'POST',body:{service:'sonarr'}})).json();assert.equal(tested.status,'connected');
    await request('/api/admin/settings',{cookie:admin,method:'PUT',body:{urls:{},keys:{seerrKey:''}}});
    const branding={title:'Test Cinema',name:'My Hub',welcome:'Find a movie',accent:'#bbaaee'};
    await request('/api/preferences',{cookie:admin,method:'PUT',body:{autoPause:false}});
    await Promise.all([request('/api/admin/branding',{cookie:admin,method:'PUT',body:branding}),request('/api/admin/settings',{cookie:admin,method:'PUT',body:{urls:{sonarrUrl:service},keys:{}}})]);
    assert.equal((await (await request('/api/branding')).json()).title,'Test Cinema');
    const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l2kAAAAASUVORK5CYII=';
    assert.equal((await request('/api/admin/branding/favicon',{cookie:admin,method:'PUT',body:{data:png}})).status,200);
    assert.equal((await request('/favicon.ico')).headers.get('content-type'),'image/png');
    assert.equal((await request('/api/admin/branding/logo',{cookie:admin,method:'PUT',body:{data:png}})).status,200);
    const publicBranding=await (await request('/api/branding')).json();assert.match(publicBranding.favicon,/favicon\.png/);assert.equal((await request(publicBranding.logo)).headers.get('content-type'),'image/png');
    assert.equal(JSON.parse(await readFile(path.join(dir,'settings.json'))).seerrKey,'persisted-secret');
    await stop();await start();
    assert.equal((await request('/api/me',{cookie:admin})).status,401);
    const newAdmin=await login('admin');
    assert.equal((await (await request('/api/preferences',{cookie:newAdmin})).json()).autoPause,false);
    assert.equal((await (await request('/api/branding')).json()).name,'My Hub');
    assert.equal(Buffer.from(await (await request('/favicon.ico')).arrayBuffer()).toString('base64'),png);
    assert.equal(Buffer.from(await (await request('/branding-logo')).arrayBuffer()).toString('base64'),png);
    assert.equal((await (await request('/api/admin/settings',{cookie:newAdmin})).json()).logging.level,'debug');
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
