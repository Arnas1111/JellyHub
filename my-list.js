import {libraryItem} from './core.js';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
export function watchState(item){if(!item)return {state:'unknown',label:'Watch status unavailable',progress:0};const progress=item.RunTimeTicks?Number(item.UserData?.PlaybackPositionTicks||0)/item.RunTimeTicks*100:Number(item.UserData?.PlayedPercentage)||0;return item.UserData?.Played?{state:'watched',label:'Watched',progress:100}:progress>0?{state:'watching',label:'Watching',progress:Math.min(100,Math.max(0,progress))}:{state:'unwatched',label:'Unwatched',progress:0}}
export function requestedVersionAvailable(request,item){if(!item)return false;if(!request.is4k)return true;const mapped=request.media?.jellyfinMediaId4k;if(mapped&&String(mapped).replaceAll('-','').toLowerCase()===String(item.Id).replaceAll('-','').toLowerCase())return true;return (item.MediaSources||[]).some(source=>(source.MediaStreams||[]).some(stream=>stream.Type==='Video'&&stream.Height>=2160))}
export function requestState(request,local){
  const media=request.media||{},status=Number(request.is4k?media.status4k:media.status),downloads=(request.is4k?media.downloadStatus4k:media.downloadStatus)||[];
  const active=Array.isArray(downloads)?downloads:[];
  if(active.length){const bytes=active.reduce((sum,item)=>sum+(Number(item.size)||0),0),left=active.reduce((sum,item)=>sum+(Number(item.sizeLeft)||0),0),statuses=active.map(item=>String(item.status).toLowerCase()),state=statuses.some(status=>['failed','warning'].includes(status))?'failed':statuses.some(status=>status.includes('paused'))?'paused':statuses.includes('downloading')?'downloading':statuses.every(status=>status==='completed')?'importing':'queued';return {state,label:{failed:'Download needs attention',paused:'Download paused',downloading:'Downloading',importing:'Importing',queued:'Queued for download'}[state],progress:bytes>0?Math.min(100,Math.max(0,(bytes-left)/bytes*100)):null,onServer:!!local}}
  if(local)return {state:status===4?'partial':'available',label:status===4?'Partly on server':'On server',progress:null,onServer:true};
  if(status===6)return {state:'removed',label:'Removed from server',progress:null,onServer:false};
  if(Number(request.status)===3)return {state:'declined',label:'Declined',progress:null,onServer:false};
  if(Number(request.status)===1)return {state:'pending',label:'Awaiting approval',progress:null,onServer:false};
  if(status===5||status===4)return {state:'unavailable',label:'Not accessible on this account',progress:null,onServer:false};
  return {state:status===3?'processing':'requested',label:status===3?'Processing':'Requested',progress:null,onServer:false};
}
export function createMyList({jf,seerr,seerrIdentity,libraryMatches,catalogItem,json,getConfig=()=>({})}){
  const metadata=new Map();
  async function details(request,identity){const type=request.media.mediaType,id=request.media.tmdbId,key=identity.id+':'+type+':'+id,old=metadata.get(key);if(old&&old.expires>Date.now())return old.value;const item=catalogItem(await seerr(`${type}/${id}`,identity.headers),type,identity.permissions),value={id:item.id,title:item.title,year:item.year,posterPath:item.posterPath,mediaType:type};if(metadata.size>=200)metadata.delete(metadata.keys().next().value);metadata.set(key,{expires:Date.now()+300000,value});return value}
  return async(req,res,url,user)=>{
    if(url.pathname!=='/api/my-list'||req.method!=='GET')return false;
    const favoriteStart=Number(url.searchParams.get('favoriteStart')||0),requestStart=Number(url.searchParams.get('requestStart')||0),requestFilter=url.searchParams.get('requestFilter')||'all';
    if([favoriteStart,requestStart].some(value=>!Number.isSafeInteger(value)||value<0||value>100000)||!['all','pending','processing','available','deleted','failed'].includes(requestFilter))fail(400,'Invalid My list page or status filter');
    const errors=[],result={favorites:{items:[],start:favoriteStart,total:0,limit:48},requests:{items:[],start:requestStart,total:0,limit:20},errors};
    await Promise.all([
      (async()=>{try{const q=new URLSearchParams({Recursive:'true',IncludeItemTypes:'Movie,Series',Filters:'IsFavorite',SortBy:'SortName',StartIndex:String(favoriteStart),Limit:'48',EnableTotalRecordCount:'true',Fields:'Overview,MediaSources,Genres'});let hidden=[];try{hidden=JSON.parse(getConfig().userState||'{}')[user.id]?.hiddenItems||[]}catch{}if(hidden.length)q.set('ExcludeItemIds',hidden.join(','));const data=await jf(`Users/${user.id}/Items?${q}`,user);result.favorites={...result.favorites,items:(data.Items||[]).map(item=>({...libraryItem(item),WatchStatus:watchState(item)})),total:data.TotalRecordCount??data.Items?.length??0}}catch(error){errors.push({source:'Jellyfin',message:error.message})}})(),
      (async()=>{try{const identity=await seerrIdentity(user),query=new URLSearchParams({requestedBy:String(identity.id),take:'20',skip:String(requestStart),filter:requestFilter,sort:'added',sortDirection:'desc'}),data=await seerr('request?'+query,identity.headers);
        if((data.results||[]).some(request=>Number(request.requestedBy?.id)!==identity.id))fail(502,'Seerr returned another account’s requests. Request history was withheld.');
        const requests=(data.results||[]).filter(request=>Number.isSafeInteger(request.media?.tmdbId)&&request.media.tmdbId>0&&['movie','tv'].includes(request.media.mediaType)),matches=await libraryMatches(user,requests.map(request=>request.media.tmdbId));
        const output=new Array(requests.length);let cursor=0;await Promise.all(Array.from({length:Math.min(4,requests.length)},async()=>{while(cursor<requests.length){const index=cursor++,request=requests[index],local=matches.find(item=>String(item.ProviderIds?.Tmdb)===String(request.media.tmdbId)&&item.Type===(request.media.mediaType==='movie'?'Movie':'Series'));let title;try{title=await details(request,identity)}catch{title={id:request.media.tmdbId,title:(request.media.mediaType==='movie'?'Movie ':'Show ')+request.media.tmdbId,mediaType:request.media.mediaType,year:'',posterPath:null}}output[index]={...title,requestId:request.id,created:request.createdAt||null,updated:request.updatedAt||null,is4k:!!request.is4k,seasons:(request.seasons||[]).map(season=>season.seasonNumber).filter(Number.isSafeInteger),itemId:local?.Id||null,status:requestState(request,requestedVersionAvailable(request,local)?local:null),standardAvailable:!!local&&!!request.is4k&&!requestedVersionAvailable(request,local),watch:watchState(local)};
        }}));result.requests={...result.requests,items:output,total:Number(data.pageInfo?.results)||requests.length};
      }catch(error){errors.push({source:'Seerr',message:error.message})}})()
    ]);json(res,200,result);return true;
  };
}
