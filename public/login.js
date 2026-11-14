export function mountLogin({root,api,brandMarkup,escapeHTML:e,onSignIn,message=''}){
  let disposed=false,busy=false,mode='login',artwork=[],imageIndex=0,timer;const controller=new AbortController();
  root.innerHTML=`<div class="login login-cinema"><div class="login-background" aria-hidden="true"><img class="login-backdrop is-visible" alt=""/><img class="login-backdrop" alt=""/></div><div class="login-shade" aria-hidden="true"></div><section class="login-card" aria-label="Sign in"><details class="login-help"><summary aria-label="Sign-in information"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/></svg></summary><p>Use your existing Jellyfin account. To create an account, choose Register and ask an administrator for a registration key.</p></details>${brandMarkup()}<div id="login-fields"></div></section></div>`;
  const fields=root.querySelector('#login-fields'),card=root.querySelector('.login-card');
  function draw(username='',notice=''){
    card.setAttribute('aria-label',mode==='login'?'Sign in':'Register');
    fields.innerHTML=mode==='login'?`<form id="login"><label class="sr-only" for="login-username">Username</label><input class="input" id="login-username" name="username" autocomplete="username" placeholder="Username" required value="${e(username)}"/><label class="sr-only" for="login-password">Password</label><input class="input" id="login-password" name="password" type="password" autocomplete="current-password" placeholder="Password"/><button class="primary">Sign in</button><div class="error" id="login-error" role="status">${e(message)}</div></form><button class="register-link" id="open-registration">Register</button>${notice?`<p class="login-feedback" role="status">${e(notice)}</p>`:''}`:`<form id="register"><h1>Create account</h1><label class="sr-only" for="register-username">New username</label><input class="input" id="register-username" name="username" autocomplete="username" placeholder="New username"/><label class="sr-only" for="register-password">New password</label><input class="input" id="register-password" name="password" type="password" autocomplete="new-password" placeholder="New password"/><label class="sr-only" for="registration-key">Registration key</label><input class="input registration-key-input" id="registration-key" name="key" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Registration key" required/><button class="primary">Create account</button><div class="error" id="register-error" role="status"></div></form><button class="register-link" id="back-to-login">Back to sign in</button>`;
    if(mode==='login'){
      fields.querySelector('#open-registration').onclick=()=>{if(busy)return;mode='register';message='';draw();fields.querySelector('input').focus()};
      fields.querySelector('#login').onsubmit=async event=>{
        event.preventDefault();if(busy)return;busy=true;const button=event.currentTarget.querySelector('button'),values=Object.fromEntries(new FormData(event.currentTarget));button.disabled=true;
        try{await onSignIn(values)}catch(error){if(!disposed)fields.querySelector('#login-error').textContent=error.message}finally{busy=false;if(!disposed)button.disabled=false}
      };
    }else{
      fields.querySelector('#back-to-login').onclick=()=>{if(busy)return;mode='login';draw()};
      fields.querySelector('#register').onsubmit=async event=>{
        event.preventDefault();if(busy)return;busy=true;const form=event.currentTarget,button=form.querySelector('button'),values=Object.fromEntries(new FormData(form));button.disabled=true;
        try{const result=await api('/api/register',{method:'POST',body:JSON.stringify(values)});if(disposed)return;mode='login';message='';draw(values.username,result.requiresApproval?'Account created. An administrator needs to activate it.':'Account created. You can now sign in.')}catch(error){if(!disposed)fields.querySelector('#register-error').textContent=error.message}finally{busy=false;if(!disposed)button.disabled=false}
      };
    }
  }
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  async function showArtwork(){
    if(disposed||!artwork.length)return;if(document.hidden){timer=setTimeout(showArtwork,20000);return}const images=[...root.querySelectorAll('.login-backdrop')],incoming=images[imageIndex%2],outgoing=images[(imageIndex+1)%2],url=artwork[imageIndex%artwork.length];
    const probe=new Image();probe.src=url;try{await probe.decode()}catch{imageIndex++;if(!disposed)timer=setTimeout(showArtwork,20000);return}if(disposed)return;
    incoming.src=url;incoming.classList.add('is-visible');outgoing.classList.remove('is-visible');imageIndex++;
    if(!reduced.matches&&artwork.length>1)timer=setTimeout(showArtwork,20000);
  }
  draw();api('/api/login-page',{signal:controller.signal}).then(data=>{if(disposed)return;artwork=(data.artwork||[]).filter(url=>/^\/api\/login-artwork\/[a-f0-9]{32}$/.test(url));showArtwork()}).catch(()=>{});
  return ()=>{disposed=true;clearTimeout(timer);controller.abort();root.querySelectorAll('.login-backdrop').forEach(image=>image.removeAttribute('src'))};
}
