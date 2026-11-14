const tabs=[['general','General'],['users','Users'],['branding','Branding'],['jellyfin','Jellyfin'],['seerr','Seerr'],['sonarr','Sonarr'],['radarr','Radarr'],['jellystat','Jellystat'],['maintainerr','Maintainerr']];
const policyLabels={IsAdministrator:'Administrator',IsDisabled:'Disable account',IsHidden:'Hide from login screen',EnableRemoteAccess:'Allow remote access',EnableMediaPlayback:'Allow playback',EnableContentDownloading:'Allow downloads',EnableAudioPlaybackTranscoding:'Allow audio transcoding',EnableVideoPlaybackTranscoding:'Allow video transcoding',EnableAllFolders:'Allow all libraries'};

export async function renderAdministration(ctx){
  const {state,api,escapeHTML:e,applyBranding}=ctx;
  const revision=state.revision,tab=state.adminTab||'general';
  const current=()=>revision===state.revision;
  document.querySelector('#content').innerHTML=`<div class="breadcrumb">Administration <span aria-hidden="true">›</span> ${e(tabs.find(t=>t[0]===tab)?.[1]||'General')}</div><h1 class="heading">Administration</h1><nav class="admin-tabs" aria-label="Administration sections">${tabs.map(([key,label])=>`<button data-admin-tab="${key}" aria-current="${key===tab?'page':'false'}">${label}</button>`).join('')}</nav><div id="admin-content" class="admin-content"><p class="loader">Loading…</p></div>`;
  document.querySelectorAll('[data-admin-tab]').forEach(btn=>btn.onclick=()=>{state.adminTab=btn.dataset.adminTab;ctx.navigate('admin')});
  const panel=document.querySelector('#admin-content');
  const feedback=(el,text,status='error')=>{el.dataset.state=status;el.textContent=text};
  try{
    if(tab==='users'){
      const data=await api('/api/admin/users');if(!current())return;
      panel.innerHTML=`<h2>Jellyfin users</h2><p class="muted">Manage existing accounts and library access. Changes apply to Jellyfin when you save.</p><div class="user-layout"><div class="user-list" aria-label="Users">${data.users.map(u=>`<button class="ghost" data-user="${e(u.id)}">${e(u.name)}<small>${u.policy.IsAdministrator?'Administrator':u.policy.IsDisabled?'Disabled':'User'}</small></button>`).join('')}</div><div id="user-editor"><p class="muted">Select a user.</p></div></div>`;
      function edit(user){
        const editor=document.querySelector('#user-editor');
        editor.innerHTML=`<h3>${e(user.name)}</h3><form id="rename-user" class="bar"><label>Account name<input class="input" name="name" required maxlength="128" value="${e(user.name)}"/></label><button class="ghost">Rename</button><p class="feedback" role="status"></p></form><form id="user-policy"><fieldset class="policy-options"><legend>Permissions</legend>${Object.entries(policyLabels).map(([key,label])=>`<label class="key-clear"><input type="checkbox" name="${key}" ${user.policy[key]?'checked':''}/><span>${label}</span></label>`).join('')}</fieldset><fieldset id="user-libraries"><legend>Allowed libraries when “Allow all libraries” is off</legend>${data.libraries.map(f=>`<label class="key-clear"><input type="checkbox" name="folder" value="${e(f.id)}" ${(user.policy.EnabledFolders||[]).includes(f.id)?'checked':''}/><span>${e(f.name)}</span></label>`).join('')||'<p>No libraries found.</p>'}</fieldset><button class="primary">Save permissions</button><p class="feedback" role="status"></p></form>`;
        const all=editor.querySelector('[name="EnableAllFolders"]');const libraryBox=document.querySelector('#user-libraries');const sync=()=>libraryBox.disabled=all.checked;all.onchange=sync;sync();
        editor.querySelector('#rename-user').onsubmit=async event=>{
          event.preventDefault();const form=event.currentTarget,btn=form.querySelector('button');btn.disabled=true;
          try{const name=new FormData(form).get('name');await api(`/api/admin/users/${encodeURIComponent(user.id)}/name`,{method:'PUT',body:JSON.stringify({name})});user.name=name;const option=document.querySelector(`[data-user="${CSS.escape(user.id)}"]`);option.firstChild.textContent=name;editor.querySelector('h3').textContent=name;feedback(form.querySelector('[role="status"]'),'Name saved.','success')}
          catch(error){feedback(form.querySelector('[role="status"]'),error.message)}finally{btn.disabled=false}
        };
        editor.querySelector('#user-policy').onsubmit=async event=>{
          event.preventDefault();const form=event.currentTarget,btn=form.querySelector('button');btn.disabled=true;
          const fields=new FormData(form);const policy=Object.fromEntries(Object.keys(policyLabels).map(k=>[k,fields.has(k)]));policy.EnabledFolders=all.checked?user.policy.EnabledFolders:fields.getAll('folder');
          try{await api(`/api/admin/users/${encodeURIComponent(user.id)}`,{method:'PUT',body:JSON.stringify({name:user.name,policy})});user.policy=policy;feedback(form.querySelector('[role="status"]'),'Permissions saved.','success')}
          catch(error){feedback(form.querySelector('[role="status"]'),error.message)}finally{btn.disabled=false}
        };
      }
      document.querySelectorAll('[data-user]').forEach(btn=>btn.onclick=()=>edit(data.users.find(u=>u.id===btn.dataset.user)));return;
    }
    if(tab==='branding'){
      const saved=await api('/api/admin/branding');if(!current())return;
      panel.innerHTML=`<h2>Branding</h2><p class="muted">Customize this frontend for everyone, including the sign-in page.</p><form id="branding-form" class="connection"><label>Browser title<input class="input" name="title" maxlength="80" required value="${e(saved.title)}"/></label><label>Sidebar text<input class="input" name="name" maxlength="40" required value="${e(saved.name)}"/></label><label>Home greeting<input class="input" name="welcome" maxlength="160" required value="${e(saved.welcome)}"/></label><label>Accent color<input name="accent" type="color" value="${e(saved.accent)}"/></label><button class="primary">Save branding</button><p class="feedback" role="status"></p></form><form id="favicon-form" class="connection"><h3>Favicon</h3><img class="favicon-preview" src="${e(saved.favicon)}" alt="Current favicon"/><label>Favicon file<input name="favicon" type="file" accept="image/png,image/x-icon,.ico" required/></label><small class="muted">PNG (up to 512 × 512) or ICO, at most 64 KiB.</small><div class="bar"><button class="primary">Upload favicon</button><button class="ghost" type="button" id="reset-favicon">Reset favicon</button></div><p class="feedback" role="status"></p></form>`;
      document.querySelector('#branding-form').onsubmit=async event=>{
        event.preventDefault();const form=event.currentTarget,btn=form.querySelector('button');btn.disabled=true;
        try{const result=await api('/api/admin/branding',{method:'PUT',body:JSON.stringify(Object.fromEntries(new FormData(form)))});applyBranding(result);feedback(form.querySelector('[role="status"]'),'Branding saved.','success')}
        catch(error){feedback(form.querySelector('[role="status"]'),error.message)}finally{btn.disabled=false}
      };
      async function upload(method,data){
        const form=document.querySelector('#favicon-form');const buttons=[...form.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
        try{const result=await api('/api/admin/branding/favicon',{method,...(data?{body:JSON.stringify({data})}:{})});applyBranding(result);form.querySelector('img').src=result.favicon;feedback(form.querySelector('[role="status"]'),'Favicon saved.','success')}
        catch(error){feedback(form.querySelector('[role="status"]'),error.message)}finally{buttons.forEach(b=>b.disabled=false)}
      }
      document.querySelector('#favicon-form').onsubmit=async event=>{
        event.preventDefault();const file=new FormData(event.currentTarget).get('favicon');
        if(!file?.size||file.size>65536){feedback(event.currentTarget.querySelector('[role="status"]'),'Choose a PNG or ICO file no larger than 64 KiB.');return}
        const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file)});await upload('PUT',data);
      };
      document.querySelector('#reset-favicon').onclick=()=>upload('DELETE');return;
    }
    const saved=await api('/api/admin/settings');if(!current())return;
    panel.innerHTML=`${saved.storage?.writable===false?`<p class="feedback" data-state="error" role="alert">${e(saved.storage.message)}</p>`:''}<h2>${e(tabs.find(t=>t[0]===tab)[1])}</h2>`;
    if(tab==='general'){
      panel.insertAdjacentHTML('beforeend',`<form id="logging" class="connection"><h3>Logging</h3><label>Log level<select class="input" name="level">${saved.logging.levels.map(level=>`<option ${level===saved.logging.level?'selected':''}>${level}</option>`).join('')}</select></label><p class="muted">Debug adds successful requests. Credentials and response bodies are excluded from logs.</p><button class="ghost">Apply log level</button><p class="feedback" role="status"></p></form>`);
      document.querySelector('#logging').onsubmit=async event=>{
        event.preventDefault();const form=event.currentTarget,btn=form.querySelector('button');btn.disabled=true;
        try{const result=await api('/api/admin/logging',{method:'PUT',body:JSON.stringify({level:new FormData(form).get('level')})});feedback(form.querySelector('[role="status"]'),result.persisted?'Log level saved.':result.message,result.persisted?'success':'error')}
        catch(error){feedback(form.querySelector('[role="status"]'),error.message)}finally{btn.disabled=false}
      };return;
    }
    const keyed=['seerr','sonarr','radarr'].includes(tab),key=tab+'Key';
    panel.insertAdjacentHTML('beforeend',`<p class="muted">Test the current fields, then save this integration. A blank key uses its saved value.</p><form id="connections" class="connection"><label>Service URL<input class="input" name="url" type="url" required value="${e(saved.urls[tab+'Url'])}"/></label>${keyed?`<label>API key<input class="input" type="password" name="apiKey" autocomplete="new-password" placeholder="${saved.keys[key]?'Saved; leave empty to keep':'Not configured'}"/></label><label class="key-clear"><input type="checkbox" name="clearKey" ${saved.keys[key]?'':'disabled'}/><span>Clear saved key</span></label>`:''}<div class="bar"><button class="ghost" type="button" id="test-connection">Test connection</button><button class="primary">Save settings</button></div><div id="connection-status" class="feedback" role="status"></div><p id="save-status" class="feedback" role="status"></p></form><div id="integration-data"></div>`);
    const form=document.querySelector('#connections');
    form.onsubmit=async event=>{
      event.preventDefault();const fields=new FormData(form),btn=form.querySelector('.primary');btn.disabled=true;
      try{await api('/api/admin/settings',{method:'PUT',body:JSON.stringify({urls:{[tab+'Url']:fields.get('url')},keys:keyed?{[key]:fields.get('apiKey')}:{},clearKeys:keyed&&fields.has('clearKey')?[key]:[]})});state.cache.clear();if(!current())return;await renderAdministration(ctx);if(current())feedback(document.querySelector('#save-status'),'Settings saved.','success')}
      catch(error){feedback(form.querySelector('#save-status'),error.message)}finally{btn.disabled=false}
    };
    document.querySelector('#test-connection').onclick=async event=>{
      const btn=event.currentTarget,fields=new FormData(form),output=document.querySelector('#connection-status');btn.disabled=true;feedback(output,'Testing…','pending');
      try{
        const result=await api('/api/admin/settings/test',{method:'POST',body:JSON.stringify({service:tab,url:fields.get('url'),...(keyed?{apiKey:fields.get('apiKey'),clearKey:fields.has('clearKey')}:{})})});
        feedback(output,result.status==='connected'?'Connected — save settings to persist any changes.':result.message,result.status==='connected'?'success':'error');
        if(result.diagnostics){const details=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');summary.textContent='Connection details';pre.textContent=Object.entries(result.diagnostics).map(([k,v])=>`${k}: ${v}`).join('\n');details.append(summary,pre);output.append(details)}
      }catch(error){feedback(output,error.message)}finally{btn.disabled=false}
    };
    if(['seerr','sonarr','radarr'].includes(tab)){
      const target=document.querySelector('#integration-data');
      try{const overview=await api('/api/admin/overview?service='+tab);if(!current())return;const entry=overview.integrations.find(i=>i.name===tab);const items=entry?.data?.requests||entry?.data?.records||[];target.innerHTML=`<h3>${tab==='seerr'?'Recent requests':'Download queue'}</h3><p class="muted">${e(entry?.message||entry?.status||'Unavailable')}</p><div class="list">${items.map(item=>`<div class="line">${e(item.title||item.media?.title||'Item '+item.id)}</div>`).join('')||'<div class="line">No entries.</div>'}</div>`}
      catch(error){if(current())target.textContent=error.message}
    }else if(tab==='jellystat')panel.insertAdjacentHTML('beforeend','<p class="notice">Analytics are not implemented. The connection test checks reachability.</p>');
  }catch(error){if(current())panel.innerHTML=`<p class="error">${e(error.message)}</p>`}
}
