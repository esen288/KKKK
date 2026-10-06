import {spawn} from 'node:child_process';
import {mkdtemp,rm,cp,writeFile,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'preview-dist');
const temp=await mkdtemp(path.join(tmpdir(),'novax-preview-build-'));
const password=randomBytes(24).toString('hex');
const port=Number(process.env.PREVIEW_BUILD_PORT||3210);
let browser;
const server=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',DATA_DIR:temp,ADMIN_USERNAME:'admin',ADMIN_PASSWORD:password,NODE_ENV:'test',COOKIE_SECURE:'false',SITE_URL:''},stdio:['ignore','pipe','pipe']});
try{
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Preview server timeout')),15000);server.stdout.on('data',chunk=>{if(chunk.toString().includes('Novax hazır')){clearTimeout(timer);resolve();}});server.once('exit',code=>{clearTimeout(timer);reject(new Error('Preview server exited: '+code));});});
 const response=await fetch(`http://127.0.0.1:${port}/api/content`);if(!response.ok)throw new Error('Content snapshot failed');const content=await response.json();
 await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});await cp(path.join(root,'public'),out,{recursive:true});
 // Only public content is exported. No credentials, database, session or uploads.
 for(const p of content.projects){if(!p.image.startsWith('/assets/'))throw new Error('Unexpected non-demo image');p.image='.'+p.image;}
 await writeFile(path.join(out,'content.json'),JSON.stringify(content,null,2));
 for(const filename of ['index.html','style.css','fonts.css','app.js']){
  let source=await readFile(path.join(out,filename),'utf8');
  if(filename==='index.html')source=source.replaceAll('href="/"','href="./"').replaceAll('href="/admin"','href="./yonetim-onizleme.html"').replace('Yönetim girişi ↗','Panel önizlemesi ↗').replace('<meta name="theme-color"','<meta name="robots" content="noindex,nofollow"><meta name="theme-color"');
  source=source.replaceAll('href="/','href="./').replaceAll('src="/','src="./').replaceAll("url('/","url('./").replace("fetch('/api/content')","fetch('./content.json')");
  await writeFile(path.join(out,filename),source);
 }
 await rm(path.join(out,'admin.html'));await rm(path.join(out,'admin.js'));await rm(path.join(out,'admin.css'));
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.goto(`http://127.0.0.1:${port}/admin`);
 await page.getByLabel('Kullanıcı adı').fill('admin');await page.getByLabel('Şifre',{exact:true}).fill(password);await page.getByRole('button',{name:'Güvenli giriş yap'}).click();await page.locator('.admin-project').first().waitFor();await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:path.join(out,'assets/admin-preview.png'),fullPage:true});
 await writeFile(path.join(out,'yonetim-onizleme.html'),`<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Novax | Panel önizlemesi</title><link rel="stylesheet" href="./style.css"></head><body><main class="container section"><a class="text-link" href="./">← Siteye dön</a><p class="eyebrow">NOVAX ÇATI SİSTEMLERİ</p><h1>Yönetim paneli önizlemesi</h1><p>Aşağıdaki görüntü, hazırlanan gerçek yönetim paneline aittir. Bu önizlemede düzenleme yapılamaz. Fotoğraf ekleme, silme ve içerik kaydetme özellikleri Node.js sunucusunda çalışır.</p><img src="./assets/admin-preview.png" width="1440" alt="Novax yönetim paneli: proje fotoğrafları, düzenle ve sil düğmeleri, hizmet ve iletişim yönetimi menüsü"></main></body></html>`);
 await writeFile(path.join(out,'.nojekyll'),'');await writeFile(path.join(out,'robots.txt'),'User-agent: *\nDisallow: /\n');
 console.log('Static preview prepared in preview-dist. Includes public content and admin screenshot only.');
}finally{
 if(browser)await browser.close();
 if(server.exitCode===null){const ended=new Promise(r=>server.once('exit',r));server.kill();await ended;}
 await rm(temp,{recursive:true,force:true});
}
