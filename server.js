import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { readdir, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, resolve, sep } from 'node:path';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { backup, DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = resolve(ROOT, 'public');
const DATA_DIR = resolve(ROOT, 'data');
mkdirSync(DATA_DIR, { recursive: true });
const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || '127.0.0.1';
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const SETUP_SECRET = process.env.HADIR_SETUP_SECRET || '';
const BACKUP_DIR = resolve(process.env.HADIR_BACKUP_DIR || resolve(DATA_DIR, 'backups'));
mkdirSync(BACKUP_DIR, { recursive: true });
const DB_PATH = resolve(process.env.HADIR_DB || resolve(DATA_DIR, 'hadir.sqlite'));
mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
db.exec(`
 CREATE TABLE IF NOT EXISTS admins(id INTEGER PRIMARY KEY,username TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,password_salt TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS services(id INTEGER PRIMARY KEY AUTOINCREMENT,icon TEXT NOT NULL DEFAULT '✨',title TEXT NOT NULL,description TEXT NOT NULL,sort_order INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS projects(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,category TEXT NOT NULL,image_url TEXT NOT NULL,tags TEXT NOT NULL DEFAULT '',button_color TEXT NOT NULL DEFAULT 'purple',sort_order INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,phone TEXT NOT NULL,email TEXT NOT NULL DEFAULT '',type TEXT NOT NULL,message TEXT NOT NULL DEFAULT '',is_read INTEGER NOT NULL DEFAULT 0,workflow_status TEXT NOT NULL DEFAULT 'new',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);
`);
const adminColumns=new Set(db.prepare('PRAGMA table_info(admins)').all().map(x=>x.name));
if(!adminColumns.has('avatar'))db.exec("ALTER TABLE admins ADD COLUMN avatar TEXT NOT NULL DEFAULT ''");
const messageColumns=new Set(db.prepare('PRAGMA table_info(messages)').all().map(x=>x.name));
if(!messageColumns.has('workflow_status'))db.exec("ALTER TABLE messages ADD COLUMN workflow_status TEXT NOT NULL DEFAULT 'new'");
if(!messageColumns.has('budget'))db.exec("ALTER TABLE messages ADD COLUMN budget TEXT NOT NULL DEFAULT ''");
if(!messageColumns.has('timeline'))db.exec("ALTER TABLE messages ADD COLUMN timeline TEXT NOT NULL DEFAULT ''");
const serviceColumns=new Set(db.prepare('PRAGMA table_info(services)').all().map(x=>x.name));
if(!serviceColumns.has('sort_order'))db.exec('ALTER TABLE services ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
const projectColumns=new Set(db.prepare('PRAGMA table_info(projects)').all().map(x=>x.name));
if(!projectColumns.has('sort_order'))db.exec('ALTER TABLE projects ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');

const DEFAULT_SETTINGS = {siteName:'Hadir',tagline:'Digital Agency',phone:'',email:'',whatsapp:'',address:'',about:'موقعك.. حاضر دائماً'};
const PLACEHOLDER_CONTACTS = {phone:'+212 6 12 34 56 78',email:'contact@hadir.ma',whatsapp:'212612345678',address:'المغرب - الرباط'};
const DEFAULT_SERVICES = [
 ['💻','تصميم مواقع احترافية','مواقع تعريفية للشركات والمهن بتصميم عصري يعكس هوية علامتك التجارية.'],
 ['🛒','متاجر إلكترونية','متجر لعرض المنتجات، مع إمكانية ربط بوابات الدفع وإدارة الطلبات بحسب نطاق المشروع والبلد.'],
 ['🍽️','مواقع مطاعم ومقاهي','مواقع لعرض المنيو والمعلومات، مع إمكان إضافة استقبال الطلبات أو الحجوزات بحسب نطاق المشروع.'],
 ['💅','مواقع مراكز التجميل','مواقع أنيقة للصالونات ومراكز التجميل مع نظام حجز المواعيد الإلكتروني.'],
 ['📈','تهيئة محركات البحث','تهيئة بنية الصفحات والمحتوى لمحركات البحث، دون ضمان ترتيب أو نتائج محددة.'],
 ['🛠️','استضافة وصيانة','خيارات الاستضافة والصيانة والدعم تُحدد حسب احتياج المشروع ونطاق الاتفاق.']
];
const DEFAULT_PROJECTS = [
 ['🍕 مطعم الأصيل','مطاعم ومقاهي','https://images.unsplash.com/photo-1513104890138-7c749659a591?w=500&q=75','منيو رقمي,حجز طاولات,طلبات أونلاين','amber'],
 ['☕ مقهى راونة','مطاعم ومقاهي','https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=500&q=75','قائمة المشروبات,عروض اليوم,الموقع الجغرافي','purple'],
 ['💅 صالون ليالي','مراكز تجميل','https://images.unsplash.com/photo-1560066984-138dadb4c035?w=500&q=75','خدماتنا,حجز موعد,الأسعار','rose'],
 ['🩺 عيادة الشفاء','عيادات','https://images.unsplash.com/photo-1586773860418-d37222d8fce3?w=500&q=75','تخصصاتنا,حجز استشارة,الأطباء','purple'],
 ['👗 متجر ستايل','متاجر إلكترونية','https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=500&q=75','سلة المشتريات,دفع آمن,تتبع الطلب','amber'],
 ['🏢 مكتب إبداع','شركات ومكاتب','https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=500&q=75','من نحن,خدماتنا,تواصل معنا','purple']
];
const getSetting = db.prepare('SELECT value FROM settings WHERE key=?');
const putSetting = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
for (const [key,value] of Object.entries(DEFAULT_SETTINGS)) if (!getSetting.get(key)) putSetting.run(key,value);
// The original seeded contact details are examples, not verified business contacts.
for (const [key,value] of Object.entries(PLACEHOLDER_CONTACTS)) if (getSetting.get(key)?.value===value) putSetting.run(key,'');
const legacyServiceCopy = [
 ['متجر متكامل لعرض وبيع منتجاتك مع بوابات دفع آمنة وإدارة الطلبات.','متجر لعرض المنتجات، مع إمكانية ربط بوابات الدفع وإدارة الطلبات بحسب نطاق المشروع والبلد.'],
 ['قوائم طعام رقمية تفاعلية، عرض المنيو وإمكانية استقبال الطلبات والحجوزات.','مواقع لعرض المنيو والمعلومات، مع إمكان إضافة استقبال الطلبات أو الحجوزات بحسب نطاق المشروع.'],
 ['ظهور متقدّم في نتائج جوجل لجذب زوار أكثر وتحقيق مبيعات أكبر.','تهيئة بنية الصفحات والمحتوى لمحركات البحث، دون ضمان ترتيب أو نتائج محددة.'],
 ['استضافة سريعة وآمنة مع دعم فني مستمر وتحديثات دورية لموقعك.','خيارات الاستضافة والصيانة والدعم تُحدد حسب احتياج المشروع ونطاق الاتفاق.']
];
const updateLegacyService = db.prepare('UPDATE services SET description=? WHERE description=?');
for (const [oldCopy,newCopy] of legacyServiceCopy) updateLegacyService.run(newCopy,oldCopy);
if (db.prepare('SELECT COUNT(*) n FROM services').get().n===0) { const q=db.prepare('INSERT INTO services(icon,title,description,sort_order) VALUES(?,?,?,?)'); DEFAULT_SERVICES.forEach((x,i)=>q.run(...x,i)); }
if (db.prepare('SELECT COUNT(*) n FROM projects').get().n===0) { const q=db.prepare('INSERT INTO projects(title,category,image_url,tags,button_color,sort_order) VALUES(?,?,?,?,?,?)'); DEFAULT_PROJECTS.forEach((x,i)=>q.run(...x,i)); }

const sessions = new Map(), limits = new Map();
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.ico':'image/x-icon'};
const send = (res,status,data,headers={}) => { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}); res.end(JSON.stringify(data)); };
const fail = (res,status,error) => send(res,status,{error});
function rateLimited(req,key,max,windowMs){const ip=req.socket.remoteAddress||'unknown',now=Date.now();let b=limits.get(key+ip);if(!b||now-b.at>windowMs)b={at:now,n:0};b.n++;limits.set(key+ip,b);return b.n>max;}
async function readBody(req,max=24000){let raw='',size=0;for await(const c of req){size+=c.length;if(size>max)throw Object.assign(Error('الطلب أكبر من المسموح'),{status:413});raw+=c;}try{return raw?JSON.parse(raw):{};}catch{throw Object.assign(Error('صيغة البيانات غير صالحة'),{status:400});}}
function str(v,max,required=false){if(typeof v!=='string')return required?null:'';v=v.trim();return (!required&&!v)||(v.length>0&&v.length<=max)?v:null;}
function session(req){const m=(req.headers.cookie||'').match(/(?:^|;\s*)hadir_session=([A-Za-z0-9_-]+)/);if(!m)return null;const s=sessions.get(m[1]);if(!s||s.expires<Date.now()){sessions.delete(m[1]);return null;}s.expires=Date.now()+SESSION_TTL;return s;}
function requireAdmin(req,res){const s=session(req);if(!s)fail(res,401,'انتهت الجلسة، سجّل الدخول مجدداً');return s;}
const setCookie=t=>`hadir_session=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL/1000}${process.env.NODE_ENV==='production'?'; Secure':''}`;
const clearCookie=`hadir_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${process.env.NODE_ENV==='production'?'; Secure':''}`;
const equalSecret=(a,b)=>timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());
function sameOriginRequest(req){
 const origin=req.headers.origin;
 if(origin){try{if(new URL(origin).host!==req.headers.host)return false;}catch{return false;}}
 return req.headers['sec-fetch-site']!=='cross-site';
}
const settingsObject=()=>Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(x=>[x.key,x.value]));
const serviceObject=r=>({id:r.id,icon:r.icon,title:r.title,desc:r.description,sortOrder:r.sort_order});
const projectObject=r=>({id:r.id,title:r.title,cat:r.category,img:r.image_url,tags:r.tags,btn:r.button_color,sortOrder:r.sort_order});
const messageObject=r=>({id:r.id,name:r.name,phone:r.phone,email:r.email,type:r.type,msg:r.message,budget:r.budget||'',timeline:r.timeline||'',read:Boolean(r.is_read),status:r.workflow_status|| (r.is_read?'done':'new'),date:r.created_at});

// ---- VPN / proxy blocking (optional, enabled with HADIR_VPN_BLOCK=1) ----
const VPN_BLOCK=process.env.HADIR_VPN_BLOCK==='1';
const VPN_BLOCK_HOSTING=process.env.HADIR_VPN_BLOCK_HOSTING!=='0';
const VPN_ALLOWED_COUNTRIES=(process.env.HADIR_ALLOWED_COUNTRIES||'').split(',').map(x=>x.trim().toUpperCase()).filter(Boolean);
const vpnCache=new Map();
const normalizeIp=ip=>String(ip).replace(/^::ffff:/,'');
const isLocalIp=ip=>ip==='localhost'||ip==='::1'||ip.startsWith('127.')||ip.startsWith('::ffff:127.')||/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)||ip.startsWith('fc')||ip.startsWith('fd');
function clientIp(req){
 if(process.env.HADIR_TRUST_PROXY==='1'){const xf=req.headers['x-forwarded-for'];if(xf)return String(xf).split(',')[0].trim();}
 return req.socket.remoteAddress||'';
}
async function vpnVerdict(ip){
 const now=Date.now(),hit=vpnCache.get(ip);
 if(hit&&hit.exp>now)return hit.result;
 let result={ok:true}; // fail-open if the lookup service is unreachable
 try{
  const r=await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,countryCode,proxy,hosting`,{signal:AbortSignal.timeout(3000)});
  const d=await r.json();
  if(d.status==='success'){
   const bad=d.proxy===true||(VPN_BLOCK_HOSTING&&d.hosting===true)||(VPN_ALLOWED_COUNTRIES.length>0&&!VPN_ALLOWED_COUNTRIES.includes(String(d.countryCode||'').toUpperCase()));
   if(bad)result={ok:false};
  }
 }catch{}
 vpnCache.set(ip,{result,exp:now+12*60*60*1000});
 if(vpnCache.size>5000)vpnCache.delete(vpnCache.keys().next().value);
 return result;
}

const server=createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','strict-origin-when-cross-origin'); res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
 if(process.env.NODE_ENV==='production')res.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains');
 if(VPN_BLOCK){
  const ip=normalizeIp(clientIp(req));
  if(ip&&!isLocalIp(ip)){
   const verdict=await vpnVerdict(ip);
   if(!verdict.ok){
    if((req.headers.accept||'').includes('text/html')){
     const blockedPage=resolve(PUBLIC_DIR,'blocked.html');
     if(existsSync(blockedPage)){res.writeHead(403,{'Content-Type':mime['.html'],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return createReadStream(blockedPage).pipe(res);}
    }
    return fail(res,403,'الوصول مرفوض: يبدو أنك تستخدم VPN أو وكيلاً. أوقفه ثم أعد المحاولة.');
   }
  }
 }
 let path;
 try {
  path=decodeURIComponent(new URL(req.url,`http://${req.headers.host||'localhost'}`).pathname);
  if(['POST','PUT','PATCH','DELETE'].includes(req.method)&&!sameOriginRequest(req))return fail(res,403,'مصدر الطلب غير مسموح');
  if(req.method==='GET'&&path==='/api/health')return send(res,200,{ok:true,database:'sqlite'});
  if(req.method==='GET'&&path==='/api/setup/status')return send(res,200,{needsSetup:db.prepare('SELECT COUNT(*) n FROM admins').get().n===0});
  if(req.method==='POST'&&path==='/api/setup'){
   if(SETUP_SECRET&&!equalSecret(req.headers['x-hadir-setup-key']||'',SETUP_SECRET))return fail(res,403,'مفتاح الإعداد غير صحيح');
   if(rateLimited(req,'setup',5,900000))return fail(res,429,'محاولات كثيرة، حاول لاحقاً');
   const d=await readBody(req),username=str(d.username,40,true),password=str(d.password,200,true);
   if(!username||!/^[A-Za-z0-9_.-]{3,40}$/.test(username))return fail(res,400,'اسم المستخدم: 3 إلى 40 حرفاً إنجليزياً أو أرقاماً');
   if(!password||password.length<12)return fail(res,400,'كلمة المرور يجب أن تكون 12 حرفاً على الأقل');
   const salt=randomBytes(16).toString('hex'),hash=scryptSync(password,salt,64).toString('hex');
   try{
    db.exec('BEGIN IMMEDIATE');
    if(db.prepare('SELECT COUNT(*) n FROM admins').get().n!==0){db.exec('ROLLBACK');return fail(res,409,'تم إنشاء حساب المدير مسبقاً');}
    db.prepare('INSERT INTO admins(username,password_hash,password_salt) VALUES(?,?,?)').run(username,hash,salt);
    db.exec('COMMIT');
   }catch(e){try{db.exec('ROLLBACK');}catch{}return fail(res,409,'تعذر إنشاء حساب المدير؛ ربما تم إعداده مسبقاً');}
   const token=randomBytes(32).toString('base64url');sessions.set(token,{username,expires:Date.now()+SESSION_TTL});return send(res,201,{ok:true,username,avatar:''},{'Set-Cookie':setCookie(token)});
  }
  if(req.method==='POST'&&path==='/api/auth/login'){
   if(rateLimited(req,'login',10,900000))return fail(res,429,'محاولات كثيرة، حاول بعد 15 دقيقة');
   const d=await readBody(req),username=str(d.username,40,true),password=str(d.password,200,true),row=username&&db.prepare('SELECT * FROM admins WHERE username=?').get(username);
   if(!row||!password){await new Promise(r=>setTimeout(r,150));return fail(res,401,'بيانات الدخول غير صحيحة');}
   const hash=scryptSync(password,row.password_salt,64);if(!timingSafeEqual(hash,Buffer.from(row.password_hash,'hex'))){await new Promise(r=>setTimeout(r,150));return fail(res,401,'بيانات الدخول غير صحيحة');}
   const token=randomBytes(32).toString('base64url');sessions.set(token,{username:row.username,expires:Date.now()+SESSION_TTL});return send(res,200,{ok:true,username:row.username,avatar:row.avatar||''},{'Set-Cookie':setCookie(token)});
  }
  if(req.method==='POST'&&path==='/api/auth/logout'){const m=(req.headers.cookie||'').match(/(?:^|;\s*)hadir_session=([A-Za-z0-9_-]+)/);if(m)sessions.delete(m[1]);return send(res,200,{ok:true},{'Set-Cookie':clearCookie});}
  if(req.method==='GET'&&path==='/api/auth/me'){const s=session(req);const admin=s&&db.prepare('SELECT avatar FROM admins WHERE username=?').get(s.username);return send(res,200,{authenticated:Boolean(s),username:s?.username||null,avatar:admin?.avatar||''});}
  if(req.method==='GET'&&path==='/api/public')return send(res,200,{settings:settingsObject(),services:db.prepare('SELECT * FROM services ORDER BY sort_order,id').all().map(serviceObject),projects:db.prepare('SELECT * FROM projects ORDER BY sort_order,id').all().map(projectObject)});
  if(req.method==='POST'&&path==='/api/messages'){
   if(rateLimited(req,'message',5,3600000))return fail(res,429,'تم تجاوز عدد الطلبات، حاول لاحقاً');
   const d=await readBody(req),name=str(d.name,100,true),phone=str(d.phone,40,true),email=str(d.email,180),type=str(d.type,100,true),message=str(d.msg,3000);
   if(!name||!phone||!type||email===null||message===null)return fail(res,400,'تحقق من الحقول المطلوبة وأطوالها');
   const budget=str(d.budget,60)||'',timeline=str(d.timeline,60)||'';
   if(email&&!/^\S+@\S+\.\S+$/.test(email))return fail(res,400,'البريد الإلكتروني غير صالح');
   if(!/^[+()0-9\s.-]{6,40}$/.test(phone))return fail(res,400,'رقم الهاتف غير صالح');
   const r=db.prepare('INSERT INTO messages(name,phone,email,type,message,budget,timeline) VALUES(?,?,?,?,?,?,?)').run(name,phone,email,type,message,budget,timeline);return send(res,201,{ok:true,id:Number(r.lastInsertRowid)});
  }
  if(path.startsWith('/api/admin/')||path==='/api/auth/password'){
   if(!requireAdmin(req,res))return;
   if(req.method==='GET'&&path==='/api/admin/dashboard')return send(res,200,{messages:db.prepare('SELECT * FROM messages ORDER BY created_at DESC LIMIT 1000').all().map(messageObject),services:db.prepare('SELECT COUNT(*) n FROM services').get().n,projects:db.prepare('SELECT COUNT(*) n FROM projects').get().n});
   if(req.method==='PATCH'&&/^\/api\/admin\/messages\/\d+\/read$/.test(path)){db.prepare('UPDATE messages SET is_read=1 WHERE id=?').run(Number(path.split('/')[4]));return send(res,200,{ok:true});}
   if(req.method==='PATCH'&&/^\/api\/admin\/messages\/\d+\/status$/.test(path)){
    const id=Number(path.split('/')[4]),d=await readBody(req),status=d.status;
    if(!['new','followup','done'].includes(status))return fail(res,400,'حالة الرسالة غير صالحة');
    const exists=db.prepare('SELECT 1 FROM messages WHERE id=?').get(id);if(!exists)return fail(res,404,'الرسالة غير موجودة');
    db.prepare('UPDATE messages SET is_read=?,workflow_status=? WHERE id=?').run(status==='new'?0:1,status,id);
    return send(res,200,{ok:true,status});
   }
   if(req.method==='DELETE'&&/^\/api\/admin\/messages\/\d+$/.test(path)){db.prepare('DELETE FROM messages WHERE id=?').run(Number(path.split('/').at(-1)));return send(res,200,{ok:true});}
   if(req.method==='GET'&&path==='/api/admin/services')return send(res,200,{items:db.prepare('SELECT * FROM services ORDER BY sort_order,id').all().map(serviceObject)});
   if(req.method==='POST'&&path==='/api/admin/services/order'){
    const d=await readBody(req),ids=d.ids;
    if(!Array.isArray(ids)||ids.some(x=>!Number.isSafeInteger(x)||x<1)||new Set(ids).size!==ids.length)return fail(res,400,'ترتيب الخدمات غير صالح');
    const actual=db.prepare('SELECT id FROM services ORDER BY sort_order,id').all().map(x=>x.id);
    if(actual.length!==ids.length||actual.some(id=>!ids.includes(id)))return fail(res,409,'تغيّرت قائمة الخدمات؛ أعد تحميلها');
    const update=db.prepare('UPDATE services SET sort_order=? WHERE id=?');db.exec('BEGIN');try{ids.forEach((id,i)=>update.run(i,id));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return send(res,200,{ok:true});
   }
   if(['POST','PUT'].includes(req.method)&&(/^\/api\/admin\/services$/.test(path)||/^\/api\/admin\/services\/\d+$/.test(path))){
    const d=await readBody(req),icon=str(d.icon,12)||'✨',title=str(d.title,120,true),desc=str(d.desc,600,true);if(!title||!desc)return fail(res,400,'العنوان والوصف مطلوبان');
    if(req.method==='POST'){const order=db.prepare('SELECT COALESCE(MAX(sort_order),-1)+1 n FROM services').get().n,r=db.prepare('INSERT INTO services(icon,title,description,sort_order) VALUES(?,?,?,?)').run(icon,title,desc,order);return send(res,201,{id:Number(r.lastInsertRowid)});}
    db.prepare('UPDATE services SET icon=?,title=?,description=? WHERE id=?').run(icon,title,desc,Number(path.split('/').at(-1)));return send(res,200,{ok:true});
   }
   if(req.method==='DELETE'&&/^\/api\/admin\/services\/\d+$/.test(path)){db.prepare('DELETE FROM services WHERE id=?').run(Number(path.split('/').at(-1)));return send(res,200,{ok:true});}
   if(req.method==='GET'&&path==='/api/admin/projects')return send(res,200,{items:db.prepare('SELECT * FROM projects ORDER BY sort_order,id').all().map(projectObject)});
   if(req.method==='POST'&&path==='/api/admin/projects/order'){
    const d=await readBody(req),ids=d.ids;
    if(!Array.isArray(ids)||ids.some(x=>!Number.isSafeInteger(x)||x<1)||new Set(ids).size!==ids.length)return fail(res,400,'ترتيب الأعمال غير صالح');
    const actual=db.prepare('SELECT id FROM projects ORDER BY sort_order,id').all().map(x=>x.id);
    if(actual.length!==ids.length||actual.some(id=>!ids.includes(id)))return fail(res,409,'تغيّرت قائمة الأعمال؛ أعد تحميلها');
    const update=db.prepare('UPDATE projects SET sort_order=? WHERE id=?');db.exec('BEGIN');try{ids.forEach((id,i)=>update.run(i,id));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return send(res,200,{ok:true});
   }
   if(req.method==='POST'&&path==='/api/admin/uploads'){
    const d=await readBody(req,6_000_000),match=typeof d.data==='string'&&d.data.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/);
    if(!match)return fail(res,400,'صيغة الصورة غير مدعومة');
    const bytes=Buffer.from(match[2],'base64');if(!bytes.length||bytes.length>4*1024*1024)return fail(res,413,'الحد الأقصى لحجم الصورة 4 MB');
    const signatures={'image/png':[0x89,0x50,0x4e,0x47],'image/jpeg':[0xff,0xd8,0xff],'image/gif':[0x47,0x49,0x46,0x38],'image/webp':[0x52,0x49,0x46,0x46]};
    const sig=signatures[match[1]],valid=match[1]==='image/webp'?bytes.subarray(0,4).equals(Buffer.from(sig))&&bytes.toString('ascii',8,12)==='WEBP':bytes.subarray(0,sig.length).equals(Buffer.from(sig));
    if(!valid)return fail(res,400,'محتوى الملف لا يطابق نوع الصورة');
    const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif'}[match[1]],name=`${randomBytes(18).toString('hex')}.${ext}`,dir=resolve(PUBLIC_DIR,'uploads');mkdirSync(dir,{recursive:true});await writeFile(resolve(dir,name),bytes,{flag:'wx'});return send(res,201,{url:`/uploads/${name}`});
   }
   if(['POST','PUT'].includes(req.method)&&(/^\/api\/admin\/projects$/.test(path)||/^\/api\/admin\/projects\/\d+$/.test(path))){
    const d=await readBody(req),title=str(d.title,140,true),cat=str(d.cat,100,true),img=str(d.img,1000,req.method==='POST'&&!d.id),tags=str(d.tags,500)||'',btn=['purple','amber','rose'].includes(d.btn)?d.btn:'purple';if(!title||!cat||img===null)return fail(res,400,'العنوان والتصنيف ورابط الصورة مطلوبة');
    if(img.startsWith('/uploads/')){if(!/^\/uploads\/[a-f0-9]{36}\.(?:png|jpg|webp|gif)$/.test(img)||!existsSync(resolve(PUBLIC_DIR,'.'+img)))return fail(res,400,'ملف الصورة المرفوع غير موجود');}
    else if(img){let parsed;try{parsed=new URL(img);}catch{return fail(res,400,'رابط الصورة غير صالح');}if(!['http:','https:'].includes(parsed.protocol))return fail(res,400,'الرابط يجب أن يبدأ بـ HTTP أو HTTPS');}
    if(!img&&!d.id)return fail(res,400,'ارفع صورة أو أدخل رابطها');
    if(req.method==='POST'){const order=db.prepare('SELECT COALESCE(MAX(sort_order),-1)+1 n FROM projects').get().n,r=db.prepare('INSERT INTO projects(title,category,image_url,tags,button_color,sort_order) VALUES(?,?,?,?,?,?)').run(title,cat,img,tags,btn,order);return send(res,201,{id:Number(r.lastInsertRowid)});}
    const id=Number(path.split('/').at(-1));db.prepare('UPDATE projects SET title=?,category=?,image_url=?,tags=?,button_color=? WHERE id=?').run(title,cat,img||db.prepare('SELECT image_url FROM projects WHERE id=?').get(id)?.image_url||'',tags,btn,id);return send(res,200,{ok:true});
   }
   if(req.method==='DELETE'&&/^\/api\/admin\/projects\/\d+$/.test(path)){db.prepare('DELETE FROM projects WHERE id=?').run(Number(path.split('/').at(-1)));return send(res,200,{ok:true});}
   if(req.method==='GET'&&path==='/api/admin/settings')return send(res,200,{settings:settingsObject()});
   if(req.method==='PUT'&&path==='/api/admin/settings'){
    const d=await readBody(req),fields=['siteName','tagline','phone','email','whatsapp','address','about'],values={};for(const k of fields){values[k]=str(d[k],k==='about'?500:180,k==='siteName');if(values[k]===null)return fail(res,400,`قيمة غير صالحة: ${k}`);}
    for(const k of ['section_services','section_works','section_why','section_process','section_faq']){const v=str(d[k],1);if(v===null||(v&&v!=='0'&&v!=='1'))return fail(res,400,`قيمة غير صالحة: ${k}`);if(v)values[k]=v;}
    for(const k of ['logo','favicon']){const v=str(d[k],1000);if(v===null)return fail(res,400,`قيمة غير صالحة: ${k}`);if(v&&!/^\/uploads\/[a-f0-9]{36}\.(?:png|jpg|webp|gif)$/.test(v))return fail(res,400,`${k==='logo'?'الشعار':'أيقونة الصفحة'} يجب أن تكون صورة مرفوعة من اللوحة`);if(v&&!existsSync(resolve(PUBLIC_DIR,'.'+v)))return fail(res,400,'ملف الصورة المرفوعة غير موجود');values[k]=v;}
    if(values.email&&!/^\S+@\S+\.\S+$/.test(values.email))return fail(res,400,'البريد الإلكتروني غير صالح');
    const stmt=db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');db.exec('BEGIN');try{for(const[k,v]of Object.entries(values))stmt.run(k,v);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return send(res,200,{ok:true});
   }
   if(req.method==='POST'&&path==='/api/auth/password'){
    const d=await readBody(req),current=str(d.currentPassword,200,true),next=str(d.newPassword,200,true),row=db.prepare('SELECT * FROM admins WHERE username=?').get(session(req).username);
    if(!current||!next||next.length<12)return fail(res,400,'كلمة المرور الجديدة يجب أن تكون 12 حرفاً على الأقل');
    const oldHash=scryptSync(current,row.password_salt,64);if(!timingSafeEqual(oldHash,Buffer.from(row.password_hash,'hex')))return fail(res,400,'كلمة المرور الحالية غير صحيحة');
    if(current===next)return fail(res,400,'اختر كلمة مرور مختلفة عن الحالية');
    const salt=randomBytes(16).toString('hex'),hash=scryptSync(next,salt,64).toString('hex');db.prepare('UPDATE admins SET password_hash=?,password_salt=? WHERE id=?').run(hash,salt,row.id);
    for(const[token,sessionData]of sessions)if(sessionData.username===row.username)sessions.delete(token);
    const token=randomBytes(32).toString('base64url');sessions.set(token,{username:row.username,expires:Date.now()+SESSION_TTL});return send(res,200,{ok:true},{'Set-Cookie':setCookie(token)});
   }
   if(req.method==='POST'&&path==='/api/admin/avatar'){
    const d=await readBody(req),avatar=str(d.avatar,1000)||'';
    if(avatar){
     if(!/^\/uploads\/[a-f0-9]{36}\.(?:png|jpg|webp|gif)$/.test(avatar))return fail(res,400,'الصورة الشخصية يجب أن تكون صورة مرفوعة من اللوحة');
     if(!existsSync(resolve(PUBLIC_DIR,'.'+avatar)))return fail(res,400,'ملف الصورة المرفوعة غير موجود');
    }
    db.prepare('UPDATE admins SET avatar=? WHERE username=?').run(avatar,session(req).username);
    return send(res,200,{ok:true,avatar});
   }
   if(req.method==='POST'&&path==='/api/admin/profile'){
    const d=await readBody(req),current=typeof d.currentPassword==='string'?d.currentPassword:'';
    let newUsername=typeof d.username==='string'?d.username.trim():'';
    const newPassword=typeof d.newPassword==='string'?d.newPassword:'';
    const row=db.prepare('SELECT * FROM admins WHERE username=?').get(session(req).username);
    if(!row)return fail(res,401,'الحساب غير موجود');
    if(!current)return fail(res,400,'أدخل كلمة المرور الحالية للتأكيد');
    if(!timingSafeEqual(scryptSync(current,row.password_salt,64),Buffer.from(row.password_hash,'hex')))return fail(res,400,'كلمة المرور الحالية غير صحيحة');
    if(newUsername.length>40)return fail(res,400,'اسم المستخدم: 3 إلى 40 حرفاً إنجليزياً أو أرقاماً');
    let username=row.username,changePassword=false;
    if(newUsername&&newUsername!==row.username){
     if(!/^[A-Za-z0-9_.-]{3,40}$/.test(newUsername))return fail(res,400,'اسم المستخدم: 3 إلى 40 حرفاً إنجليزياً أو أرقاماً');
     if(db.prepare('SELECT 1 FROM admins WHERE username=? AND id<>?').get(newUsername,row.id))return fail(res,409,'اسم المستخدم مستخدم مسبقاً');
     username=newUsername;
    }
    if(newPassword){
     if(newPassword.length<12)return fail(res,400,'كلمة المرور الجديدة يجب أن تكون 12 حرفاً على الأقل');
     if(newPassword===current)return fail(res,400,'اختر كلمة مرور مختلفة عن الحالية');
     changePassword=true;
    }
    if(username===row.username&&!changePassword)return fail(res,400,'لا يوجد أي تغيير للحفظ');
    if(changePassword){
     const salt=randomBytes(16).toString('hex'),hash=scryptSync(newPassword,salt,64).toString('hex');
     db.prepare('UPDATE admins SET username=?,password_hash=?,password_salt=? WHERE id=?').run(username,hash,salt,row.id);
     for(const[token,sessionData]of sessions)if(sessionData.username===row.username||sessionData.username===username)sessions.delete(token);
     const token=randomBytes(32).toString('base64url');sessions.set(token,{username,expires:Date.now()+SESSION_TTL});
     return send(res,200,{ok:true,username,passwordChanged:true},{'Set-Cookie':setCookie(token)});
    }
    db.prepare('UPDATE admins SET username=? WHERE id=?').run(username,row.id);
    for(const sessionData of sessions.values())if(sessionData.username===row.username)sessionData.username=username;
    return send(res,200,{ok:true,username,passwordChanged:false});
   }
   if(req.method==='POST'&&path==='/api/admin/backups'){
    const name=`hadir-backup-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomBytes(3).toString('hex')}.sqlite`,file=resolve(BACKUP_DIR,name);await backup(db,file);
    const files=(await readdir(BACKUP_DIR)).filter(x=>/^hadir-(?:backup|auto)-[\dTZ-]+(?:-[a-f0-9]{6})?\.sqlite$/.test(x)).sort().reverse();for(const stale of files.slice(10))await unlink(resolve(BACKUP_DIR,stale));
    return send(res,201,{ok:true,name});
   }
   if(req.method==='GET'&&path==='/api/admin/backups'){
    const files=(await readdir(BACKUP_DIR)).filter(x=>/^hadir-(?:backup|auto)-[\dTZ-]+(?:-[a-f0-9]{6})?\.sqlite$/.test(x)).sort().reverse();return send(res,200,{items:files});
   }
   if(req.method==='GET'&&path.startsWith('/api/admin/backups/')){
    const name=path.slice('/api/admin/backups/'.length);if(basename(name)!==name||!/^hadir-(?:backup|auto)-[\dTZ-]+(?:-[a-f0-9]{6})?\.sqlite$/.test(name))return fail(res,400,'اسم النسخة غير صالح');
    const file=resolve(BACKUP_DIR,name);if(!existsSync(file))return fail(res,404,'النسخة الاحتياطية غير موجودة');const stat=await import('node:fs/promises').then(fs=>fs.stat(file));res.writeHead(200,{'Content-Type':'application/vnd.sqlite3','Content-Disposition':`attachment; filename="${name}"`,'Content-Length':stat.size,'Cache-Control':'no-store'});return createReadStream(file).pipe(res);
   }
   return fail(res,404,'مسار الإدارة غير موجود');
  }
  if(req.method==='GET'&&path==='/robots.txt'){const base=`https://${req.headers.host||'localhost'}`;res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});return res.end(`User-agent: *\nAllow: /\nDisallow: /admin.html\nDisallow: /uploads/\n\nSitemap: ${base}/sitemap.xml\n`);}
  if(req.method==='GET'&&path==='/sitemap.xml'){const base=`https://${req.headers.host||'localhost'}`;res.writeHead(200,{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'no-store'});return res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${base}/</loc></url></urlset>`);}
  if(req.method==='GET'){
   const requestedName=path.split('/').at(-1)||'';
   if(path.split('/').some(part=>part.startsWith('.'))||/^(?:.*\.(?:env|pem|key|p12|pfx|sqlite|db)|credentials(?:\..*)?|secrets?(?:\..*)?)$/i.test(requestedName))return fail(res,404,'الملف غير موجود');
   const file=path==='/'?resolve(PUBLIC_DIR,'index.html'):resolve(PUBLIC_DIR,'.'+path);
   if(file!==PUBLIC_DIR&&!file.startsWith(PUBLIC_DIR+sep))return fail(res,403,'ممنوع');
   if(!existsSync(file)){
    if((req.headers.accept||'').includes('text/html')){
     const notFound=resolve(PUBLIC_DIR,'404.html');
     if(existsSync(notFound)){res.writeHead(404,{'Content-Type':mime['.html'],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return createReadStream(notFound).pipe(res);}
    }
    return fail(res,404,'الملف غير موجود');
   }
   res.writeHead(200,{'Content-Type':mime[extname(file).toLowerCase()]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':extname(file).toLowerCase()==='.html'?'no-store':'public, max-age=300'});return createReadStream(file).pipe(res);
  }
  return fail(res,404,'المسار غير موجود');
 }catch(e){console.error(e);if(!res.headersSent)return fail(res,e.status||500,e.status?e.message:'خطأ داخلي في الخادم');res.destroy();}
});
if(!['127.0.0.1','localhost','::1'].includes(HOST)&&db.prepare('SELECT COUNT(*) n FROM admins').get().n===0&&!SETUP_SECRET)throw new Error('Set HADIR_SETUP_SECRET before exposing first-run setup on a public interface.');

async function autoBackup(){
 try{
  const stamp=new Date().toISOString().replace(/[:.]/g,'-'),file=resolve(BACKUP_DIR,`hadir-auto-${stamp}-${randomBytes(3).toString('hex')}.sqlite`);
  await backup(db,file);
  const autos=(await readdir(BACKUP_DIR)).filter(x=>/^hadir-auto-[\dTZ-]+(?:-[a-f0-9]{6})?\.sqlite$/.test(x)).sort().reverse();
  for(const stale of autos.slice(7))await unlink(resolve(BACKUP_DIR,stale));
 }catch(e){console.error('auto backup failed:',e.message);}
}
setTimeout(autoBackup,60_000);
setInterval(autoBackup,24*60*60*1000).unref();
server.listen(PORT,HOST,()=>console.log(`Hadir ready: http://${HOST}:${PORT} | SQLite: ${DB_PATH}`));
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>server.close(()=>{db.close();process.exit(0);}));
