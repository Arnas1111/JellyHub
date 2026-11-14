import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startPlaybackFixture } from './mock-jellyfin.mjs';
import { resolvePlaybackResource, rewritePlaylist, buildPlaybackProfile } from '../playback.js';

test('playback resource graph rejects SSRF/traversal and rewrites every HLS URI',()=>{
  const base='http://jellyfin:8096/jellyfin/',parent=base+'Videos/movie/main.m3u8';
  const target=resolvePlaybackResource('segment.ts?api_key=secret&x=1',parent,'movie',base);assert.equal(target.searchParams.has('api_key'),false);assert.equal(target.searchParams.get('x'),'1');
  for(const uri of ['https://attacker.test/segment.ts','../../System/Info','/jellyfin/Videos/other/segment.ts','file:///tmp/segment.ts','segment.ts#fragment','/jellyfin/Videos/movie/%2e%2e/segment.ts'])assert.throws(()=>resolvePlaybackResource(uri,parent,'movie',base));
  const uris=[];const rewritten=rewritePlaylist('#EXTM3U\n#EXT-X-MAP:URI="init.mp4?api_key=secret"\n#EXT-X-KEY:METHOD=AES-128,URI="enc.key"\nsegment.ts\n',parent,url=>{uris.push(url);return '/private/'+uris.length});
  assert.equal(uris.length,3);assert.doesNotMatch(rewritten,/api_key|secret|http:/);assert.match(rewritten,/URI="\/private\/1"/);assert.match(rewritten,/\/private\/3/);
  assert.throws(()=>rewritePlaylist('<html>not a playlist</html>',parent,()=>''));
  assert.equal(buildPlaybackProfile({maxBitrate:3000000}).TranscodingProfiles[0].Protocol,'hls');
});

test('Jellyfin GUID formats and root-relative HLS URLs retain the configured URL base',()=>{
  const compact='0123456789abcdef0123456789abcdef',hyphenated='01234567-89ab-cdef-0123-456789abcdef',base='http://jellyfin:8096/jellyfin/';
  for(const item of [compact,hyphenated])for(const stream of [compact,hyphenated,hyphenated.toUpperCase()]){
    const master=resolvePlaybackResource(`/videos/${stream}/master.m3u8?api_key=secret`,base,item,base);assert.equal(master.pathname,`/jellyfin/videos/${stream}/master.m3u8`);assert.equal(master.searchParams.has('api_key'),false);
    const segment=resolvePlaybackResource('hls1/main/0.ts',master,item,base);assert.equal(segment.pathname,`/jellyfin/videos/${stream}/hls1/main/0.ts`);
  }
  for(const path of ['/videos/ffffffff-ffff-ffff-ffff-ffffffffffff/master.m3u8','/other/videos/'+hyphenated+'/master.m3u8','/videos/'+hyphenated+'/%2e%2e/master.m3u8'])assert.throws(()=>resolvePlaybackResource(path,base,compact,base),error=>error.code==='PLAYBACK_RESOURCE_PATH'&&!!error.reason);
  assert.throws(()=>resolvePlaybackResource('http://external.test/videos/'+hyphenated+'/master.m3u8',base,compact,base),error=>error.code==='PLAYBACK_RESOURCE_ORIGIN');
});

test('full playback negotiates, proxies HLS/ranges/subtitles, reports progress and isolates sessions',async t=>{
  const fixture=await startPlaybackFixture();t.after(()=>fixture.close());
  const request=(route,{cookie,method='GET',body,headers={}}={})=>fetch(fixture.base+route,{method,headers:{...(cookie?{Cookie:cookie}:{}),...headers},body:body?JSON.stringify(body):undefined});
  const login=async user=>(await request('/api/login',{method:'POST',body:{username:user,password:'fixture'}})).headers.get('set-cookie').split(';')[0];
  const viewer=await login('viewer'),admin=await login('admin');
  const start=async(itemId,extra={})=>{const response=await request('/api/playback/start',{cookie:viewer,method:'POST',body:{itemId,...extra}});assert.equal(response.status,200,await response.clone().text());return response.json()};
  const direct=await start('movie-direct');assert.equal(direct.method,'DirectPlay');assert.equal(direct.startSeconds,2);assert.equal(direct.runtimeSeconds,12);assert.equal(direct.tracks.filter(t=>t.type==='Audio').length,2);assert.equal(direct.segments[0].type,'Intro');assert.equal(direct.chapters.length,2);assert.doesNotMatch(JSON.stringify(direct),/secret|api_key|PlaySessionId|private\/|Path/);
  const guid=await start('0123456789abcdef0123456789abcdef');assert.equal(guid.hls,true);const guidMaster=await request(guid.url,{cookie:viewer});assert.equal(guidMaster.status,200);assert.match(await guidMaster.text(),/#EXTM3U/);assert.ok(fixture.calls.some(call=>call.path==='/videos/01234567-89ab-cdef-0123-456789abcdef/master.m3u8'));
  const invalidPath=await request('/api/playback/start',{cookie:viewer,method:'POST',body:{itemId:'movie-bad-path',forceTranscode:true}});assert.equal(invalidPath.status,502);assert.equal((await invalidPath.json()).code,'PLAYBACK_RESOURCE_PATH');assert.match(fixture.logs(),/"reason":"different_item"/);assert.match(fixture.logs(),/"message":"Jellyfin returned an unexpected playback resource path/);assert.doesNotMatch(fixture.logs(),/must-never-reach-browser|secret-token-/);
  const episode=await start('episode1');assert.equal(episode.nextEpisode.id,'episode2');assert.equal(episode.seasons[0].id,'season1');
  const season=await request(`/api/playback/${episode.id}/episodes?seasonId=season1`,{cookie:viewer});assert.equal(season.status,200);assert.equal((await season.json()).episodes.length,2);
  assert.equal((await request(`/api/playback/${episode.id}/episodes?seasonId=unrelated`,{cookie:viewer})).status,400);assert.equal((await request(`/api/playback/${episode.id}/episodes?seasonId=season1`,{cookie:admin})).status,403);
  const range=await request(direct.url,{cookie:viewer,headers:{Range:'bytes=0-99'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,100);assert.match(range.headers.get('content-range'),/^bytes 0-99\//);
  assert.equal((await request(direct.url,{cookie:admin})).status,403);assert.equal((await request(direct.url)).status,401);
  assert.equal((await request('/api/playback/start',{cookie:viewer,method:'POST',body:{itemId:'forbidden'}})).status,403);
  assert.equal((await request('/api/playback/start',{cookie:viewer,method:'POST',body:{itemId:'movie-direct',startTicks:-1}})).status,400);
  for(const event of ['start','progress'])assert.equal((await request(`/api/playback/${direct.id}/report`,{cookie:viewer,method:'POST',body:{event,positionTicks:50000000,paused:event==='progress',volume:50,rate:1}})).status,200);
  assert.equal(fixture.reports[0].body.ItemId,'movie-direct');assert.equal(fixture.reports[1].body.PositionTicks,50000000);assert.equal(fixture.reports[1].body.IsPaused,true);
  const hls=await start('movie-hls',{startTicks:40000000,audioIndex:2,subtitleIndex:3,forceTranscode:true,maxBitrate:3000000});assert.equal(hls.hls,true);assert.equal(hls.startSeconds,4);assert.equal(hls.offsetSeconds,0);
  assert.equal(fixture.playbackInfo.at(-1).StartTimeTicks,0,'VOD segments must use an absolute seekable timeline');
  const master=await (await request(hls.url,{cookie:viewer})).text();assert.match(master,/#EXTM3U/);assert.doesNotMatch(master,/api_key|must-never|http:/);
  const variantPath=master.split('\n').find(line=>line.startsWith('/api/'));const variant=await (await request(variantPath,{cookie:viewer})).text();assert.match(variant,/#EXTINF/);assert.doesNotMatch(variant,/segment000\.ts/);
  const segmentPath=variant.split('\n').find(line=>line.startsWith('/api/'));const segment=await request(segmentPath,{cookie:viewer});assert.equal(segment.status,200);assert.ok((await segment.arrayBuffer()).byteLength>1000);
  const subtitles=await request(hls.subtitle,{cookie:viewer});assert.equal(subtitles.status,200);assert.match(await subtitles.text(),/^WEBVTT/);
  assert.ok(fixture.calls.filter(call=>call.path.startsWith('/Videos/')).every(call=>!call.query.api_key&&call.auth.includes('secret-token-viewer')));
  fixture.setAllowed(false);assert.equal((await request(direct.url,{cookie:viewer})).status,403);fixture.setAllowed(true);
  await request(`/api/playback/${hls.id}/report`,{cookie:viewer,method:'POST',body:{event:'start',positionTicks:40000000}});
  await request(`/api/playback/${hls.id}/report`,{cookie:viewer,method:'POST',body:{event:'stop',positionTicks:80000000}});
  assert.ok(fixture.calls.some(call=>call.path==='/Videos/ActiveEncodings'&&call.method==='DELETE'));assert.equal((await request(hls.url,{cookie:viewer})).status,403);
  await request(`/api/playback/${direct.id}/report`,{cookie:viewer,method:'POST',body:{event:'stop',positionTicks:60000000}});
});
