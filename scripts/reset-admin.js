import { DatabaseSync } from 'node:sqlite';
import { randomBytes,scryptSync } from 'node:crypto';
import path from 'node:path';
import { existsSync } from 'node:fs';
const file=path.join(process.env.DATA_DIR||'data','novax.sqlite');
if(!existsSync(file)){console.error('Veritabanı bulunamadı. Önce kurulumu yapın.');process.exit(1);}
const db=new DatabaseSync(file), password=randomBytes(18).toString('base64url'),salt=randomBytes(16).toString('hex');
db.prepare('UPDATE admin SET password=? WHERE id=1').run(salt+':'+scryptSync(password,salt,64).toString('hex'));db.exec('DELETE FROM sessions');db.close();console.log('Yeni yönetici şifresi: '+password+'\nTüm oturumlar kapatıldı. Bu şifreyi güvenli bir yerde saklayın.');
