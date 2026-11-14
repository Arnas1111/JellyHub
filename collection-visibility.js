const normalize=value=>String(value||'').replaceAll('-','').toLowerCase();
export function managementIds(config){try{return [...new Set([...JSON.parse(config.managementCollections||'[]'),...JSON.parse(config.hiddenManagementCollections||'[]')])].filter(value=>typeof value==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(value))}catch{return []}}
export const isManagementCollection=(id,config)=>managementIds(config).some(value=>normalize(value)===normalize(id));
