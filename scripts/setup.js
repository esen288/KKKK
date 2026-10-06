import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if(existsSync('.env')) { console.log('.env zaten mevcut; değiştirilmedi. Siteyi npm start ile başlatabilirsiniz.'); process.exit(0); }
const password=randomBytes(18).toString('base64url');
writeFileSync('.env',`# Bu dosyayı paylaşmayın veya Git'e eklemeyin.\nPORT=3000\nNODE_ENV=development\nADMIN_USERNAME=admin\nADMIN_PASSWORD=${password}\n# Canlı HTTPS yayınında aşağıdaki ayarları etkinleştirin:\n# NODE_ENV=production\n# SITE_URL=https://alanadiniz.com\n# TRUST_PROXY=1\n`,{mode:0o600,flag:'wx'});
console.log('Kurulum ayarları oluşturuldu.\nKullanıcı adı: admin\nİlk şifre: '+password+'\nŞifreyi güvenli bir yerde saklayın. npm start ile başlatın; /admin sayfasından giriş yapın.');
