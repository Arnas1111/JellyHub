export function summarizeEpisodes(items){
  const seen=new Set(),episodes=[],seasons=new Map();
  for(const item of items){
    if(!item.Id||seen.has(item.Id)||item.Type!=='Episode'||item.IsMissing||item.IsVirtualItem)continue;
    seen.add(item.Id);const runtimeTicks=Math.max(0,Number(item.RunTimeTicks)||0),positionTicks=Math.max(0,Number(item.UserData?.PlaybackPositionTicks)||0),played=item.UserData?.Played===true;
    const episode={id:item.Id,played,positionTicks,runtimeTicks,percent:played?100:runtimeTicks?Math.min(100,positionTicks/runtimeTicks*100):0};episodes.push(episode);
    const key=item.SeasonId||String(item.ParentIndexNumber??0);let season=seasons.get(key);if(!season){season={id:item.SeasonId||null,number:item.ParentIndexNumber??0,total:0,watched:0,inProgress:0};seasons.set(key,season)}season.total++;if(played)season.watched++;else if(positionTicks>0)season.inProgress++;
  }
  const watched=episodes.filter(item=>item.played).length,inProgress=episodes.filter(item=>!item.played&&item.positionTicks>0).length,total=episodes.length;
  return {total,watched,inProgress,unwatched:total-watched,percent:total?watched/total*100:0,seasons:[...seasons.values()].sort((a,b)=>a.number-b.number),episodes};
}

export async function seriesProgress(id,user,jf){
  const series=await jf(`Users/${user.id}/Items/${id}`,user);
  if(series.Type!=='Series')throw Object.assign(Error('Choose a TV show.'),{status:400});
  const items=[];
  for(let start=0;start<20000;){
    const q=new URLSearchParams({UserId:user.id,StartIndex:String(start),Limit:'200',IsMissing:'false',EnableUserData:'true',EnableTotalRecordCount:'true'}),page=await jf(`Shows/${id}/Episodes?${q}`,user),batch=page.Items||[];items.push(...batch);
    const knownTotal=Number.isFinite(page.TotalRecordCount);
    if(!batch.length){if(knownTotal&&start<page.TotalRecordCount)throw Object.assign(Error('Jellyfin returned an incomplete episode list.'),{status:502});return {seriesId:id,...summarizeEpisodes(items)}}
    start+=batch.length;
    if(knownTotal?start>=page.TotalRecordCount:batch.length<200)return {seriesId:id,...summarizeEpisodes(items)};
  }
  throw Object.assign(Error('This show has too many episodes to summarize.'),{status:502});
}
