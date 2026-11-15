import {createUIId} from './choices.js';
export function mountChat({root,api,escapeHTML:e,getDraft,onDraft,getAttempt,onAttempt}){
  let disposed=false,timer,busy=false,revision='',sending=false,first=true;const controller=new AbortController(),nodes=new Map();
  root.innerHTML='<section class="chat-room"><div class="library-heading"><div><h1 class="heading">Chat</h1><p class="muted">A shared room for everyone signed in. The latest 200 messages are saved.</p></div><button class="ghost" id="refresh-chat">Refresh</button></div><ol class="chat-messages" aria-label="Chat messages" role="log" aria-live="polite" aria-relevant="additions"><li class="loader chat-placeholder">Loading chat…</li></ol><button class="chat-new-messages ghost" hidden>New messages</button><form id="chat-compose"><label class="sr-only" for="chat-text">Message</label><textarea class="input" id="chat-text" name="text" maxlength="1000" rows="2" placeholder="Write a message…"></textarea><div class="chat-compose-actions"><span class="muted">Enter to send · Shift+Enter for a new line</span><button class="primary" id="send-chat" disabled>Send</button></div></form><p class="feedback chat-feedback" role="status"></p></section>';
  const list=root.querySelector('.chat-messages'),input=root.querySelector('#chat-text'),form=root.querySelector('#chat-compose'),send=root.querySelector('#send-chat'),feedback=root.querySelector('.chat-feedback'),refresh=root.querySelector('#refresh-chat'),newButton=root.querySelector('.chat-new-messages');input.value=getDraft()||'';
  const updateSend=()=>{send.disabled=sending||!input.value.trim()};updateSend();
  const bottom=()=>{list.scrollTop=list.scrollHeight;newButton.hidden=true};newButton.onclick=bottom;list.onscroll=()=>{if(list.scrollHeight-list.clientHeight-list.scrollTop<80)newButton.hidden=true};
  const error=message=>{feedback.dataset.state='error';feedback.textContent=message};
  function messageNode(message){
    let row=nodes.get(message.id);if(!row){row=document.createElement('li');row.className='chat-message';row.dataset.messageId=message.id;nodes.set(message.id,row);list.append(row)}
    const signature=JSON.stringify(message);if(row.dataset.signature===signature)return;row.dataset.signature=signature;row.classList.toggle('is-mine',message.mine);
    row.innerHTML=`<span class="chat-avatar" aria-hidden="true">${e(Array.from(message.name)[0]||'?')}</span><div class="chat-message-copy"><header><strong>${e(message.name)}</strong><time datetime="${e(message.created)}" title="${e(new Date(message.created).toLocaleString())}">${e(new Date(message.created).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}))}</time>${message.canDelete?`<button class="chat-delete" type="button" data-delete="${e(message.id)}" aria-label="Delete message by ${e(message.name)}">Delete</button>`:''}</header><p>${e(message.text)}</p></div>`;
  }
  function apply(messages){
    const nearBottom=first||list.scrollHeight-list.scrollTop-list.clientHeight<80,ids=new Set(messages.map(message=>message.id));list.querySelectorAll('.chat-placeholder').forEach(node=>node.remove());
    for(const [id,node]of nodes)if(!ids.has(id)){node.remove();nodes.delete(id)}for(const message of messages)messageNode(message);
    if(!messages.length&&!list.children.length){const empty=document.createElement('li');empty.className='chat-placeholder muted';empty.textContent='No messages yet. Say hello.';list.append(empty)}
    if(nearBottom)bottom();else newButton.hidden=false;first=false;
  }
  async function load(){
    if(disposed||busy)return;clearTimeout(timer);if(document.hidden){timer=setTimeout(load,3000);return}busy=true;refresh.disabled=true;
    try{const data=await api('/api/chat'+(revision?'?revision='+encodeURIComponent(revision):''),{signal:controller.signal});if(disposed)return;if(!data.unchanged)apply(data.messages);revision=data.revision;if(feedback.dataset.state==='refresh-error')feedback.textContent=''}
    catch(failure){if(!disposed){if(failure.status===401||failure.status===403){list.replaceChildren();nodes.clear()}feedback.dataset.state='refresh-error';feedback.textContent='Chat could not refresh: '+failure.message}}
    finally{busy=false;if(!disposed){refresh.disabled=false;timer=setTimeout(load,3000)}}
  }
  refresh.onclick=()=>{revision='';load()};
  input.oninput=()=>{onDraft(input.value);updateSend()};input.onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();if(!send.disabled)form.requestSubmit()}};
  form.onsubmit=async event=>{
    event.preventDefault();if(sending||!input.value.trim())return;const text=input.value,prior=getAttempt(),attempt=prior?.text===text?prior:{text,clientId:createUIId()};onAttempt(attempt);sending=true;updateSend();feedback.textContent='Sending…';feedback.dataset.state='pending';
    try{const data=await api('/api/chat',{method:'POST',body:JSON.stringify({text,clientId:attempt.clientId})});if(getAttempt()?.clientId===attempt.clientId)onAttempt(null);if(getDraft()===text)onDraft('');if(disposed)return;
      if(input.value===text)input.value='';list.querySelectorAll('.chat-placeholder').forEach(node=>node.remove());messageNode(data.message);bottom();revision='';feedback.dataset.state='success';feedback.textContent='';load();input.focus();
    }catch(failure){if(!disposed)error(failure.message)}finally{sending=false;if(!disposed)updateSend()}
  };
  const deletion=async event=>{const button=event.target.closest('[data-delete]');if(!button||button.disabled)return;button.disabled=true;try{await api('/api/chat/messages/'+button.dataset.delete,{method:'DELETE'});if(!disposed){revision='';load()}}catch(failure){if(!disposed){error(failure.message);button.disabled=false}}};root.addEventListener('click',deletion);load();
  return ()=>{disposed=true;clearTimeout(timer);controller.abort();root.removeEventListener('click',deletion)};
}
