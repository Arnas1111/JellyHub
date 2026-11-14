import {profileName} from './profiles.js';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
export const pluginHandling=[
  ['AudioDB','Backend metadata provider'],['Custom Tabs','Native navigation registry'],['File Transformation','Backend transformations; original web patches do not apply'],['InPlayerEpisodePreview','Native player episode drawer'],['Intro Skipper','Native MediaSegments skip controls'],['JavaScript Injector','Native extension API; original web scripts need porting'],['Jellyfin Enhanced','Native playback/preferences plus optional review adapter; full feature parity pending'],['ListenBrainz Similarity Provider','Backend provider'],['MusicBrainz','Backend metadata provider'],['OMDb','Backend metadata provider'],['Plugin Pages','Native page registry; original web pages need porting'],['SkipMe.db','Native MediaSegments skip controls'],['Studio Images','Backend artwork provider'],['TMDb','Backend metadata provider']
];
const normalize=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function createPlugins({jf,json,readBody,cleanId,getConfig=()=>({})}){
  return async(req,res,url,user)=>{
    if(url.pathname==='/api/admin/plugins'&&req.method==='GET'){
      if(!user.admin)fail(403,'Administrator required');const installed=await jf('Plugins',user);
      const plugins=(Array.isArray(installed)?installed:installed.Items||[]).map(p=>({id:p.Id,name:p.Name,version:p.Version,status:p.Status,description:p.Description||''}));
      json(res,200,{plugins,compatibility:pluginHandling.map(([name,handling])=>({name,handling,installed:plugins.find(p=>normalize(p.name).includes(normalize(name)))||null})),note:'Installed versions are reported by your server. Native adapters require live verification; original Jellyfin Web injection scripts are not automatically compatible.'});return true;
    }
    const reviews=url.pathname.match(/^\/api\/reviews\/([^/]+)$/);
    if(reviews&&['GET','POST','DELETE'].includes(req.method)){
      // Resolve provider identity only after checking this user's access to a local item.
      const item=await jf(`Users/${user.id}/Items/${cleanId(reviews[1])}`,user),type=item.Type==='Movie'?'movie':item.Type==='Series'?'tv':null,tmdb=item.ProviderIds?.Tmdb;
      if(!type||!/^\d+$/.test(tmdb||''))fail(422,'Community reviews need a movie or series with a TMDb identity.');
      const route=`JellyfinEnhanced/reviews/${type}/${tmdb}`;
      try{
        if(req.method==='GET'){
          const data=await jf(route,user);json(res,200,{reviews:(data.reviews||[]).slice(0,200).map(r=>({name:profileName(getConfig(),r.userId,String(r.userName||'User')),content:String(r.content||'').slice(0,2000),rating:r.rating??null,created:r.createdAt,own:normalize(r.userId)===normalize(user.id)}))});return true;
        }
        let body;if(req.method==='POST'){const input=await readBody(req);if(typeof input.content!=='string'||input.content.length>2000||input.rating!==null&&(typeof input.rating!=='number'||input.rating<.5||input.rating>5||!Number.isInteger(input.rating*2))||!input.content.trim()&&input.rating===null)fail(400,'Add review text or a rating from 0.5 to 5 stars.');body={Content:input.content.trim(),Rating:input.rating}}
        await jf(route,user,{method:req.method,...(body?{body}:{})});json(res,200,{ok:true});return true;
      }catch(error){if(error.status===404)fail(501,'The Jellyfin Enhanced review endpoint is unavailable on this server.');throw error}
    }
    return false;
  };
}
