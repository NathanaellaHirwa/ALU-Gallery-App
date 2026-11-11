// Interaction polish layered over the initial gallery screens.
const originalRender = window.__aluBaseRender;
const defaultConversations = {
  'University of Ghana': db.messages,
  'Amara Nkurunziza': [{text:'I have uploaded a new piece for the upcoming exhibition.',mine:false},{text:'Thank you. It is now in the review queue.',mine:true}],
  'ALU Gallery Team': [{text:'The exhibition brief is ready to share with partner institutions.',mine:false}]
};
let conversations = JSON.parse(localStorage.getItem('aluGalleryConversations') || 'null') || defaultConversations;
let activeConversation = 'University of Ghana';
let notifications = JSON.parse(localStorage.getItem('aluGalleryNotifications') || 'null') || [];

function persist() {
  try { save(); localStorage.setItem('aluGalleryConversations', JSON.stringify(conversations)); localStorage.setItem('aluGalleryNotifications', JSON.stringify(notifications)); }
  catch { toast('Browser storage is full. Try a smaller image or remove older records.'); }
}
function addNotification(text) { notifications.unshift({text, date:new Date().toLocaleString(), read:false}); persist(); }
function showArtwork(art) {
  document.querySelector('#modal').innerHTML=`<div class="modalback" id="backdrop"><section class="modal artdetail" role="dialog" aria-modal="true" aria-labelledby="detailTitle"><button class="detailclose" aria-label="Close" data-close>×</button><img src="${esc(art.image)}" alt="Artwork: ${esc(art.title)}"><div class="detailcopy"><div class="eyebrow">${esc(art.category)}</div><h2 id="detailTitle">${esc(art.title)}</h2><p class="detailartist">By ${esc(art.artist)}</p><p>${esc(art.description||'A work from the ALU Gallery collection.')}</p>${art.medium?`<p><b>Medium</b> · ${esc(art.medium)}</p>`:''}</div></section></div>`;
  document.querySelector('#backdrop').onclick=e=>{if(e.target.id==='backdrop'||e.target.closest('[data-close]'))close();};
}
function showNotifications() {
  const list=notifications.length?notifications.slice(0,10).map(n=>`<div class="notificationrow"><i class="readmark ${n.read?'read':''}"></i><div><b>${esc(n.text)}</b><small>${esc(n.date)}</small></div></div>`).join(''):'<div class="empty">You are all caught up.</div>';
  document.querySelector('#modal').innerHTML=`<div class="modalback" id="backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="noticeTitle"><div class="panelhead"><h2 id="noticeTitle">Notifications</h2><button class="textbtn" id="clearNotices">Clear all</button></div>${list}<div class="formactions"><button class="btn outline" data-close>Close</button></div></section></div>`;
  notifications.forEach(n=>n.read=true);persist();document.querySelector('#backdrop').onclick=e=>{if(e.target.id==='backdrop'||e.target.closest('[data-close]'))close();};document.querySelector('#clearNotices').onclick=()=>{notifications=[];persist();showNotifications();render();};render();
}
function permitted(item) {
  const p=item.dataset.page;
  if(role==='Gallery admin') return true;
  if(role==='Institution admin') return ['Home','Gallery','Artists','Exhibitions','Institutions','Events','Dashboard','Submissions','Collaborations','Messages'].includes(p);
  if(role==='Artist') return ['Home','Gallery','Artists','Exhibitions','Institutions','Events','Submissions','Messages'].includes(p);
  return ['Home','Gallery','Artists','Exhibitions','Institutions','Events'].includes(p);
}
function render() {
  originalRender();
  document.querySelectorAll('.navbtn').forEach(item=>item.hidden=!permitted(item));
  if(role==='Institution admin'&&page==='Gallery') document.querySelector('.pagehead')?.insertAdjacentHTML('beforeend','<button class="btn" data-inst-submit>＋ Submit institutional artwork</button>');
  const badge=document.querySelector('#notif .dot');
  if(badge) badge.hidden=!notifications.some(n=>!n.read);
}

function submissionTable(rows,actions=false) {
  return `<div class="tablewrap"><table><thead><tr><th>Artwork</th><th>Artist</th><th>Exhibition</th><th>Date</th><th>Status</th>${actions?'<th>Review</th>':''}</tr></thead><tbody>${rows.map((s,i)=>`<tr><td>${esc(s.title)}</td><td>${esc(s.artist)}</td><td>${esc(s.exhibition)}</td><td>${esc(s.date||'Today')}</td><td>${stat(s.status)}${s.feedback?`<small class="reviewfeedback">${esc(s.feedback)}</small>`:''}</td>${actions?`<td class="reviewactions"><button class="textbtn" data-review-status="${i}" data-status="Approved">Approve</button><button class="textbtn" data-review-status="${i}" data-status="Changes requested">Request changes</button><button class="textbtn" data-review-status="${i}" data-status="Rejected">Reject</button></td>`:''}</tr>`).join('')||'<tr><td colspan="6">No submissions yet.</td></tr>'}</tbody></table></div>`;
}
function messages() {
  const msgs=conversations[activeConversation]||[];
  return `${head('Private workspace','Messages','Conversations with artists and partner institutions.')}<div class="panel messages"><div>${Object.keys(conversations).map(name=>`<div class="thread ${activeConversation===name?'active':''}" data-thread-name="${esc(name)}"><b>${esc(name)}</b><small>${esc((conversations[name].at(-1)||{}).text||'No messages yet')}</small></div>`).join('')}</div><div class="chat"><div id="bubbles">${msgs.map(m=>`<div class="bubble ${m.mine?'mine':''}">${esc(m.text)}<small>${m.date?' · '+esc(m.date):''}</small></div>`).join('')||'<p class="empty">Start the conversation.</p>'}</div><form class="chatform" id="chatform"><input name="message" placeholder="Write a message…" required maxlength="1000"><button class="btn small">Send</button></form></div></div>`;
}
const originalModal=modal;
function modal(type) {
  originalModal(type);
  const form=document.querySelector('#modalform');
  if(!form) return;
  if(type==='art') {
    form.onsubmit=null;
    const imageField=[...form.querySelectorAll('.field')].find(f=>f.querySelector('[name="image"]'));
    if(imageField) imageField.innerHTML='<label>Artwork image (JPEG, PNG, WebP · max 2 MB)</label><input name="imageFile" type="file" accept="image/jpeg,image/png,image/webp" required>';
    const file=form.querySelector('[name="imageFile"]');
    file?.addEventListener('change',()=>{const f=file.files[0];if(f&&f.size>2*1024*1024){file.value='';toast('Please choose an image under 2 MB.');}});
  }
  if(type==='submission') {
    form.onsubmit=null;
    const title=form.querySelector('[name="title"]');
    if(title){const select=document.createElement('select');select.name='title';select.required=true;const items=db.artworks.filter(a=>a.status==='Published'||a.status==='Pending review');select.innerHTML=items.map(a=>`<option>${esc(a.title)}</option>`).join('');title.replaceWith(select);}
    const exhibition=form.querySelector('[name="exhibition"]');
    if(exhibition){const select=document.createElement('select');select.name='exhibition';select.required=true;select.innerHTML=db.exhibitions.filter(e=>/submission/i.test(e.status)).map(e=>`<option>${esc(e.title)}</option>`).join('');if(!select.options.length)select.innerHTML='<option>General submission</option>';exhibition.replaceWith(select);}
    const artist=form.querySelector('[name="artist"]');
    if(artist&&role==='Artist'){artist.value='Amara Nkurunziza';artist.readOnly=true;}
  }
  form.addEventListener('submit',async e=>{
    if(type==='art') {
      e.preventDefault(); const f=form.querySelector('[name="imageFile"]')?.files[0]; if(!f)return;
      if(f.size>2*1024*1024){toast('Please choose an image under 2 MB.');return;}
      const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=reject;reader.onload=()=>resolve(reader.result);reader.readAsDataURL(f);});
      const values=Object.fromEntries(new FormData(form));db.artworks.unshift({title:values.title,artist:values.artist,category:values.category||'Painting',description:values.description,image:data,status:'Pending review'});persist();close();render();toast('Artwork submitted. It will appear in the public gallery after approval.');
    }
    if(type==='submission') {
      e.preventDefault();const values=Object.fromEntries(new FormData(form));
      db.submissions.unshift({...values,artist:values.artist||(role==='Artist'?'Amara Nkurunziza':'Institution team'),institution:role==='Institution admin'?'African Leadership University':undefined,status:'Submitted',date:new Date().toLocaleDateString()});
      addNotification(`${values.title}: submission received.`);close();render();toast('Submission sent for review.');
    }
  },{once:true});
}

// Keep the institution and artist views scoped to their own workspaces.
const originalSubmissions=window.__aluBaseSubmissions;
function submissions() {
  if(role==='Institution admin') {const own=db.submissions.filter(s=>s.institution==='African Leadership University');return `${head('Institution workspace','Submissions','Artwork submitted by your institution.')}<div class="panel"><div class="panelhead"><h3>Institution activity</h3></div><div id="subtable">${submissionTable(own, false)}</div></div>`;}
  return originalSubmissions();
}
collabs=function() {
  const actions=role==='Gallery admin';
  return `${head('Phase 2 · Collaboration','Working together','Build meaningful artistic partnerships across institutions.',role==='Institution admin'?'<button class="btn" data-modal="collab">＋ Propose collaboration</button>':'')}<div class="collabcall"><div><h3>Good art travels further together.</h3><p>Connect with partner institutions and create exhibitions that cross borders.</p></div><button class="btn" style="background:white;color:#102a43" data-modal="collab">Start a conversation</button></div><div class="panel"><div class="panelhead"><h3>Partnership requests</h3></div><div class="tablewrap"><table><thead><tr><th>Institution</th><th>Request</th><th>Details</th><th>Status</th>${actions?'<th>Action</th>':''}</tr></thead><tbody>${db.requests.map((r,i)=>`<tr><td>${esc(r.institution)}</td><td>${esc(r.type)}</td><td>${esc(r.detail)}</td><td>${stat(r.status)}</td>${actions?`<td><button class="textbtn" data-request-status="${i}" data-status="Accepted">Accept</button><button class="textbtn" data-request-status="${i}" data-status="Declined">Decline</button></td>`:''}</tr>`).join('')||'<tr><td colspan="5">No requests yet.</td></tr>'}</tbody></table></div></div><div class="panel"><div class="panelhead"><h3>Partner network</h3><button class="textbtn" data-go="Institutions">Browse institutions →</button></div><div class="grid">${db.institutions.map(i=>`<div><b>${esc(i.name)}</b><p>${esc(i.location)}</p></div>`).join('')}</div></div>`;
};
function installStyles() {
  const style=document.createElement('style');
  style.textContent='.navbtn[hidden]{display:none!important}.navbtn>svg{width:17px;height:17px;flex:none}.navbtn span:first-child{display:none}.reviewactions{white-space:nowrap}.reviewactions .textbtn{padding:4px 6px}.reviewactions .textbtn:last-child{color:var(--red)}.reviewfeedback{display:block;color:var(--muted);font-size:9px;margin-top:5px}.thread{overflow-wrap:anywhere}.thread.active{border-left:2px solid var(--red)}.bubble small{display:block;font-size:8px;opacity:.7;margin-top:5px}.iconbtn{font-size:0}.iconbtn svg{width:15px;height:15px}.instcard,.artcard,.panel{transition:box-shadow .18s ease,transform .18s ease}.artcard:focus-visible,.navbtn:focus-visible,button:focus-visible{outline:2px solid #b2606c;outline-offset:2px}.artdetail{padding:0;overflow:hidden;position:relative;display:grid;grid-template-columns:1.1fr 1fr;width:min(820px,100%)}.artdetail>img{width:100%;height:100%;min-height:390px;max-height:75vh;object-fit:cover;background:#e9e7e3}.detailcopy{padding:35px 28px;align-self:center}.detailcopy h2{font-size:29px;margin:10px 0 4px}.detailcopy p{font-size:12px;line-height:1.8;color:var(--muted)}.detailcopy .detailartist{color:var(--navy);font-weight:600}.detailclose{position:absolute;right:12px;top:12px;border:0;background:#fff;color:var(--navy);font-size:22px;width:32px;height:32px;border-radius:50%}.notificationrow{display:flex;gap:10px;padding:13px 0;border-bottom:1px solid var(--line)}.notificationrow b{font-size:11px;color:var(--navy)}.notificationrow small{display:block;color:var(--muted);font-size:9px;margin-top:4px}.readmark{width:7px;height:7px;border-radius:50%;background:var(--red);margin:4px 3px;flex:none}.readmark.read{background:#ccd3d7}@media(max-width:600px){.artdetail{grid-template-columns:1fr}.artdetail>img{height:40vh;min-height:190px}.detailcopy{padding:23px}}@media(max-width:760px){.navbtn span{display:none}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition:none!important}}';
  document.head.appendChild(style);
}
installStyles();
const navIcons=[['M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1z'],['M3 3h18v18H3z','M8 8h.01','m21 15-5-5L5 21'],['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8','M5 21a7 7 0 0 1 14 0'],['M4 4h16v16H4z','M8 8h8M8 12h8M8 16h5'],['M3 9l9-6 9 6M5 10v9m5-9v9m4-9v9m5-9v9M3 21h18'],['M4 5h16v16H4z','M8 3v4m8-4v4M4 10h16'],['M3 3h8v8H3z','M13 3h8v5h-8z','M13 10h8v11h-8z','M3 13h8v8H3z'],['M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4'],['M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6','M17 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6','M2 21a6 6 0 0 1 12 0m-1 0a5 5 0 0 1 10 0'],['M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z']];
document.querySelectorAll('.navbtn').forEach((b,i)=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.6');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');for(const d of navIcons[i]){const p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d',d);svg.appendChild(p);}b.prepend(svg);});
const oldRoleChange=document.querySelector('#roleSelect').onchange;
document.querySelector('#roleSelect').onchange=e=>{role=e.target.value;localStorage.setItem('aluRole',role);if(!permitted(document.querySelector(`[data-page="${page}"]`))){page='Home';}render();toast(`Workspace preview: ${role}`);};
document.querySelector('#notif').onclick=showNotifications;
document.addEventListener('click',e=>{
  if(e.target.closest('[data-inst-submit]')){modal('submission');return;}
  const review=e.target.closest('[data-review-status]');
  if(review){const s=db.submissions[Number(review.dataset.reviewStatus)],status=review.dataset.status;if(s){s.status=status;if(status==='Approved'){const artwork=db.artworks.find(a=>a.title===s.title);if(artwork)artwork.status='Published';}s.reviewedAt=new Date().toLocaleString();s.feedback=status==='Changes requested'?'Please update the artwork details and resubmit.':'';addNotification(`${s.title}: ${status.toLowerCase()}.`);render();toast(`Submission ${status.toLowerCase()}.`);}return;}
  const thread=e.target.closest('[data-thread-name]');
  if(thread){activeConversation=thread.dataset.threadName;render();}
  const request=e.target.closest('[data-request-status]');
  if(request){const record=db.requests[Number(request.dataset.requestStatus)];if(record){record.status=request.dataset.status;addNotification(`${record.institution}: collaboration ${record.status.toLowerCase()}.`);render();toast(`Request ${record.status.toLowerCase()}.`);}return;}
  const art=e.target.closest('.artcard');
  if(art&&!e.target.closest('button')){const title=art.querySelector('h3')?.textContent,a=db.artworks.find(x=>x.title===title);if(a)showArtwork(a);}
});
document.addEventListener('submit',e=>{
  if(e.target.id==='chatform'){e.preventDefault();const text=new FormData(e.target).get('message')?.trim();if(!text)return;(conversations[activeConversation] ||= []).push({text,mine:true,date:new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})});persist();render();}
});
const baseBind=bind;
bind=function(){baseBind();const chat=document.querySelector('#chatform');if(chat)chat.onsubmit=null;document.querySelectorAll('[data-thread-name]').forEach(b=>b.onclick=()=>{activeConversation=b.dataset.threadName;render();});document.querySelectorAll('[data-submit]').forEach(b=>b.onclick=()=>role==='Artist'?modal('submission'):toast('Choose the Artist workspace preview to submit artwork.'));};
render();
document.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
