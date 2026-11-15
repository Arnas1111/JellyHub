import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createChatEvents} from '../chat-events.js';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
class Response extends EventEmitter{chunks=[];writeHead(status,headers){this.status=status;this.headers=headers}write(data){this.chunks.push(data);return !this.blocked}end(){if(!this.closed){this.closed=true;this.emit('close')}}}
test('live chat emits only authorized room invalidations and closes revoked or logged-out sessions',async()=>{
  let revoked=false,active=true;const live=createChatEvents({authorize:async user=>{if(revoked&&user.id==='bob')throw Object.assign(Error('revoked'),{status:403})},canRead:(id,user)=>id==='general'||user.id==='alice',isActive:()=>active}),alice=new Response(),bob=new Response();live.connect(alice,{id:'alice'});live.connect(bob,{id:'bob'});assert.equal(alice.headers['Content-Type'],'text/event-stream');assert.match(alice.chunks[0],/ready/);
  live.notify(['private-dm']);await settle();assert.match(alice.chunks.join(''),/private-dm/);assert.doesNotMatch(bob.chunks.join(''),/private-dm|change/);live.notify(['general']);await settle();assert.match(bob.chunks.join(''),/general/);revoked=true;live.notify(['general']);await settle();assert.equal(bob.closed,true);assert.match(bob.chunks.join(''),/blocked/);active=false;live.notify(['general']);await settle();assert.equal(alice.closed,true);
});
test('live chat bounds per-user connections and disconnects slow readers',async()=>{
  const live=createChatEvents({authorize:async()=>{},canRead:()=>true}),responses=Array.from({length:4},()=>new Response());for(const response of responses)live.connect(response,{id:'alice'});assert.throws(()=>live.connect(new Response(),{id:'alice'}),error=>error.status===429);responses[0].blocked=true;live.notify(['general']);await settle();assert.equal(responses[0].closed,true);for(const response of responses)response.end();
});
test('live chat coalesces bursts, allows reconnect after transient failures, and shuts down cleanly',async()=>{
  let failure=false;const live=createChatEvents({authorize:async()=>{if(failure)throw Object.assign(Error('Unavailable'),{status:502})},canRead:()=>true}),response=new Response();live.connect(response,{id:'alice'});live.notify(['general']);live.notify(['other']);live.notify(['general']);await settle();assert.equal(response.chunks.filter(chunk=>chunk.includes('event: change')).length,1);assert.match(response.chunks.join(''),/other/);failure=true;live.notify(['general']);await settle();assert.equal(response.closed,true);assert.doesNotMatch(response.chunks.join(''),/blocked/);failure=false;const next=new Response();live.connect(next,{id:'alice'});live.close();assert.equal(next.closed,true);
});
