import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlugins} from '../plugins.js';
import {createExtensions,validateNavigation} from '../extensions.js';

test('plugin inventory and Enhanced reviews require user-scoped item access and sanitize responses',async()=>{
  const calls=[],user={id:'viewer',admin:false};let allowed=true;
  const api=createPlugins({getConfig:()=>({userState:JSON.stringify({viewer:{profile:{displayName:'Display Friend'}}})}),jf:async(route,actor,options)=>{calls.push({route,actor,options});if(route==='Plugins')return [{Id:'intro',Name:'Intro Skipper',Version:'12.0.6.0',Status:'Active',Configuration:{key:'private'}}];if(route.startsWith('Users/')){if(!allowed)throw Object.assign(Error('Forbidden'),{status:403});return {Type:'Movie',ProviderIds:{Tmdb:'123'}}}return {reviews:[{userId:'viewer',userName:'Viewer',content:'Good',rating:4,secret:'private'}]}},readBody:async req=>req.input,cleanId:value=>value,json:(res,status,data)=>Object.assign(res,{status,data})});
  const run=async(path,method='GET',input)=>{const res={};await api({method,input},res,new URL(path,'http://test'),user);return res.data};
  await assert.rejects(run('/api/admin/plugins'),/Administrator/);user.admin=true;const inventory=await run('/api/admin/plugins');assert.equal(inventory.compatibility.find(p=>p.name==='Intro Skipper').installed.version,'12.0.6.0');assert.equal(JSON.stringify(inventory).includes('private'),false);
  const reviews=await run('/api/reviews/movie');assert.equal(reviews.reviews[0].own,true);assert.equal(reviews.reviews[0].name,'Display Friend');assert.equal(reviews.reviews[0].secret,undefined);assert.equal(calls.at(-1).route,'JellyfinEnhanced/reviews/movie/123');assert.equal(calls.at(-1).actor,user);
  await run('/api/reviews/movie','POST',{content:'Great',rating:4.5,userId:'other'});assert.deepEqual(calls.at(-1).options.body,{Content:'Great',Rating:4.5});await assert.rejects(run('/api/reviews/movie','POST',{content:'',rating:6}),/rating/);allowed=false;await assert.rejects(run('/api/reviews/movie'),/Forbidden/);
});

test('native navigation validates URLs and roles, persists and filters administrator links',async()=>{
  for(const url of ['javascript:alert(1)','data:text/html,hello','https://user:secret@example.org'])assert.throws(()=>validateNavigation([{id:'link-test',title:'Link',role:'all',url}]),/HTTP/);
  const links=[{id:'link-admin',title:'Sonarr',url:'http://sonarr:8989',role:'admin'},{id:'link-public',title:'Requests',url:'https://requests.example.org',role:'all'}];let config={navigation:'[]'};const user={admin:true};
  const api=createExtensions({getConfig:()=>config,saveConfig:async patch=>config={...config,...patch},readBody:async req=>req.input,json:(res,status,data)=>Object.assign(res,{status,data})});
  const run=async(path,method='GET',input)=>{const res={};await api({method,input},res,new URL(path,'http://test'),user);return res.data};
  await run('/api/admin/navigation','PUT',{links});assert.equal((await run('/api/navigation')).links.length,2);user.admin=false;assert.deepEqual((await run('/api/navigation')).links.map(link=>link.id),['link-public']);await assert.rejects(run('/api/admin/navigation'),/Administrator/);
});
