import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeEpisodes,seriesProgress} from '../series-progress.js';
import {startPlaybackFixture} from './mock-jellyfin.mjs';
const episode=(Id,Played=false,extra={})=>({Id,Type:'Episode',SeasonId:'season1',ParentIndexNumber:1,RunTimeTicks:100000000,UserData:{Played,PlaybackPositionTicks:Played?0:20000000},...extra});
test('episode totals deduplicate, exclude unavailable placeholders and separate progress from completion',()=>{
  const data=summarizeEpisodes([episode('a',true),episode('b'),episode('c',false,{SeasonId:'season2',ParentIndexNumber:2,UserData:{Played:false,PlaybackPositionTicks:0}}),episode('a'),episode('missing',false,{IsMissing:true}),episode('virtual',false,{IsVirtualItem:true}),{Id:'movie',Type:'Movie'}]);
  assert.equal(data.total,3);assert.equal(data.watched,1);assert.equal(data.inProgress,1);assert.equal(data.unwatched,2);assert.equal(data.episodes[1].percent,20);assert.deepEqual(data.seasons.map(s=>[s.id,s.total,s.watched]),[['season1',2,1],['season2',1,0]]);assert.equal(summarizeEpisodes([]).percent,0);
});
test('whole-show progress includes every page and uses only the current Jellyfin account',async()=>{
  const rows=Array.from({length:205},(_,i)=>episode('episode'+i,i<103)),calls=[];
  const jf=async(path,user)=>{calls.push(path);assert.equal(user.id,'viewer');if(path==='Users/viewer/Items/series')return {Type:'Series'};const q=new URL('http://fixture/'+path).searchParams;assert.equal(q.get('UserId'),'viewer');assert.equal(q.get('IsMissing'),'false');const start=Number(q.get('StartIndex'));return {Items:rows.slice(start,start+200),TotalRecordCount:205}};
  const result=await seriesProgress('series',{id:'viewer'},jf);assert.equal(result.total,205);assert.equal(result.watched,103);assert.equal(calls.length,3);
  const capped=await seriesProgress('series',{id:'viewer'},async path=>{if(path==='Users/viewer/Items/series')return {Type:'Series'};const start=Number(new URL('http://fixture/'+path).searchParams.get('StartIndex'));return {Items:rows.slice(start,start+50),TotalRecordCount:205}});assert.equal(capped.total,205);assert.equal(capped.watched,103);
  await assert.rejects(seriesProgress('series',{id:'viewer'},async path=>path==='Users/viewer/Items/series'?{Type:'Series'}:{Items:[],TotalRecordCount:10}),/incomplete episode list/);
  await assert.rejects(seriesProgress('forbidden',{id:'viewer'},async()=>{throw Object.assign(Error('Forbidden'),{status:403})}),{status:403});
  await assert.rejects(seriesProgress('movie',{id:'viewer'},async()=>({Type:'Movie'})),{status:400});
});
test('watch progress and episode updates remain private to each account',async t=>{
  const fixture=await startPlaybackFixture({resumeTicks:0,watchStates:{viewer:{episode1:{Played:true}}}});t.after(()=>fixture.close());
  const client=async name=>{const login=await fetch(fixture.base+'/api/login',{method:'POST',body:JSON.stringify({username:name,password:'fixture'})}),cookie=login.headers.get('set-cookie').split(';')[0];return (path,body)=>fetch(fixture.base+path,{method:body?'PUT':'GET',headers:{Cookie:cookie},body:body?JSON.stringify(body):undefined})};
  const viewer=await client('viewer'),admin=await client('admin');assert.equal((await fetch(fixture.base+'/api/series-progress/series')).status,401);assert.equal((await viewer('/api/series-progress/forbidden')).status,403);
  assert.equal((await (await viewer('/api/series-progress/series')).json()).watched,1);assert.equal((await (await admin('/api/series-progress/series')).json()).watched,0);
  assert.equal((await viewer('/api/user-item/episode2',{played:true})).status,200);assert.equal((await (await viewer('/api/series-progress/series')).json()).watched,2);assert.equal((await (await admin('/api/series-progress/series')).json()).watched,0);
  assert.equal((await viewer('/api/user-item/episode1',{played:false})).status,200);assert.equal((await (await viewer('/api/series-progress/series')).json()).watched,1);
});
