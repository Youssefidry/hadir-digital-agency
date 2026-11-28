/* Hadir public-site client. All persistent data is stored by the server in SQLite. */
const HadirAPI = {
  async request(url, options = {}) {
    const response = await fetch(url, { credentials:'same-origin', headers:{'Content-Type':'application/json',...(options.headers||{})}, ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `خطأ في الاتصال (${response.status})`);
    return data;
  }
};
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
async function initSite() {
  const toast=document.getElementById('formToast');
  const year=document.querySelector('.current-year');
  if(year)year.textContent=new Date().getFullYear();

  try {
    const {settings={},services=[],projects=[]}=await HadirAPI.request('/api/public');
    document.querySelectorAll('.js-brand').forEach(el=>el.textContent=settings.siteName||'Hadir');
    document.querySelectorAll('.js-tagline').forEach(el=>el.textContent=settings.tagline||'Digital Agency');
    document.querySelectorAll('.js-phone').forEach(el=>{const digits=(settings.phone||'').replace(/[^+0-9]/g,'');el.textContent=settings.phone||'';const line=el.closest('.contact-line');if(line){const a=document.createElement('a');a.className='contact-text js-phone';a.href=settings.phone?('tel:'+digits.replace(/\s/g,'')):'#';a.textContent=settings.phone||'';el.replaceWith(a);line.hidden=!settings.phone;}});
    document.querySelectorAll('.js-email').forEach(el=>{el.textContent=settings.email||'';const line=el.closest('.contact-line');if(line){const a=document.createElement('a');a.className='contact-text js-email';a.href=settings.email?('mailto:'+settings.email):'#';a.textContent=settings.email||'';el.replaceWith(a);line.hidden=!settings.email;}});
    const waDigits=(settings.whatsapp||'').replace(/\D/g,'');
    const waHref=waDigits?('https://wa.me/'+waDigits):'';
    document.querySelectorAll('.js-whatsapp').forEach(el=>{el.textContent=settings.whatsapp||'';const line=el.closest('.contact-line');if(line){if(waHref){const a=document.createElement('a');a.className='contact-text js-whatsapp';a.href=waHref;a.target='_blank';a.rel='noopener';a.textContent=settings.whatsapp;el.replaceWith(a);}line.hidden=!waHref;}});
    const waFloat=document.getElementById('waFloat');if(waFloat){waFloat.hidden=!waHref;if(waHref)waFloat.href=waHref;}
    document.querySelectorAll('.js-address').forEach(el=>{el.textContent=settings.address||'';const line=el.closest('.contact-line');if(line)line.hidden=!settings.address;});
    const contactNote=document.querySelector('.contact-setup-note');
    if(contactNote)contactNote.hidden=Boolean(settings.phone||settings.email||settings.address);
    document.querySelectorAll('.js-about').forEach(el=>{el.textContent=settings.about||'';el.hidden=!settings.about;});
    const logoUrl=settings.logo||'';if(logoUrl)document.querySelectorAll('.logo-mark img').forEach(img=>{img.src=logoUrl;});
    const sectionMap={
      section_services:['#services','header a[href="#services"]','footer a[href="#services"]'],
      section_works:['#works','header a[href="#works"]','footer a[href="#works"]'],
      section_why:['#why','header a[href="#why"]','header a[href="#contact"]'],
      section_process:['#process','header a[href="#process"]','footer a[href="#process"]'],
      section_faq:['#faq','header a[href="#faq"]']
    };
    for(const [key,selectors] of Object.entries(sectionMap)){
      if(settings[key]==='0')selectors.forEach(sel=>document.querySelectorAll(sel).forEach(el=>{el.hidden=true;}));
    }
    const iconLink=document.querySelector('link[rel="icon"]');if(iconLink&&settings.favicon)iconLink.href=settings.favicon;
    const svcGrid=document.getElementById('svcGrid');
    if(svcGrid){const colors=['svc-1','svc-2','svc-3','svc-4','svc-5','svc-6'];svcGrid.innerHTML=services.length?services.map(x=>`<article class="svc ${colors[(x.id-1+colors.length)%colors.length]||'svc-1'}"><div class="ic">${esc(x.icon||'✨')}</div><h3>${esc(x.title)}</h3><p>${esc(x.desc)}</p></article>`).join(''):'<p class="empty-state">سيتم الإعلان عن الخدمات قريباً.</p>';}
    const tplRow=document.getElementById('tplRow');
    if(tplRow){const btns={purple:'f-purple',amber:'f-amber',rose:'f-rose'};tplRow.innerHTML=projects.length?projects.map(x=>`<article class="tpl"><div class="tpl-img"><img src="${esc(x.img)}" alt="" loading="lazy" decoding="async"><div class="tpl-overlay"><h3>${esc(x.title)}</h3><div class="tpl-links">${(x.tags||'').split(',').filter(Boolean).map(t=>`<span>${esc(t.trim())}</span>`).join('')}</div></div></div><div class="tpl-foot"><span class="tpl-label ${btns[x.btn]||'f-purple'}">نموذج توضيحي</span></div></article>`).join(''):'<p class="empty-state">ستُضاف نماذج توضيحية قريباً.</p>';}
  } catch(error) { console.error('Website data load failed:',error); }
  const form=document.getElementById('contactForm');
  if(form)form.addEventListener('submit',async event=>{
    event.preventDefault();
    const button=form.querySelector('[type="submit"]');
    const old=button.innerHTML;
    const setNotice=(message,kind)=>{
      if(!toast)return;
      toast.textContent=message;
      toast.className=`form-toast form-toast--${kind}`;
      toast.hidden=false;
    };
    button.disabled=true;
    button.textContent='جارٍ إرسال طلبك…';
    try{
      const f=new FormData(form);
      await HadirAPI.request('/api/messages',{method:'POST',body:JSON.stringify({name:f.get('name'),phone:f.get('phone'),email:f.get('email'),type:f.get('type'),msg:f.get('msg')})});
      form.reset();
      setNotice('شكراً لك، وصل طلبك وحُفظ بنجاح. سنراجعه ونتواصل معك.','success');
      toast?.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
    }catch(error){
      setNotice(`تعذر إرسال الطلب: ${error.message}`,'error');
      toast?.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
    }finally{
      button.disabled=false;
      button.innerHTML=old;
    }
  });
}
