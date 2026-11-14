import {profileName,featurePermissions} from './profiles.js';
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
  if(Number(request.status)===4)return {state:'failed',label:'Request failed',progress:null,onServer:false};
  if(Number(request.status)===1)return {state:'pending',label:'Awaiting approval',progress:null,onServer:false};
  if(status===5||status===4)return {state:'unavailable',label:'Not accessible on this account',progress:null,onServer:false};
  return {state:status===3?'processing':'requested',label:status===3?'Processing':'Requested',progress:null,onServer:false};
}
export function downloadDetails(request){
  const value=(request.is4k?request.media?.downloadStatus4k:request.media?.downloadStatus)||[],rows=Array.isArray(value)?value:[];
  const size=rows.reduce((sum,row)=>sum+Math.max(0,Number(row.size)||0),0),left=rows.reduce((sum,row)=>sum+Math.max(0,Number(row.sizeLeft)||0),0);
  const times=rows.map(row=>{const value=String(row.timeleft||row.timeLeft||'');if(!/^\d{1,3}:\d{2}:\d{2}$/.test(value))return null;const [h,m,s]=value.split(':').map(Number);return m<60&&s<60?h*3600+m*60+s:null}).filter(Number.isFinite);
  return rows.length?{sizeBytes:size||null,downloadedBytes:size?Math.max(0,size-left):null,etaSeconds:times.length?Math.max(...times):null}:null;
}
export function createMyList({jf,seerr,seerrIdentity,libraryMatches,catalogItem,json,getConfig=()=>({})}){
  const metadata=new Map();
  async function details(request,identity){
    const type=request.media.mediaType,id=request.media.tmdbId,key=identity.id+':'+type+':'+id,old=metadata.get(key);if(old&&old.expires>Date.now())return old.value;
    const raw=await seerr(`${type}/${id}`,identity.headers),item=catalogItem(raw,type,identity.permissions),date=raw.releaseDate||raw.firstAirDate;
    const value={id:item.id,title:item.title,year:item.year,posterPath:item.posterPath,mediaType:type,releaseDate:/^\d{4}-\d{2}-\d{2}$/.test(date||'')?date:null};
    if(metadata.size>=200)metadata.delete(metadata.keys().next().value);metadata.set(key,{expires:Date.now()+300000,value});return value;
  }
  async function requestPage(user,identity,{scope,filter,start,limit=20}){
    const query=new URLSearchParams({take:String(limit),skip:String(start),filter,sort:'added',sortDirection:'desc'});if(scope==='mine')query.set('requestedBy',String(identity.id));
    const data=await seerr('request?'+query,identity.headers),raw=data.results||[];
    if(scope==='mine'&&raw.some(request=>Number(request.requestedBy?.id)!==identity.id))fail(502,'Seerr returned another account’s requests. Request history was withheld.');
    return {raw,total:Number(data.pageInfo?.results)||raw.length};
  }
  async function enrich(user,identity,raw){
    const requests=raw.filter(request=>Number.isSafeInteger(request.media?.tmdbId)&&request.media.tmdbId>0&&['movie','tv'].includes(request.media.mediaType)),matches=await libraryMatches(user,requests.map(request=>request.media.tmdbId));
    const output=new Array(requests.length);let cursor=0;await Promise.all(Array.from({length:Math.min(4,requests.length)},async()=>{while(cursor<requests.length){
      const index=cursor++,request=requests[index],local=matches.find(item=>String(item.ProviderIds?.Tmdb)===String(request.media.tmdbId)&&item.Type===(request.media.mediaType==='movie'?'Movie':'Series'));let title;
      try{title=await details(request,identity)}catch{title={id:request.media.tmdbId,title:(request.media.mediaType==='movie'?'Movie ':'Show ')+request.media.tmdbId,mediaType:request.media.mediaType,year:'',posterPath:null,releaseDate:null}}
      const owner=request.requestedBy||{},own=Number(owner.id)===identity.id,fallback=String(owner.displayName||owner.jellyfinUsername||owner.username||'Member').slice(0,60);
      const status=requestState(request,requestedVersionAvailable(request,local)?local:null),upcoming=!!title.releaseDate&&title.releaseDate>new Date().toISOString().slice(0,10);
      if(upcoming&&['requested','processing'].includes(status.state)){status.state='upcoming';status.label='Coming soon'}
      output[index]={...title,requestId:request.id,created:request.createdAt||null,updated:request.updatedAt||null,is4k:!!request.is4k,seasons:(request.seasons||[]).map(season=>season.seasonNumber).filter(Number.isSafeInteger),itemId:local?.Id||null,status,download:downloadDetails(request),requester:{name:profileName(getConfig(),owner.jellyfinUserId||'',own?user.name||fallback:fallback),own},standardAvailable:!!local&&!!request.is4k&&!requestedVersionAvailable(request,local),watch:watchState(local)};
    }}));return output;
  }
  async function favorites(user,start){
    const q=new URLSearchParams({Recursive:'true',IncludeItemTypes:'Movie,Series',Filters:'IsFavorite',SortBy:'SortName',StartIndex:String(start),Limit:'48',EnableTotalRecordCount:'true',Fields:'Overview,MediaSources,Genres'});let hidden=[];try{hidden=JSON.parse(getConfig().userState||'{}')[user.id]?.hiddenItems||[]}catch{}if(hidden.length)q.set('ExcludeItemIds',hidden.join(','));
    const data=await jf(`Users/${user.id}/Items?${q}`,user);return {items:(data.Items||[]).map(item=>({...libraryItem(item),WatchStatus:watchState(item)})),start,total:data.TotalRecordCount??data.Items?.length??0,limit:48};
  }
  return async(req,res,url,user)=>{
    if(!['/api/my-list','/api/requests'].includes(url.pathname)||req.method!=='GET')return false;
    const dashboard=url.pathname==='/api/requests',favoriteStart=Number(url.searchParams.get('favoriteStart')||0),start=Number(url.searchParams.get(dashboard?'start':'requestStart')||0),filter=url.searchParams.get(dashboard?'filter':'requestFilter')||'all',requestedScope=url.searchParams.get('scope')||'all';
    if([favoriteStart,start].some(value=>!Number.isSafeInteger(value)||value<0||value>100000)||!['all','pending','processing','upcoming','available','deleted','failed'].includes(filter)||!['all','mine'].includes(requestedScope))fail(400,'Invalid My list page or status filter');
    const errors=[];
    if(dashboard&&!featurePermissions(getConfig(),user.id,user.admin).requests)fail(403,'Requests are disabled for this account.');
    if(dashboard){
      const result={scope:'mine',canViewAll:false,items:[],downloads:[],start,limit:20,total:0,hasMore:false,nextStart:start,errors};
      try{
        const identity=await seerrIdentity(user),canViewAll=[2,16,16384].some(bit=>(identity.permissions&bit)!==0),scope=requestedScope==='all'&&canViewAll?'all':'mine';Object.assign(result,{scope,canViewAll});
        await Promise.all([
          (async()=>{try{
            if(filter==='upcoming'){
              // Scan bounded batches; the cursor advances through Seerr rows, so pages never repeat matches.
              let cursor=start,more=true;const items=[];
              for(let batch=0;batch<5&&more&&items.length<20;batch++){
                const page=await requestPage(user,identity,{scope,filter:'unavailable',start:cursor,limit:50}),rows=await enrich(user,identity,page.raw);
                const matching=new Map(rows.filter(item=>item.status.state==='upcoming').map(item=>[item.requestId,item]));
                for(const raw of page.raw){cursor++;if(matching.has(raw.id))items.push(matching.get(raw.id));if(items.length===20)break}
                more=page.raw.length>0&&cursor<page.total;
              }
              Object.assign(result,{items,total:null,hasMore:more,nextStart:cursor});
            }else{
              const page=await requestPage(user,identity,{scope,filter,start});Object.assign(result,{items:await enrich(user,identity,page.raw),total:page.total,hasMore:start+20<page.total,nextStart:start+20});
            }
          }catch(error){errors.push({source:'Requests',message:error.message})}})(),
          (async()=>{try{const page=await requestPage(user,identity,{scope,filter:'processing',start:0,limit:100}),active=page.raw.filter(row=>downloadDetails(row));result.downloads=await enrich(user,identity,active);result.downloadsLimited=page.total>100}catch(error){errors.push({source:'Downloads',message:error.message})}})()
        ]);
      }catch(error){errors.push({source:'Seerr',message:error.message})}
      json(res,200,result);return true;
    }
    const result={favorites:{items:[],start:favoriteStart,total:0,limit:48},requests:{items:[],start,total:0,limit:20},errors};
    await Promise.all([
      (async()=>{try{result.favorites=await favorites(user,favoriteStart)}catch(error){errors.push({source:'Jellyfin',message:error.message})}})(),
      (async()=>{if(url.searchParams.get('source')==='favorites'||!featurePermissions(getConfig(),user.id,user.admin).requests)return;try{const identity=await seerrIdentity(user),page=await requestPage(user,identity,{scope:'mine',filter,start});result.requests={...result.requests,items:await enrich(user,identity,page.raw),total:page.total}}catch(error){errors.push({source:'Seerr',message:error.message})}})()
    ]);json(res,200,result);return true;
  };
}
