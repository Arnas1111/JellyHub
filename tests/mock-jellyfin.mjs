import http from 'node:http';
import { once } from 'node:events';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixture=name=>readFile(new URL('./fixtures/'+name,import.meta.url));
export async function startPlaybackFixture(options={}){
  const dir=await mkdtemp(path.join(os.tmpdir(),'jellyhub-playback-'));
  if(options.seerr)await writeFile(path.join(dir,'settings.json'),JSON.stringify({seerrKey:'fixture-key'}));
  const bytes=await fixture('direct.mp4'),calls=[],reports=[],playbackInfo=[];
  let allowPlayback=true,adminEnabled=true,startedCount=0;const userData=new Map(),avatars=new Map(),registrationKeys=[],registeredUsers=new Map(),policies=new Map(),accountNames=new Map();
  const movie=id=>({Id:id,Name:id==='movie-hls'?'HLS Test Movie':id==='episode2'?'The next episode':id==='episode1'?'The pilot':'Direct Test Movie',Type:id.startsWith('series')?'Series':id.startsWith('episode')?'Episode':'Movie',SeriesId:id.startsWith('episode')?'series':undefined,SeriesName:id.startsWith('episode')?'Synthetic Series':undefined,SeasonId:id.startsWith('episode')?'season1':undefined,ParentIndexNumber:1,IndexNumber:id==='episode2'?2:1,RunTimeTicks:120000000,UserData:{PlaybackPositionTicks:20000000,Played:false},ImageTags:{},ProviderIds:id==='movie-direct'?{Tmdb:'100'}:id==='movie-hls'?{Tmdb:'200'}:{},Genres:['Test'],OfficialRating:'G',People:[],Studios:[],Chapters:[{Name:'Opening',StartPositionTicks:0},{Name:'Middle',StartPositionTicks:60000000}]});
  const streams=[{Type:'Video',Index:0,Codec:'h264',BitDepth:8,VideoRange:'SDR',Width:160,Height:90},{Type:'Audio',Index:1,Codec:'aac',Language:'eng',DisplayTitle:'English test tone',IsDefault:true},{Type:'Audio',Index:2,Codec:'aac',Language:'deu',DisplayTitle:'German test tone'},{Type:'Subtitle',Index:3,Codec:'srt',Language:'eng',DisplayTitle:'English subtitles',IsExternal:true}];
  const upstream=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://fixture'),auth=req.headers.authorization||'';let raw='';for await(const part of req)raw+=part;
    const body=raw?(url.pathname.includes('/Images/Primary')?raw:JSON.parse(raw)):undefined;calls.push({path:url.pathname,query:Object.fromEntries(url.searchParams),method:req.method,body,range:req.headers.range,auth});
    const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data))};
    if(options.registration){
      const service=auth.includes('registration-service-secret'),administrator=auth.includes('secret-token-admin');
      if(service&&url.pathname==='/Sessions')return json(options.streams||[]);
      if(service&&/^\/Users\/[^/]+\/Images\/Primary$/.test(url.pathname)){res.writeHead(200,{'Content-Type':'image/png'});return res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l2kAAAAASUVORK5CYII=','base64'))}
      if(service&&url.pathname==='/Users')return json([{Id:'viewer',Name:'viewer'},{Id:'admin',Name:'admin'},...[...registeredUsers.values()].map(user=>({Id:user.Id,Name:user.Name,Policy:user.Policy})),...(options.presenceDirectory||[])]);
      if(url.pathname==='/Auth/Keys'){
        if(!administrator)return json({},403);
        if(req.method==='POST'){const key={AccessToken:'registration-service-secret',AppName:url.searchParams.get('app')};registrationKeys.push(key);if(options.registrationKey204){res.writeHead(204);return res.end()}return json(key)}
        return json({Items:registrationKeys});
      }
      if(url.pathname==='/Users/New'){
        if(!service)return json({},403);if(['viewer','admin'].includes(body.Name)||[...registeredUsers.values()].some(user=>user.Name.toLowerCase()===body.Name.toLowerCase()))return json({},409);
        const user={Id:'new-user-'+(registeredUsers.size+1),Name:body.Name,Password:body.Password,Policy:{IsAdministrator:false,EnableAllFolders:true}};registeredUsers.set(user.Id,user);return json(user);
      }
      const changed=url.pathname.match(/^\/Users\/(new-user-\d+)(?:\/(Policy|Password))?$/);
      if(changed){const user=registeredUsers.get(changed[1]);if(!service||!user)return json({},403);if(req.method==='DELETE'){registeredUsers.delete(user.Id);return json({})}if(changed[2]==='Policy')user.Policy=body;if(changed[2]==='Password')user.Password=body.NewPw;return json({})}
      if(url.pathname==='/Users/AuthenticateByName'){
        const user=[...registeredUsers.values()].find(user=>user.Name===body.Username);if(user){if(user.Password!==body.Pw||user.Policy.IsDisabled)return json({},401);return json({AccessToken:'secret-token-'+user.Id,User:{Id:user.Id,Name:user.Name,Policy:user.Policy}})}
      }
      if(service&&url.pathname==='/Items')return json({Items:[{Id:'movie-direct',BackdropImageTags:['backdrop']},{Id:'movie-hls',BackdropImageTags:['backdrop']}]});
      if(service&&/\/Images\/Backdrop$/.test(url.pathname)){res.writeHead(200,{'Content-Type':'image/png'});return res.end(options.registrationArtwork||Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l2kAAAAASUVORK5CYII=','base64'))}
      if(url.pathname==='/Users/Me'){
        const name=auth.match(/Token="secret-token-([^\"]+)"/)?.[1],user=[...registeredUsers.values()].find(user=>user.Name===name||user.Id===name);if(user)return json({Id:user.Id,Name:user.Name,Policy:user.Policy});
      }
    }
    if(url.pathname==='/Users/AuthenticateByName')return json({AccessToken:'secret-token-'+body.Username,User:{Id:body.Username,Name:body.Username,Policy:{IsAdministrator:body.Username==='admin'}}});
    if(url.pathname==='/api/collections/overlay-data')return json(options.management?[{id:1,title:'Basic Movies',mediaServerId:'managed-movies',arrAction:0,isActive:true,deleteAfterDays:7,media:[]},{id:2,title:'Basic Shows',mediaServerId:'managed-shows',arrAction:0,isActive:true,deleteAfterDays:7,media:[]}]:[]);
    if(url.pathname.startsWith('/api/v1/')){
      if(req.headers['x-api-key']!=='fixture-key')return json({},401);
      if(url.pathname==='/api/v1/search'){if(options.searchError||options.strictSearchEncoding&&req.url.includes('+'))return json({errors:[{path:'.query.query',message:'must match URL encoding format',value:'private query value'}]},400);return json({results:options.searchResults||[],totalPages:1})}
      if(url.pathname==='/api/v1/user/jellyfin/viewer')return json({id:7,jellyfinUserId:'viewer',permissions:options.seerrPermissions??32});
      if(url.pathname==='/api/v1/user/jellyfin/admin')return json({id:1,jellyfinUserId:'admin',permissions:2});
      if(url.pathname==='/api/v1/auth/me')return json({id:Number(req.headers['x-api-user']),jellyfinUserId:Number(req.headers['x-api-user'])===7?'viewer':'admin',permissions:Number(req.headers['x-api-user'])===7?(options.seerrPermissions??32):2});
      if(url.pathname==='/api/v1/request'){let rows=options.requests||[];if(url.searchParams.has('requestedBy'))rows=rows.filter(row=>row.requestedBy.id===Number(url.searchParams.get('requestedBy')));const filter=url.searchParams.get('filter');if(filter==='deleted')rows=rows.filter(row=>row.media.status===6);if(filter==='pending')rows=rows.filter(row=>row.status===1);if(filter==='processing')rows=rows.filter(row=>row.status===2&&row.media.status!==5&&row.media.status!==6);if(filter==='unavailable')rows=rows.filter(row=>[1,2].includes(row.status)&&![5,6].includes(row.media.status));if(filter==='failed')rows=rows.filter(row=>row.status===4);if(filter==='available')rows=rows.filter(row=>row.media.status===5);const start=Number(url.searchParams.get('skip')||0);return json({results:rows.slice(start,start+Number(url.searchParams.get('take')||20)),pageInfo:{results:rows.length}})}
      const detail=url.pathname.match(/^\/api\/v1\/(movie|tv)\/(\d+)$/);if(detail)return json({id:Number(detail[2]),title:options.titles?.[detail[2]]||'Requested title '+detail[2],name:options.titles?.[detail[2]]||'Requested title '+detail[2],releaseDate:options.releaseDates?.[detail[2]]||'2026-01-01'});
      if(url.pathname.includes('/discover/'))return json({results:[]});return json({},404);
    }
    if(!auth.includes('secret-token-'))return json({error:'Token missing'},401);
    const avatarRoute=url.pathname.match(/^\/Users\/([^/]+)\/Images\/Primary$/);if(avatarRoute){if(req.method!=='GET'&&!auth.includes('secret-token-'+avatarRoute[1]+'"'))return json({error:'Not your picture'},403);if(req.method==='POST'){avatars.set(avatarRoute[1],Buffer.from(raw,'base64'));res.writeHead(204);return res.end()}if(req.method==='DELETE'){avatars.delete(avatarRoute[1]);res.writeHead(204);return res.end()}const image=avatars.get(avatarRoute[1]);if(!image)return json({},404);res.writeHead(200,{'Content-Type':'image/png'});return res.end(image)}
    if(url.pathname==='/Sessions'&&req.method==='GET')return json(options.streams||[]);
    const renameRoute=url.pathname.match(/^\/Users\/(viewer|admin)$/);if(renameRoute&&req.method==='POST'){if(!auth.includes('secret-token-admin'))return json({},403);accountNames.set(renameRoute[1],body.Name);return json({})}
    const policyRoute=url.pathname.match(/^\/Users\/(viewer|admin)\/Policy$/);if(policyRoute&&req.method==='POST'){if(!auth.includes('secret-token-admin'))return json({},403);policies.set(policyRoute[1],body);return json({})}
    if(url.pathname==='/Users')return json([{Id:'viewer',Name:accountNames.get('viewer')||'Viewer',Policy:policies.get('viewer')||{IsAdministrator:false,EnableAllFolders:true}},{Id:'admin',Name:accountNames.get('admin')||'admin',Policy:policies.get('admin')||{IsAdministrator:adminEnabled,EnableAllFolders:true}}]);
    if(url.pathname==='/Users/viewer'||url.pathname==='/Users/admin')return json({Id:url.pathname.split('/').at(-1),Name:accountNames.get(url.pathname.split('/').at(-1))||(url.pathname.endsWith('admin')?'admin':'Viewer'),Policy:policies.get(url.pathname.split('/').at(-1))||{IsAdministrator:adminEnabled&&url.pathname.endsWith('admin'),EnableAllFolders:true}});
    if(url.pathname==='/Library/VirtualFolders')return json([{ItemId:'movies-view',Name:'Main movies'},{ItemId:'shows-view',Name:'Main shows'}]);
    if(url.pathname==='/Users/Me')return json({Id:auth.includes('secret-token-admin')?'admin':'viewer',Name:options.presence&&auth.includes('secret-token-admin')?'Administrator':'Viewer',Configuration:{AudioLanguagePreference:'eng'},Policy:policies.get(auth.includes('secret-token-admin')?'admin':'viewer')||{IsAdministrator:adminEnabled&&auth.includes('secret-token-admin'),EnableMediaPlayback:allowPlayback}});
    if(url.pathname.endsWith('/Views'))return json({Items:[{Id:'movies-view',Name:'Main movies',CollectionType:'movies'},{Id:'shows-view',Name:'Main shows',CollectionType:'tvshows'},{Id:'music-view',Name:'Music',CollectionType:'music'}]});
    if(url.pathname==='/Items/Filters2')return json({Genres:[{Name:'Test'}],Years:[2026]});
    if(/^\/Users\/[^/]+\/(FavoriteItems|PlayedItems)\//.test(url.pathname)){const id=url.pathname.split('/').at(-1),value={...userData.get(id),[url.pathname.includes('FavoriteItems')?'IsFavorite':'Played']:req.method==='POST'};userData.set(id,value);return json(value)}
    if(url.pathname.endsWith('/Configuration')&&req.method==='POST'||url.pathname==='/Users/Password'){res.writeHead(204);return res.end()}
    if(url.pathname==='/Users/viewer/Items/forbidden')return json({error:'Forbidden'},403);
    const item=url.pathname.match(/^\/Users\/[^/]+\/Items\/([^/]+)$/);if(item)return json({...movie(item[1]),MediaSources:[{Id:'source1',MediaStreams:streams}],MediaStreams:streams,UserData:{...movie(item[1]).UserData,...userData.get(item[1])},Path:'/private/never-return.mp4'});
    if(url.pathname.endsWith('/Items/Resume'))return json({Items:[movie('movie-direct')]});
    if(url.pathname.endsWith('/Items')){
      if(url.searchParams.get('IncludeItemTypes')==='BoxSet'){const items=[{Id:'collection',Name:'Test Collection',Type:'BoxSet'},...(options.management?[{Id:'managed-movies',Name:'Basic Movies',Type:'BoxSet'},{Id:'managed-shows',Name:'Basic Shows',Type:'BoxSet'}]:[])].filter(item=>!url.searchParams.get('ExcludeItemIds')?.split(',').includes(item.Id));return json({Items:items,TotalRecordCount:items.length})}
      let items=[movie('movie-direct'),movie('movie-hls')].map(item=>({...item,UserData:{...item.UserData,...userData.get(item.Id)}}));
      if(url.searchParams.get('Ids'))items=items.filter(item=>url.searchParams.get('Ids').split(',').includes(item.Id));
      if(url.searchParams.get('ExcludeItemIds'))items=items.filter(item=>!url.searchParams.get('ExcludeItemIds').split(',').includes(item.Id));
      if(url.searchParams.get('Filters')==='IsFavorite')items=items.filter(item=>item.UserData.IsFavorite);
      return json({Items:items,TotalRecordCount:items.length});
    }
    if(url.pathname==='/Shows/NextUp')return json({Items:[movie('episode1')]});
    if(url.pathname==='/Shows/serieslong/Episodes'){const start=Number(url.searchParams.get('StartIndex')||0),limit=Number(url.searchParams.get('Limit')||100);return json({Items:Array.from({length:105},(_,index)=>({...movie('episode'+(index+1)),IndexNumber:index+1,Name:'Long episode '+(index+1),SeriesId:'serieslong'})).slice(start,start+limit),TotalRecordCount:105})}
    if(url.pathname==='/Shows/serieslong/Seasons')return json({Items:[{Id:'seasonlong',Name:'Season 1'}]});
    if(url.pathname==='/Shows/series/Episodes')return json({Items:[movie('episode1'),movie('episode2')],TotalRecordCount:2});
    if(url.pathname==='/Shows/series/Seasons')return json({Items:[{Id:'season1',Name:'Season 1'}]});
    if(url.pathname.endsWith('/Similar'))return json({Items:[]});
    const info=url.pathname.match(/^\/Items\/([^/]+)\/PlaybackInfo$/);
    if(info){
      playbackInfo.push(body);const transcode=info[1]==='movie-hls'||/^[a-f0-9]{32}$/.test(info[1])||body.EnableDirectPlay===false;
      const streamId=/^[a-f0-9]{32}$/.test(info[1])?info[1].replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5'):info[1]==='movie-bad-path'?'another-item':info[1];
      return json({PlaySessionId:'play-session-'+(++startedCount),MediaSources:[{Id:'source1',Name:'Synthetic version',Container:transcode?'mkv':'mp4',SupportsDirectPlay:!transcode,SupportsDirectStream:false,SupportsTranscoding:true,DefaultAudioStreamIndex:1,MediaStreams:streams,Path:'/private/source.mkv',Size:bytes.length,TranscodingUrl:`/videos/${streamId}/master.m3u8?api_key=must-never-reach-browser&PlaySessionId=test`}]});
    }
    if(url.pathname.startsWith('/MediaSegments/'))return json({Items:[{Id:'intro',Type:'Intro',StartTicks:10000000,EndTicks:30000000}]});
    if(url.pathname.startsWith('/Sessions/Playing')){reports.push({path:url.pathname,body});res.writeHead(204);return res.end()}
    if(url.pathname==='/Videos/ActiveEncodings'){res.writeHead(204);return res.end()}
    if(/\/Subtitles\/3\/(0\/)?Stream\.vtt$/.test(url.pathname)){res.writeHead(200,{'Content-Type':'text/vtt'});return res.end(await fixture('subtitles.vtt'))}
    if(url.pathname.endsWith('/master.m3u8')){res.writeHead(200,{'Content-Type':'application/vnd.apple.mpegurl'});return res.end('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=240000,CODECS="avc1.64000a,mp4a.40.2",RESOLUTION=160x90\nmain.m3u8?api_key=must-never-reach-browser\n')}
    if(url.pathname.endsWith('/main.m3u8')){res.writeHead(200,{'Content-Type':'application/vnd.apple.mpegurl'});return res.end(await fixture('hls/index.m3u8'))}
    const segment=url.pathname.match(/\/(segment\d{3}\.ts)$/);if(segment){res.writeHead(200,{'Content-Type':'video/mp2t'});return res.end(await fixture('hls/'+segment[1]))}
    if(url.pathname.endsWith('/stream')){
      let start=0,end=bytes.length-1;
      if(req.headers.range){const match=req.headers.range.match(/^bytes=(\d*)-(\d*)$/);if(match?.[1])start=Number(match[1]);else if(match?.[2])start=bytes.length-Number(match[2]);if(match?.[1]&&match[2])end=Math.min(end,Number(match[2]));}
      if(start<0||start>=bytes.length||end<start){res.writeHead(416,{'Content-Range':'bytes */'+bytes.length});return res.end()}
      res.writeHead(req.headers.range?206:200,{'Content-Type':'video/mp4','Content-Length':end-start+1,'Accept-Ranges':'bytes',...(req.headers.range?{'Content-Range':`bytes ${start}-${end}/${bytes.length}`}:{})});return res.end(req.method==='HEAD'?undefined:bytes.subarray(start,end+1));
    }
    return json({error:'Unsupported fixture route'},404);
  });
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');const service=`http://127.0.0.1:${upstream.address().port}`;
  const child=spawn(process.execPath,[fileURLToPath(new URL('../server.js',import.meta.url))],{env:{...process.env,PORT:'0',CONFIG_DIR:dir,JELLYFIN_URL:service,SEERR_URL:service,MAINTAINERR_URL:service}});
  let logs='';child.stderr.on('data',data=>logs+=data);
  const base=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('App startup timeout '+logs)),10000);child.on('exit',code=>{clearTimeout(timeout);reject(Error('Exited '+code+' '+logs))});child.stdout.on('data',data=>{logs+=data;const match=String(data).match(/running on :(\d+)/);if(match){clearTimeout(timeout);resolve(`http://127.0.0.1:${match[1]}`)}})});
  return {base,calls,reports,playbackInfo,configDir:dir,logs:()=>logs,setAllowed:value=>allowPlayback=value,setAdmin:value=>adminEnabled=value,async close(){if(child.exitCode===null){const done=once(child,'exit');child.kill();await done}upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));await rm(dir,{recursive:true,force:true})}};
}
