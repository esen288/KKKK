import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,cp,writeFile,readFile,rm,access,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import sharp from 'sharp';
import {chromium} from '@playwright/test';
const runtime=process.env.NOVAX_PHP_RUNTIME||'/workspace/.novax-tools/runtime';
const env={...process.env,LD_LIBRARY_PATH:path.join(runtime,'usr/lib/x86_64-linux-gnu')};
const base='http://127.0.0.1:3222';
const suffix=randomBytes(5).toString('hex'),dbName='novax_test_'+suffix,dbUser='nv_'+suffix,dbPass=randomBytes(16).toString('hex'),adminPass='test-only-password-2026',installKey=randomBytes(24).toString('hex');
let temp,site,apache,cookie='',csrf='',config,projectId,imageUrl,serviceId;
function sql(input){return execFileSync(path.join(runtime,'usr/bin/mariadb'),['--no-defaults','--socket=/tmp/novax-mysql.sock','-uroot'],{input,env,encoding:'utf8'});}
async function request(route,{method='GET',body,headers={}}={}){
 let data=body;if(body && !(body instanceof FormData)&&!(body instanceof URLSearchParams)&&typeof body!=='string')data=JSON.stringify(body);
 const real=['PUT','DELETE'].includes(method)?'POST':method;
 const url=route.startsWith('/')?base+route:base+'/api.php?route='+encodeURIComponent(route);
 const r=await fetch(url,{method:real,headers:{...(data instanceof FormData||data instanceof URLSearchParams?{}:{'Content-Type':'application/json'}),...(cookie?{cookie}:{}),'X-CSRF-Token':csrf,...(real!==method?{'X-HTTP-Method-Override':method}:{}),...headers},body:data,redirect:'manual'});
 for(const c of r.headers.getSetCookie()){if(c.startsWith('novax_admin='))cookie=c.split(';')[0];}
 return r;
}
async function startApache(){
 apache=spawn(path.join(runtime,'usr/sbin/apache2'),['-f',config,'-DFOREGROUND'],{env,detached:true,stdio:['ignore','pipe','pipe']});
 let errors='';apache.stderr.on('data',d=>errors+=d.toString());
 for(let i=0;i<60;i++){try{const r=await fetch(base+'/install.php');if(r.status>0)return;}catch{}if(apache.exitCode!==null)throw new Error('Apache failed: '+errors);await new Promise(r=>setTimeout(r,100));}
 throw new Error('Apache timeout '+errors);
}
async function stopApache(){if(apache&&apache.exitCode===null){const done=new Promise(r=>apache.once('exit',r));apache.kill('SIGTERM');await done;}}
before(async()=>{
 temp=await mkdtemp(path.join(tmpdir(),'novax-php-test-'));site=path.join(temp,'site');await cp('hostinger',site,{recursive:true});
 sql(`CREATE DATABASE ${dbName} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; CREATE USER '${dbUser}'@'127.0.0.1' IDENTIFIED BY '${dbPass}'; GRANT ALL ON ${dbName}.* TO '${dbUser}'@'127.0.0.1';`);
 const module=name=>`LoadModule ${name}_module "${runtime}/usr/lib/apache2/modules/mod_${name}.so"`;
 config=path.join(temp,'apache.conf');await writeFile(config,`ServerRoot "${temp}"
ServerName 127.0.0.1
Listen 127.0.0.1:3222
PidFile "${temp}/apache.pid"
ErrorLog "${temp}/apache.log"
${['mpm_prefork','authz_core','authz_host','dir','mime','headers','rewrite','alias'].map(module).join('\n')}
LoadModule php_module "${runtime}/usr/lib/apache2/modules/libphp8.4.so"
PHPIniDir "/workspace/.novax-tools"
User agent
Group agent
StartServers 1
MinSpareServers 1
MaxSpareServers 2
MaxRequestWorkers 4
TypesConfig /etc/mime.types
DocumentRoot "${site}"
Alias /sub/ "${site}/"
<Directory "${site}">
 Require all granted
 AllowOverride All
 Options -Indexes
</Directory>
<FilesMatch "\\.php$">
 SetHandler application/x-httpd-php
</FilesMatch>
`);
 await startApache();
});
after(async()=>{await stopApache();sql(`DROP DATABASE IF EXISTS ${dbName}; DROP USER IF EXISTS '${dbUser}'@'127.0.0.1';`);if(temp)await rm(temp,{recursive:true,force:true});});
test('Hostinger PHP/MySQL installation and application',async t=>{
 await t.test('installer locked until owner configures private key',async()=>{
  const r=await request('/install.php');assert.equal(r.status,200);assert.match(await r.text(),/Önce kurulum kilidini açın/);
  assert.equal((await request('content')).status,503);
  const home=await request('/');assert.equal(home.status,302);assert.equal(home.headers.get('location'),'./install.php');
  await writeFile(path.join(site,'private/install-key.php'),`<?php if(!defined('NOVAX')){http_response_code(404);exit;} return '${installKey}';`);
  const page=await(await request('/install.php')).text();csrf=/name="csrf" value="([a-f0-9]+)"/.exec(page)?.[1];assert.ok(csrf);
 });
 const installForm=()=>new URLSearchParams({csrf,install_key:installKey,db_host:'127.0.0.1',db_port:'3307',db_name:dbName,db_user:dbUser,db_password:dbPass,admin_username:'admin',admin_password:adminPass,admin_confirm:adminPass});
 await t.test('installer rejects missing key and invalid CSRF',async()=>{const f=installForm();f.set('install_key','wrong');assert.equal((await request('/install.php',{method:'POST',body:f})).status,400);f.set('csrf','wrong');assert.equal((await request('/install.php',{method:'POST',body:f})).status,403);});
 await t.test('actual MySQL installation, config persistence and installer lockout',async()=>{
  const r=await request('/install.php',{method:'POST',body:installForm()});assert.equal(r.status,200,await r.clone().text());assert.match(await r.text(),/Siteniz hazır/);
  await access(path.join(site,'private/config.php'));await assert.rejects(access(path.join(site,'private/install-key.php')));
  assert.equal((await request('/install.php')).status,404);
  const c=await(await request('content')).json();assert.equal(c.settings.phone,'05060921806');assert.equal(c.projects.length,3);assert.equal(c.services.length,4);
 });
 await t.test('Apache protects private files, SQL backups and uploads from code execution',async()=>{
  for(const file of ['private/config.php','private/default-content.json','.user.ini','.htaccess'])assert.equal((await request('/'+file)).status,403,file);
  await writeFile(path.join(site,'uploads/probe.php'),'<?php echo "NEVER_EXECUTE";');await writeFile(path.join(site,'backup.sql'),'private');
  assert.equal((await request('/uploads/probe.php')).status,403);assert.equal((await request('/backup.sql')).status,403);
  const admin=await request('/admin');assert.equal(admin.status,302);assert.ok(admin.headers.get('location').endsWith('/admin.php'));
 });
 await t.test('authentication, login CSRF and foreign-origin checks',async()=>{
  assert.equal((await request('admin/session')).status,401);csrf=(await(await request('csrf')).json()).csrf;
  assert.equal((await request('login',{method:'POST',body:{username:'admin',password:'wrong'},headers:{'X-CSRF-Token':'wrong'}})).status,403);
  assert.equal((await request('login',{method:'POST',body:{username:'admin',password:adminPass},headers:{Origin:'https://attacker.example'}})).status,403);
  assert.equal((await request('login',{method:'POST',body:{username:'admin',password:'wrong'}})).status,401);
  const r=await request('login',{method:'POST',body:{username:'admin',password:adminPass}});assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly/i);csrf=(await r.json()).csrf;
 });
 await t.test('redesigned desktop/mobile pages render all images and fonts',async()=>{
  const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
  try{
   const page=await browser.newPage({viewport:{width:1440,height:1000}});const bad=[];page.on('response',r=>{if(r.status()>=400)bad.push(r.status()+' '+r.url());});
   await page.goto(base+'/');await page.locator('.project-card').first().waitFor();await page.evaluate(()=>document.fonts.ready);await page.locator('footer').scrollIntoViewIfNeeded();await page.waitForTimeout(250);await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'/tmp/novax-hostinger-desktop.png',fullPage:true});
   await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/novax-hostinger-mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/admin.php');await page.screenshot({path:'/tmp/novax-hostinger-login.png',fullPage:true});
   await page.getByLabel('Kullanıcı adı').fill('admin');await page.getByLabel('Şifre',{exact:true}).fill(adminPass);await page.getByRole('button',{name:'Güvenli giriş yap'}).click();await page.locator('.admin-project').first().waitFor();await page.screenshot({path:'/tmp/novax-hostinger-admin.png',fullPage:true});
   assert.deepEqual(bad.filter(x=>!x.includes('route=admin%2Fsession')),[]);
  }finally{await browser.close();}
 });
 await t.test('settings validation and MySQL persistence',async()=>{
  const c=await(await request('content')).json();
  assert.equal((await request('admin/settings',{method:'PUT',body:{...c.settings,mapUrl:'javascript:alert(1)'}})).status,400);
  assert.equal((await request('admin/settings',{method:'PUT',body:{...c.settings,area:'Ankara test bölgesi',about:'Türkçe: çatı, ısı, yağmur.'},headers:{'X-CSRF-Token':'wrong'}})).status,403);
  assert.equal((await request('admin/settings',{method:'PUT',body:{...c.settings,area:'Ankara test bölgesi',about:'Türkçe: çatı, ısı, yağmur.'}})).status,200);
  assert.equal((await(await request('content')).json()).settings.area,'Ankara test bölgesi');
 });
 await t.test('services support create, unavailable, edit and delete',async()=>{
  const r=await request('admin/services',{method:'POST',body:{title:'Test hizmeti',description:'Bu iş yapılmıyor.',available:false}});assert.equal(r.status,201);serviceId=(await r.json()).id;
  let c=await(await request('content')).json();assert.equal(c.services.find(s=>s.id===serviceId).available,0);
  assert.equal((await request('admin/services/'+serviceId,{method:'PUT',body:{title:'Test hizmeti düzenlendi',description:'Yapılıyor',available:true}})).status,200);
  c=await(await request('content')).json();assert.equal(c.services.find(s=>s.id===serviceId).available,1);
  assert.equal((await request('admin/services/'+serviceId,{method:'DELETE'})).status,200);
 });
 await t.test('rejects executable/SVG uploads before saving',async()=>{
  const f=new FormData();f.set('title','Test');f.set('category','Test');f.set('description','Test');f.set('image',new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],{type:'image/svg+xml'}),'fake.jpg');
  assert.equal((await request('admin/projects',{method:'POST',body:f})).status,400);
 });
 await t.test('GD photo conversion, project edit, replace and cleanup',async()=>{
  const png=await sharp({create:{width:2400,height:1800,channels:3,background:'#173d34'}}).png().toBuffer();
  const form=()=>{const f=new FormData();f.set('title','Gerçek test çatısı');f.set('category','Çatı');f.set('description','Gerçek yükleme testi.');return f;};
  const f=form();f.set('image',new Blob([png],{type:'image/png'}),'roof.png');const r=await request('admin/projects',{method:'POST',body:f});assert.equal(r.status,201,await r.clone().text());projectId=(await r.json()).id;
  let c=await(await request('content')).json();const p=c.projects.find(p=>p.id===projectId);assert.equal(p.demo,0);imageUrl=p.image;
  const img=await request('/'+imageUrl);assert.equal(img.status,200);assert.match(img.headers.get('content-type'),/image\/webp/);const meta=await sharp(Buffer.from(await img.arrayBuffer())).metadata();assert.equal(meta.width,1800);assert.equal(meta.height,1350);
  const edit=form();edit.set('description','Düzenlenmiş açıklama');assert.equal((await request('admin/projects/'+projectId,{method:'PUT',body:edit})).status,200);
  assert.equal((await(await request('content')).json()).projects.find(p=>p.id===projectId).image,imageUrl);
  const replacement=form();replacement.set('image',new Blob([png],{type:'image/png'}),'new.png');assert.equal((await request('admin/projects/'+projectId,{method:'PUT',body:replacement})).status,200);
  assert.equal((await request('/'+imageUrl)).status,404);imageUrl=(await(await request('content')).json()).projects.find(p=>p.id===projectId).image;
 });
 await t.test('server restart retains MySQL records, image and authenticated session',async()=>{
  await stopApache();await startApache();assert.equal((await(await request('content')).json()).settings.area,'Ankara test bölgesi');assert.equal((await request('/'+imageUrl)).status,200);assert.equal((await request('admin/session')).status,200);
 });
 await t.test('browser mobile layout, login, photo UI and project-path support',async()=>{
  const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
  try{
   const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base+'/sub/');await page.locator('.project-card').first().waitFor();assert.equal(await page.locator('.project-card').count(),4);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.equal(await page.locator('[data-phone]').first().getAttribute('href'),'tel:+905060921806');
   await page.goto(base+'/admin.php');await page.getByLabel('Kullanıcı adı').fill('admin');await page.getByLabel('Şifre',{exact:true}).fill(adminPass);await page.getByRole('button',{name:'Güvenli giriş yap'}).click();await page.locator('#dashboard').waitFor({state:'visible'});await page.locator('.admin-project').first().waitFor();
   await page.getByRole('button',{name:'Yeni proje ekle'}).click();await page.getByLabel('Başlık',{exact:true}).fill('UI test projesi');await page.getByLabel('Kategori',{exact:true}).fill('Onarım');await page.getByLabel('Açıklama',{exact:true}).fill('Tarayıcıdan kaydedildi.');const buffer=await sharp({create:{width:320,height:240,channels:3,background:'#ee9a67'}}).png().toBuffer();await page.locator('input[type=file]').setInputFiles({name:'roof.png',mimeType:'image/png',buffer});await page.locator('#editor-form').getByRole('button',{name:'Kaydet'}).click();await page.locator('#edit-dialog').waitFor({state:'hidden'});await page.locator('.admin-project').filter({hasText:'UI test projesi'}).waitFor();
   await page.getByRole('button',{name:'İşletme & iletişim'}).click();await page.getByLabel('Hizmet bölgesi').fill('Ankara ve çevresi');await page.getByRole('button',{name:'Değişiklikleri kaydet'}).click();await page.getByText('İşletme bilgileri kaydedildi.',{exact:true}).waitFor();
   await page.getByRole('button',{name:'Çıkış yap'}).click();await page.locator('#login-view').waitFor({state:'visible'});await page.getByLabel('Kullanıcı adı').fill('admin');await page.getByLabel('Şifre',{exact:true}).fill(adminPass);await page.getByRole('button',{name:'Güvenli giriş yap'}).click();await page.locator('#dashboard').waitFor({state:'visible'});
   assert.deepEqual(errors,[]);
  }finally{await browser.close();}
 });
 await t.test('project deletion removes stored photo',async()=>{assert.equal((await request('admin/projects/'+projectId,{method:'DELETE'})).status,200);assert.equal((await request('/'+imageUrl)).status,404);});
 await t.test('password update invalidates sessions and old password',async()=>{
  const oldCookie=cookie;
  assert.equal((await request('admin/password',{method:'PUT',body:{current:adminPass,password:'new-test-only-password-2026'}})).status,200);
  cookie=oldCookie;assert.equal((await request('admin/session')).status,401);
  csrf=(await(await request('csrf')).json()).csrf;
  assert.equal((await request('login',{method:'POST',body:{username:'admin',password:adminPass}})).status,401);
  assert.equal((await request('login',{method:'POST',body:{username:'admin',password:'new-test-only-password-2026'}})).status,200);
 });
});
