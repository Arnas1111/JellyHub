import test from 'node:test';
import assert from 'node:assert/strict';
import {startPlaybackFixture} from './mock-jellyfin.mjs';
test('real HTTP search uses Seerr frontend encoding and exposes safe validation details for rejected queries',async()=>{
  const options={seerr:true,strictSearchEncoding:true,searchResults:[{id:8067,title:'Johnny English',mediaType:'movie',releaseDate:'2003-01-01'},{id:58233,title:'Johnny English Reborn',mediaType:'movie',releaseDate:'2011-01-01'},{id:463272,title:'Johnny English Strikes Again',mediaType:'movie',releaseDate:'2018-01-01'}]},fixture=await startPlaybackFixture(options);
  try{const login=await fetch(fixture.base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'viewer',password:'fixture'})}),cookie=login.headers.get('set-cookie').split(';')[0];const search=()=>fetch(fixture.base+'/api/search?q=Johnny%20English&page=1',{headers:{Cookie:cookie}}).then(response=>response.json());const data=await search();assert.equal(data.catalog.length,3);assert.deepEqual(data.catalog.map(item=>item.year),['2003','2011','2018']);assert.deepEqual(data.errors,[]);
    options.searchError=true;const failure=await search();assert.equal(failure.catalogState,'unavailable');assert.match(failure.errors[0].message,/query: invalid format/);const log=fixture.logs().split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line)).filter(line=>line.event==='upstream.failed').at(-1);assert.equal(log.httpStatus,400);assert.match(log.hint,/API parameters/);assert.deepEqual(log.validation,[{field:'query',issue:'invalid format'}]);assert.doesNotMatch(JSON.stringify(log),/private query value|fixture-key/);
  }finally{await fixture.close()}
});
