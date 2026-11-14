// Native extension API v1. Modules are trusted, reviewed code shipped with this image.
const registry=new Map();
export function registerPage(page){
  if(!page||!/^extension-[a-z0-9-]{1,40}$/.test(page.id)||typeof page.title!=='string'||page.title.length>40||!['all','admin'].includes(page.role)||typeof page.mount!=='function'||registry.has(page.id))throw Error('Invalid native page registration');
  registry.set(page.id,Object.freeze({...page}));
}
export const pagesFor=user=>[...registry.values()].filter(page=>page.role==='all'||user?.admin);
export const getPage=(id,user)=>pagesFor(user).find(page=>page.id===id);
export async function loadExtensions(){
  const response=await fetch('/extensions/manifest.json');if(!response.ok)throw Error('Could not load the native extension manifest');
  const manifest=await response.json();if(manifest.apiVersion!==1||!Array.isArray(manifest.modules)||manifest.modules.length>30)throw Error('Unsupported native extension manifest');
  await Promise.all(manifest.modules.map(async path=>{if(typeof path!=='string'||!/^\/extensions\/[a-z0-9/-]+\.js$/.test(path))throw Error('Invalid extension module path');const module=await import(path);await module.register(Object.freeze({apiVersion:1,registerPage}))}));
}
