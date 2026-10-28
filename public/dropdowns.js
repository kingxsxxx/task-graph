// Keep real select fields and their existing change handlers; replace only the popup.
let current=null, sequence=0;
const eligible=el=>el instanceof HTMLSelectElement && !el.multiple && el.size<=1 && !el.disabled;
function enhance(root=document){
  for(const select of root.querySelectorAll('select')) if(eligible(select)){
    if(!select.classList.contains('rounded-select'))select.classList.add('rounded-select');select.setAttribute('aria-haspopup','listbox');
    if(current?.select!==select) select.setAttribute('aria-expanded','false');
  }
}
function close(){
  if(!current) return;
  const {select,popup}=current;current=null;
  select.setAttribute('aria-expanded','false');select.removeAttribute('aria-controls');select.removeAttribute('aria-activedescendant');
  popup.remove();
}
function highlight(index){
  if(!current || !current.items.length) return;
  const {items,select}=current;
  current.index=Math.max(0,Math.min(items.length-1,index));
  items.forEach((item,i)=>item.row.classList.toggle('highlighted',i===current.index));
  const row=items[current.index].row;select.setAttribute('aria-activedescendant',row.id);row.scrollIntoView({block:'nearest'});
}
function choose(index){
  if(!current) return;
  const {select,items}=current,item=items[index];if(!item || !select.isConnected || select.disabled) return close();
  const changed=select.selectedIndex!==item.option.index;
  select.selectedIndex=item.option.index;close();select.focus({preventScroll:true});
  if(changed){select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));}
}
function open(select){
  if(!eligible(select)) return;
  if(current?.select===select){close();return;}
  close();select.focus({preventScroll:true});
  const popup=document.createElement('div');popup.id=`select-popup-${++sequence}`;popup.className='select-popup';popup.setAttribute('role','listbox');
  popup.setAttribute('aria-label',select.getAttribute('aria-label') || select.labels?.[0]?.textContent.trim() || '选择选项');
  const items=[];
  for(const option of select.options){
    if(option.hidden) continue;
    const row=document.createElement('div');row.className='select-option';row.id=`${popup.id}-${option.index}`;row.setAttribute('role','option');row.setAttribute('aria-selected',String(option.selected));
    const disabled=option.disabled || option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled;
    row.setAttribute('aria-disabled',String(disabled));row.textContent=option.textContent;row.setAttribute('aria-label',option.textContent);row.tabIndex=-1;
    row.addEventListener('pointerdown',event=>{if(event.pointerType==='mouse')event.preventDefault();});
    if(!disabled){const index=items.length;items.push({option,row});row.addEventListener('click',()=>choose(index));row.addEventListener('pointermove',event=>{if(event.pointerType==='mouse')highlight(index);});}
    popup.append(row);
  }
  const parent=select.closest('dialog[open]') || document.body;
  if(typeof popup.showPopover==='function')popup.setAttribute('popover','manual');
  parent.append(popup);if(popup.hasAttribute('popover'))popup.showPopover();
  current={select,popup,items,index:0,search:'',searchAt:0};
  const rect=select.getBoundingClientRect(),padding=8;
  const width=Math.min(Math.max(rect.width,180),innerWidth-padding*2);
  const below=innerHeight-rect.bottom-padding-6,above=rect.top-padding-6;
  const upward=below<Math.min(popup.scrollHeight,260) && above>below;
  const height=Math.max(40,Math.min(320,upward?above:below,innerHeight-padding*2));
  popup.style.width=`${width}px`;popup.style.maxHeight=`${height}px`;
  popup.style.left=`${Math.max(padding,Math.min(rect.left,innerWidth-width-padding))}px`;
  const popupHeight=Math.min(popup.scrollHeight,height);
  popup.style.top=`${Math.max(padding,Math.min(upward?rect.top-popupHeight-6:rect.bottom+6,innerHeight-popupHeight-padding))}px`;
  select.setAttribute('aria-expanded','true');select.setAttribute('aria-controls',popup.id);
  const selected=items.findIndex(item=>item.option.selected);highlight(Math.max(0,selected));
}
document.addEventListener('pointerdown',event=>{
  const select=event.target.closest?.('select');
  if(eligible(select)){event.preventDefault();open(select);}
  else if(current && !current.popup.contains(event.target))close();
},true);
document.addEventListener('click',event=>{
  if(eligible(event.target.closest?.('select'))){event.preventDefault();if(event.detail===0 && !current)open(event.target.closest('select'));}
},true);
document.addEventListener('keydown',event=>{
  const select=event.target.closest?.('select');if(!eligible(select))return;
  if(['ArrowDown','ArrowUp','Enter',' '].includes(event.key) && !current){event.preventDefault();open(select);return;}
  if(!current || current.select!==select)return;
  if(event.key==='Tab'){close();return;}
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
  if(['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(event.key)){
    event.preventDefault();event.stopPropagation();
    if(event.key==='Enter' || event.key===' ')choose(current.index);
    else highlight(event.key==='Home'?0:event.key==='End'?current.items.length-1:current.index+(event.key==='ArrowDown'?1:-1));
  }else if(event.key.length===1 && !event.ctrlKey && !event.metaKey && !event.altKey){
    event.preventDefault();const now=Date.now();current.search=(now-current.searchAt>700?'':current.search)+event.key.toLocaleLowerCase();current.searchAt=now;
    const index=current.items.findIndex(item=>item.option.textContent.trim().toLocaleLowerCase().startsWith(current.search));if(index>=0)highlight(index);
  }
},true);
document.addEventListener('focusin',event=>{if(current && event.target!==current.select && !current.popup.contains(event.target))close();});
document.addEventListener('scroll',event=>{if(current && !current.popup.contains(event.target))close();},true);
window.addEventListener('resize',close);
document.addEventListener('change',event=>{if(current?.select===event.target)close();},true);
new MutationObserver(records=>{
  if(current && (!current.select.isConnected || current.select.disabled || !current.select.getClientRects().length || current.select.closest('[inert]')))close();
  if(current && records.some(record=>record.type==='attributes' && current.select.contains(record.target) && record.target!==current.select))close();
  enhance();
}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','hidden','inert','style','class','open']});
enhance();
