import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createChat} from '../chat.js';
async function fixture(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'jellyhub-chat-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const config={userState:'{}'},logs=[];let time=Date.now();const make=()=>createChat({configDir:dir,getConfig:()=>config,readBody:async req=>req.body,json:(res,status,data)=>Object.assign(res,{status,data}),logger:{log:(...args)=>logs.push(args)},now:()=>time});let handler=make();return {dir,config,logs,advance:amount=>time+=amount,restart:()=>handler=make(),async call(route,method='GET',body={},user={id:'alice',name:'Alice',admin:false}){const res={};await handler({method,body},res,new URL(route,'http://local'),user);return res},id:()=>crypto.randomBytes(16).toString('hex')}}
test('chat persists, applies current display names, supports safe retry and enforces own/admin deletion',async t=>{
  const f=await fixture(t),clientId=f.id();f.config.userState=JSON.stringify({alice:{profile:{displayName:'Movie Friend'}}});
  const sent=(await f.call('/api/chat','POST',{text:'Hello <script>literal text</script>',clientId})).data.message;assert.equal(sent.name,'Movie Friend');assert.equal(sent.mine,true);assert.equal(sent.canDelete,true);assert.equal((await f.call('/api/chat','POST',{text:'retry',clientId})).data.message.id,sent.id);
  const bob={id:'bob',name:'Bob'},other=(await f.call('/api/chat','GET',{},bob)).data;assert.equal(other.messages.length,1);assert.equal(other.messages[0].canDelete,false);assert.doesNotMatch(JSON.stringify(other),/authorId|clientId/);
  assert.equal((await f.call('/api/chat?revision='+other.revision,'GET',{},bob)).data.unchanged,true);assert.deepEqual((await f.call('/api/chat?revision='+other.revision,'GET',{},bob)).data.messages,[]);
  await assert.rejects(f.call('/api/chat/messages/'+sent.id,'DELETE',{},bob),/only delete your own/);f.restart();assert.equal((await f.call('/api/chat')).data.messages[0].id,sent.id);
  await f.call('/api/chat/messages/'+sent.id,'DELETE',{}, {id:'admin',name:'Admin',admin:true});assert.equal((await f.call('/api/chat')).data.messages.length,0);assert.equal(JSON.parse(await fs.readFile(path.join(f.dir,'chat.json'),'utf8')).messages.length,0);
  assert.doesNotMatch(JSON.stringify(f.logs),/literal text/);
});
test('chat validates payloads, rate limits, serializes concurrent writes and bounds history',async t=>{
  const f=await fixture(t);await assert.rejects(f.call('/api/chat','POST',{text:'hi',clientId:f.id(),authorId:'someone'}),/Write a message/);await assert.rejects(f.call('/api/chat','POST',{text:' ',clientId:f.id()}),/Write a message/);
  await Promise.all(Array.from({length:10},(_,i)=>f.call('/api/chat','POST',{text:'Concurrent '+i,clientId:f.id()})));assert.equal((await f.call('/api/chat')).data.messages.length,10);
  for(let i=0;i<20;i++)await f.call('/api/chat','POST',{text:'rate '+i,clientId:f.id()});await assert.rejects(f.call('/api/chat','POST',{text:'too fast',clientId:f.id()}),/too quickly/);
  f.advance(60001);for(let i=0;i<205;i++){f.advance(3001);await f.call('/api/chat','POST',{text:'History '+i,clientId:f.id()})}const messages=(await f.call('/api/chat')).data.messages;assert.equal(messages.length,200);assert.equal(messages.at(-1).text,'History 204');
});
test('corrupt chat history fails visibly and is never silently overwritten',async t=>{
  const f=await fixture(t);await fs.writeFile(path.join(f.dir,'chat.json'),'{invalid');f.restart();await assert.rejects(f.call('/api/chat'),/could not be read/);await assert.rejects(f.call('/api/chat','POST',{text:'hello',clientId:f.id()}),/could not be read/);assert.equal(await fs.readFile(path.join(f.dir,'chat.json'),'utf8'),'{invalid');
});
