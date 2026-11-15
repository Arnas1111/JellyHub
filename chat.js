import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {profileName} from './profiles.js';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const owner=id=>String(id).replaceAll('-','').toLowerCase();
const uuid=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
export function createChat({configDir,getConfig,readBody,json,logger,now=Date.now}){
  const file=path.join(configDir,'chat.json'),rates=new Map();let store={version:1,revision:0,messages:[]},readError,queue=Promise.resolve();
  const ready=(async()=>{try{const stat=await fs.stat(file);if(stat.size>2097152)throw Error('oversized');const data=JSON.parse(await fs.readFile(file,'utf8'));if(data.version!==1||!Number.isSafeInteger(data.revision)||data.revision<0||!Array.isArray(data.messages)||data.messages.length>200||data.messages.some(message=>!uuid(message.id)||typeof message.authorId!=='string'||typeof message.authorName!=='string'||typeof message.text!=='string'||message.text.length>1000||!Number.isFinite(Date.parse(message.createdAt))))throw Error('invalid');store=data}catch(error){if(error.code!=='ENOENT'){readError=true;logger.log('error','chat.read_failed',{code:error.code||'INVALID_CHAT_HISTORY'})}}})();
  const check=async()=>{await ready;if(readError)fail(503,'Chat history could not be read. Ask an administrator to check /config/chat.json.')};
  const revision=user=>crypto.createHash('sha256').update(JSON.stringify([store.revision,user.id,!!user.admin,getConfig().userState])).digest('hex').slice(0,24);
  const dto=(message,user)=>({id:message.id,name:profileName(getConfig(),message.authorId,message.authorName),text:message.text,created:message.createdAt,mine:owner(message.authorId)===owner(user.id),canDelete:!!user.admin||owner(message.authorId)===owner(user.id)});
  async function save(next){const tmp=path.join(configDir,'.chat-'+crypto.randomBytes(10).toString('hex')+'.tmp');try{await fs.mkdir(configDir,{recursive:true});await fs.writeFile(tmp,JSON.stringify(next)+'\n',{mode:0o600,flag:'wx'});await fs.rename(tmp,file);store=next}catch(error){await fs.rm(tmp,{force:true}).catch(()=>{});logger.log('error','chat.save_failed',{code:error.code||'CHAT_NOT_WRITABLE'});fail(503,'Chat history could not be saved. Check that /config is writable. Your message was not saved.')}}
  const mutate=work=>{const result=queue.catch(()=>{}).then(async()=>{await check();return work()});queue=result;return result};
  return async(req,res,url,user)=>{
    if(!url.pathname.startsWith('/api/chat'))return false;
    if(url.pathname==='/api/chat'&&req.method==='GET'){
      await check();await queue.catch(()=>{});const token=revision(user);json(res,200,{revision:token,unchanged:url.searchParams.get('revision')===token,messages:url.searchParams.get('revision')===token?[]:store.messages.map(message=>dto(message,user)),limit:200});return true;
    }
    if(url.pathname==='/api/chat'&&req.method==='POST'){
      const input=await readBody(req,8192);if(Object.keys(input).some(key=>!['text','clientId'].includes(key))||typeof input.text!=='string'||!input.text.trim()||input.text.length>1000||typeof input.clientId!=='string'||!/^[a-f0-9]{32}$/.test(input.clientId))fail(400,'Write a message of up to 1,000 characters.');
      const result=await mutate(async()=>{
        const duplicate=store.messages.find(message=>owner(message.authorId)===owner(user.id)&&message.clientId===input.clientId);if(duplicate)return {message:dto(duplicate,user),revision:revision(user)};
        const key=owner(user.id),time=now();for(const [id,rate]of rates)if(rate.until<=time)rates.delete(id);const rate=rates.get(key)||{count:0,until:time+60000};if(rate.count>=30||rates.size>=2000&&!rates.has(key))fail(429,'You are sending messages too quickly. Try again shortly.');
        const message={id:crypto.randomUUID(),authorId:user.id,authorName:String(profileName(getConfig(),user.id,user.name||'Member')).slice(0,128),text:input.text.trim(),createdAt:new Date(time).toISOString(),clientId:input.clientId};
        await save({version:1,revision:store.revision+1,messages:[...store.messages,message].slice(-200)});rates.set(key,{...rate,count:rate.count+1});return {message:dto(message,user),revision:revision(user)};
      });json(res,201,result);return true;
    }
    const deletion=url.pathname.match(/^\/api\/chat\/messages\/([a-f0-9-]{36})$/);if(deletion&&req.method==='DELETE'){
      const result=await mutate(async()=>{const message=store.messages.find(message=>message.id===deletion[1]);if(!message)fail(404,'Message no longer exists.');if(!user.admin&&owner(message.authorId)!==owner(user.id))fail(403,'You can only delete your own messages.');await save({version:1,revision:store.revision+1,messages:store.messages.filter(message=>message.id!==deletion[1])});return {ok:true,revision:revision(user)}});json(res,200,result);return true;
    }
    return false;
  };
}
