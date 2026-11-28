import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { execPath } from 'node:process';
import { createServer } from 'node:net';
import { mkdtemp, readdir, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

let child, base, cookie='', tempDir;
const uploadedFiles=[];
async function freePort(){
  const s=createServer();
  await new Promise((resolve,reject)=>s.once('error',reject).listen(0,'127.0.0.1',resolve));
  const port=s.address().port;
  await new Promise(resolve=>s.close(resolve));
  return port;
}
async function api(path,{method='GET',body,auth=true,headers={}}={}){
  const response=await fetch(base+path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(auth&&cookie?{cookie}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const setCookie=response.headers.get('set-cookie');
  if(setCookie)cookie=setCookie.split(';')[0];
  const data=await response.json().catch(()=>({}));
  return {status:response.status,data};
}

before(async()=>{
  tempDir=await mkdtemp(join(tmpdir(),'hadir-test-'));
  const port=await freePort();base=`http://127.0.0.1:${port}`;
  child=spawn(execPath,['server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),HOST:'127.0.0.1',HADIR_DB:join(tempDir,'test.sqlite')},stdio:['ignore','pipe','pipe']});
  let logs='';child.stdout.on('data',c=>logs+=c);child.stderr.on('data',c=>logs+=c);
  const until=Date.now()+10000;
  while(Date.now()<until){
    if(child.exitCode!==null)throw new Error(`Test server exited: ${logs}`);
    try{const r=await fetch(base+'/api/health');if(r.ok)return;}catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  throw new Error(`Test server failed to start: ${logs}`);
});
after(async()=>{
  if(child){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}
  for(const file of uploadedFiles)await rm(file,{force:true});
  try{if((await readdir(resolve('public/uploads'))).length===0)await rmdir(resolve('public/uploads'));}catch{}
  if(tempDir)await rm(tempDir,{recursive:true,force:true});
});

test('health, security headers, and first-run setup',async()=>{
  const health=await fetch(base+'/api/health');
  assert.deepEqual(await health.json(),{ok:true,database:'sqlite'});
  assert.equal(health.headers.get('x-frame-options'),'SAMEORIGIN');
  assert.equal(health.headers.get('x-content-type-options'),'nosniff');
  assert.equal((await fetch(base+'/.env')).status,404);
  assert.equal((await fetch(base+'/credentials.json')).status,404);
  assert.equal((await api('/api/messages',{method:'POST',auth:false,headers:{origin:'https://evil.example'},body:{name:'Blocked',phone:'+212600123456',type:'site'}})).status,403);
  assert.deepEqual((await api('/api/health')).data,{ok:true,database:'sqlite'});
  assert.equal((await api('/api/setup/status')).data.needsSetup,true);
  const tooShort=await api('/api/setup',{method:'POST',body:{username:'admin',password:'weak'}});
  assert.equal(tooShort.status,400);
  const setup=await api('/api/setup',{method:'POST',body:{username:'admin-test',password:'a-strong-password-123'}});
  assert.equal(setup.status,201);assert.ok(cookie.startsWith('hadir_session='));
  assert.equal((await api('/api/setup/status')).data.needsSetup,false);
  assert.equal((await api('/api/setup',{method:'POST',body:{username:'another',password:'another-strong-password'}})).status,409);
});

test('public content, contact validation, persistent messages',async()=>{
  const pub=(await api('/api/public',{auth:false})).data;
  assert.equal(pub.services.length,6);assert.equal(pub.projects.length,6);assert.equal(pub.settings.siteName,'Hadir');
  const invalid=await api('/api/messages',{method:'POST',auth:false,body:{name:'X',phone:'bad',type:'site'}});
  assert.equal(invalid.status,400);
  const created=await api('/api/messages',{method:'POST',auth:false,body:{name:'Test Customer',phone:'+212600123456',email:'test@example.com',type:'موقع شركة',msg:'طلب اختبار'}});
  assert.equal(created.status,201);
  const unauth=await api('/api/admin/dashboard',{auth:false});assert.equal(unauth.status,401);
  const dashboard=await api('/api/admin/dashboard');assert.equal(dashboard.data.messages[0].id,created.data.id);assert.equal(dashboard.data.messages[0].read,false);
});

test('admin CRUD, settings, read status, logout',async()=>{
  const s=await api('/api/admin/services',{method:'POST',body:{icon:'🧪',title:'خدمة اختبار',desc:'وصف اختبار'}});assert.equal(s.status,201);
  assert.equal((await api(`/api/admin/services/${s.data.id}`,{method:'PUT',body:{icon:'✅',title:'خدمة معدلة',desc:'وصف جديد'}})).status,200);
  assert.ok((await api('/api/admin/services')).data.items.some(x=>x.title==='خدمة معدلة'));
  assert.equal((await api(`/api/admin/services/${s.data.id}`,{method:'DELETE'})).status,200);

  const p=await api('/api/admin/projects',{method:'POST',body:{title:'عمل اختبار',cat:'اختبار',img:'https://example.com/image.jpg',tags:'أ,ب',btn:'rose'}});assert.equal(p.status,201);
  assert.equal((await api(`/api/admin/projects/${p.data.id}`,{method:'PUT',body:{title:'عمل معدل',cat:'اختبار',img:'https://example.com/image.jpg',tags:'ج',btn:'purple'}})).status,200);
  assert.ok((await api('/api/admin/projects')).data.items.some(x=>x.title==='عمل معدل'));
  assert.equal((await api(`/api/admin/projects/${p.data.id}`,{method:'DELETE'})).status,200);

  const setting={siteName:'Hadir اختبار',tagline:'Agency',phone:'+212 600 000 000',email:'hello@example.com',whatsapp:'212600000000',address:'Rabat',about:'تذييل'};
  assert.equal((await api('/api/admin/settings',{method:'PUT',body:setting})).status,200);
  assert.equal((await api('/api/public',{auth:false})).data.settings.siteName,setting.siteName);
  const messages=(await api('/api/admin/dashboard')).data.messages;
  assert.equal((await api(`/api/admin/messages/${messages[0].id}/read`,{method:'PATCH'})).status,200);
  assert.equal((await api('/api/admin/dashboard')).data.messages[0].read,true);
  const statusChange=await api(`/api/admin/messages/${messages[0].id}/status`,{method:'PATCH',body:{status:'followup'}});
  assert.equal(statusChange.status,200);assert.equal((await api('/api/admin/dashboard')).data.messages[0].status,'followup');
  assert.equal((await api(`/api/admin/messages/${messages[0].id}/status`,{method:'PATCH',body:{status:'bogus'}})).status,400);

  const services=(await api('/api/admin/services')).data.items;
  assert.equal((await api('/api/admin/services/order',{method:'POST',body:{ids:services.map(x=>x.id).reverse()}})).status,200);
  assert.deepEqual((await api('/api/admin/services')).data.items.map(x=>x.id),services.map(x=>x.id).reverse());
  assert.equal((await api('/api/admin/services/order',{method:'POST',body:{ids:[services[0].id]}})).status,409);

  const projects=(await api('/api/admin/projects')).data.items;
  assert.equal((await api('/api/admin/projects/order',{method:'POST',body:{ids:projects.map(x=>x.id).reverse()}})).status,200);
  assert.deepEqual((await api('/api/admin/projects')).data.items.map(x=>x.id),projects.map(x=>x.id).reverse());

  assert.equal((await api('/api/admin/uploads',{method:'POST',body:{data:'data:image/svg+xml;base64,PHN2Zz4='}})).status,400);
  const tinyPng=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00,0x00,0x00,0x00]);
  const uploaded=await api('/api/admin/uploads',{method:'POST',body:{data:`data:image/png;base64,${tinyPng.toString('base64')}`}});
  assert.equal(uploaded.status,201);uploadedFiles.push(resolve('public',`.${uploaded.data.url}`));
  assert.equal((await api('/api/admin/projects',{method:'POST',body:{title:'صورة مرفوعة',cat:'اختبار',img:uploaded.data.url}})).status,201);

  const backup=await api('/api/admin/backups',{method:'POST',body:{}});assert.equal(backup.status,201);
  const listing=await api('/api/admin/backups');assert.ok(listing.data.items.includes(backup.data.name));
  const download=await fetch(`${base}/api/admin/backups/${backup.data.name}`,{headers:{cookie}});assert.equal(download.status,200);
  const backupBytes=Buffer.from(await download.arrayBuffer());assert.equal(backupBytes.subarray(0,16).toString(),'SQLite format 3\0');
  const snapshotPath=join(tempDir,'snapshot.sqlite');await import('node:fs/promises').then(fs=>fs.writeFile(snapshotPath,backupBytes));
  const snapshot=new DatabaseSync(snapshotPath,{readOnly:true});assert.equal(snapshot.prepare('SELECT COUNT(*) n FROM admins').get().n,1);snapshot.close();

  assert.equal((await api('/api/auth/password',{method:'POST',body:{currentPassword:'wrong-password',newPassword:'another-strong-password-456'}})).status,400);
  assert.equal((await api('/api/auth/password',{method:'POST',body:{currentPassword:'a-strong-password-123',newPassword:'another-strong-password-456'}})).status,200);
  assert.equal((await api('/api/admin/dashboard')).status,200);
  assert.equal((await api('/api/auth/logout',{method:'POST'})).status,200);cookie='';
  assert.equal((await api('/api/admin/dashboard')).status,401);
  assert.equal((await api('/api/auth/login',{method:'POST',body:{username:'admin-test',password:'a-strong-password-123'}})).status,401);
  const login=await api('/api/auth/login',{method:'POST',body:{username:'admin-test',password:'another-strong-password-456'}});
  assert.equal(login.status,200);assert.ok(cookie.startsWith('hadir_session='));
});
