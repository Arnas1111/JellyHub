import crypto from 'node:crypto';
import {registrationPolicyDefaults} from './registration.js';
export const socialPermissionDefaults={chat:true,dm:true,upload:true,viewProfiles:true,manageChannels:false,moderate:false};
export const nativeRoleKeys=[...Object.keys(registrationPolicyDefaults),'EnabledFolders'];
const norm=id=>String(id||'').replaceAll('-','').toLowerCase();
let policyChanges=Promise.resolve();
export function serializePolicyChange(work){const result=policyChanges.catch(()=>{}).then(work);policyChanges=result;return result}
export function userState(config,id){let all;try{all=JSON.parse(config.userState||'{}')}catch{all={}}const key=Object.keys(all).find(key=>norm(key)===norm(id))||id;return {all,key,value:all[key]||{}}}
export function roleList(config){try{const roles=JSON.parse(config.roles||'[]');return Array.isArray(roles)?roles:[]}catch{return []}}
export function assignedRoles(config,id){const ids=userState(config,id).value.roleIds||[];return roleList(config).filter(role=>ids.includes(role.id)).sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id))}
export function roleFeature(config,id,key,fallback){for(const role of assignedRoles(config,id))if(typeof role.permissions?.[key]==='boolean')return role.permissions[key];return fallback}
export function rolePolicy(config,id,baseline){const result={...baseline};for(const role of assignedRoles(config,id).reverse())Object.assign(result,role.policy);return result}
export function socialPermissions(config,user){return Object.fromEntries(Object.entries(socialPermissionDefaults).map(([key,fallback])=>[key,!!user.admin||roleFeature(config,user.id,key,fallback)]))}
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
export function createRoles({getConfig,saveConfig,jf,json,readBody,cleanId,logger}){
  async function apply(next,ids,actor){
    const targets=[];
    for(const id of new Set(ids)){
      const user=await jf('Users/'+cleanId(id),actor),old=userState(getConfig(),id),state=userState(next,id),oldKeys=new Set(assignedRoles(getConfig(),id).flatMap(role=>Object.keys(role.policy))),newKeys=new Set(assignedRoles(next,id).flatMap(role=>Object.keys(role.policy))),baseline={...user.Policy};
      for(const key of oldKeys)if(Object.hasOwn(old.value.roleBaseline||{},key))baseline[key]=old.value.roleBaseline[key];else delete baseline[key];
      state.all[state.key]={...state.value};if(assignedRoles(next,id).length)state.all[state.key].roleBaseline=Object.fromEntries([...newKeys].filter(key=>Object.hasOwn(baseline,key)).map(key=>[key,baseline[key]]));else delete state.all[state.key].roleBaseline;
      next.userState=JSON.stringify(state.all);targets.push({id,user,policy:rolePolicy(next,id,baseline)})
    }
    const users=await jf('Users',actor);let admins=users.filter(user=>user.Policy?.IsAdministrator&&!user.Policy?.IsDisabled).length;
    for(const target of targets){if(norm(target.id)===norm(actor.id)&&(!target.policy.IsAdministrator||target.policy.IsDisabled))fail(400,'Your current administrator account cannot be demoted or disabled.');if(target.policy.IsAdministrator&&target.policy.IsDisabled)fail(400,'Jellyfin administrators cannot be disabled.');if(target.user.Policy?.IsAdministrator&&!target.user.Policy?.IsDisabled)admins--;if(target.policy.IsAdministrator&&!target.policy.IsDisabled)admins++}if(admins<1)fail(400,'Keep an enabled administrator.');
    const done=[];try{for(const target of targets){done.push(target);await jf(`Users/${target.id}/Policy`,actor,{method:'POST',body:target.policy})}await saveConfig(latest=>{let all=userState(latest,'').all;for(const {id}of targets){const state=userState({...latest,userState:JSON.stringify(all)},id),changed=userState(next,id).value;all[state.key]={...state.value,roleIds:changed.roleIds||[]};if(changed.roleBaseline)all[state.key].roleBaseline=changed.roleBaseline;else delete all[state.key].roleBaseline}return {roles:next.roles,userState:JSON.stringify(all)}})}catch(error){let failed=false;for(const target of done.reverse())try{await jf(`Users/${target.id}/Policy`,actor,{method:'POST',body:target.user.Policy})}catch{failed=true}if(failed){logger.log('error','roles.rollback_failed');fail(503,'Role changes failed and some Jellyfin permissions could not be restored. Review affected users.')}throw error}
  }
  return async(req,res,url,actor)=>{
    if(!url.pathname.startsWith('/api/admin/roles')&&!/^\/api\/admin\/users\/[^/]+\/roles$/.test(url.pathname))return false;if(!actor.admin)fail(403,'Administrator required');
    if(url.pathname==='/api/admin/roles'&&req.method==='GET'){const users=await jf('Users',actor),folders=await jf('Library/VirtualFolders',actor);json(res,200,{roles:roleList(getConfig()),users:users.map(user=>({id:user.Id,name:user.Name,roleIds:userState(getConfig(),user.Id).value.roleIds||[]})),folders:folders.map(folder=>({id:folder.ItemId,name:folder.Name}))});return true}
    const result=serializePolicyChange(async()=>{
      const config=getConfig(),next={...config},roles=roleList(config),assignment=url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/roles$/),route=url.pathname.match(/^\/api\/admin\/roles\/([a-f0-9-]{36})$/);let targets=[];
      if(assignment&&req.method==='PUT'){const id=cleanId(assignment[1]),input=await readBody(req);if(Object.keys(input).some(key=>key!=='roleIds')||!Array.isArray(input.roleIds)||input.roleIds.length>30||input.roleIds.some(value=>!roles.some(role=>role.id===value)))fail(400,'Choose valid roles.');const state=userState(config,id);state.all[state.key]={...state.value,roleIds:[...new Set(input.roleIds)]};next.userState=JSON.stringify(state.all);targets=[id]}
      else if((url.pathname==='/api/admin/roles'&&req.method==='POST')||(route&&req.method==='PUT')){
        const input=await readBody(req);if(Object.keys(input).some(key=>!['name','color','priority','permissions','policy'].includes(key))||typeof input.name!=='string'||!input.name.trim()||input.name.length>40||!/^#[a-f0-9]{6}$/i.test(input.color||'')||!Number.isSafeInteger(input.priority)||Math.abs(input.priority)>1000||!input.permissions||typeof input.permissions!=='object'||Array.isArray(input.permissions)||!input.policy||typeof input.policy!=='object'||Array.isArray(input.policy))fail(400,'Enter valid role settings.');
        for(const [key,value]of Object.entries(input.permissions))if(!['requests','streams',...Object.keys(socialPermissionDefaults)].includes(key)||typeof value!=='boolean')fail(400,'Invalid role permission.');
        for(const [key,value]of Object.entries(input.policy))if(!nativeRoleKeys.includes(key)||(key==='EnabledFolders'?!Array.isArray(value)||value.length>200||value.some(id=>typeof id!=='string'):typeof value!=='boolean'))fail(400,'Invalid Jellyfin role permission.');
        if(input.policy.EnabledFolders){const folders=await jf('Library/VirtualFolders',actor);if(input.policy.EnabledFolders.some(id=>!folders.some(folder=>folder.ItemId===id)))fail(400,'A selected section no longer exists.')}
        const id=route?.[1]||crypto.randomUUID();if(route&&!roles.some(role=>role.id===id))fail(404,'Role not found.');if(!route&&roles.length>=30)fail(400,'Maximum 30 roles.');next.roles=JSON.stringify([...roles.filter(role=>role.id!==id),{id,name:input.name.trim(),color:input.color,priority:input.priority,permissions:input.permissions,policy:input.policy}]);targets=Object.entries(JSON.parse(config.userState||'{}')).filter(([,state])=>state.roleIds?.includes(id)).map(([id])=>id);
      }else if(route&&req.method==='DELETE'){next.roles=JSON.stringify(roles.filter(role=>role.id!==route[1]));const all=JSON.parse(config.userState||'{}');targets=Object.entries(all).filter(([,state])=>state.roleIds?.includes(route[1])).map(([id])=>id);for(const id of targets)all[id].roleIds=all[id].roleIds.filter(value=>value!==route[1]);next.userState=JSON.stringify(all)}else fail(405,'Method not allowed.');
      if(targets.length)await apply(next,targets,actor);else await saveConfig({roles:next.roles||config.roles});json(res,200,{ok:true});
    });await result;return true;
  };
}
