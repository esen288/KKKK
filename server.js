import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import sharp from 'sharp';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'novax.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admin (id INTEGER PRIMARY KEY CHECK(id=1), username TEXT NOT NULL, password TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL, image TEXT NOT NULL, demo INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS services (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, available INTEGER NOT NULL DEFAULT 1);`);
export function hashPassword(password) { const salt = randomBytes(16).toString('hex'); return salt + ':' + scryptSync(password, salt, 64).toString('hex'); }
function verifyPassword(value, stored) { const [salt, hash] = stored.split(':'); return timingSafeEqual(Buffer.from(hash, 'hex'), scryptSync(value, salt, 64)); }
const initial = {
 brand: 'Novax Çatı Sistemleri', phone: '05060921806', whatsapp: '905060921806',
 area: 'Hizmet bölgesi ve keşif için bize ulaşın.', address: '', hours: 'Çalışma saatleri için bize ulaşın.',
 mapUrl: 'https://www.google.com/maps/search/?api=1&query=Novax+%C3%87at%C4%B1+Sistemleri+39.7467374,32.5710355',
 about: 'Her çatının ihtiyacı farklıdır. Novax Çatı Sistemleri olarak mevcut çatınızı, beklentilerinizi ve kullanılacak malzemeleri birlikte değerlendiriyoruz. İşin kapsamını konuşalım; yapınıza uygun çözümü birlikte belirleyelim.',
 heroTitle: 'Çatınız sağlam. İçiniz rahat.', heroText: 'Yeni bir çatı, yenilenen bir yaşam alanı. Çatı sistemleri için ihtiyacınızı birlikte değerlendirelim, yapınıza uygun çözümü planlayalım.'
};
if (!db.prepare('SELECT id FROM settings').get()) db.prepare('INSERT INTO settings VALUES(1,?)').run(JSON.stringify(initial));
if (!db.prepare('SELECT id FROM admin').get()) {
 const pw = process.env.ADMIN_PASSWORD;
 if (!pw || pw.length < 12) { console.error('İlk kurulum gerekli: npm run setup komutunu çalıştırın veya en az 12 karakterlik ADMIN_PASSWORD tanımlayın.'); process.exit(1); }
 db.prepare('INSERT INTO admin VALUES(1,?,?)').run(process.env.ADMIN_USERNAME || 'admin', hashPassword(pw));
 const insert = db.prepare('INSERT INTO services VALUES(?,?,?,?)');
 for (const [title, description] of [
  ['Çatı yapımı & yenileme','Yeni çatı uygulaması ve mevcut çatının yenilenmesi hakkında bilgi alın. Yapınıza uygun kapsam keşif sırasında netleştirilir.'],
  ['Çatı onarımı','Hasarlı kaplama, bağlantı ve detayların değerlendirilmesi için bizimle iletişime geçin.'],
  ['Isı & su yalıtımı','Çatınızın yalıtım ihtiyacını ve uygulanabilecek malzeme seçeneklerini birlikte değerlendirelim.'],
  ['Oluk & yağmur sistemleri','Yağmur suyunun yönlendirilmesi, oluk ve iniş detayları için çözüm seçeneklerini konuşalım.']
 ]) insert.run(randomUUID(), title, description, 1);
 const p = db.prepare('INSERT INTO projects VALUES(?,?,?,?,?,?,?)');
 for (const [i,title,category,description] of [
  [1,'Kiremit çatının zamansız çizgisi','Çatı sistemleri','Kiremit çatı görünümünü anlatan temsili çalışma. Tamamlanmış müşteri projesi değildir.'],
  [2,'Modern yapılara net bir dokunuş','Metal çatı','Metal çatı tasarımını anlatan temsili çalışma. Malzeme ve uygulama uygunluğu keşifte değerlendirilir.'],
  [3,'Her detayda bütünlük','Çatı detayları','Çatı ve yağmur sistemi bütünlüğünü anlatan temsili çalışma. Tamamlanmış müşteri projesi değildir.']
 ]) p.run(randomUUID(),title,category,description,`/assets/project-${i}.svg`,1,Date.now()+i);
}
const app = express();
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],imgSrc:["'self'",'blob:','data:'],scriptSrc:["'self'"],styleSrc:["'self'"],connectSrc:["'self'"],fontSrc:["'self'"],upgradeInsecureRequests:process.env.NODE_ENV==='production'?[]:null}}, referrerPolicy:{policy:'strict-origin-when-cross-origin'}}));
app.use(express.json({limit:'40kb'}));
app.use('/api', (_req,res,next)=>{res.set('Cache-Control','no-store');next();});
app.use('/api', rateLimit({windowMs:60000,limit:180,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Çok fazla istek. Bir dakika sonra tekrar deneyin.'}}));
const loginLimit = rateLimit({windowMs:15*60000,limit:12,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Çok fazla giriş denemesi. 15 dakika sonra tekrar deneyin.'}});
const cookieSecure = process.env.COOKIE_SECURE === 'true' || (process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false');
const cookieOptions = {httpOnly:true,sameSite:'strict',secure:cookieSecure,path:'/'};
const digest = t=>createHash('sha256').update(t).digest('hex');
function auth(req,res,next) {
 const token = /(?:^|;\s*)novax_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie||'')?.[1];
 const session = token && db.prepare('SELECT * FROM sessions WHERE id=? AND expires>?').get(digest(token), Date.now());
 if(!session) return res.status(401).json({error:'Oturum açmanız gerekiyor.'});
 req.session=session;
 if(!['GET','HEAD','OPTIONS'].includes(req.method) && req.get('X-CSRF-Token')!==session.csrf) return res.status(403).json({error:'Güvenlik doğrulaması başarısız. Sayfayı yenileyin.'});
 next();
}
function str(value,max=5000) {if(typeof value!=='string'||value.length>max) throw new Error('Geçersiz veya çok uzun metin.');return value.trim();}
function required(value,max=120) {const result=str(value,max);if(!result) throw new Error('Gerekli alanları doldurun.');return result;}
const settings = ()=>JSON.parse(db.prepare('SELECT value FROM settings WHERE id=1').get().value);
app.get('/api/content', (_req,res)=>res.json({settings:settings(),services:db.prepare('SELECT * FROM services ORDER BY rowid').all(),projects:db.prepare('SELECT * FROM projects ORDER BY created DESC').all()}));
app.post('/api/login', loginLimit, (req,res)=>{
 const origin=req.get('origin');
 const expected=process.env.SITE_URL ? new URL(process.env.SITE_URL).origin : `${req.protocol}://${req.get('host')}`;
 if(origin && origin!==expected) return res.status(403).json({error:'Geçersiz istek kaynağı.'});
 const {username,password}=req.body||{};
 if(typeof username!=='string'||typeof password!=='string'||password.length>256) return res.status(400).json({error:'Geçersiz giriş bilgileri.'});
 const admin=db.prepare('SELECT * FROM admin WHERE id=1').get();
 const valid=verifyPassword(password,admin.password);
 if(!valid||username!==admin.username) return res.status(401).json({error:'Kullanıcı adı veya şifre hatalı.'});
 db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
 const token=randomBytes(32).toString('hex'), csrf=randomBytes(24).toString('hex');
 db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token),csrf,Date.now()+8*3600000);
 res.cookie('novax_session',token,{...cookieOptions,maxAge:8*3600000}).json({csrf});
});
app.get('/api/admin/session',auth,(req,res)=>res.json({csrf:req.session.csrf,username:db.prepare('SELECT username FROM admin WHERE id=1').get().username}));
app.post('/api/admin/logout',auth,(req,res)=>{db.prepare('DELETE FROM sessions WHERE id=?').run(req.session.id);res.clearCookie('novax_session',cookieOptions).json({ok:true});});
app.put('/api/admin/settings',auth,(req,res)=>{
 const s={};for(const [key,max] of Object.entries({brand:100,phone:24,whatsapp:24,area:250,address:500,hours:250,mapUrl:1000,about:5000,heroTitle:100,heroText:500})) s[key]=str(req.body[key],max);
 if(!s.brand||!s.heroTitle||!s.heroText) throw new Error('İşletme adı ve giriş metinleri boş olamaz.');
 if(!/^\+?[\d\s()-]{10,24}$/.test(s.phone)||!/^\+?[\d\s()-]{10,24}$/.test(s.whatsapp)) throw new Error('Geçerli telefon ve WhatsApp numarası girin.');
 if(s.mapUrl){ const u=new URL(s.mapUrl);if(u.protocol!=='https:'||!['google.com','www.google.com','maps.google.com','maps.app.goo.gl'].includes(u.hostname)||u.username||u.password) throw new Error('HTTPS Google Haritalar bağlantısı kullanın.'); }
 db.prepare('UPDATE settings SET value=? WHERE id=1').run(JSON.stringify(s));res.json({ok:true});
});
app.put('/api/admin/password',auth,(req,res)=>{
 const current=required(req.body.current,256),password=required(req.body.password,256);
 if(password.length<12) throw new Error('Yeni şifre en az 12 karakter olmalı.');
 const admin=db.prepare('SELECT * FROM admin WHERE id=1').get();
 if(!verifyPassword(current,admin.password)) return res.status(400).json({error:'Mevcut şifre yanlış.'});
 db.prepare('UPDATE admin SET password=? WHERE id=1').run(hashPassword(password));db.exec('DELETE FROM sessions');res.clearCookie('novax_session',cookieOptions).json({ok:true});
});
app.post('/api/admin/services',auth,(req,res)=>{
 if(db.prepare('SELECT count(*) AS n FROM services').get().n>=30) throw new Error('En fazla 30 hizmet eklenebilir.');
 const id=randomUUID();db.prepare('INSERT INTO services VALUES(?,?,?,?)').run(id,required(req.body.title),required(req.body.description,2000),req.body.available===false?0:1);res.status(201).json({id});
});
app.put('/api/admin/services/:id',auth,(req,res)=>{
 const r=db.prepare('UPDATE services SET title=?,description=?,available=? WHERE id=?').run(required(req.body.title),required(req.body.description,2000),req.body.available===false?0:1,req.params.id);
 res.status(r.changes?200:404).json(r.changes?{ok:true}:{error:'Hizmet bulunamadı.'});
});
app.delete('/api/admin/services/:id',auth,(req,res)=>{const r=db.prepare('DELETE FROM services WHERE id=?').run(req.params.id);res.status(r.changes?200:404).json(r.changes?{ok:true}:{error:'Hizmet bulunamadı.'});});
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:8*1024*1024,files:1,fields:6,fieldSize:6000}}).single('image');
async function project(req,res){
 const existing=req.params.id?db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id):null;
 if(req.params.id&&!existing) return res.status(404).json({error:'Proje bulunamadı.'});
 const title=required(req.body.title),category=required(req.body.category,80),description=required(req.body.description,5000);
 let image=existing?.image,demo=existing?.demo||0;
 if(req.file){
  let output;try{const instance=sharp(req.file.buffer,{limitInputPixels:40000000,animated:false});const meta=await instance.metadata();if(!['jpeg','png','webp','heif'].includes(meta.format)) throw new Error();output=await instance.rotate().resize({width:1800,height:1800,fit:'inside',withoutEnlargement:true}).webp({quality:84}).toBuffer();}catch{throw new Error('Geçerli JPG, PNG veya WebP fotoğraf yükleyin (en fazla 40 megapiksel).');}
  const filename=randomUUID()+'.webp';await sharp(output).toFile(path.join(dataDir,'uploads',filename));image='/uploads/'+filename;demo=0;
 }
 if(!image) throw new Error('Proje için bir fotoğraf seçin.');
 const id=existing?.id||randomUUID();
 db.prepare('INSERT INTO projects VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,category=excluded.category,description=excluded.description,image=excluded.image,demo=excluded.demo').run(id,title,category,description,image,demo,existing?.created||Date.now());
 if(existing&&existing.image!==image) removeImage(existing.image);
 res.status(existing?200:201).json({id});
}
function removeImage(image){if(/^\/uploads\/[a-f0-9-]+\.webp$/.test(image)){const file=path.join(dataDir,'uploads',path.basename(image));if(existsSync(file)) unlinkSync(file);}}
app.post('/api/admin/projects',auth,upload,project);
app.put('/api/admin/projects/:id',auth,upload,project);
app.delete('/api/admin/projects/:id',auth,(req,res)=>{const p=db.prepare('SELECT image FROM projects WHERE id=?').get(req.params.id);if(!p)return res.status(404).json({error:'Proje bulunamadı.'});db.prepare('DELETE FROM projects WHERE id=?').run(req.params.id);removeImage(p.image);res.json({ok:true});});
app.use('/uploads',express.static(path.join(dataDir,'uploads'),{maxAge:'7d',immutable:true,dotfiles:'deny'}));
app.get('/admin',(_req,res)=>res.sendFile(path.join(root,'public/admin.html')));
app.use(express.static(path.join(root,'public'),{maxAge:process.env.NODE_ENV==='production'?'1h':0}));
app.use('/api',(_req,res)=>res.status(404).json({error:'İşlem bulunamadı.'}));
app.use((err,_req,res,_next)=>{const uploadError=err instanceof multer.MulterError;res.status(uploadError?400:400).json({error:uploadError?'Fotoğraf en fazla 8 MB olabilir; tek fotoğraf seçin.':err.message?.startsWith('SQLITE')?'Kayıt işlemi başarısız.':err.message||'İşlem başarısız.'});});
const port=Number(process.env.PORT||3000);
app.listen(port,process.env.HOST||'0.0.0.0',()=>console.log(`Novax hazır. Port: ${port}. Yönetim: /admin`));
