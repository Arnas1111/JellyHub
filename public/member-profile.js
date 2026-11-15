import {adminCrown} from './avatars.js';
let opening=0;
export async function openMember({id,api,escapeHTML:e,onMessage,onItem,isCurrent=()=>true}){
  const request=++opening;
  document.querySelector('.member-dialog')?.remove();
  const dialog=document.createElement('dialog');dialog.className='member-dialog';dialog.innerHTML='<button class="dialog-close ghost" aria-label="Close profile">×</button><div class="member-body"><p class="loader">Loading profile…</p></div>';
  const close=()=>dialog.remove();dialog.querySelector('.dialog-close').onclick=close;dialog.oncancel=close;dialog.onclick=event=>{if(event.target===dialog)close()};
  try{const person=await api('/api/chat/profiles/'+encodeURIComponent(id));if(request!==opening||!isCurrent())return;
    dialog.querySelector('.member-body').innerHTML=`<div class="member-banner"></div><div class="member-identity"><span class="avatar-wrap member-avatar-wrap"><img class="member-avatar" src="${e(person.avatar)}" alt=""/>${adminCrown(person.admin)}</span><h2>${e(person.name)}</h2><div class="member-roles">${person.roles.map(role=>`<span data-role-color="${e(role.color)}">${e(role.name)}</span>`).join('')}</div>${person.canMessage?'<button class="primary" id="member-message">Message</button>':''}<h3>Recently watched</h3>${person.historyShared?(person.recent.length?`<ul class="member-history">${person.recent.map(item=>`<li><button data-history-item="${e(item.id)}">${item.image?`<img src="/api/image/${encodeURIComponent(item.id)}" alt=""/>`:''}<span>${e(item.title)}${item.series?`<small>${e(item.series)}</small>`:''}${item.played?`<small>${e(new Date(item.played).toLocaleDateString())}</small>`:''}</span></button></li>`).join('')}</ul>`:'<p class="muted">No watched titles to show.</p>'):'<p class="muted">Watch history is private or unavailable.</p>'}<p class="feedback" role="status"></p></div>`;
    dialog.querySelectorAll('[data-role-color]').forEach(node=>node.style.setProperty('--role-color',/^#[a-f0-9]{6}$/i.test(node.dataset.roleColor)?node.dataset.roleColor:'#9980ff'));
    dialog.querySelector('.member-avatar').onerror=event=>event.currentTarget.style.visibility='hidden';
    const message=dialog.querySelector('#member-message');if(message)message.onclick=async()=>{message.disabled=true;try{const conversation=await api('/api/chat/direct',{method:'POST',body:JSON.stringify({memberId:id})});close();onMessage(conversation.id)}catch(error){dialog.querySelector('.feedback').textContent=error.message;message.disabled=false}};
    document.body.append(dialog);dialog.showModal();
    dialog.querySelectorAll('[data-history-item]').forEach(button=>button.onclick=()=>{close();onItem(button.dataset.historyItem)});
  }catch(error){if(request!==opening||!isCurrent())return;dialog.querySelector('.member-body').textContent=error.message;document.body.append(dialog);dialog.showModal()}
}
