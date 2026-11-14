import crypto from 'node:crypto';
const DAY=86400000;
export const registrationPolicyDefaults={IsAdministrator:false,IsDisabled:false,IsHidden:true,EnableAllFolders:false,EnableMediaPlayback:true,EnableAudioPlaybackTranscoding:true,EnableVideoPlaybackTranscoding:true,EnablePlaybackRemuxing:true,EnableRemoteAccess:true,EnableContentDownloading:false,EnableContentDeletion:false,EnableRemoteControlOfOtherUsers:false,EnableSharedDeviceControl:false,EnableUserPreferenceAccess:true,EnablePublicSharing:false,EnableSubtitleManagement:false,EnableLiveTvAccess:false,EnableLiveTvManagement:false};
const policyDefaults=state=>({...registrationPolicyDefaults,...Object.fromEntries(Object.entries(state.defaultPolicy||{}).filter(([key,value])=>Object.hasOwn(registrationPolicyDefaults,key)&&typeof value==='boolean'))});
const featureDefaults=state=>({requests:state.defaultFeatures?.requests===true,streams:state.defaultFeatures?.streams===true});
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const parse=config=>{try{const state=JSON.parse(config.registrationState||'{}');return state&&typeof state==='object'&&!Array.isArray(state)?state:{}}catch{return {}}};
export function generateRegistrationKey(){const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*+-_=?';let value;do{value=Array.from({length:20},()=>alphabet[crypto.randomInt(alphabet.length)]).join('')}while(!/[A-Za-z]/.test(value)||!/[!@#$%&*+_=?-]/.test(value));return value}
export function createRegistration({getConfig,saveConfig,jf,jellyfin,upstream,authHeader,readBody,json,send,cleanId,logger,now=Date.now}){
  let rotation=Promise.resolve(),setup=Promise.resolve(),creating=Promise.resolve(),art={signature:'',expires:0,items:[],images:new Map()},artPending,pendingRegistrations=0;
  const attempts=new Map();
  const service=()=>({token:getConfig().registrationServiceKey,deviceId:'JellyHub-registration',admin:true});
  const serviceRequest=(route,opts={})=>{if(!getConfig().registrationServiceKey)fail(503,'An administrator must set up registration first.');return upstream(jellyfin(),route,{...opts,headers:{Authorization:authHeader(service(),service().deviceId),...(opts.body?{'Content-Type':'application/json'}:{}),...opts.headers}})};
  function rotate(force=false){const work=rotation.catch(()=>{}).then(async()=>{const state=parse(getConfig());if(!force&&state.key?.length===20&&state.expiresAt>now())return state;const next={...state,key:generateRegistrationKey(),issuedAt:now(),expiresAt:now()+DAY};await saveConfig(config=>({registrationState:JSON.stringify({...parse(config),key:next.key,issuedAt:next.issuedAt,expiresAt:next.expiresAt})}));return parse(getConfig())});rotation=work;return work}
  const rotationTimer=setInterval(()=>{const state=parse(getConfig());if(state.key&&state.expiresAt<=now())rotate().catch(()=>logger.log('error','registration.rotation_failed',{code:'CONFIG_NOT_WRITABLE'}))},60000);rotationTimer.unref();
  const signature=()=>JSON.stringify([getConfig().jellyfinUrl,getConfig().registrationServiceKey,parse(getConfig()).artwork,parse(getConfig()).folders]);
  async function boundedImage(id){
    const response=await fetch(new URL(`Items/${cleanId(id)}/Images/Backdrop?maxWidth=1600&quality=75`,jellyfin()+'/'),{headers:{Authorization:authHeader(service(),service().deviceId)},signal:AbortSignal.timeout(8000),redirect:'error'});
    if(!response.ok)fail(502,'Artwork could not be loaded.');const type=response.headers.get('content-type')?.split(';')[0];if(!['image/jpeg','image/png','image/webp'].includes(type)){await response.body?.cancel();fail(502,'Unsupported artwork image.')}
    const reader=response.body.getReader(),parts=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2097152){await reader.cancel();fail(502,'Artwork image is too large.')}parts.push(Buffer.from(value))}}finally{reader.releaseLock()}
    return {bytes:Buffer.concat(parts),type};
  }
  async function artwork(){
    const state=parse(getConfig()),sig=signature();if(!state.artwork||!getConfig().registrationServiceKey||!state.folders?.length)return [];
    if(art.signature===sig&&art.expires>now())return art.items;
    if(artPending)return artPending;
    artPending=(async()=>{
      const lists=await Promise.all(state.folders.map(folder=>serviceRequest('Items?'+new URLSearchParams({ParentId:folder,Recursive:'true',IncludeItemTypes:'Movie,Series',HasBackdrop:'true',SortBy:'CommunityRating',SortOrder:'Descending',Limit:'24'}))));
      const candidates=[...new Map(lists.flatMap(list=>list.Items||[]).filter(item=>item.BackdropImageTags?.length).map(item=>[item.Id,item])).values()],hour=Math.floor(now()/3600000),score=item=>crypto.createHash('sha256').update(hour+':'+item.Id).digest('hex');
      candidates.sort((a,b)=>score(a).localeCompare(score(b)));const images=new Map(),items=[];let cursor=0;
      await Promise.all(Array.from({length:Math.min(3,candidates.length)},async()=>{while(cursor<Math.min(8,candidates.length)){const item=candidates[cursor++];try{const image=await boundedImage(item.Id),id=crypto.randomBytes(16).toString('hex');images.set(id,image);items.push('/api/login-artwork/'+id)}catch{/* Keep the other selected artwork. */}}}));
      if(signature()!==sig)return [];art={signature:sig,expires:now()+3600000,images,items};return items;
    })().finally(()=>artPending=null);return artPending;
  }
  async function configure(input,user){
    if(Object.keys(input).some(key=>!['enabled','artwork','folders','defaultPolicy','defaultFeatures'].includes(key))||typeof input.enabled!=='boolean'||typeof input.artwork!=='boolean'||!Array.isArray(input.folders)||input.folders.length>20||input.folders.some(id=>typeof id!=='string'))fail(400,'Choose registration settings and server sections.');
    for(const [field,allowed]of [['defaultPolicy',Object.keys(registrationPolicyDefaults)],['defaultFeatures',['requests','streams']]]){if(input[field]!==undefined&&(!input[field]||typeof input[field]!=='object'||Array.isArray(input[field])||Object.entries(input[field]).some(([key,value])=>!allowed.includes(key)||typeof value!=='boolean')))fail(400,'Choose valid default permissions.')}
    const defaults=policyDefaults({defaultPolicy:{...policyDefaults(parse(getConfig())),...input.defaultPolicy}});if(defaults.IsAdministrator&&defaults.IsDisabled)fail(400,'Jellyfin administrator accounts cannot require activation.');
    const folders=await jf('Library/VirtualFolders',user),ids=[...new Set(input.folders.map(cleanId))];if(ids.some(id=>!folders.some(folder=>folder.ItemId===id)))fail(400,'A selected server section no longer exists.');if(input.artwork&&!ids.length)fail(400,'Select at least one server section for artwork.');
    let key=getConfig().registrationServiceKey,created=false;
    if(!key&&(input.enabled||input.artwork)){
      const app='JellyHub registration '+crypto.randomBytes(8).toString('hex'),result=await jf('Auth/Keys?'+new URLSearchParams({app}),user,{method:'POST'});
      key=result?.AccessToken;if(!key){const list=await jf('Auth/Keys',user);key=list.Items?.find(item=>item.AppName===app)?.AccessToken}
      if(typeof key!=='string'||!/^[\w-]{16,128}$/.test(key))fail(502,'Jellyfin did not return the dedicated service key.');created=true;
    }
    try{await saveConfig(config=>({registrationServiceKey:key||'',registrationState:JSON.stringify({...parse(config),...input,folders:ids,defaultPolicy:{...policyDefaults(parse(config)),...input.defaultPolicy},defaultFeatures:{...featureDefaults(parse(config)),...input.defaultFeatures}})}));art={signature:'',expires:0,items:[],images:new Map()}}
    catch(error){if(created)await fetch(new URL('Auth/Keys/'+encodeURIComponent(key),jellyfin()+'/'),{method:'DELETE',headers:{Authorization:authHeader(user,user.deviceId)},signal:AbortSignal.timeout(8000),redirect:'error'}).catch(()=>{});throw error}
  }
  async function createAccount(input){
    const state=await rotate();if(!state.enabled||!getConfig().registrationServiceKey)fail(403,'Registration is not enabled. Ask an administrator.');
    const hash=value=>crypto.createHash('sha256').update(value).digest();if(!crypto.timingSafeEqual(hash(input.key),hash(state.key)))fail(403,'Registration key is not valid.');
    const existing=await serviceRequest('Users');if((Array.isArray(existing)?existing:[]).some(user=>typeof user.Name==='string'&&user.Name.toLowerCase()===input.username.toLowerCase()))fail(409,'That username is already in use.');
    let id,created=false,stage='creating the account';
    try{
      const result=await serviceRequest('Users/New',{method:'POST',body:{Name:input.username,Password:crypto.randomBytes(32).toString('base64url')}});id=cleanId(result?.Id||'');created=true;
      const defaults=policyDefaults(state),policy={...result.Policy,...defaults,IsAdministrator:false,IsDisabled:true,EnabledFolders:state.folders||[],EnableContentDeletionFromFolders:[]};
      stage='applying account permissions';await serviceRequest(`Users/${id}/Policy`,{method:'POST',body:policy});
      stage='saving frontend permissions';await saveConfig(config=>{let users;try{users=JSON.parse(config.userState||'{}')}catch{users={}}users[id]={...users[id],featurePermissions:featureDefaults(state)};return {userState:JSON.stringify(users)}});
      stage='setting the password';await serviceRequest(`Users/${id}/Password`,{method:'POST',body:{NewPw:input.password,ResetPassword:false}});
      stage='applying the completed account defaults';await serviceRequest(`Users/${id}/Policy`,{method:'POST',body:{...policy,IsAdministrator:defaults.IsAdministrator,IsDisabled:defaults.IsDisabled}});
      logger.log('info','registration.account_created');
      return {created:true,requiresApproval:defaults.IsDisabled};
    }catch(error){
      if(created){try{await serviceRequest('Users/'+id,{method:'DELETE'})}catch{logger.log('error','registration.cleanup_failed',{code:'INCOMPLETE_ACCOUNT'});fail(503,'Account setup did not finish. Ask an administrator to remove the incomplete account before retrying.')}}
      if(stage==='creating the account'&&error.status===409)fail(409,'That username is already in use.');if(stage==='creating the account'&&error.status===400)fail(400,'Jellyfin could not accept this username.');if(created)fail(error.status||502,'Account setup failed while '+stage+'. '+error.message);throw error;
    }
  }
  return async(req,res,url,user)=>{
    const route=url.pathname,method=req.method;
    if(route==='/api/login-page'&&method==='GET'){
      let images=[];try{images=await artwork()}catch{logger.log('warn','login.artwork_unavailable')}
      json(res,200,{registrationEnabled:!!parse(getConfig()).enabled&&!!getConfig().registrationServiceKey,artwork:images});return true;
    }
    const image=route.match(/^\/api\/login-artwork\/([a-f0-9]{32})$/);
    if(image&&method==='GET'){if(art.signature!==signature()||!parse(getConfig()).artwork)fail(404,'Artwork unavailable');const picture=art.images.get(image[1]);if(!picture)fail(404,'Artwork unavailable');send(res,200,picture.bytes,{'Content-Type':picture.type,'Cache-Control':'public, max-age=300'});return true}
    if(route==='/api/register'&&method==='POST'){
      const ip=req.socket?.remoteAddress||'unknown',time=now();for(const [key,value]of attempts)if(value.until<=time)attempts.delete(key);const entry=attempts.get(ip)||{count:0,until:time+900000};if(entry.count>=8)fail(429,'Too many registration attempts. Try again in 15 minutes.');if(attempts.size>=2000&&!attempts.has(ip))fail(429,'Registration is busy. Try again later.');attempts.set(ip,{...entry,count:entry.count+1});
      const input=await readBody(req,4096);if(Object.keys(input).some(key=>!['username','password','key'].includes(key))||typeof input.username!=='string'||typeof input.password!=='string'||typeof input.key!=='string')fail(400,'Enter your account details and registration key.');
      if(!parse(getConfig()).enabled)fail(403,'Registration is not enabled. Ask an administrator.');
      if(pendingRegistrations>=16)fail(429,'Registration is busy. Try again shortly.');pendingRegistrations++;
      const work=creating.catch(()=>{}).then(()=>createAccount(input));creating=work;let result;try{result=await work}finally{pendingRegistrations--}json(res,201,result);return true;
    }
    if(route.startsWith('/api/admin/registration')&&user){
      const me=await jf('Users/Me',user);if(!me.Policy?.IsAdministrator)fail(403,'Administrator required');
      if(route==='/api/admin/registration'&&method==='GET'){const state=await rotate(),folders=await jf('Library/VirtualFolders',user);json(res,200,{enabled:!!state.enabled,artwork:!!state.artwork,folders:state.folders||[],key:state.key,expiresAt:state.expiresAt,configured:!!getConfig().registrationServiceKey,defaultPolicy:policyDefaults(state),defaultFeatures:featureDefaults(state),sections:folders.map(item=>({id:item.ItemId,name:item.Name}))});return true}
      if(route==='/api/admin/registration'&&method==='PUT'){const input=await readBody(req);const work=setup.catch(()=>{}).then(()=>configure(input,user));setup=work;await work;json(res,200,{ok:true});return true}
      if(route==='/api/admin/registration/regenerate'&&method==='POST'){const state=await rotate(true);json(res,200,{key:state.key,expiresAt:state.expiresAt});return true}
    }
    return false;
  };
}
