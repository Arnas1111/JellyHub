export function mountChoice(root,{name,label,options,value='',onChange=()=>{}}){
  const controller=new AbortController();let choices=options,current=String(value),open=false;
  root.classList.add('choice');const input=document.createElement('input');input.type='hidden';input.name=name;input.value=current;
  const button=document.createElement('button');button.type='button';button.className='choice-trigger';button.setAttribute('role','combobox');button.setAttribute('aria-label',label);button.setAttribute('aria-haspopup','listbox');
  const menu=document.createElement('div');menu.className='choice-menu';menu.setAttribute('role','listbox');menu.setAttribute('aria-label',label+' options');menu.id='choice-'+crypto.randomUUID();button.setAttribute('aria-controls',menu.id);root.replaceChildren(input,button,menu);
  const close=()=>{open=false;menu.hidden=true;button.setAttribute('aria-expanded','false')};
  function draw(){button.textContent=choices.find(option=>String(option.value)===current)?.label||current||label;menu.replaceChildren();for(const option of choices){const item=document.createElement('button');item.type='button';item.setAttribute('role','option');item.setAttribute('aria-selected',String(String(option.value)===current));item.textContent=option.label;item.onclick=()=>{current=String(option.value);input.value=current;draw();close();button.focus();onChange(current)};menu.append(item)}close()}
  const show=()=>{open=true;menu.hidden=false;button.setAttribute('aria-expanded','true');(menu.querySelector('[aria-selected="true"]')||menu.querySelector('button'))?.focus()};button.onclick=()=>open?close():show();
  button.onkeydown=event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();show()}};
  menu.onkeydown=event=>{const items=[...menu.querySelectorAll('button')],index=items.indexOf(document.activeElement);if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const target=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[target]?.focus()}else if(event.key==='Escape'){event.preventDefault();close();button.focus()}else if(event.key==='Tab')close()};
  document.addEventListener('pointerdown',event=>{if(!root.contains(event.target))close()},{signal:controller.signal});draw();
  return {setOptions(next){choices=next;draw()},setValue(next){current=String(next);input.value=current;draw()},get value(){return current},dispose(){controller.abort();close()}};
}
