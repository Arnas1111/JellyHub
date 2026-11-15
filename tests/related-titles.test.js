import test from 'node:test';
import assert from 'node:assert/strict';
import {relatedTitles,createMedia} from '../media.js';

const source={Id:'source',Type:'Movie',Genres:['Adventure','Comedy'],People:[{Type:'Director',Name:'Director A'},{Type:'Actor',Name:'Actor A'}],Studios:[{Name:'Studio A'}]};
const movie=(Id,extra={})=>({Id,Name:Id,Type:'Movie',...extra});
test('related titles favor shared genres and filmmakers, deduplicate and preserve Jellyfin order for ties',()=>{
  const candidates=[movie('unrelated'),movie('genre',{Genres:['Comedy']}),movie('filmmaker',{Genres:['comedy'],People:[{Type:'Director',Name:'Director A'}]}),movie('genre'),source,{Id:'show',Type:'Series'},movie('missing',{IsMissing:true}),movie('virtual',{IsVirtualItem:true}),movie('also-unrelated')];
  assert.deepEqual(relatedTitles(source,candidates).map(item=>item.Id),['filmmaker','genre','unrelated','also-unrelated']);
  assert.equal(relatedTitles(source,Array.from({length:60},(_,i)=>movie('movie'+i))).length,12);
});
test('related title endpoint keeps recommendations user scoped and hides excluded titles and raw metadata',async()=>{
  const calls=[];let output;
  const route=createMedia({jf:async path=>{calls.push(path);if(path==='Users/viewer/Items/source')return source;return {Items:[movie('hidden',{Genres:['Adventure','Comedy']}),movie('visible',{Genres:['Comedy'],ImageTags:{Primary:'poster'},Path:'/private/file',People:source.People})]}},cleanId:id=>id,json:(_res,_status,body)=>output=body,getConfig:()=>({userState:JSON.stringify({viewer:{hiddenItems:['hidden']}})})});
  await route({method:'GET'},{},new URL('http://fixture/api/details/source'),{id:'viewer'});
  assert.deepEqual(output.similar.map(item=>item.Id),['visible']);assert.equal(output.similar[0].ImageTags.Primary,'poster');assert.doesNotMatch(JSON.stringify(output.similar),/private|People/);
  const query=new URL('http://fixture/'+calls[1]).searchParams;assert.equal(query.get('UserId'),'viewer');assert.equal(query.get('Limit'),'48');assert.match(query.get('Fields'),/Genres,People,Studios/);
});
