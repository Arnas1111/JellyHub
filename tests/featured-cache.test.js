import test from 'node:test';
import assert from 'node:assert/strict';
import {readFeaturedSnapshot,writeFeaturedSnapshot,clearFeaturedSnapshots} from '../public/featured-cache.js';
function storage(){const values=new Map();return {get length(){return values.size},key:index=>[...values.keys()][index],getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)}}
test('featured snapshots are user-scoped, bounded, expiring and contain no stream credentials',()=>{
  const store=storage(),now=10000000,data={items:[{Id:'movie',Name:'Movie',Overview:'Hello',Path:'/private/movie',Token:'secret',UserData:{Password:'secret'}}],activeId:'movie',source:'library',artwork:{id:'movie',data:'data:image/jpeg;base64,YWJj'}};
  writeFeaturedSnapshot('alice',data,store,now);assert.equal(readFeaturedSnapshot('bob',store,now),null);const saved=readFeaturedSnapshot('alice',store,now);assert.equal(saved.activeId,'movie');assert.equal(saved.artwork.data,data.artwork.data);assert.doesNotMatch(JSON.stringify(saved),/secret|private|Token|Password|UserData/);
  assert.equal(readFeaturedSnapshot('alice',store,now+3600001),null);assert.equal(store.length,0);
  writeFeaturedSnapshot('alice',{...data,artwork:{id:'movie',data:'data:image/svg+xml;base64,YWJj'}},store,now);assert.equal(readFeaturedSnapshot('alice',store,now).artwork,null);
  writeFeaturedSnapshot('bob',data,store,now);store.setItem('unrelated','preserve');clearFeaturedSnapshots(store);assert.equal(store.getItem('unrelated'),'preserve');assert.equal(store.length,1);
  writeFeaturedSnapshot('alice',data,store,now);writeFeaturedSnapshot('alice',{items:[]},store,now);assert.equal(readFeaturedSnapshot('alice',store,now),null);
});
test('blocked, corrupt and quota-limited snapshot storage never breaks the page',()=>{
  const broken={getItem(){throw Error('disabled')},setItem(){throw Error('full')},get length(){throw Error('disabled')}};assert.equal(readFeaturedSnapshot('alice',broken),null);assert.doesNotThrow(()=>writeFeaturedSnapshot('alice',{items:[{Id:'one',Name:'One'}]},broken));assert.doesNotThrow(()=>clearFeaturedSnapshots(broken));
  const store=storage();store.setItem('jellyhub.featured.v1.alice','{bad');assert.equal(readFeaturedSnapshot('alice',store),null);
});
