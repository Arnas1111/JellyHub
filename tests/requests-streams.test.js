import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startPlaybackFixture} from './mock-jellyfin.mjs';
const row=(id,owner=7,extra={})=>({id,status:2,requestedBy:{id:owner,displayName:owner===7?'Viewer':'Other Member',email:'never-expose@example.test',jellyfinUserId:owner===7?'viewer':'other'},createdAt:'2026-11-01T10:00:00Z',media:{tmdbId:id+900,mediaType:'movie',status:2,...extra}});
async function client(fixture,user){const login=await fetch(fixture.base+'/api/login',{method:'POST',body:JSON.stringify({username:user,password:'test'})});const cookie=login.headers.get('set-cookie').split(';')[0];return (route,body)=>fetch(fixture.base+route,{method:body?'PUT':'GET',headers:{Cookie:cookie},body:body?JSON.stringify(body):undefined})}
test('feature toggles persist, block APIs, preserve profiles and permit sanitized streams without granting administration',async t=>{
  const fixture=await startPlaybackFixture({seerr:true,streams:[{Id:'session1',UserName:'Viewer',UserId:'viewer',Client:'JellyHub',DeviceName:'Web',AccessToken:'never-expose-token',RemoteEndPoint:'private-network',NowPlayingItem:{Id:'movie-direct',Name:'Playing movie',Path:'/private/movie',RunTimeTicks:100000000,ImageTags:{},MediaStreams:[{Type:'Video',Codec:'h264',Width:1920,Height:1080}]},PlayState:{PositionTicks:50000000,IsPaused:true,PlayMethod:'Transcode'},TranscodingInfo:{VideoCodec:'h264',AudioCodec:'aac',Bitrate:11800000,TranscodeReasons:['ContainerNotSupported']}},{Id:'session2',UserId:'other',UserName:'Other',NowPlayingItem:{Id:'forbidden',Name:'Private title'}}]});t.after(()=>fixture.close());
  const admin=await client(fixture,'admin'),viewer=await client(fixture,'viewer');assert.equal((await viewer('/api/active-streams')).status,403);
  assert.equal((await viewer('/api/admin/users/viewer/features',{requests:false,streams:true})).status,403);
  assert.equal((await admin('/api/admin/users/viewer/features',{streams:'yes'})).status,400);
  await fetch(fixture.base+'/api/profile',{method:'PUT',headers:{Cookie:(await fetch(fixture.base+'/api/login',{method:'POST',body:JSON.stringify({username:'viewer',password:'test'})})).headers.get('set-cookie').split(';')[0]},body:JSON.stringify({displayName:'Movie Friend'})});
  assert.equal((await admin('/api/admin/users/viewer/features',{requests:false,streams:true})).status,200);
  const saved=JSON.parse(await fs.readFile(path.join(fixture.configDir,'settings.json'),'utf8')),state=JSON.parse(saved.userState);assert.deepEqual(state.viewer.featurePermissions,{requests:false,streams:true});assert.equal(state.viewer.profile.displayName,'Movie Friend');
  const me=await (await viewer('/api/me')).json();assert.deepEqual(me.permissions,{requests:false,streams:true});assert.equal(me.admin,false);
  assert.equal((await viewer('/api/requests')).status,403);assert.equal((await viewer('/api/catalog/movie/100')).status,403);assert.equal((await viewer('/api/discover')).status,403);
  const calls=fixture.calls.length;const search=await (await viewer('/api/search?q=test')).json();assert.deepEqual(search.catalog,[]);assert.ok(search.library.length);await viewer('/api/featured');assert.equal(fixture.calls.slice(calls).some(call=>call.path.startsWith('/api/v1/')),false,'Disabled request access must not fetch Seerr discovery/search');
  const personal=await (await viewer('/api/my-list')).json();assert.deepEqual(personal.requests.items,[]);
  const visible=await (await viewer('/api/active-streams')).json();assert.equal(visible.streams.length,1);assert.equal(visible.streams[0].paused,true);assert.equal(visible.streams[0].progress,50);assert.equal(visible.streams[0].bitrate,11800000);assert.equal(visible.streams[0].user,'Movie Friend');assert.doesNotMatch(JSON.stringify(visible),/never-expose|private-network|\/private\/|Private title/);
  assert.equal((await viewer('/api/admin/users')).status,403);assert.equal((await (await admin('/api/active-streams')).json()).streams.length,2);
  await admin('/api/admin/users/viewer/features',{streams:false});assert.equal((await viewer('/api/active-streams')).status,403);
  fixture.setAdmin(false);assert.equal((await admin('/api/active-streams')).status,403,'A revoked administrator must not retain inherited stream access');
});
test('request dashboard respects verified Seerr visibility, sanitizes downloads and keeps My Requests personal',async t=>{
  const requests=[row(1,7,{status:3,downloadStatus:[{status:'downloading',size:100,sizeLeft:40,timeleft:'00:10:00',downloadId:'never-expose',title:'/private/movie'}]}),row(2,8)];
  for(const permissions of [32,32|16384]){
    const fixture=await startPlaybackFixture({seerr:true,seerrPermissions:permissions,requests});t.after(()=>fixture.close());const viewer=await client(fixture,'viewer');
    const data=await (await viewer('/api/requests?scope=all')).json();assert.equal(data.canViewAll,!!(permissions&16384));assert.equal(data.items.length,permissions&16384?2:1);assert.equal(data.downloads[0].status.progress,60);assert.equal(data.downloads[0].download.etaSeconds,600);assert.doesNotMatch(JSON.stringify(data),/never-expose|\/private\/|email|downloadId/);
    const mine=await (await viewer('/api/requests?scope=mine')).json();assert.equal(mine.items.length,1);assert.equal(mine.items[0].requester.own,true);assert.ok(fixture.calls.some(call=>call.path==='/api/v1/request'&&call.query.requestedBy==='7'));
    const sourceCalls=fixture.calls.length;await viewer('/api/my-list?source=favorites');assert.equal(fixture.calls.slice(sourceCalls).some(call=>call.path.startsWith('/api/v1/')),false,'Favorites must work independently of Seerr');
  }
});
test('coming-soon request pagination advances a real source cursor without duplicates',async t=>{
  const requests=Array.from({length:25},(_,index)=>row(index+1)),releaseDates=Object.fromEntries(requests.map(request=>[request.media.tmdbId,'2099-01-01']));
  const fixture=await startPlaybackFixture({seerr:true,requests,releaseDates});t.after(()=>fixture.close());const viewer=await client(fixture,'viewer');
  const first=await (await viewer('/api/requests?scope=mine&filter=upcoming')).json();assert.equal(first.items.length,20);assert.equal(first.hasMore,true);assert.equal(first.nextStart,20);assert.equal(first.total,null);
  const next=await (await viewer('/api/requests?scope=mine&filter=upcoming&start='+first.nextStart)).json();assert.equal(next.items.length,5);assert.equal(next.hasMore,false);assert.equal(new Set([...first.items,...next.items].map(item=>item.requestId)).size,25);assert.ok(next.items.every(item=>item.status.state==='upcoming'));
});
