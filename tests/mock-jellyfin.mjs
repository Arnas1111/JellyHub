import http from 'node:http';
import { once } from 'node:events';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixture=name=>readFile(new URL('./fixtures/'+name,import.meta.url));
export async function startPlaybackFixture(){
  const dir=await mkdtemp(path.join(os.tmpdir(),'jellyhub-playback-'));
  const bytes=await fixture('direct.mp4'),calls=[],reports=[],playbackInfo=[];
  let allowPlayback=true,startedCount=0;const userData=new Map();
  const movie=id=>({Id:id,Name:id==='movie-hls'?'HLS Test Movie':id==='episode2'?'The next episode':id==='episode1'?'The pilot':'Direct Test Movie',Type:id.startsWith('episode')?'Episode':'Movie',SeriesId:id.startsWith('episode')?'series':undefined,SeriesName:id.startsWith('episode')?'Synthetic Series':undefined,SeasonId:id.startsWith('episode')?'season1':undefined,ParentIndexNumber:1,IndexNumber:id==='episode2'?2:1,RunTimeTicks:120000000,UserData:{PlaybackPositionTicks:20000000,Played:false},ImageTags:{},Genres:['Test'],OfficialRating:'G',People:[],Studios:[],Chapters:[{Name:'Opening',StartPositionTicks:0},{Name:'Middle',StartPositionTicks:60000000}]});
  const streams=[{Type:'Video',Index:0,Codec:'h264',BitDepth:8,VideoRange:'SDR',Width:160,Height:90},{Type:'Audio',Index:1,Codec:'aac',Language:'eng',DisplayTitle:'English test tone',IsDefault:true},{Type:'Audio',Index:2,Codec:'aac',Language:'deu',DisplayTitle:'German test tone'},{Type:'Subtitle',Index:3,Codec:'srt',Language:'eng',DisplayTitle:'English subtitles',IsExternal:true}];
  const upstream=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://fixture'),auth=req.headers.authorization||'';let raw='';for await(const part of req)raw+=part;
    const body=raw?JSON.parse(raw):undefined;calls.push({path:url.pathname,query:Object.fromEntries(url.searchParams),method:req.method,body,range:req.headers.range,auth});
    const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data))};
    if(url.pathname==='/Users/AuthenticateByName')return json({AccessToken:'secret-token-'+body.Username,User:{Id:body.Username,Name:body.Username,Policy:{IsAdministrator:body.Username==='admin'}}});
    if(!auth.includes('secret-token-'))return json({error:'Token missing'},401);
    if(url.pathname==='/Users/Me')return json({Id:auth.includes('secret-token-admin')?'admin':'viewer',Name:'Viewer',Configuration:{AudioLanguagePreference:'eng'},Policy:{IsAdministrator:auth.includes('secret-token-admin'),EnableMediaPlayback:allowPlayback}});
    if(url.pathname==='/Items/Filters2')return json({Genres:[{Name:'Test'}],Years:[2026]});
    if(/^\/Users\/[^/]+\/(FavoriteItems|PlayedItems)\//.test(url.pathname)){const id=url.pathname.split('/').at(-1),value={...userData.get(id),[url.pathname.includes('FavoriteItems')?'IsFavorite':'Played']:req.method==='POST'};userData.set(id,value);return json(value)}
    if(url.pathname.endsWith('/Configuration')&&req.method==='POST'||url.pathname==='/Users/Password'){res.writeHead(204);return res.end()}
    if(url.pathname==='/Users/viewer/Items/forbidden')return json({error:'Forbidden'},403);
    const item=url.pathname.match(/^\/Users\/[^/]+\/Items\/([^/]+)$/);if(item)return json({...movie(item[1]),MediaSources:[{Id:'source1',MediaStreams:streams}],MediaStreams:streams,Path:'/private/never-return.mp4'});
    if(url.pathname.endsWith('/Items/Resume'))return json({Items:[movie('movie-direct')]});
    if(url.pathname.endsWith('/Items')){
      if(url.searchParams.get('IncludeItemTypes')==='BoxSet')return json({Items:[{Id:'collection',Name:'Test Collection',Type:'BoxSet'}],TotalRecordCount:1});
      let items=[movie('movie-direct'),movie('movie-hls')].map(item=>({...item,UserData:{...item.UserData,...userData.get(item.Id)}}));
      if(url.searchParams.get('Ids'))items=items.filter(item=>url.searchParams.get('Ids').split(',').includes(item.Id));
      if(url.searchParams.get('ExcludeItemIds'))items=items.filter(item=>!url.searchParams.get('ExcludeItemIds').split(',').includes(item.Id));
      if(url.searchParams.get('Filters')==='IsFavorite')items=items.filter(item=>item.UserData.IsFavorite);
      return json({Items:items,TotalRecordCount:items.length});
    }
    if(url.pathname==='/Shows/NextUp')return json({Items:[movie('episode1')]});
    if(url.pathname==='/Shows/series/Episodes')return json({Items:[movie('episode1'),movie('episode2')],TotalRecordCount:2});
    if(url.pathname==='/Shows/series/Seasons')return json({Items:[{Id:'season1',Name:'Season 1'}]});
    if(url.pathname.endsWith('/Similar'))return json({Items:[]});
    const info=url.pathname.match(/^\/Items\/([^/]+)\/PlaybackInfo$/);
    if(info){
      playbackInfo.push(body);const transcode=info[1]==='movie-hls'||body.EnableDirectPlay===false;
      return json({PlaySessionId:'play-session-'+(++startedCount),MediaSources:[{Id:'source1',Name:'Synthetic version',Container:transcode?'mkv':'mp4',SupportsDirectPlay:!transcode,SupportsDirectStream:false,SupportsTranscoding:true,DefaultAudioStreamIndex:1,MediaStreams:streams,Path:'/private/source.mkv',Size:bytes.length,TranscodingUrl:`/Videos/${info[1]}/master.m3u8?api_key=must-never-reach-browser&PlaySessionId=test`}]});
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
  return {base,calls,reports,playbackInfo,setAllowed:value=>allowPlayback=value,async close(){if(child.exitCode===null){const done=once(child,'exit');child.kill();await done}upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));await rm(dir,{recursive:true,force:true})}};
}
