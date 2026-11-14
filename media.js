import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const profile={Name:'JellyHub previews',MaxStreamingBitrate:20000000,MaxStaticBitrate:20000000,DirectPlayProfiles:[{Container:'mp4,m4v',Type:'Video',VideoCodec:'h264',AudioCodec:'aac,mp3'},{Container:'webm',Type:'Video',VideoCodec:'vp8,vp9',AudioCodec:'opus,vorbis'}],TranscodingProfiles:[]};
const cleanItem=item=>Object.fromEntries(['Id','Name','Type','Overview','ProductionYear','OfficialRating','CommunityRating','RunTimeTicks','Genres','Taglines','ImageTags','BackdropImageTags','SeriesId','SeriesName','SeasonId','ParentIndexNumber','IndexNumber','UserData','PremiereDate','EndDate'].filter(k=>item[k]!==undefined).map(k=>[k,item[k]]));
function technical(item){
  const streams=item.MediaStreams||item.MediaSources?.[0]?.MediaStreams||[];
  const video=streams.find(s=>s.Type==='Video');
  return {video:video?{codec:video.Codec,width:video.Width,height:video.Height,range:video.VideoRange}:null,audio:[...new Set(streams.filter(s=>s.Type==='Audio').map(s=>s.Language||s.DisplayTitle||s.Codec))],subtitles:[...new Set(streams.filter(s=>s.Type==='Subtitle').map(s=>s.Language||s.DisplayTitle||'Unknown'))]};
}
export function createMedia({jf,jellyfin,authHeader,json,cleanId,send}){
  const tickets=new Map();
  async function playableItem(id,session){
    let item=await jf(`Users/${session.id}/Items/${id}`,session);
    if(item.Type==='Series'){
      const q=new URLSearchParams({UserId:session.id,Limit:'1',IsMissing:'false',Fields:'Overview'});
      const episodes=await jf(`Shows/${id}/Episodes?${q}`,session);
      const episode=episodes.Items?.[0];if(!episode)return null;
      item=await jf(`Users/${session.id}/Items/${cleanId(episode.Id)}`,session);
    }
    return item;
  }
  return async(req,res,url,session)=>{
    const route=url.pathname,method=req.method;
    if(route==='/api/continue'&&method==='GET'){
      const type=url.searchParams.get('type');if(!['Movie','Series'].includes(type))fail(400,'Invalid library type');
      const q=new URLSearchParams({Limit:'24',MediaTypes:'Video',IncludeItemTypes:type==='Movie'?'Movie':'Episode',Fields:'Overview,PrimaryImageAspectRatio',EnableUserData:'true'});
      const data=await jf(`Users/${session.id}/Items/Resume?${q}`,session);
      json(res,200,{Items:(data.Items||[]).filter(i=>i.Type===(type==='Movie'?'Movie':'Episode')).map(cleanItem)});return true;
    }
    const detail=route.match(/^\/api\/details\/([^/]+)$/);
    if(detail&&method==='GET'){
      const id=cleanId(detail[1]),item=await jf(`Users/${session.id}/Items/${id}`,session);
      const result={item:cleanItem(item),people:(item.People||[]).slice(0,30).map(p=>({name:p.Name,role:p.Role||p.Type,type:p.Type})),studios:(item.Studios||[]).map(s=>s.Name),technical:technical(item),seasons:[],episodes:[],similar:[],errors:[]};
      const work=[(async()=>{try{const q=new URLSearchParams({UserId:session.id,Limit:'12',Fields:'Overview'});result.similar=(await jf(`Items/${id}/Similar?${q}`,session)).Items?.map(cleanItem)||[]}catch{result.errors.push('Similar titles are unavailable.')}})()];
      if(item.Type==='Series')work.push((async()=>{
        try{
          const q=new URLSearchParams({UserId:session.id,IsMissing:'false'});
          result.seasons=(await jf(`Shows/${id}/Seasons?${q}`,session)).Items?.map(cleanItem)||[];
          const selected=url.searchParams.get('seasonId')||result.seasons[0]?.Id;
          if(selected&&!result.seasons.some(s=>s.Id===selected))fail(400,'Unknown season for this series');
          if(selected){q.set('SeasonId',cleanId(selected));q.set('Limit','100');q.set('Fields','Overview');result.episodes=(await jf(`Shows/${id}/Episodes?${q}`,session)).Items?.filter(e=>!e.IsMissing&&!e.IsVirtualItem).map(cleanItem)||[];result.selectedSeason=selected}
        }catch(error){if(error.status===400)throw error;result.errors.push('Seasons and episodes are unavailable.')}
      })());
      await Promise.all(work);json(res,200,result);return true;
    }
    const backdrop=route.match(/^\/api\/backdrop\/([^/]+)$/);
    if(backdrop&&method==='GET'){
      const id=cleanId(backdrop[1]),item=await jf(`Users/${session.id}/Items/${id}`,session);
      let imageId=id,type='Backdrop';
      if(!item.BackdropImageTags?.length){if(item.ParentBackdropItemId||item.SeriesId){imageId=cleanId(item.ParentBackdropItemId||item.SeriesId);await jf(`Users/${session.id}/Items/${imageId}`,session)}else type='Primary'}
      const response=await fetch(new URL(`Items/${imageId}/Images/${type}?maxWidth=1920&quality=85`,jellyfin()+'/'),{headers:{Authorization:authHeader(session,session.deviceId)},signal:AbortSignal.timeout(6000),redirect:'error'});
      if(!response.ok)fail(404,'Backdrop unavailable');
      send(res,200,Buffer.from(await response.arrayBuffer()),{'Content-Type':response.headers.get('content-type')||'image/jpeg','Cache-Control':'private, no-cache','Vary':'Cookie'});return true;
    }
    const preview=route.match(/^\/api\/preview\/([^/]+)$/);
    if(preview&&method==='GET'){
      const id=cleanId(preview[1]),me=await jf('Users/Me',session);
      if(me.Policy?.EnableMediaPlayback!==true)fail(403,'Media playback is not permitted for this user.');
      const item=await playableItem(id,session);
      if(!item||!['Movie','Episode','Video'].includes(item.Type)){json(res,200,{playable:false,reason:'No playable video is available.'});return true}
      const info=await jf(`Items/${cleanId(item.Id)}/PlaybackInfo`,session,{method:'POST',body:{UserId:session.id,DeviceProfile:profile,EnableDirectPlay:true,EnableDirectStream:false,EnableTranscoding:false,AutoOpenLiveStream:false,IsPlayback:false}});
      const source=(info.MediaSources||[]).find(s=>{
        const streams=s.MediaStreams||[],video=streams.find(v=>v.Type==='Video'),audio=streams.filter(v=>v.Type==='Audio');
        const container=(s.Container||'').toLowerCase();const mp4=['mp4','m4v'].includes(container),webm=container==='webm';
        return s.SupportsDirectPlay&&!s.IsRemote&&!s.RequiresOpening&&!s.LiveStreamId&&video&&(mp4&&video.Codec==='h264'&&audio.every(a=>['aac','mp3'].includes(a.Codec))||webm&&['vp8','vp9'].includes(video.Codec)&&audio.every(a=>['opus','vorbis'].includes(a.Codec)))&&(!video.BitDepth||video.BitDepth<=8)&&(!video.VideoRange||video.VideoRange==='SDR')&&(!s.Bitrate||s.Bitrate<=20000000);
      });
      if(!source){json(res,200,{playable:false,reason:'This file needs a playback mode that previews do not yet support. Showing artwork instead.'});return true}
      for(const [key,value]of tickets)if(value.expires<Date.now())tickets.delete(key);
      if(tickets.size>=1000)tickets.delete(tickets.keys().next().value);
      const ticket=crypto.randomBytes(24).toString('hex'),duration=(item.RunTimeTicks||source.RunTimeTicks||0)/10000000;
      tickets.set(ticket,{session,itemId:item.Id,sourceId:source.Id,container:source.Container.toLowerCase(),expires:Date.now()+120000});
      json(res,200,{playable:true,url:'/api/preview-stream/'+ticket,startSeconds:duration>60?Math.min(120,Math.floor(duration*.08)):0,clipSeconds:20,container:source.Container});return true;
    }
    const stream=route.match(/^\/api\/preview-stream\/([a-f0-9]{48})$/);
    if(stream&&['GET','HEAD'].includes(method)){
      const ticket=tickets.get(stream[1]);
      if(!ticket||ticket.session!==session||ticket.expires<Date.now())fail(403,'Preview expired. Reload the title.');
      await jf(`Users/${session.id}/Items/${cleanId(ticket.itemId)}`,session);
      const me=await jf('Users/Me',session);if(me.Policy?.EnableMediaPlayback!==true)fail(403,'Media playback is not permitted.');
      const range=req.headers.range;if(range&&!/^bytes=(\d+-\d*|-\d+)$/.test(range))fail(416,'Invalid byte range');
      const target=new URL(`Videos/${cleanId(ticket.itemId)}/stream`,jellyfin()+'/');target.searchParams.set('Static','true');if(ticket.sourceId)target.searchParams.set('MediaSourceId',ticket.sourceId);
      const controller=new AbortController();const abort=()=>controller.abort();res.once('close',abort);
      const timeout=setTimeout(abort,10000);
      try{
        const response=await fetch(target,{method,headers:{Authorization:authHeader(session,session.deviceId),'Accept-Encoding':'identity',...(range?{Range:range}:{})},signal:controller.signal,redirect:'error'});clearTimeout(timeout);
        if(![200,206,416].includes(response.status)){await response.body?.cancel();fail(response.status>=400?response.status:502,'Preview stream unavailable.')}
        const headers={'Content-Type':ticket.container==='webm'?'video/webm':'video/mp4','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Cookie'};
        for(const name of ['content-length','content-range','accept-ranges'])if(response.headers.has(name))headers[name]=response.headers.get(name);
        res.writeHead(response.status,headers);
        if(method==='HEAD'||!response.body){res.end();await response.body?.cancel()}
        else await pipeline(Readable.fromWeb(response.body),res);
      }catch(error){if(!controller.signal.aborted)throw error;if(!res.destroyed&&!res.writableEnded){if(!res.headersSent)fail(504,'Preview request timed out.');res.destroy()}}
      finally{clearTimeout(timeout);res.off('close',abort)}
      return true;
    }
    return false;
  };
}
