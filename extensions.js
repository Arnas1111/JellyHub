const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
export function validateNavigation(value){
  if(!Array.isArray(value)||value.length>20)fail(400,'Configure at most 20 navigation links.');
  const ids=new Set();return value.map(item=>{
    if(!item||typeof item!=='object'||typeof item.id!=='string'||!/^link-[a-z0-9-]{1,40}$/.test(item.id)||ids.has(item.id)||typeof item.title!=='string'||!item.title.trim()||item.title.length>40||!['all','admin'].includes(item.role))fail(400,'Each link needs a unique link- ID, title and all/admin role.');
    let url;try{url=new URL(item.url)}catch{fail(400,'Navigation URLs must be full HTTP(S) URLs.')}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.href.length>2048)fail(400,'Navigation URLs must use HTTP(S) without embedded credentials.');ids.add(item.id);return {id:item.id,title:item.title.trim(),url:url.href,role:item.role};
  });
}
export function createExtensions({getConfig,saveConfig,readBody,json}){
  const links=()=>{try{return validateNavigation(JSON.parse(getConfig().navigation||'[]'))}catch{return []}};
  return async(req,res,url,user)=>{
    if(url.pathname==='/api/navigation'&&req.method==='GET'){json(res,200,{links:links().filter(link=>link.role==='all'||user.admin)});return true}
    if(url.pathname==='/api/admin/navigation'){
      if(!user.admin)fail(403,'Administrator required');
      if(req.method==='GET'){json(res,200,{links:links()});return true}
      if(req.method==='PUT'){const input=await readBody(req,65536),value=validateNavigation(input.links);await saveConfig({navigation:JSON.stringify(value)});json(res,200,{links:value});return true}
    }
    return false;
  };
}
