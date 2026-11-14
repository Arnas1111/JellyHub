import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createProfiles,profileName} from '../profiles.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l2kAAAAASUVORK5CYII=','base64');
test('profiles preserve login identity, scope photo mutations and serve bounded appdata presets',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'jellyhub-profile-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));let config={userState:'{}'},editable=true;const calls=[],user={id:'viewer',deviceId:'device',token:'secret'};
  const handler=createProfiles({configDir:dir,getConfig:()=>config,saveConfig:async patch=>config={...config,...(typeof patch==='function'?patch(config):patch)},jf:async()=>({Name:'login-name',Policy:{EnableUserPreferenceAccess:editable}}),jellyfin:()=> 'http://jellyfin:8096',authHeader:actor=>'private-'+actor.id,fetchImpl:async(url,options)=>{calls.push({url,options});return options.method?new Response(null,{status:204}):new Response(png,{headers:{'Content-Type':'image/png'}})},readBody:async req=>req.body,json:(res,status,data)=>Object.assign(res,{status,data}),send:(res,status,data,headers)=>Object.assign(res,{status,data,headers})});
  const run=async(route,method='GET',body,actor=user)=>{const response={};assert.equal(await handler({method,body},response,new URL(route,'http://local'),actor),true);return response};
  await run('/api/profile','PUT',{displayName:'Movie Friend'});const profile=(await run('/api/profile')).data;assert.equal(profile.username,'login-name');assert.equal(profile.displayName,'Movie Friend');assert.equal(profileName(config,'other','Other'),'Other');assert.equal((await run('/api/profile','GET',null,{id:'other'})).data.displayName,'login-name');
  await assert.rejects(run('/api/profile','PUT',{displayName:'New',userId:'other'}),/display name/);await assert.rejects(run('/api/profile','PUT',{displayName:'\u0000'}),/display name/);
  await run('/api/profile/avatar','PUT',{data:png.toString('base64')});assert.equal(calls.at(-1).url.pathname,'/Users/viewer/Images/Primary');assert.equal(calls.at(-1).options.body,png.toString('base64'));assert.equal(calls.at(-1).options.headers.Authorization,'private-viewer');
  await assert.rejects(run('/api/profile/avatar','PUT',{data:png.toString('base64'),userId:'admin'}),/one profile picture/);await assert.rejects(run('/api/profile/avatar','PUT',{data:Buffer.from('<svg onload="alert(1)"/>').toString('base64')}),/PNG/);
  const folder=path.join(dir,'profile-pictures');await run('/api/profile/presets');await fs.writeFile(path.join(folder,'Portrait.png'),png);await fs.writeFile(path.join(folder,'secret.txt'),'private');const presets=(await run('/api/profile/presets')).data.items;assert.equal(presets.length,1);assert.equal(presets[0].name,'Portrait');assert.doesNotMatch(JSON.stringify(presets),/secret|configDir|"file":/);
  await run('/api/profile/avatar','PUT',{preset:presets[0].id});assert.equal(calls.at(-1).options.body,png.toString('base64'));const image=await run(presets[0].url);assert.deepEqual(image.data,png);await run('/api/profile/avatar','DELETE');assert.equal(calls.at(-1).options.method,'DELETE');
  editable=false;await assert.rejects(run('/api/profile','PUT',{displayName:'Blocked'}),/cannot change/);await assert.rejects(run('/api/profile/avatar','DELETE'),/cannot change/);
});
