const AdminAPI = {
  async request(path, options={}) {
    const response=await fetch(path,{credentials:'same-origin',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||`تعذر إكمال الطلب (${response.status})`);
    return data;
  }
};
const $=id=>document.getElementById(id);
const escAdmin=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateText=v=>{const d=new Date(String(v||'').replace(' ','T')+'Z');return Number.isNaN(+d)?'—':d.toLocaleString('ar-MA',{dateStyle:'short',timeStyle:'short'});};
const state={messages:[],services:[],projects:[],settings:{},username:'',avatar:'',modalId:null,setup:false,projectFile:null,previewUrl:null};
function notice(message){const n=$('notice');n.textContent=message;n.classList.add('show');clearTimeout(notice.timer);notice.timer=setTimeout(()=>n.classList.remove('show'),3200);}
function showError(target,message){target.textContent=message;}

async function boot(){
  try{
    const status=await AdminAPI.request('/api/setup/status');
    state.setup=status.needsSetup;
    configureAuth();
    const me=await AdminAPI.request('/api/auth/me');
    if(me.authenticated){state.username=me.username;state.avatar=me.avatar||'';await showAdmin();}
  }catch(error){$('loginTitle').textContent='تعذر الاتصال بالخادم';$('loginDesc').textContent='تأكد من تشغيل الخادم ثم أعد تحميل الصفحة.';showError($('authError'),error.message);}
}
function configureAuth(){
  $('loginTitle').textContent=state.setup?'إنشاء حساب المدير':'تسجيل الدخول';
  $('loginDesc').textContent=state.setup?'هذه خطوة الإعداد الأولى. اختر بيانات دخول آمنة.':'أدخل بيانات حساب الإدارة.';
  $('authButton').textContent=state.setup?'إنشاء الحساب والدخول':'دخول';
  $('confirmField').classList.toggle('hidden',!state.setup);
  $('setupSecretField').classList.toggle('hidden',!state.setup);
  $('setupNote').classList.toggle('hidden',!state.setup);
  $('authPass').autocomplete=state.setup?'new-password':'current-password';
}
$('authForm').addEventListener('submit',async e=>{
  e.preventDefault();showError($('authError'),'');
  const username=$('authUser').value.trim(),password=$('authPass').value;
  if(state.setup&&password!==$('authConfirm').value)return showError($('authError'),'كلمتا المرور غير متطابقتين');
  if(state.setup&&password.length<12)return showError($('authError'),'كلمة المرور يجب أن تكون 12 حرفاً على الأقل');
  $('authButton').disabled=true;
  try{
    const headers=state.setup&&$('setupSecret').value?{'x-hadir-setup-key':$('setupSecret').value}:{};
    const data=await AdminAPI.request(state.setup?'/api/setup':'/api/auth/login',{method:'POST',headers,body:JSON.stringify({username,password})});
    state.username=data.username;state.avatar=data.avatar||'';state.setup=false;await showAdmin();
  }catch(error){showError($('authError'),error.message);}
  finally{$('authButton').disabled=false;}
});
async function showAdmin(){
  $('loginScreen').style.display='none';$('app').style.display='block';$('adminName').textContent=`مرحباً، ${state.username}`;renderAvatar();
  try{await loadAll();await loadBackups();}catch(error){notice(error.message);}
}
$('logoutMenuBtn').addEventListener('click',async()=>{try{await AdminAPI.request('/api/auth/logout',{method:'POST'});}catch{}location.reload();});

function renderAvatar(){const initial=(state.username[0]||'ح').toUpperCase();for(const el of [$('userAvatar'),$('avatarPreview')]){if(!el)continue;if(state.avatar){el.style.backgroundImage=`url(${state.avatar})`;el.style.backgroundSize='cover';el.style.backgroundPosition='center';el.textContent='';}else{el.style.backgroundImage='';el.textContent=initial;}}}

// تغيير الصورة الشخصية
async function pickAvatar(file){
 if(!file)return;
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>4*1024*1024)return notice('اختر صورة PNG أو JPG أو WebP بحجم لا يتجاوز 4 MB');
 try{
  const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('تعذرت قراءة الملف'));reader.readAsDataURL(file);});
  const res=await AdminAPI.request('/api/admin/uploads',{method:'POST',body:JSON.stringify({data})});
  await AdminAPI.request('/api/admin/avatar',{method:'POST',body:JSON.stringify({avatar:res.url})});
  state.avatar=res.url;renderAvatar();notice('تم تحديث الصورة الشخصية ✅');
 }catch(err){notice(err.message);}
}
$('avatarPick').addEventListener('click',()=>$('avatarFile').click());
$('avatarFile').addEventListener('change',e=>{pickAvatar(e.target.files[0]).finally(()=>{$('avatarFile').value='';});});
$('avatarClear').addEventListener('click',async()=>{try{await AdminAPI.request('/api/admin/avatar',{method:'POST',body:JSON.stringify({avatar:''})});state.avatar='';renderAvatar();notice('أُعيدت الصورة الافتراضية');}catch(err){notice(err.message);}});

// قائمة الحساب المنسدلة (الشريحة أعلى اليسار)
function setUserMenu(open){$('userDropdown').classList.toggle('hidden',!open);$('userChip').setAttribute('aria-expanded',String(open));}
$('userChip').addEventListener('click',e=>{e.stopPropagation();setUserMenu($('userDropdown').classList.contains('hidden'));});
document.addEventListener('click',e=>{if(!e.target.closest||!e.target.closest('.user-menu-wrap'))setUserMenu(false);});
document.addEventListener('keydown',e=>{if(e.key==='Escape')setUserMenu(false);});

// نافذة إعدادات الحساب (اسم المستخدم + كلمة المرور)
function openProfile(){setUserMenu(false);renderAvatar();$('profileUsername').value=state.username;$('profileCurrentPassword').value='';$('profileNewPassword').value='';$('profileConfirmPassword').value='';$('profileModal').classList.add('open');setTimeout(()=>$('profileCurrentPassword').focus(),50);}
function closeProfile(){$('profileModal').classList.remove('open');}
$('profileMenuBtn').addEventListener('click',openProfile);
$('profileModalClose').addEventListener('click',closeProfile);
$('profileCancel').addEventListener('click',closeProfile);
$('profileModal').addEventListener('click',e=>{if(e.target===e.currentTarget)closeProfile();});
$('profileForm').addEventListener('submit',async e=>{
 e.preventDefault();
 const currentPassword=$('profileCurrentPassword').value,newUsername=$('profileUsername').value.trim(),newPassword=$('profileNewPassword').value,confirm=$('profileConfirmPassword').value;
 if(newUsername===state.username&&!newPassword)return notice('لا يوجد أي تغيير للحفظ');
 if(newPassword||confirm){
  if(newPassword.length<12)return notice('كلمة المرور الجديدة يجب أن تكون 12 حرفاً على الأقل');
  if(newPassword!==confirm)return notice('كلمتا المرور غير متطابقتين');
 }
 const btn=e.target.querySelector('button[type=submit]');btn.disabled=true;
 try{
  const data=await AdminAPI.request('/api/admin/profile',{method:'POST',body:JSON.stringify({currentPassword,username:newUsername!==state.username?newUsername:'',newPassword})});
  state.username=data.username;$('adminName').textContent=`مرحباً، ${state.username}`;$('userAvatar').textContent=(state.username[0]||'ح').toUpperCase();
  closeProfile();notice(data.passwordChanged?'تم حفظ التغييرات، وتم تحديث كلمة المرور ✅':'تم حفظ التغييرات ✅');
 }catch(error){notice(error.message);}
 finally{btn.disabled=false;}
});

const titles={dashboard:'لوحة المعلومات',messages:'الرسائل',services:'إدارة الخدمات',projects:'إدارة الأعمال',sections:'التحكم بالأقسام',settings:'إعدادات الموقع'};
const SECTIONS=[
  {key:'section_services',title:'قسم الخدمات',desc:'شبكة بطاقات الخدمات المعرّضة للزوار'},
  {key:'section_works',title:'قسم الأعمال التوضيحية',desc:'معرض نماذج التصميم مع شريط التمرير'},
  {key:'section_why',title:'قسم التعريف ونموذج التواصل',desc:'خصائص الموقع ونموذج طلب عرض السعر'},
  {key:'section_process',title:'قسم آلية العمل',desc:'خطوات العمل الأربع بخطها الزمني'},
  {key:'section_faq',title:'قسم الأسئلة الشائعة',desc:'الأسئلة وعرض سعر سريع'}
];
document.querySelectorAll('.side-link').forEach(btn=>btn.addEventListener('click',async()=>{
  document.querySelectorAll('.side-link').forEach(x=>x.classList.toggle('active',x===btn));
  document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id===`view-${btn.dataset.view}`));
  $('pageTitle').textContent=titles[btn.dataset.view];
  try{if(btn.dataset.view==='messages')await loadDashboard();if(btn.dataset.view==='services')await loadServices();if(btn.dataset.view==='projects')await loadProjects();if(btn.dataset.view==='sections')renderSections();if(btn.dataset.view==='settings')await loadSettings();}catch(e){notice(e.message);}
}));
async function loadAll(){await Promise.all([loadDashboard(),loadServices(),loadProjects(),loadSettings()]);}
async function loadDashboard(){
  const data=await AdminAPI.request('/api/admin/dashboard');state.messages=data.messages||[];
  $('statMessages').textContent=state.messages.length;$('statUnread').textContent=state.messages.filter(m=>!m.read).length;
  $('statServices').textContent=data.services;$('statProjects').textContent=data.projects;
  const unread=state.messages.filter(m=>!m.read).length;$('msgBadge').textContent=unread;$('msgBadge').classList.toggle('hidden',!unread);
  renderChart();renderRecent();renderMessages();
}
function renderChart(){
  const counts=[];const now=new Date();
  for(let back=6;back>=0;back--){const day=new Date(now);day.setDate(day.getDate()-back);const key=day.toLocaleDateString('en-CA');const n=state.messages.filter(m=>{const d=new Date(String(m.date||'').replace(' ','T')+'Z');return !Number.isNaN(+d)&&d.toLocaleDateString('en-CA')===key;}).length;counts.push({label:day.toLocaleDateString('ar-MA',{weekday:'short'}),n});}
  const max=Math.max(...counts.map(x=>x.n),1);
  $('messageChart').innerHTML=counts.map(x=>`<div class="chart-col"><b>${x.n||''}</b><div class="bar-wrap"><i style="height:${Math.max(3,x.n/max*100)}%"></i></div><small>${x.label}</small></div>`).join('');
}
function renderRecent(){const list=state.messages.slice(0,5);$('recentMessages').innerHTML=list.length?list.map(m=>`<div class="recent-item"><span class="recent-icon">${m.read?'📬':'🔔'}</span><span class="recent-text"><b>${escAdmin(m.name)} — ${escAdmin(m.type)}</b><small>${escAdmin((m.msg||'').slice(0,75))}</small></span><time class="recent-date">${dateText(m.date).split('،')[0]}</time></div>`).join(''):'<div class="empty">لا توجد رسائل بعد 📭</div>';}
function filteredMessages(){const query=$('messageSearch').value.trim().toLocaleLowerCase(),status=$('messageStatusFilter').value,from=$('messageDateFrom').value,to=$('messageDateTo').value;return state.messages.filter(m=>{const haystack=[m.name,m.phone,m.email,m.type,m.msg].join(' ').toLocaleLowerCase();const time=new Date(String(m.date||'').replace(' ','T')+'Z'),day=Number.isNaN(+time)?'':time.toISOString().slice(0,10);return(!query||haystack.includes(query))&&(status==='all'||(status==='new'?(m.status||(!m.read?'new':'done'))==='new':status==='followup'?(m.status==='followup'):(m.status==='done'||(!m.status&&m.read))))&&(!from||day>=from)&&(!to||day<=to);});}
function renderMessages(){const rows=$('messageRows'),list=filteredMessages();$('messagesEmpty').classList.toggle('hidden',list.length>0);$('messageResultCount').textContent=`عرض ${list.length} من ${state.messages.length} رسالة`;$('messagesEmpty').textContent=state.messages.length?'لا توجد رسائل تطابق البحث والفلاتر.':'لا توجد رسائل حالياً 📭';rows.innerHTML=list.map(m=>{const status=m.status||(!m.read?'new':'done'),labels={new:'جديدة',followup:'قيد المتابعة',done:'مكتملة'};return `<tr class="${status==='new'?'unread':''}"><td><span class="status status-${status}">${labels[status]}</span></td><td><b>${escAdmin(m.name)}</b><br><small>${escAdmin(m.email||'')}</small></td><td dir="ltr">${escAdmin(m.phone)}</td><td class="hide-mobile">${escAdmin(m.type)}</td><td class="hide-mobile">${dateText(m.date)}</td><td><div class="actions"><button class="icon-btn" title="عرض التفاصيل" aria-label="عرض تفاصيل ${escAdmin(m.name)}" data-action="view-message" data-id="${m.id}">👁️</button><select class="status-select" aria-label="حالة رسالة ${escAdmin(m.name)}" data-message-status="${m.id}"><option value="new" ${status==='new'?'selected':''}>جديدة</option><option value="followup" ${status==='followup'?'selected':''}>متابعة</option><option value="done" ${status==='done'?'selected':''}>مكتملة</option></select><button class="icon-btn" title="حذف" aria-label="حذف رسالة ${escAdmin(m.name)}" data-action="delete-message" data-id="${m.id}">🗑️</button></div></td></tr>`;}).join('');}
['messageSearch','messageStatusFilter','messageDateFrom','messageDateTo'].forEach(id=>$(id).addEventListener(id==='messageSearch'?'input':'change',renderMessages));
$('clearMessageFilters').addEventListener('click',()=>{for(const id of ['messageSearch','messageStatusFilter','messageDateFrom','messageDateTo'])$(id).value=id==='messageStatusFilter'?'all':'';renderMessages();});
$('messageRows').addEventListener('change',async e=>{const select=e.target.closest('select[data-message-status]');if(!select)return;try{await AdminAPI.request(`/api/admin/messages/${select.dataset.messageStatus}/status`,{method:'PATCH',body:JSON.stringify({status:select.value})});await loadDashboard();notice('تم تحديث حالة الرسالة');}catch(error){notice(error.message);await loadDashboard();}});
$('messageRows').addEventListener('click',async e=>{const b=e.target.closest('button[data-action]');if(!b)return;const id=Number(b.dataset.id);try{if(b.dataset.action==='view-message')return openMessage(id);if(b.dataset.action==='delete-message'&&confirm('هل تريد حذف الرسالة نهائياً؟')){await AdminAPI.request(`/api/admin/messages/${id}`,{method:'DELETE'});await loadDashboard();notice('تم حذف الرسالة');}}catch(error){notice(error.message);}});
function openMessage(id){const m=state.messages.find(x=>x.id===id);if(!m)return;state.modalId=id;$('modalContent').innerHTML=`<div class="modal-line"><b>الاسم</b><span>${escAdmin(m.name)}</span></div><div class="modal-line"><b>الهاتف</b><span dir="ltr">${escAdmin(m.phone)}</span></div><div class="modal-line"><b>البريد</b><span dir="ltr">${escAdmin(m.email||'—')}</span></div><div class="modal-line"><b>نوع الموقع</b><span>${escAdmin(m.type)}</span></div><div class="modal-line"><b>الميزانية</b><span>${escAdmin(m.budget||'—')}</span></div><div class="modal-line"><b>موعد الإطلاق</b><span>${escAdmin(m.timeline||'—')}</span></div><div class="modal-line"><b>التاريخ</b><span>${dateText(m.date)}</span></div><div class="modal-line"><b>الرسالة</b><span>${escAdmin(m.msg||'—')}</span></div>`;$('messageModal').classList.add('open');if(!m.read)AdminAPI.request(`/api/admin/messages/${id}/read`,{method:'PATCH'}).then(loadDashboard).catch(e=>notice(e.message));}
function closeModal(){$('messageModal').classList.remove('open');state.modalId=null;}
$('modalClose').addEventListener('click',closeModal);$('modalDone').addEventListener('click',closeModal);$('messageModal').addEventListener('click',e=>{if(e.target===$('messageModal'))closeModal();});document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
$('modalDelete').addEventListener('click',async()=>{if(!state.modalId)return;if(!confirm('هل تريد حذف الرسالة نهائياً؟'))return;try{await AdminAPI.request(`/api/admin/messages/${state.modalId}`,{method:'DELETE'});closeModal();await loadDashboard();notice('تم حذف الرسالة');}catch(e){notice(e.message);}});
$('exportBtn').addEventListener('click',()=>{const rows=[['الاسم','الهاتف','البريد','نوع الموقع','الميزانية','موعد الإطلاق','الحالة','الرسالة','التاريخ'],...filteredMessages().map(m=>[m.name,m.phone,m.email,m.type,m.budget||'',m.timeline||'',m.status||(!m.read?'new':'done'),m.msg,m.date])];const csv='\ufeff'+rows.map(row=>row.map(x=>`"${String(x??'').replaceAll('"','""')}"`).join(',')).join('\r\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='hadir-messages.csv';a.click();URL.revokeObjectURL(a.href);});

async function loadServices(){const data=await AdminAPI.request('/api/admin/services');state.services=data.items||[];renderServices();}
function renderServices(){$('serviceList').innerHTML=state.services.length?state.services.map((s,i)=>`<div class="manage-row"><span class="manage-emoji">${escAdmin(s.icon)}</span><span class="manage-info"><b>${escAdmin(s.title)}</b><small>${escAdmin(s.desc)}</small></span><span class="actions"><button class="icon-btn" title="تحريك لأعلى" aria-label="تحريك خدمة ${escAdmin(s.title)} لأعلى" data-action="move-service" data-id="${s.id}" data-dir="-1" ${i===0?'disabled':''}>↑</button><button class="icon-btn" title="تحريك لأسفل" aria-label="تحريك خدمة ${escAdmin(s.title)} لأسفل" data-action="move-service" data-id="${s.id}" data-dir="1" ${i===state.services.length-1?'disabled':''}>↓</button><button class="icon-btn" title="تعديل" data-action="edit-service" data-id="${s.id}">✏️</button><button class="icon-btn" title="حذف" data-action="delete-service" data-id="${s.id}">🗑️</button></span></div>`).join(''):'<div class="empty">لا توجد خدمات</div>';}
async function moveItem(type,id,direction){const list=type==='service'?state.services:state.projects,index=list.findIndex(x=>x.id===id),target=index+direction;if(target<0||target>=list.length)return;const reordered=[...list];[reordered[index],reordered[target]]=[reordered[target],reordered[index]];await AdminAPI.request(`/api/admin/${type==='service'?'services':'projects'}/order`,{method:'POST',body:JSON.stringify({ids:reordered.map(x=>x.id)})});if(type==='service')await loadServices();else await loadProjects();}
function resetService(){$('serviceForm').reset();$('serviceId').value='';$('serviceIcon').value='✨';$('serviceFormTitle').textContent='➕ إضافة خدمة';}
$('serviceCancel').addEventListener('click',resetService);
$('serviceList').addEventListener('click',async e=>{const b=e.target.closest('button[data-action]');if(!b)return;const id=Number(b.dataset.id),s=state.services.find(x=>x.id===id);if(b.dataset.action==='move-service'){try{await moveItem('service',id,Number(b.dataset.dir));}catch(error){notice(error.message);}return;}if(b.dataset.action==='edit-service'&&s){$('serviceId').value=s.id;$('serviceIcon').value=s.icon;$('serviceTitle').value=s.title;$('serviceDesc').value=s.desc;$('serviceFormTitle').textContent='✏️ تعديل الخدمة';$('serviceForm').scrollIntoView({behavior:'smooth',block:'start'});}if(b.dataset.action==='delete-service'&&confirm('حذف الخدمة؟'))try{await AdminAPI.request(`/api/admin/services/${id}`,{method:'DELETE'});await loadServices();await loadDashboard();notice('تم حذف الخدمة');}catch(err){notice(err.message);}});
$('serviceForm').addEventListener('submit',async e=>{e.preventDefault();const id=$('serviceId').value;const body={icon:$('serviceIcon').value.trim()||'✨',title:$('serviceTitle').value.trim(),desc:$('serviceDesc').value.trim()};try{await AdminAPI.request(id?`/api/admin/services/${id}`:'/api/admin/services',{method:id?'PUT':'POST',body:JSON.stringify(body)});resetService();await loadServices();await loadDashboard();notice('تم حفظ الخدمة');}catch(err){notice(err.message);}});

async function loadProjects(){const data=await AdminAPI.request('/api/admin/projects');state.projects=data.items||[];renderProjects();}
function renderProjects(){$('projectList').innerHTML=state.projects.length?state.projects.map((p,i)=>`<div class="manage-row"><img class="manage-thumb" src="${escAdmin(p.img)}" alt="معاينة ${escAdmin(p.title)}" loading="lazy"><span class="manage-info"><b>${escAdmin(p.title)}</b><small>${escAdmin(p.cat)} • ${escAdmin(p.tags)}</small></span><span class="actions"><button class="icon-btn" title="تحريك لأعلى" aria-label="تحريك ${escAdmin(p.title)} لأعلى" data-action="move-project" data-id="${p.id}" data-dir="-1" ${i===0?'disabled':''}>↑</button><button class="icon-btn" title="تحريك لأسفل" aria-label="تحريك ${escAdmin(p.title)} لأسفل" data-action="move-project" data-id="${p.id}" data-dir="1" ${i===state.projects.length-1?'disabled':''}>↓</button><button class="icon-btn" title="تعديل" data-action="edit-project" data-id="${p.id}">✏️</button><button class="icon-btn" title="حذف" data-action="delete-project" data-id="${p.id}">🗑️</button></span></div>`).join(''):'<div class="empty">لا توجد أعمال</div>';}
function clearProjectPreview(clearInput=true){if(state.previewUrl)URL.revokeObjectURL(state.previewUrl);state.previewUrl=null;state.projectFile=null;if(clearInput)$('projectImageFile').value='';$('projectImagePreview').removeAttribute('src');$('projectImagePreview').classList.add('hidden');}
$('projectImageFile').addEventListener('change',()=>{clearProjectPreview(false);const file=$('projectImageFile').files[0];if(!file)return;if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)||file.size>4*1024*1024){$('projectImageFile').value='';notice('اختر صورة PNG أو JPG أو WebP أو GIF بحجم لا يتجاوز 4 MB');return;}state.projectFile=file;state.previewUrl=URL.createObjectURL(file);$('projectImagePreview').src=state.previewUrl;$('projectImagePreview').classList.remove('hidden');$('projectImage').value='';});
$('projectImage').addEventListener('input',()=>{if(state.projectFile)clearProjectPreview();const value=$('projectImage').value.trim();if(!value){$('projectImagePreview').classList.add('hidden');return;}try{const url=value.startsWith('/uploads/')?new URL(value,location.origin):new URL(value);if(url.protocol==='http:'||url.protocol==='https:'){$('projectImagePreview').src=url.href;$('projectImagePreview').classList.remove('hidden');}}catch{$('projectImagePreview').classList.add('hidden');}});
async function resetProject(){clearProjectPreview();$('projectForm').reset();$('projectId').value='';$('projectColor').value='purple';$('projectImagePreview').classList.add('hidden');$('projectFormTitle').textContent='➕ إضافة عمل';}
async function uploadProjectImage(){if(!state.projectFile)return $('projectImage').value.trim();const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('تعذرت قراءة ملف الصورة'));reader.readAsDataURL(state.projectFile);});const result=await AdminAPI.request('/api/admin/uploads',{method:'POST',body:JSON.stringify({data})});return result.url;}
$('projectCancel').addEventListener('click',resetProject);
$('projectList').addEventListener('click',async e=>{const b=e.target.closest('button[data-action]');if(!b)return;const id=Number(b.dataset.id),p=state.projects.find(x=>x.id===id);if(b.dataset.action==='move-project'){try{await moveItem('project',id,Number(b.dataset.dir));}catch(error){notice(error.message);}return;}if(b.dataset.action==='edit-project'&&p){clearProjectPreview();$('projectId').value=p.id;$('projectTitle').value=p.title;$('projectCategory').value=p.cat;$('projectImage').value=p.img;$('projectImagePreview').src=p.img;$('projectImagePreview').classList.remove('hidden');$('projectTags').value=p.tags;$('projectColor').value=p.btn;$('projectFormTitle').textContent='✏️ تعديل العمل';$('projectForm').scrollIntoView({behavior:'smooth',block:'start'});}if(b.dataset.action==='delete-project'&&confirm('حذف العمل؟'))try{await AdminAPI.request(`/api/admin/projects/${id}`,{method:'DELETE'});await loadProjects();await loadDashboard();notice('تم حذف العمل');}catch(err){notice(err.message);}});
$('projectForm').addEventListener('submit',async e=>{e.preventDefault();const id=$('projectId').value;try{const body={title:$('projectTitle').value.trim(),cat:$('projectCategory').value.trim(),img:await uploadProjectImage(),tags:$('projectTags').value.trim(),btn:$('projectColor').value};await AdminAPI.request(id?`/api/admin/projects/${id}`:'/api/admin/projects',{method:id?'PUT':'POST',body:JSON.stringify(body)});await resetProject();await loadProjects();await loadDashboard();notice('تم حفظ العمل');}catch(err){notice(err.message);}});

async function loadSettings(){const data=await AdminAPI.request('/api/admin/settings');state.settings=data.settings||{};for(const [key,id] of Object.entries({siteName:'settingSiteName',tagline:'settingTagline',phone:'settingPhone',email:'settingEmail',whatsapp:'settingWhatsapp',address:'settingAddress',about:'settingAbout'}))$(id).value=state.settings[key]||'';
  const DEFAULT_ICON='/assets/hadir-icon.svg';
  const lp=$('logoPreview'),fp=$('faviconPreview');
  if(lp)lp.src=state.settings.logo||DEFAULT_ICON;if(fp)fp.src=state.settings.favicon||DEFAULT_ICON;
  applyBrand();
}
function applyBrand(){const DEFAULT_ICON='/assets/hadir-icon.svg';const logo=state.settings.logo||DEFAULT_ICON,icon=state.settings.favicon||DEFAULT_ICON;
  document.querySelectorAll('.brand-mark img,.logo-mark img').forEach(img=>{img.src=logo;});
  document.querySelectorAll('.brand-name').forEach(el=>{if(el.closest('.side-brand'))el.textContent=state.settings.siteName||'Hadir';});
  const link=document.querySelector('link[rel="icon"]');if(link)link.href=icon;
}
function sectionOn(key){return state.settings[key]!=='0';}
function renderSections(){const el=$('sectionToggles');el.innerHTML=SECTIONS.map(s=>{const on=sectionOn(s.key);return `<div class="toggle-row"><span class="toggle-info"><b>${escAdmin(s.title)}</b><small>${escAdmin(s.desc)}</small></span><button class="switch ${on?'on':''}" type="button" role="switch" aria-checked="${on}" aria-label="تفعيل ${escAdmin(s.title)}" data-section="${s.key}"></button></div>`}).join('');}
$('sectionToggles').addEventListener('click',async e=>{const b=e.target.closest('.switch');if(!b)return;const key=b.dataset.section,wasOn=sectionOn(key);b.classList.toggle('on',!wasOn);b.setAttribute('aria-checked',String(!wasOn));try{await saveSettings({...settingsPayload(),[key]:wasOn?'0':'1'},wasOn?'تم إخفاء القسم من الموقع':'تم تفعيل القسم');}catch(err){notice(err.message);b.classList.toggle('on',wasOn);b.setAttribute('aria-checked',String(wasOn));}});
function settingsPayload(){const s={};for(const [key,id]of Object.entries({siteName:'settingSiteName',tagline:'settingTagline',phone:'settingPhone',email:'settingEmail',whatsapp:'settingWhatsapp',address:'settingAddress',about:'settingAbout'}))s[key]=$(id).value.trim();s.logo=state.settings.logo||'';s.favicon=state.settings.favicon||'';return s;}
async function saveSettings(payload,message){await AdminAPI.request('/api/admin/settings',{method:'PUT',body:JSON.stringify(payload)});state.settings={...state.settings,...payload};applyBrand();if(message)notice(message);}
$('settingsForm').addEventListener('submit',async e=>{e.preventDefault();try{await saveSettings(settingsPayload(),'تم حفظ إعدادات الموقع');}catch(err){notice(err.message);}});
async function pickIdentity(file,kind){
  if(!file)return;
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>4*1024*1024)return notice('اختر صورة PNG أو JPG أو WebP بحجم لا يتجاوز 4 MB');
  try{const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('تعذرت قراءة الملف'));reader.readAsDataURL(file);});
    const res=await AdminAPI.request('/api/admin/uploads',{method:'POST',body:JSON.stringify({data})});
    await saveSettings({...settingsPayload(),[kind]:res.url},kind==='logo'?'تم تحديث شعار الموقع':'تم تحديث أيقونة الصفحة');
    $(kind==='logo'?'logoPreview':'faviconPreview').src=res.url;
  }catch(err){notice(err.message);}
}
$('logoPick').addEventListener('click',()=>$('logoFile').click());
$('logoFile').addEventListener('change',e=>{pickIdentity(e.target.files[0],'logo').finally(()=>{$('logoFile').value='';});});
$('logoClear').addEventListener('click',async()=>{try{await saveSettings({...settingsPayload(),logo:''},'أعيد الشعار الافتراضي');}catch(err){notice(err.message);}});
$('faviconPick').addEventListener('click',()=>$('faviconFile').click());
$('faviconFile').addEventListener('change',e=>{pickIdentity(e.target.files[0],'favicon').finally(()=>{$('faviconFile').value='';});});
$('faviconClear').addEventListener('click',async()=>{try{await saveSettings({...settingsPayload(),favicon:''},'أعيدت الأيقونة الافتراضية');}catch(err){notice(err.message);}});
$('passwordForm').addEventListener('submit',async e=>{e.preventDefault();if($('newPassword').value!==$('confirmNewPassword').value){notice('كلمتا المرور الجديدتان غير متطابقتين');return;}try{await AdminAPI.request('/api/auth/password',{method:'POST',body:JSON.stringify({currentPassword:$('currentPassword').value,newPassword:$('newPassword').value})});$('passwordForm').reset();notice('تم تحديث كلمة المرور بنجاح');}catch(err){notice(err.message);}});
async function loadBackups(){const data=await AdminAPI.request('/api/admin/backups');const list=$('backupList');list.innerHTML=data.items.length?data.items.map(name=>`<a class="backup-item" href="/api/admin/backups/${encodeURIComponent(name)}">⬇️ ${escAdmin(name)}</a>`).join(''):'<small class="muted">لا توجد نسخ احتياطية بعد.</small>';}
$('createBackupBtn').addEventListener('click',async e=>{const button=e.currentTarget;button.disabled=true;try{const data=await AdminAPI.request('/api/admin/backups',{method:'POST',body:'{}'});await loadBackups();const link=document.createElement('a');link.href=`/api/admin/backups/${encodeURIComponent(data.name)}`;link.download=data.name;link.click();notice('تم إنشاء النسخة الاحتياطية وتنزيلها');}catch(error){notice(error.message);}finally{button.disabled=false;}});

boot();
