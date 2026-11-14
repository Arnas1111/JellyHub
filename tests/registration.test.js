import test from 'node:test';
import assert from 'node:assert/strict';
import {createRegistration,generateRegistrationKey} from '../registration.js';
function fixture({oldKeys=false}={}){
  const config={registrationState:'{}',registrationServiceKey:'',userState:'{}',jellyfinUrl:'http://127.0.0.1:1'},calls=[],logs=[];let time=1000000000000,admin=true,passwordFailure=false,created=0;
  const saveConfig=async patch=>Object.assign(config,typeof patch==='function'?patch(config):patch);
  const jf=async(route,user,opts={})=>{calls.push({route,...opts});if(route==='Users/Me')return {Policy:{IsAdministrator:admin}};if(route==='Library/VirtualFolders')return [{ItemId:'movies',Name:'Movies'}];if(route.startsWith('Auth/Keys?'))return oldKeys?null:{AccessToken:'private-service-token-12345'};if(route==='Auth/Keys')return {Items:[{AppName:new URLSearchParams(calls.find(call=>call.route.startsWith('Auth/Keys?')).route.split('?')[1]).get('app'),AccessToken:'private-service-token-12345'}]};throw Error('Unexpected '+route)};
  const handler=createRegistration({getConfig:()=>config,saveConfig,jf,jellyfin:()=>config.jellyfinUrl,upstream:async(base,route,opts={})=>{calls.push({route,...opts});assert.match(opts.headers.Authorization,/private-service-token/);if(route==='Users/New')return {Id:'new-user-'+(++created),Policy:{IsAdministrator:true,EnableAllFolders:true}};if(route.endsWith('/Password')&&passwordFailure)throw Object.assign(Error('Password setup failed'),{status:503});return null},authHeader:user=>'Bearer '+user?.token,readBody:async req=>req.body,json:(response,status,data)=>Object.assign(response,{status,data}),send(){},cleanId:id=>{assert.match(id,/^[\w-]+$/);return id},logger:{log:(...args)=>logs.push(args)},now:()=>time});
  const user={id:'admin',token:'admin-private',deviceId:'test'};
  return {config,calls,logs,advance:value=>time+=value,setAdmin:value=>admin=value,failPassword:()=>passwordFailure=true,async run(route,method='GET',body={},actor=user,ip='test-ip'){const response={};await handler({method,body,socket:{remoteAddress:ip}},response,new URL(route,'http://local'),actor);return response}};
}
test('registration keys are exactly 20 characters with letters and symbols',()=>{const keys=Array.from({length:100},generateRegistrationKey);assert.equal(new Set(keys).size,100);for(const key of keys){assert.equal(key.length,20);assert.match(key,/[A-Za-z]/);assert.match(key,/[!@#$%&*+_=?-]/)}});
test('daily and manual registration key rotation persists and withholds keys from public metadata',async()=>{
  const f=fixture(),first=(await f.run('/api/admin/registration')).data;assert.equal(first.expiresAt-JSON.parse(f.config.registrationState).issuedAt,86400000);const persisted=JSON.parse(f.config.registrationState);assert.equal(first.key,persisted.key);
  f.advance(86400000-1);assert.equal((await f.run('/api/admin/registration')).data.key,first.key);f.advance(1);const rotated=(await f.run('/api/admin/registration')).data;assert.notEqual(rotated.key,first.key);assert.equal(rotated.expiresAt-first.expiresAt,86400000);
  const forced=(await f.run('/api/admin/registration/regenerate','POST')).data;assert.notEqual(forced.key,rotated.key);const publicData=(await f.run('/api/login-page','GET',{},null)).data;assert.deepEqual(publicData,{registrationEnabled:false,artwork:[]});assert.doesNotMatch(JSON.stringify(publicData),new RegExp(forced.key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  f.setAdmin(false);await assert.rejects(f.run('/api/admin/registration'),/Administrator required/);
});
test('registration supports old/new API key responses, restricts new accounts before enabling and rolls back failed creation',async()=>{
  for(const oldKeys of [false,true]){
    const f=fixture({oldKeys}),key=(await f.run('/api/admin/registration')).data.key;
    await assert.rejects(f.run('/api/admin/registration','PUT',{enabled:true,artwork:false,folders:[]}),/Select at least one/);
    await f.run('/api/admin/registration','PUT',{enabled:true,artwork:false,folders:['movies']});assert.equal(f.config.registrationServiceKey,'private-service-token-12345');
    const publicMetadata=(await f.run('/api/login-page','GET',{},null)).data;assert.equal(publicMetadata.registrationEnabled,true);assert.doesNotMatch(JSON.stringify(publicMetadata),/private-service/);
    const body={username:'newviewer',password:'chosen-password',key};const response=await f.run('/api/register','POST',body,null);assert.equal(response.status,201);assert.deepEqual(response.data,{created:true});
    const creation=f.calls.find(call=>call.route==='Users/New');assert.notEqual(creation.body.Password,body.password);const policies=f.calls.filter(call=>call.route==='Users/new-user-1/Policy');assert.equal(policies[0].body.IsDisabled,true);assert.equal(policies[1].body.IsDisabled,false);assert.equal(policies[0].body.IsAdministrator,false);assert.equal(policies[0].body.EnableAllFolders,false);assert.deepEqual(policies[0].body.EnabledFolders,['movies']);assert.equal(policies[0].body.EnableContentDownloading,false);assert.equal(policies[0].body.EnableRemoteControlOfOtherUsers,false);
    assert.deepEqual(JSON.parse(f.config.userState)['new-user-1'].featurePermissions,{requests:false,streams:false});assert.equal(f.calls.find(call=>call.route==='Users/new-user-1/Password').body.NewPw,body.password);assert.doesNotMatch(JSON.stringify(f.logs),/chosen-password|private-service|admin-private/);
    await f.run('/api/admin/registration/regenerate','POST');await assert.rejects(f.run('/api/register','POST',body,null),/invalid or has expired/);
    f.failPassword();const latest=(await f.run('/api/admin/registration')).data.key;await assert.rejects(f.run('/api/register','POST',{...body,username:'failedviewer',key:latest},null),/Password setup failed/);assert.ok(f.calls.some(call=>call.route==='Users/new-user-2'&&call.method==='DELETE'));
  }
});
test('invalid registration payloads, disabled registration and excessive attempts never create accounts',async()=>{
  const f=fixture(),key=(await f.run('/api/admin/registration')).data.key,body={username:'newviewer',password:'chosen-password',key};await assert.rejects(f.run('/api/register','POST',body,null),/not enabled/);
  await f.run('/api/admin/registration','PUT',{enabled:true,artwork:false,folders:['movies']});await assert.rejects(f.run('/api/register','POST',{...body,policy:{IsAdministrator:true}},null),/Use a username/);
  for(let i=0;i<6;i++)await assert.rejects(f.run('/api/register','POST',{...body,key:'x'.repeat(20)},null),/invalid or has expired/);
  await assert.rejects(f.run('/api/register','POST',body,null),/Too many registration attempts/);assert.equal(f.calls.filter(call=>call.route==='Users/New').length,0);
});
