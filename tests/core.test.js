import test from 'node:test';
import assert from 'node:assert/strict';
import {createCore,libraryItem} from '../core.js';

test('library paging, filters and user actions retain identity and hide private source data',async()=>{
  let config={userState:'{}'};const calls=[],user={id:'viewer'},item={Id:'movie',Name:'Movie',MediaSources:[{Path:'/private',MediaStreams:[{Type:'Video',Height:2160,VideoRange:'HDR',VideoRangeType:'HDR10'},{Type:'Audio',Channels:6}]}],Path:'/private'};
  const handler=createCore({getConfig:()=>config,saveConfig:async patch=>{config={...config,...(typeof patch==='function'?patch(config):patch)}},jf:async(route,actor,options)=>{calls.push({route,actor,options});if(route==='Users/Me')return {Id:'viewer',Name:'Viewer',Configuration:{Unrelated:true},Policy:{}};if(route.includes('/Items/forbidden'))throw Object.assign(Error('Forbidden'),{status:403});if(route.includes('/Items/'))return item;return {Items:[item],TotalRecordCount:123}},readBody:async req=>req.input,cleanId:value=>{if(!/^[a-z0-9-]+$/.test(value))throw Error('Invalid id');return value},json:(res,status,data)=>Object.assign(res,{status,data})});
  const run=async(path,method='GET',input)=>{const res={};assert.equal(await handler({method,input},res,new URL(path,'http://test'),user),true);return res.data};
  const page=await run('/api/browse?type=Movie&start=48&limit=48&sort=CommunityRating&order=desc&genre=Drama&year=2026&filter=IsUnplayed');assert.equal(page.TotalRecordCount,123);assert.equal(page.StartIndex,48);assert.deepEqual(page.Items[0].QualityTags,['4K','HDR10','5.1']);assert.equal(JSON.stringify(page).includes('/private'),false);
  const query=new URL('http://test/'+calls.at(-1).route).searchParams;assert.equal(query.get('StartIndex'),'48');assert.equal(query.get('Filters'),'IsUnplayed');assert.equal(query.get('Genres'),'Drama');assert.equal(calls.at(-1).actor,user);
  await run('/api/user-item/movie','PUT',{favorite:true});assert.equal(calls.at(-1).route,'Users/viewer/FavoriteItems/movie');assert.equal(calls.at(-1).options.method,'POST');await run('/api/user-item/movie','PUT',{played:false});assert.equal(calls.at(-1).options.method,'DELETE');
  await assert.rejects(run('/api/user-item/forbidden','PUT',{hidden:true}),/Forbidden/);await run('/api/user-item/movie','PUT',{hidden:true});assert.deepEqual(JSON.parse(config.userState).viewer.hiddenItems,['movie']);await run('/api/browse');assert.match(calls.at(-1).route,/ExcludeItemIds=movie/);
  await run('/api/account/configuration','PUT',{SubtitleMode:'Smart'});assert.equal(calls.at(-1).options.body.Unrelated,true);assert.equal(calls.at(-1).options.body.SubtitleMode,'Smart');
  await assert.rejects(run('/api/browse?limit=10000'),/Invalid page/);await assert.rejects(run('/api/user-item/movie','PUT',{played:true,favorite:true}),/one user-item action/);await assert.rejects(run('/api/account/configuration','PUT',{IsAdministrator:true}),/Invalid playback language/);
  assert.equal(libraryItem(item).MediaSources,undefined);
});
