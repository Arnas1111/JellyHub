export async function mountReviews({root,api,itemId,escapeHTML:e,isCurrent}){
  if(!root)return;
  root.innerHTML='<h2>Community reviews</h2><p class="loader">Loading…</p>';
  const draw=async()=>{
    try{
      const data=await api('/api/reviews/'+encodeURIComponent(itemId));if(!isCurrent())return;
      const own=data.reviews.find(review=>review.own);
      root.innerHTML=`<h2>Community reviews</h2><div class="review-grid">${data.reviews.map(review=>`<article class="review"><div><strong>${e(review.name)}</strong>${review.rating?`<span class="review-rating">${review.rating} / 5</span>`:''}</div><p>${e(review.content)}</p></article>`).join('')||'<p class="muted">Be the first to leave a review.</p>'}</div><form class="review-form"><label>Your rating<select class="input" name="rating"><option value="">No rating</option>${[.5,1,1.5,2,2.5,3,3.5,4,4.5,5].map(rating=>`<option value="${rating}" ${own?.rating===rating?'selected':''}>${rating} / 5</option>`).join('')}</select></label><label>Your review<textarea class="input" name="content" maxlength="2000" rows="4">${e(own?.content||'')}</textarea></label><div class="bar"><button class="primary">Save review</button>${own?'<button class="ghost" type="button" data-delete-review>Remove my review</button>':''}</div><p class="feedback" role="status"></p></form>`;
      const form=root.querySelector('form'),output=form.querySelector('.feedback');
      async function save(method){form.querySelectorAll('button').forEach(button=>button.disabled=true);try{await api('/api/reviews/'+encodeURIComponent(itemId),{method,...(method==='POST'?{body:JSON.stringify({content:form.elements.content.value,rating:form.elements.rating.value?Number(form.elements.rating.value):null})}:{})});if(isCurrent())await draw()}catch(error){output.dataset.state='error';output.textContent=error.message;form.querySelectorAll('button').forEach(button=>button.disabled=false)}}
      form.onsubmit=event=>{event.preventDefault();save('POST')};const remove=form.querySelector('[data-delete-review]');if(remove)remove.onclick=()=>save('DELETE');
    }catch(error){if(isCurrent())root.innerHTML=`<h2>Community reviews</h2><p class="muted">${e(error.message)}</p>`}
  };await draw();
}
