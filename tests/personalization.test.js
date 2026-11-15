import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startPlaybackFixture } from './mock-jellyfin.mjs';
import { createPersonalization } from '../personalization.js';

test('old automatic-pause defaults reset once and a new explicit choice persists',async()=>{
  let config={userState:JSON.stringify({viewer:{preferences:{autoPause:true,volume:45}}})},output;
  const route=createPersonalization({getConfig:()=>config,saveConfig:async mutate=>{config={...config,...mutate(config)}},json:(_res,_status,body)=>output=body,readBody:async req=>req.body});
  const request=async(method,body)=>{await route({method,body},{},new URL('http://test/api/preferences'),{id:'viewer'});return output};
  assert.equal((await request('GET')).autoPause,false);assert.equal(output.volume,45);
  assert.equal((await request('PUT',{volume:60})).autoPause,false);
  assert.equal((await request('PUT',{autoPause:true})).autoPause,true);
  assert.equal((await request('GET')).autoPause,true);assert.equal(output.volume,60);
  assert.equal(Object.hasOwn(output,'backgroundPlaybackConfigured'),false);
  assert.equal((await request('PUT',{autoPause:false})).autoPause,false);
});

test('preferences and bookmarks are validated, durable and private to the signed-in account',async t=>{
  const fixture=await startPlaybackFixture();t.after(()=>fixture.close());
  const request=(path,{cookie,method='GET',body}={})=>fetch(fixture.base+path,{method,headers:cookie?{Cookie:cookie}:{},body:body?JSON.stringify(body):undefined});
  const login=async name=>(await request('/api/login',{method:'POST',body:{username:name,password:'fixture'}})).headers.get('set-cookie').split(';')[0];
  const user=await login('viewer'),other=await login('admin');
  assert.equal((await request('/api/preferences')).status,401);
  assert.equal((await request('/api/preferences',{cookie:user,method:'PUT',body:{autoSkipIntro:true,subtitleSize:120}})).status,200);
  assert.equal((await (await request('/api/preferences',{cookie:user})).json()).autoSkipIntro,true);
  assert.equal((await (await request('/api/preferences',{cookie:other})).json()).autoSkipIntro,false);
  for(const body of [{userId:'admin'},{subtitleColor:'red;display:none'},{volume:200},{autoSkipIntro:'yes'}])assert.equal((await request('/api/preferences',{cookie:user,method:'PUT',body})).status,400);
  assert.equal((await request('/api/bookmarks',{cookie:user,method:'POST',body:{itemId:'forbidden',positionTicks:10000000,label:''}})).status,403);
  const added=await request('/api/bookmarks',{cookie:user,method:'POST',body:{itemId:'movie-direct',positionTicks:50000000,label:'Favorite moment'}});assert.equal(added.status,201);const bookmark=await added.json();
  assert.equal((await (await request('/api/bookmarks',{cookie:user})).json()).items.length,1);
  assert.equal((await (await request('/api/bookmarks',{cookie:other})).json()).items.length,0);
  await request('/api/bookmarks/'+bookmark.id,{cookie:other,method:'DELETE'});assert.equal((await (await request('/api/bookmarks',{cookie:user})).json()).items.length,1);
  await request('/api/bookmarks/'+bookmark.id,{cookie:user,method:'DELETE'});assert.equal((await (await request('/api/bookmarks',{cookie:user})).json()).items.length,0);
  await Promise.all([request('/api/preferences',{cookie:user,method:'PUT',body:{rate:1.25}}),request('/api/preferences',{cookie:other,method:'PUT',body:{volume:60}})]);
  assert.equal((await (await request('/api/preferences',{cookie:user})).json()).rate,1.25);assert.equal((await (await request('/api/preferences',{cookie:other})).json()).volume,60);
});
