const PREFIX='jellyhub.featured.v1.';
const MAX_AGE=3600000,MAX_SIZE=600000;
const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(value);
function cleanItem(item){
  if(!item||!validId(item.Id)||typeof item.Name!=='string')return null;
  const result={Id:item.Id,Name:item.Name.slice(0,300),Type:String(item.Type||'Movie').slice(0,40),Overview:String(item.Overview||'').slice(0,3000),OfficialRating:String(item.OfficialRating||'').slice(0,40),Genres:(Array.isArray(item.Genres)?item.Genres:[]).filter(value=>typeof value==='string').slice(0,20).map(value=>value.slice(0,80))};
  for(const key of ['ProductionYear','CommunityRating','RunTimeTicks'])if(Number.isFinite(item[key]))result[key]=item[key];return result;
}
function clean(value){
  if(!value||!Array.isArray(value.items)||value.items.length>8)return null;
  const items=value.items.map(cleanItem).filter(Boolean);if(!items.length)return null;
  const activeId=items.some(item=>item.Id===value.activeId)?value.activeId:items[0].Id;
  const artwork=value.artwork?.id===activeId&&typeof value.artwork.data==='string'&&value.artwork.data.length<500000&&/^data:image\/jpeg;base64,[a-zA-Z0-9+/]+=*$/.test(value.artwork.data)?{id:activeId,data:value.artwork.data}:null;
  return {items,activeId,source:['popular','mixed','library'].includes(value.source)?value.source:'library',reshuffleAt:Number.isFinite(value.reshuffleAt)?value.reshuffleAt:Date.now()+3600000,artwork};
}
export function readFeaturedSnapshot(userId,storage,now=Date.now()){
  if(!userId)return null;
  try{storage??=globalThis.sessionStorage;const raw=storage.getItem(PREFIX+userId);if(!raw||raw.length>MAX_SIZE)return null;const saved=JSON.parse(raw);if(!Number.isFinite(saved.savedAt)||now<saved.savedAt||now-saved.savedAt>MAX_AGE){storage.removeItem(PREFIX+userId);return null}return clean(saved)}catch{return null}
}
export function writeFeaturedSnapshot(userId,value,storage,now=Date.now()){
  if(!userId)return;
  try{storage??=globalThis.sessionStorage;const saved=clean(value);if(!saved){storage.removeItem(PREFIX+userId);return}let raw=JSON.stringify({...saved,savedAt:now});if(raw.length>MAX_SIZE)return;try{storage.setItem(PREFIX+userId,raw)}catch{raw=JSON.stringify({...saved,artwork:null,savedAt:now});storage.setItem(PREFIX+userId,raw)}}catch{/* Private mode or full storage must never prevent browsing. */}
}
export function clearFeaturedSnapshots(storage){
  try{storage??=globalThis.sessionStorage;for(let index=storage.length-1;index>=0;index--){const key=storage.key(index);if(key?.startsWith(PREFIX))storage.removeItem(key)}}catch{/* Storage may be unavailable. */}
}
