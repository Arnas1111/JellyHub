import test from 'node:test';
import assert from 'node:assert/strict';
import {createPresence,recentPeople} from '../presence.js';
const time=Date.parse('2026-11-15T12:00:00Z'),date=age=>new Date(time-age).toISOString();
const session=(id,age,extra={})=>({UserId:id,UserName:id,LastActivityDate:date(age),...extra});
test('presence groups devices and GUID formats, prefers active playback, distinguishes away and drops stale/anonymous sessions',()=>{
  const guid='0123456789abcdef0123456789abcdef',rows=[session(guid,1000,{NowPlayingItem:{Id:'movie',Name:'Paused movie'},PlayState:{IsPaused:true}}),session('01234567-89ab-cdef-0123-456789abcdef',2000,{NowPlayingItem:{Id:'other',Name:'Playing movie'}}),session('away',180000),session('stale',301000),session('',0),session('future',-90000)];
  const users=recentPeople(rows,time);assert.equal(users.length,2);assert.equal(users[0].state,'watching');assert.equal(users[0].playing.item.Name,'Playing movie');assert.equal(users[1].state,'away');
});
test('presence merges connected JellyHub users with native clients and hides stream titles without permission or media access',async()=>{
  const config={jellyfinUrl:'http://jellyfin',registrationServiceKey:'private-key',userState:JSON.stringify({viewer:{profile:{displayName:'Movie Friend'}}})},calls=[];
  const handler=createPresence({getConfig:()=>config,getHubSessions:()=>[{id:'viewer',name:'login-name',created:time-10000,lastActivity:time},{id:'offline-hub',name:'Old login',created:time-900000,lastActivity:time-301000}],now:()=>time,jellyfin:()=>config.jellyfinUrl,authHeader:()=>'',send(){},json:(res,status,data)=>Object.assign(res,{status,data}),upstream:async()=>[session('viewer',1000,{NowPlayingItem:{Id:'movie',Name:'Permitted movie'},AccessToken:'secret',RemoteEndPoint:'private-ip'}),session('other',1000,{NowPlayingItem:{Id:'forbidden',Name:'Forbidden movie',Path:'/private/file'}})],jf:async route=>{calls.push(route);if(route.endsWith('/forbidden'))throw Error('Forbidden');return {Name:'Permitted movie'}}});
  const run=async actor=>{const response={};await handler({method:'GET'},response,new URL('http://local/api/presence'),actor);return response.data};
  const limited=await run({id:'viewer',admin:false});assert.equal(limited.users.length,2);assert.equal(limited.users.find(user=>user.name==='Movie Friend').state,'watching');assert.ok(limited.users.every(user=>user.activity===null));assert.doesNotMatch(JSON.stringify(limited),/Permitted movie|Forbidden movie|secret|private-ip|\/private\/file|offline-hub/);assert.equal(calls.length,0);assert.match(limited.users[0].avatar,/^\/api\/presence\/avatar\/[a-f0-9]{32}\?v=/);
  config.userState=JSON.stringify({viewer:{profile:{displayName:'Movie Friend'},featurePermissions:{streams:true}}});const allowed=await run({id:'viewer',admin:false});assert.equal(allowed.users.find(user=>user.name==='Movie Friend').activity.title,'Permitted movie');assert.equal(allowed.users.find(user=>user.name==='other').activity,null);
  const admin=await run({id:'admin',admin:true});assert.equal(admin.users.find(user=>user.name==='other').activity.title,'Forbidden movie');
  config.userState='{}';assert.ok((await run({id:'viewer',admin:false})).users.every(user=>!user.activity));
});
test('unavailable native presence retains recent JellyHub activity with a truthful partial state',async()=>{
  const handler=createPresence({getConfig:()=>({}),getHubSessions:()=>[{id:'viewer',name:'Viewer',created:time-1000,lastActivity:time}],now:()=>time,jf:async()=>{throw Error('Offline')},json:(res,status,data)=>Object.assign(res,{status,data})});
  const response={};await handler({method:'GET'},response,new URL('http://local/api/presence'),{id:'viewer'});assert.equal(response.data.count,1);assert.equal(response.data.partial,true);assert.equal(response.data.users[0].state,'online');
});
