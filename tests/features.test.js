import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFeatures, brandingDefaults } from '../features.js';

function fixture(libraryItems){
  const config={...brandingDefaults,seerrKey:'private-key',seerrUrl:'http://seerr:5055'};
  const users=[{Id:'admin',Name:'Admin',Configuration:{AudioLanguagePreference:'de'},Policy:{IsAdministrator:true,IsDisabled:false,EnableAllFolders:true,EnabledFolders:[],EnableContentDeletion:false}},{Id:'viewer',Name:'Viewer',Configuration:{AudioLanguagePreference:'en'},Policy:{IsAdministrator:false,EnableAllFolders:false,EnabledFolders:['movies'],EnableContentDeletion:false,CustomUntouchedField:17}}];
  const calls=[];let permissions=32,unmapped=false,ignoreIdentity=false,discoveryFails=false,quotaFails=false;
  const library=libraryItems||[{Id:'visible',Name:'Library Movie',Type:'Movie',ProviderIds:{Tmdb:'100'}}];
  const jf=async(route,session,opts={})=>{
    calls.push({service:'jf',route,session:session.id,...opts});
    if(route==='Users')return structuredClone(users);
    if(route==='Library/VirtualFolders')return [{ItemId:'movies',Name:'Movies'},{ItemId:'shows',Name:'Shows'}];
    const user=users.find(u=>route==='Users/'+u.Id||route==='Users/'+u.Id+'/Policy');
    if(user){if(opts.method==='POST'){if(route.endsWith('/Policy'))user.Policy=opts.body;else Object.assign(user,opts.body)}return structuredClone(user)}
    if(route.startsWith('Users/viewer/Items?'))return {Items:library};
    throw Error('Unexpected Jellyfin route '+route);
  };
  const upstream=async(base,route,opts={})=>{
    calls.push({service:'seerr',route,...opts});
    if(route.startsWith('api/v1/user/jellyfin/')){if(unmapped)throw Object.assign(Error('Not found'),{status:404});return {id:7,jellyfinUserId:'viewer',permissions,jellyfinAuthToken:'hidden-token'}}
    if(route==='api/v1/auth/me')return {id:ignoreIdentity?1:7,jellyfinUserId:ignoreIdentity?'admin':'viewer',permissions};
    if(discoveryFails)throw Object.assign(Error('Seerr unavailable'),{status:503});
    if(route.startsWith('api/v1/search?'))return {results:[{id:100,title:'Library Movie',mediaType:'movie',posterPath:'/poster.jpg'},{id:200,title:'Request Movie',mediaType:'movie',mediaInfo:{status:1,requests:[{requestedBy:{email:'private'}}]}},{id:300,name:'A Show',mediaType:'tv'},{id:5,name:'A Person',mediaType:'person'}]};
    if(route.startsWith('api/v1/discover/'))return {results:[{id:100,title:'Popular',name:'Popular',posterPath:'/poster.jpg'}]};
    if(route==='api/v1/tv/300')return {id:300,name:'A Show',seasons:[{seasonNumber:0,name:'Specials'},{seasonNumber:1,name:'Season 1'},{seasonNumber:2,name:'Season 2'}],mediaInfo:{seasons:[{seasonNumber:1,status:5}]}};
    if(route==='api/v1/movie/200')return {id:200,title:'Request Movie'};
    if(route==='api/v1/request'){if(quotaFails)throw Object.assign(Error('Service returned HTTP 403.'),{status:403});return {id:9,status:1,requestedBy:{email:'private'}}}
    throw Error('Unexpected Seerr route '+route);
  };
  const handler=createFeatures({getConfig:()=>config,saveConfig:async patch=>Object.assign(config,patch),jf,upstream,json:(res,status,data)=>Object.assign(res,{status,data}),send:(res,status,data,headers)=>Object.assign(res,{status,data,headers}),readBody:async req=>req.body,cleanId:id=>{assert.match(id,/^[a-zA-Z0-9-]+$/);return id}});
  const run=async(path,{method='GET',body,session={id:'viewer'}}={})=>{const res={};await handler({method,body},res,new URL(path,'http://local'),session);return res};
  return {config,users,calls,run,set(options){if('permissions'in options)permissions=options.permissions;if('unmapped'in options)unmapped=options.unmapped;if('ignoreIdentity'in options)ignoreIdentity=options.ignoreIdentity;if('discoveryFails'in options)discoveryFails=options.discoveryFails;if('quotaFails'in options)quotaFails=options.quotaFails}};
}

test('branding validates text/color, serves uploaded favicon, resets and never returns integration secrets',async()=>{
  const f=fixture();const saved=await f.run('/api/admin/branding',{method:'PUT',body:{title:'My Cinema',name:'Cinema',welcome:'Choose tonight’s movie',accent:'#aabbcc'}});
  assert.equal(saved.data.title,'My Cinema');assert.doesNotMatch(JSON.stringify(saved.data),/private-key/);
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l2kAAAAASUVORK5CYII=';
  await f.run('/api/admin/branding/favicon',{method:'PUT',body:{data:png}});
  const icon=await f.run('/favicon.ico',{session:null});assert.equal(icon.headers['Content-Type'],'image/png');assert.equal(icon.data.toString('base64'),png);
  assert.equal((await f.run('/api/branding',{session:null})).data.name,'Cinema');
  await assert.rejects(()=>f.run('/api/admin/branding/favicon',{method:'PUT',body:{data:Buffer.from('<svg onload="alert(1)"/>').toString('base64')}}),/Only PNG and ICO/);
  await assert.rejects(()=>f.run('/api/admin/branding/favicon',{method:'PUT',body:{data:Buffer.alloc(65537).toString('base64')}}),/64 KiB/);
  await f.run('/api/admin/branding/favicon',{method:'DELETE'});assert.equal(f.config.brandingFavicon,'');
  await f.run('/api/admin/branding/logo',{method:'PUT',body:{data:png}});assert.equal((await f.run('/branding-logo',{session:null})).headers['Content-Type'],'image/png');assert.match((await f.run('/api/branding',{session:null})).data.logo,/branding-logo/);
  await assert.rejects(()=>f.run('/api/admin/branding/logo',{method:'PUT',body:{data:Buffer.from('<svg/>').toString('base64')}}),/PNG/);
  await f.run('/api/admin/branding/logo',{method:'DELETE'});assert.match((await f.run('/api/branding',{session:null})).data.logo,/branding-logo/);
  await assert.rejects(()=>f.run('/api/admin/branding',{method:'PUT',body:{title:'Valid',name:'Name',welcome:'Welcome',accent:'red;display:none'}}),/accent/);
});

test('user edits preserve unrelated policy and configuration; invalid libraries and self-lockout are blocked',async()=>{
  const f=fixture();const listed=await f.run('/api/admin/users');assert.equal(listed.data.users.length,2);assert.equal(listed.data.libraries.length,2);
  await f.run('/api/admin/users/viewer',{method:'PUT',session:{id:'admin'},body:{name:'Viewer',policy:{EnableRemoteAccess:true,EnabledFolders:['shows']}}});
  assert.equal(f.users[1].Policy.CustomUntouchedField,17);assert.equal(f.users[1].Policy.EnableContentDeletion,false);assert.equal(f.users[1].Policy.EnableRemoteAccess,true);assert.deepEqual(f.users[1].Policy.EnabledFolders,['shows']);
  await f.run('/api/admin/users/viewer/name',{method:'PUT',session:{id:'admin'},body:{name:'New Viewer'}});assert.equal(f.users[1].Name,'New Viewer');assert.equal(f.users[1].Configuration.AudioLanguagePreference,'en');
  await assert.rejects(()=>f.run('/api/admin/users/admin',{method:'PUT',session:{id:'admin'},body:{name:'Admin',policy:{IsAdministrator:false}}}),/current account/);
  await assert.rejects(()=>f.run('/api/admin/users/viewer',{method:'PUT',session:{id:'admin'},body:{name:'New Viewer',policy:{EnabledFolders:['missing']}}}),/no longer exists/);
  await assert.rejects(()=>f.run('/api/admin/users/viewer',{method:'PUT',session:{id:'admin'},body:{name:'New Viewer',policy:{EnableContentDeletion:true}}}),/Unsupported/);
});

test('universal search merges user-scoped Jellyfin and Seerr results without raw user data',async()=>{
  const f=fixture();const result=await f.run('/api/search?q=movie');
  assert.equal(result.data.library[0].Id,'visible');assert.equal(result.data.catalog.length,3);assert.equal(result.data.catalog[0].libraryId,'visible');assert.equal(result.data.catalog[1].libraryId,null);
  assert.doesNotMatch(JSON.stringify(result.data),/private-key|hidden-token|requestedBy|email/);
  assert.ok(f.calls.filter(c=>c.service==='seerr'&&!c.route.startsWith('api/v1/user/')).every(c=>c.headers['X-Api-User']==='7'));
  f.set({discoveryFails:true});const partial=await f.run('/api/search?q=movie');assert.equal(partial.data.library.length,1);assert.equal(partial.data.catalog.length,0);assert.equal(partial.data.errors[0].source,'Seerr');
});

test('search pages both backends and hidden titles stay out of featured/discovery rows',async()=>{
  const f=fixture([{Id:'visible',Name:'Movie',Type:'Movie',ProviderIds:{Tmdb:'100'},Path:'/private/file.mp4'}]);
  const page=await f.run('/api/search?q=movie&page=2');assert.equal(page.data.page,2);assert.doesNotMatch(JSON.stringify(page.data),/private\/file|"Path"/);
  assert.ok(f.calls.some(call=>call.service==='jf'&&new URL('http://test/'+call.route).searchParams.get('StartIndex')==='60'));
  assert.ok(f.calls.some(call=>call.service==='seerr'&&call.route.includes('search?')&&call.route.includes('page=2')&&call.headers['X-Api-User']==='7'));
  await assert.rejects(f.run('/api/search?q=movie&page=0'),/Search page/);
  f.config.userState=JSON.stringify({viewer:{hiddenItems:['visible']}});assert.deepEqual((await f.run('/api/featured')).data.items,[]);assert.deepEqual((await f.run('/api/discover')).data.movies,[]);
});

test('discovery and media details use verified Seerr identity; TV season state is normalized',async()=>{
  const f=fixture();const data=await f.run('/api/discover');assert.equal(data.data.movies.length,1);assert.equal(data.data.shows.length,1);
  const detail=await f.run('/api/catalog/tv/300');assert.deepEqual(detail.data.seasons.map(s=>[s.number,s.requested]),[[1,true],[2,false]]);
  f.set({ignoreIdentity:true});await assert.rejects(()=>f.run('/api/discover'),/impersonation/);
  f.set({ignoreIdentity:false,unmapped:true});await assert.rejects(()=>f.run('/api/discover'),/matching Seerr account/);
});

test('featured titles are accessible library matches and stay stable within an hourly shuffle window',async()=>{
  const f=fixture();const first=await f.run('/api/featured'),second=await f.run('/api/featured');assert.deepEqual(first.data.items,second.data.items);assert.equal(first.data.items[0].Id,'visible');assert.equal(first.data.reshuffleAt%3600000,0);assert.equal(first.data.source,'popular');
  f.set({discoveryFails:true});const fallback=await f.run('/api/featured');assert.equal(fallback.data.source,'library');assert.equal(fallback.data.items[0].Id,'visible');
});

test('featured selection returns at most eight distinct titles and omits private source fields',async()=>{
  const items=Array.from({length:12},(_,index)=>({Id:'movie'+index,Name:'Movie '+index,Type:'Movie',Path:'/private/video.mp4'}));
  const f=fixture(items);f.set({discoveryFails:true});const result=await f.run('/api/featured');
  assert.equal(result.data.items.length,8);assert.equal(new Set(result.data.items.map(item=>item.Id)).size,8);assert.doesNotMatch(JSON.stringify(result.data),/private|Path/);
  assert.ok(result.data.items.every(item=>items.some(source=>source.Id===item.Id)));
  const mixed=fixture([{Id:'popular',Name:'Popular Movie',Type:'Movie',ProviderIds:{Tmdb:'100'}},...items]);
  const filled=await mixed.run('/api/featured');assert.equal(filled.data.items.length,8);assert.ok(filled.data.items.some(item=>item.Id==='popular'),'Keep accessible popular titles while filling remaining places from the library');assert.equal(filled.data.source,'mixed');
});

test('movie and season requests enforce actor permissions and upstream quota decisions',async()=>{
  const f=fixture();const movie=await f.run('/api/requests',{method:'POST',body:{mediaType:'movie',mediaId:200}});assert.equal(movie.status,201);assert.deepEqual(movie.data,{id:9,status:1});
  const request=f.calls.find(c=>c.route==='api/v1/request');assert.equal(request.headers['X-Api-User'],'7');assert.deepEqual(request.body,{mediaType:'movie',mediaId:200});
  const tv=await f.run('/api/requests',{method:'POST',body:{mediaType:'tv',mediaId:300,seasons:[2]}});assert.equal(tv.status,201);
  await assert.rejects(()=>f.run('/api/requests',{method:'POST',body:{mediaType:'tv',mediaId:300,seasons:[999]}}),/Unknown season/);
  await assert.rejects(()=>f.run('/api/requests',{method:'POST',body:{mediaType:'movie',mediaId:200,userId:1}}),/Unsupported/);
  f.set({permissions:262144});await assert.rejects(()=>f.run('/api/requests',{method:'POST',body:{mediaType:'tv',mediaId:300,seasons:[2]}}),/permission/);
  f.set({permissions:0});await assert.rejects(()=>f.run('/api/requests',{method:'POST',body:{mediaType:'movie',mediaId:200}}),/permission/);
  f.set({permissions:32,quotaFails:true});await assert.rejects(()=>f.run('/api/requests',{method:'POST',body:{mediaType:'movie',mediaId:200}}),/403/);
});
