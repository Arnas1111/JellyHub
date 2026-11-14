import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const textCodecs=new Set(['srt','subrip','vtt','webvtt','ass','ssa','mov_text','text','ttml']);
const sourceDto=source=>({id:source.Id,name:source.Name||source.Container||'Version',container:source.Container,bitrate:source.Bitrate,size:source.Size,video:source.MediaStreams?.find(stream=>stream.Type==='Video')?.Codec});
const streamDto=stream=>({index:stream.Index,type:stream.Type,language:stream.Language||'und',title:stream.DisplayTitle||stream.Title||stream.Language||stream.Codec,codec:stream.Codec,default:!!stream.IsDefault,forced:!!stream.IsForced,text:stream.Type==='Subtitle'&&textCodecs.has((stream.Codec||'').toLowerCase())});
const validIndex=value=>value===undefined||Number.isSafeInteger(value)&&value>=-1&&value<=1000;
const episodeDto=i=>({id:i.Id,name:i.Name,season:i.ParentIndexNumber,episode:i.IndexNumber,overview:i.Overview||'',played:!!i.UserData?.Played,image:!!i.ImageTags?.Primary});

export function buildPlaybackProfile({maxBitrate=120000000,hevc=false,av1=false}={}){
  return {Name:'JellyHub Web',MaxStreamingBitrate:maxBitrate,MaxStaticBitrate:maxBitrate,DirectPlayProfiles:[{Container:'mp4,m4v',Type:'Video',VideoCodec:['h264',hevc?'hevc':'',av1?'av1':''].filter(Boolean).join(','),AudioCodec:'aac,mp3,flac,alac'},{Container:'webm',Type:'Video',VideoCodec:'vp8,vp9'+(av1?',av1':''),AudioCodec:'opus,vorbis'}],TranscodingProfiles:[{Container:'ts',Type:'Video',VideoCodec:'h264',AudioCodec:'aac',Protocol:'hls',Context:'Streaming',MaxAudioChannels:'2',MinSegments:2,SegmentLength:6,BreakOnNonKeyFrames:true}],SubtitleProfiles:[{Format:'vtt',Method:'External'},{Format:'srt',Method:'External'},{Format:'ass',Method:'External'},{Format:'ssa',Method:'External'},{Format:'pgssub',Method:'Encode'},{Format:'dvdsub',Method:'Encode'}],CodecProfiles:[{Type:'Video',Codec:'h264',Conditions:[{Condition:'LessThanEqual',Property:'VideoLevel',Value:'52',IsRequired:false}]}]};
}

export function resolvePlaybackResource(value,parent,itemId,base){
  const target=new URL(value,parent),root=new URL(base.endsWith('/')?base:base+'/');
  if(target.origin!==root.origin||target.username||target.password||target.hash)fail(502,'Jellyfin returned an external playback resource.');
  const relative=target.pathname.slice(root.pathname.length);
  if(!target.pathname.startsWith(root.pathname)||!new RegExp(`^(?:Videos|Audio)/${itemId}/`,'i').test(relative)||/%2f|%5c|%2e|\\/i.test(target.pathname))fail(502,'Jellyfin returned an unexpected playback resource path.');
  if(!/\.(m3u8|ts|m4s|mp4|m4v|webm|aac|vtt|key)$/i.test(target.pathname)&&!target.pathname.endsWith('/stream'))fail(502,'Unsupported playback resource type.');
  for(const key of [...target.searchParams.keys()])if(/token|api[_-]?key|authorization/i.test(key))target.searchParams.delete(key);
  return target;
}

export function rewritePlaylist(raw,parent,register){
  if(raw.length>2097152||!raw.trimStart().startsWith('#EXTM3U'))fail(502,'Invalid Jellyfin HLS playlist.');
  return raw.split(/\r?\n/).map(line=>{
    if(!line.trim())return line;
    if(!line.startsWith('#'))return register(new URL(line.trim(),parent));
    return line.replace(/\bURI="([^"]+)"/g,(_,uri)=>`URI="${register(new URL(uri,parent))}"`);
  }).join('\n');
}
async function boundedText(response,limit){
  const reader=response.body?.getReader();if(!reader)return '';let length=0;const chunks=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit){await reader.cancel();fail(502,'Jellyfin returned an oversized text resource.')}chunks.push(Buffer.from(value))}return Buffer.concat(chunks).toString('utf8')}finally{reader.releaseLock()}
}

export function createPlayback({jf,jellyfin,authHeader,json,readBody,cleanId,send,logger}){
  const sessions=new Map();
  async function allowed(session,itemId){
    const [me,item]=await Promise.all([jf('Users/Me',session),jf(`Users/${session.id}/Items/${cleanId(itemId)}`,session)]);
    if(me.Policy?.EnableMediaPlayback!==true||me.Policy?.IsDisabled)fail(403,'This account cannot play media.');
    return item;
  }
  async function authorize(ticket){
    if(!ticket.checking)ticket.checking=allowed(ticket.owner,ticket.itemId).finally(()=>ticket.checking=null);
    await ticket.checking;
  }
  function getTicket(id,owner){
    const ticket=sessions.get(id);
    if(!ticket||ticket.owner!==owner||ticket.lastActivity+180000<Date.now())fail(403,'Playback session expired. Resume the title to reconnect.');
    ticket.lastActivity=Date.now();return ticket;
  }
  function register(ticket,value,parent){
    const target=resolvePlaybackResource(value,parent,ticket.itemId,jellyfin());
    const key=crypto.createHash('sha256').update(target.href).digest('hex').slice(0,24);
    if(ticket.resources.size>10000&&!ticket.resources.has(key))fail(502,'Playback playlist contains too many resources.');
    ticket.resources.set(key,target);
    return `/api/playback/${ticket.id}/resource/${key}`;
  }
  async function stop(ticket,positionTicks=ticket.positionTicks){
    if(ticket.stopping)return ticket.stopping;
    ticket.stopping=(async()=>{
      try{if(ticket.started)await jf('Sessions/Playing/Stopped',ticket.owner,{method:'POST',body:{ItemId:ticket.itemId,MediaSourceId:ticket.source.Id,PlaySessionId:ticket.playSessionId,PositionTicks:positionTicks,Failed:ticket.failed||false}})}
      finally{
        if(ticket.method!=='DirectPlay')await jf('Videos/ActiveEncodings?'+new URLSearchParams({deviceId:ticket.owner.deviceId,playSessionId:ticket.playSessionId}),ticket.owner,{method:'DELETE'}).catch(()=>{});
        sessions.delete(ticket.id);
      }
    })();return ticket.stopping;
  }
  const reap=setInterval(()=>{for(const ticket of sessions.values())if(ticket.lastActivity+180000<Date.now())stop(ticket).catch(()=>logger.log('warn','playback.cleanup_failed',{itemId:ticket.itemId}))},60000);reap.unref();
  async function proxy(req,res,ticket,target){
    await authorize(ticket);
    const range=req.headers.range;if(range&&!/^bytes=(\d+-\d*|-\d+)$/.test(range))fail(416,'Invalid byte range');
    const controller=new AbortController(),abort=()=>controller.abort();res.once('close',abort);const timeout=setTimeout(abort,12000);
    try{
      const response=await fetch(target,{method:req.method,headers:{Authorization:authHeader(ticket.owner,ticket.owner.deviceId),'Accept-Encoding':'identity',...(range?{Range:range}:{})},signal:controller.signal,redirect:'error'});clearTimeout(timeout);
      if(![200,206,416].includes(response.status)){await response.body?.cancel();fail(response.status>=400?response.status:502,'Jellyfin could not deliver this part of the stream.')}
      if(/\.m3u8$/i.test(target.pathname)){
        const raw=await boundedText(response,2097152),body=rewritePlaylist(raw,target,url=>register(ticket,url,target));
        send(res,200,body,{'Content-Type':'application/vnd.apple.mpegurl','Cache-Control':'private, no-store','Vary':'Cookie'});return;
      }
      const extension=target.pathname.split('.').at(-1).toLowerCase();
      const contentType={ts:'video/mp2t',m4s:'video/iso.segment',mp4:'video/mp4',m4v:'video/mp4',webm:'video/webm',aac:'audio/aac',vtt:'text/vtt',key:'application/octet-stream'}[extension]||(ticket.source.Container==='webm'?'video/webm':'video/mp4');
      const headers={'Cache-Control':'private, no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff','Content-Type':contentType};
      for(const key of ['content-length','content-range','accept-ranges'])if(response.headers.has(key))headers[key]=response.headers.get(key);
      res.writeHead(response.status,headers);
      if(req.method==='HEAD'||!response.body){res.end();await response.body?.cancel()}else await pipeline(Readable.fromWeb(response.body),res);
    }catch(error){if(!controller.signal.aborted)throw error;if(!res.destroyed&&!res.writableEnded){if(!res.headersSent)fail(504,'Jellyfin playback timed out.');res.destroy()}}
    finally{clearTimeout(timeout);res.off('close',abort)}
  }
  return async(req,res,url,owner)=>{
    const path=url.pathname,method=req.method;
    if(path==='/api/playback/start'&&method==='POST'){
      const input=await readBody(req),requestedId=cleanId(input.itemId);
      if(!validIndex(input.audioIndex)||!validIndex(input.subtitleIndex))fail(400,'Invalid audio/subtitle track.');
      const startTicks=input.startTicks??null;if(startTicks!==null&&(!Number.isSafeInteger(startTicks)||startTicks<0))fail(400,'Invalid playback position.');
      const maxBitrate=input.maxBitrate??120000000;if(!Number.isSafeInteger(maxBitrate)||maxBitrate<500000||maxBitrate>150000000)fail(400,'Invalid playback quality.');
      let item=await allowed(owner,requestedId);
      if(item.Type==='Series'){
        const q=new URLSearchParams({UserId:owner.id,SeriesId:requestedId,Limit:'1',Fields:'Overview'});
        let next=(await jf(`Shows/NextUp?${q}`,owner)).Items?.[0];
        if(!next){q.delete('SeriesId');q.set('IsMissing','false');next=(await jf(`Shows/${requestedId}/Episodes?${q}`,owner)).Items?.[0]}
        if(!next)fail(404,'No available episode found.');item=await allowed(owner,cleanId(next.Id));
      }
      if(!['Movie','Episode','Video'].includes(item.Type))fail(400,'This item is not a playable video.');
      const position=Math.min(startTicks??item.UserData?.PlaybackPositionTicks??0,item.RunTimeTicks||Number.MAX_SAFE_INTEGER);
      // Jellyfin's VOD playlists describe the whole title. Seek on that absolute
      // timeline; dynamic HLS segment requests reject non-zero StartTimeTicks.
      const body={UserId:owner.id,DeviceProfile:buildPlaybackProfile({maxBitrate,hevc:input.hevc===true,av1:input.av1===true}),MaxStreamingBitrate:maxBitrate,StartTimeTicks:0,AutoOpenLiveStream:false,EnableDirectPlay:!input.forceTranscode&&!input.burnSubtitles&&input.audioIndex===undefined,EnableDirectStream:true,EnableTranscoding:true,AlwaysBurnInSubtitleWhenTranscoding:input.burnSubtitles===true};
      if(input.subtitleIndex!==undefined)body.SubtitleStreamIndex=input.subtitleIndex;
      if(input.audioIndex!==undefined)body.AudioStreamIndex=input.audioIndex;
      if(input.sourceId!==undefined){if(typeof input.sourceId!=='string'||input.sourceId.length>100)fail(400,'Invalid media version');body.MediaSourceId=input.sourceId}
      const info=await jf(`Items/${item.Id}/PlaybackInfo`,owner,{method:'POST',body});
      if(info.ErrorCode||!info.MediaSources?.length)fail(422,'Jellyfin found no playable source for this account and browser. Check playback/transcoding permissions.');
      const source=input.sourceId?info.MediaSources.find(s=>s.Id===input.sourceId):info.MediaSources[0];
      if(!source||source.RequiresOpening||source.LiveStreamId)fail(422,'This source requires a live-stream session, which is not yet supported.');
      const selectedAudio=source.MediaStreams?.find(s=>s.Type==='Audio'&&s.Index===input.audioIndex);
      if(input.audioIndex!==undefined&&input.audioIndex>=0&&!selectedAudio)fail(400,'Audio track no longer exists.');
      const subtitleIndex=input.subtitleIndex??source.DefaultSubtitleStreamIndex??-1;
      const selectedSubtitle=source.MediaStreams?.find(s=>s.Type==='Subtitle'&&s.Index===subtitleIndex);
      if(input.subtitleIndex!==undefined&&input.subtitleIndex>=0&&!selectedSubtitle)fail(400,'Subtitle track no longer exists.');
      const native=['mp4','m4v','webm'].includes((source.Container||'').toLowerCase());
      const useDirect=source.SupportsDirectPlay&&native&&body.EnableDirectPlay&&(!selectedSubtitle||textCodecs.has((selectedSubtitle.Codec||'').toLowerCase()));
      let target,playMethod;
      if(useDirect){target=new URL(`Videos/${item.Id}/stream`,jellyfin()+'/');target.searchParams.set('Static','true');target.searchParams.set('MediaSourceId',source.Id);playMethod='DirectPlay'}
      else{
        if(!source.TranscodingUrl)fail(422,'This file requires remuxing/transcoding but Jellyfin did not offer an HLS stream.');
        target=resolvePlaybackResource(source.TranscodingUrl,jellyfin()+'/',item.Id,jellyfin());
        if(!/\.m3u8$/i.test(target.pathname))fail(422,'Jellyfin did not offer an HLS playback stream.');
        target.searchParams.set('StartTimeTicks','0');target.searchParams.set('CopyTimestamps','false');playMethod=source.SupportsDirectStream?'DirectStream':'Transcode';
      }
      if(!info.PlaySessionId)fail(502,'Jellyfin did not return a playback session ID.');
      if(sessions.size>=500)fail(503,'Too many active playback sessions. Try again shortly.');
      const id=crypto.randomBytes(24).toString('hex');const ticket={id,owner,itemId:item.Id,source,playSessionId:info.PlaySessionId,positionTicks:position,lastActivity:Date.now(),resources:new Map(),method:playMethod,started:false,runtime:item.RunTimeTicks||0,subtitle:selectedSubtitle,audioIndex:input.audioIndex??source.DefaultAudioStreamIndex};sessions.set(id,ticket);
      const resource=register(ticket,target,target);
      const tracks=(source.MediaStreams||[]).filter(s=>['Audio','Subtitle'].includes(s.Type)).map(streamDto);
      const segments=await jf(`MediaSegments/${item.Id}`,owner).then(result=>(result.Items||[]).filter(s=>Number.isFinite(s.StartTicks)&&Number.isFinite(s.EndTicks)&&s.EndTicks>s.StartTicks).map(s=>({id:s.Id,type:s.Type,startTicks:s.StartTicks,endTicks:s.EndTicks}))).catch(()=>[]);
      let episodes=[],seasons=[],nextEpisode=null;
      if(item.SeriesId){
        ticket.seriesId=cleanId(item.SeriesId);ticket.seasonId=item.SeasonId;
        const q=new URLSearchParams({UserId:owner.id,IsMissing:'false',Limit:'100',Fields:'Overview'});if(item.SeasonId)q.set('SeasonId',cleanId(item.SeasonId));
        const adjacent=new URLSearchParams({UserId:owner.id,IsMissing:'false',AdjacentTo:item.Id,Fields:'Overview'});
        const [list,seasonList,neighbors]=await Promise.all([jf(`Shows/${ticket.seriesId}/Episodes?${q}`,owner),jf(`Shows/${ticket.seriesId}/Seasons?UserId=${encodeURIComponent(owner.id)}&IsMissing=false`,owner),jf(`Shows/${ticket.seriesId}/Episodes?${adjacent}`,owner)].map(work=>work.catch(()=>({Items:[]}))));
        episodes=(list.Items||[]).filter(i=>!i.IsMissing&&!i.IsVirtualItem).map(episodeDto);seasons=(seasonList.Items||[]).map(i=>({id:i.Id,name:i.Name}));ticket.seasons=new Set(seasons.map(s=>s.id));
        const index=(neighbors.Items||[]).findIndex(i=>i.Id===item.Id);if(index>=0&&neighbors.Items[index+1])nextEpisode=episodeDto(neighbors.Items[index+1]);
      }
      logger.log('info','playback.negotiated',{itemId:item.Id,method:playMethod});
      json(res,200,{id,item:{id:item.Id,name:item.Name,series:item.SeriesName||'',type:item.Type,year:item.ProductionYear,rating:item.OfficialRating,genres:item.Genres||[]},url:resource,method:playMethod,hls:!useDirect,offsetSeconds:0,startSeconds:position/10000000,runtimeSeconds:(item.RunTimeTicks||source.RunTimeTicks||0)/10000000,sourceId:source.Id,sources:info.MediaSources.map(sourceDto),audioIndex:input.audioIndex??source.DefaultAudioStreamIndex??null,subtitleIndex,tracks,subtitle:selectedSubtitle&&textCodecs.has((selectedSubtitle.Codec||'').toLowerCase())?`/api/playback/${id}/subtitle/${selectedSubtitle.Index}`:null,chapters:(item.Chapters||[]).map((chapter,index)=>({index,name:chapter.Name||`Chapter ${index+1}`,startTicks:chapter.StartPositionTicks,image:!!chapter.ImageTag})),segments,episodes,seasons,seasonId:item.SeasonId||null,nextEpisode});return true;
    }
    const episodeRoute=path.match(/^\/api\/playback\/([a-f0-9]{48})\/episodes$/);
    if(episodeRoute&&method==='GET'){
      const ticket=getTicket(episodeRoute[1],owner);await authorize(ticket);const seasonId=cleanId(url.searchParams.get('seasonId')),start=Number(url.searchParams.get('start')||0);
      if(!ticket.seriesId||!ticket.seasons?.has(seasonId))fail(400,'Choose a season in this series');if(!Number.isSafeInteger(start)||start<0||start>500000)fail(400,'Invalid episode page');
      const q=new URLSearchParams({UserId:owner.id,SeasonId:seasonId,StartIndex:String(start),Limit:'100',IsMissing:'false',Fields:'Overview',EnableTotalRecordCount:'true'}),data=await jf(`Shows/${ticket.seriesId}/Episodes?${q}`,owner);
      json(res,200,{episodes:(data.Items||[]).filter(i=>!i.IsMissing&&!i.IsVirtualItem).map(episodeDto),total:data.TotalRecordCount??data.Items?.length??0});return true;
    }
    const asset=path.match(/^\/api\/playback\/([a-f0-9]{48})\/resource\/([a-f0-9]{24})$/);
    if(asset&&['GET','HEAD'].includes(method)){const ticket=getTicket(asset[1],owner),target=ticket.resources.get(asset[2]);if(!target)fail(404,'Unknown playback resource');await proxy(req,res,ticket,target);return true}
    const subtitle=path.match(/^\/api\/playback\/([a-f0-9]{48})\/subtitle\/(\d+)$/);
    if(subtitle&&method==='GET'){
      const ticket=getTicket(subtitle[1],owner);await authorize(ticket);const stream=ticket.source.MediaStreams?.find(s=>s.Type==='Subtitle'&&s.Index===Number(subtitle[2]));if(!stream||!textCodecs.has((stream.Codec||'').toLowerCase()))fail(404,'Text subtitle unavailable');
      const start=0;
      const target=new URL(`Videos/${ticket.itemId}/${encodeURIComponent(ticket.source.Id)}/Subtitles/${stream.Index}/${start}/Stream.vtt`,jellyfin()+'/');
      const response=await fetch(target,{headers:{Authorization:authHeader(owner,owner.deviceId)},signal:AbortSignal.timeout(12000),redirect:'error'});if(!response.ok)fail(response.status,'Subtitle conversion failed.');
      send(res,200,await boundedText(response,8388608),{'Content-Type':'text/vtt; charset=utf-8','Cache-Control':'private, no-store'});return true;
    }
    const report=path.match(/^\/api\/playback\/([a-f0-9]{48})\/report$/);
    if(report&&method==='POST'){
      const ticket=getTicket(report[1],owner),input=await readBody(req);if(!['start','progress','stop'].includes(input.event))fail(400,'Invalid playback report');
      if(!Number.isSafeInteger(input.positionTicks)||input.positionTicks<0||ticket.runtime&&input.positionTicks>ticket.runtime+10000000)fail(400,'Invalid playback report position');ticket.positionTicks=input.positionTicks;
      if(input.event==='stop'){ticket.failed=input.failed===true;await stop(ticket);json(res,200,{ok:true});return true}
      await authorize(ticket);
      const body={ItemId:ticket.itemId,MediaSourceId:ticket.source.Id,PlaySessionId:ticket.playSessionId,PositionTicks:ticket.positionTicks,PlayMethod:ticket.method,CanSeek:true,IsPaused:input.paused===true,IsMuted:input.muted===true,VolumeLevel:Math.max(0,Math.min(100,Number(input.volume)||0)),PlaybackRate:Math.max(.25,Math.min(3,Number(input.rate)||1)),AudioStreamIndex:ticket.audioIndex,SubtitleStreamIndex:ticket.subtitle?.Index??-1};
      const event=input.event==='start'&&!ticket.started?'Sessions/Playing':'Sessions/Playing/Progress';await jf(event,owner,{method:'POST',body});ticket.started=true;json(res,200,{ok:true});return true;
    }
    return false;
  };
}
