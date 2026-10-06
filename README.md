# Novax Çatı Sistemleri

Mobil uyumlu Türkçe web sitesi + şifreli yönetim paneli. Telefon ve WhatsApp: **0506 092 18 06**.

## Paketin içindekiler

- Çatı mimarisini öne çıkaran özgün, yeşil ve turuncu tasarım.
- Telefonla tek dokunuşta arama, WhatsApp mesajı, Google Haritalar bağlantısı.
- Proje kategorileri, fotoğraf galerisi ve açıklamalı detay penceresi.
- `/admin` panelinde fotoğraflı proje ekleme, düzenleme, silme.
- Hizmet ekleme/silme; yapılan ve yapılmayan işleri açıkça belirtme.
- İşletme adı, telefon, WhatsApp, bölge, adres, saatler ve ana sayfa metinleri yönetimi.
- Kalıcı SQLite veritabanı, sunucuda saklanan fotoğraflar, otomatik WebP dönüştürme.
- Şifreli giriş, HttpOnly oturum, CSRF koruması, giriş denemesi sınırı.
- Yerel görseller ve fontlar: harici görsel/font servislerine bağımlılık yok.

Başlangıçtaki üç proje **temsili mimari illüstrasyondur**, tamamlanmış müşteri işi değildir. Panelden gerçek iş fotoğraflarınızla değiştirin. Başlangıç hizmetlerinin işletmenizde gerçekten sunulduğunu kontrol edin. Adres, hizmet bölgesi ve çalışma saatleri henüz doğrulanmadığı için tahmini bilgi eklenmedi; bunları panelden doldurun. Harita bağlantısı paylaşılan işletme adı ve koordinatlarını kullanır.

## Bilgisayarda çalıştırma — 3 adım

Gereken: **Node.js 24 LTS** (asgari 22.13) ve npm. ZIP dosyasını açın, `novax-cati-sistemleri` klasöründe terminal açın:

```sh
npm ci
npm run setup
npm start
```

1. `npm ci` bağımlılıkları kilit dosyasındaki sürümlerle kurar.
2. `npm run setup`, `.env` dosyasını ve güçlü rastgele ilk yönetici şifresini oluşturur. Kullanıcı adı **admin**. Terminalde gösterilen şifreyi kaydedin. Bu komut mevcut `.env` dosyasını değiştirmez.
3. `npm start` uygulamayı 3000 portunda başlatır. Tarayıcınıza `http://localhost:3000` yazın. Panel için sonuna `/admin` ekleyin.

HTML dosyasına çift tıklamak yeterli değildir; panel ve veri kaydı için Node.js sunucusu çalışmalıdır. İlk gerçek açılışta başlangıç içerikleri oluşturulur; sonraki açılışlar içerikleri sıfırlamaz.

## Panel kullanımı

- **Proje & fotoğraflar → Yeni proje ekle:** başlık, kategori, açıklama ve fotoğraf seçin. Her kayıtta bir fotoğraf vardır; aynı kategoriye istediğiniz sayıda kayıt ekleyebilirsiniz.
- **Düzenle:** metinleri güncelleyin veya fotoğrafı değiştirin. Yeni fotoğraf seçmezseniz eski fotoğraf korunur. Fotoğraf değişince eski dosya kaldırılır.
- **Sil:** onaydan sonra kayıt ve yüklenen fotoğraf kalıcı silinir.
- Fotoğraf: JPG, PNG veya WebP, en fazla 8 MB ve 40 megapiksel. Görsel en fazla 1800 piksele küçültülür, WebP olarak kaydedilir; EXIF konum bilgisi kopyalanmaz.
- **Hizmetler:** “Sunuyoruz / Sunmuyoruz” durumunu seçin. Sunulmayan işlerin açıklaması da ziyaretçiye görünür. Uygulama fotoğraflarını ilgili proje kategorisine ekleyin.
- **İşletme & iletişim:** telefon, WhatsApp, adres, hizmet bölgesi, çalışma saatleri ve metinleri güncelleyin.
- **Şifre değiştir:** en az 12 karakter. Şifre değişince bütün oturumlar kapanır.

Şifrenizi unutursanız sunucuda proje klasöründen `npm run admin:reset` çalıştırın. Yeni rastgele şifre terminalde gösterilir. `.env` içindeki `ADMIN_PASSWORD` yalnızca ilk kullanıcı oluşturulurken kullanılır; var olan şifreyi değiştirmez. İlk kurulumdan sonra bu satırı `.env` içinden kaldırabilirsiniz, veritabanını koruyun.

## Alan adıyla yayınlama

**Alan adı tek başına yeterli değildir. Node.js destekleyen, kalıcı disk sağlayan bir hosting veya VPS gerekir.** Yalnızca statik dosya/PHP barındıran bir pakette admin paneli çalışmaz. Geçici dosya sistemli sunucusuz barındırmalar SQLite/fotoğraflar için uygun değildir.

### Node.js destekli hosting

1. Kaynak dosyaları yükleyin. `.env`, `node_modules`, test verileri veya mevcut gizli bilgileri herkese açık klasöre koymayın.
2. Uygulama kökünde `npm ci --omit=dev` çalıştırın.
3. `npm run setup` çalıştırın veya hosting ayarlarından `ADMIN_USERNAME=admin` ile en az 12 karakterlik güçlü `ADMIN_PASSWORD` tanımlayın.
4. Canlı ortamda `NODE_ENV=production`, `SITE_URL=https://alanadiniz.com` ve gerekiyorsa `PORT` ayarlarını belirleyin.
5. Tek güvenilir ters proxy kullanılıyorsa `TRUST_PROXY=1` ayarlayın. Uygulama portunu internete doğrudan açmayın; yalnızca proxy erişsin. Birden çok proxy varsa yapılandırmayı sağlayıcınızla doğrulayın.
6. Başlatma komutu: `npm start`. Kalıcı disk için `DATA_DIR` yolunu tanımlayın; uygulama kullanıcısının yazma izni olsun. Tek uygulama örneği kullanın.
7. Alan adının DNS kayıtlarını hostinginize yönlendirin ve HTTPS sertifikasını etkinleştirin. Canlı ortamda yönetim çerezi `Secure` olduğu için HTTPS gereklidir.
8. Panelden gerçek hizmetleri, adresi ve fotoğrafları düzenleyin. Telefonda arama, WhatsApp, harita ve paneli kontrol edin.

### VPS üzerinde Docker seçeneği

Docker ve Compose kurulu bir sunucuda:

```sh
# .env dosyasını güvenli ilk şifreyle oluşturur; Node.js olan makinede çalıştırılabilir.
npm run setup
# .env içine SITE_URL=https://alanadiniz.com ekleyin.
docker compose up -d --build
```

`compose.yaml` uygulamayı yalnızca sunucunun `127.0.0.1:3000` adresine açar. `novax_data` adlı kalıcı volume veritabanı ve fotoğrafları saklar. Sunucuda Caddy gibi bir HTTPS ters proxy kurun; `Caddyfile.example` dosyasındaki alan adını değiştirin. Caddy'nin 80/443 portlarına erişebilmesi gerekir. Compose tek başına alan adı veya HTTPS kurmaz. `docker compose down -v` verileri siler; kullanmayın.

Docker kurulum dosyaları sağlanmıştır; bu geliştirme ortamında Docker ile canlı dağıtım yapılmadı. Alan adı satın alınmadı ve internet yayını başlatılmadı.

## Yedekleme

`data/` (veya `DATA_DIR`) içinde `novax.sqlite`, varsa `novax.sqlite-wal` / `novax.sqlite-shm` ve `uploads/` bulunur. Tutarlı yedek için uygulamayı durdurup veri klasörünün tamamını güvenli bir yere kopyalayın, ardından yeniden başlatın. Docker kullanıyorsanız aynı işlemi kalıcı volume üzerinde yapın. Bu dosyalar kaynak ZIP'ine dahil değildir. `.env` ve yedekleri paylaşmayın. Yeniden kurulumlarda veri klasörünü koruyun.

## Test ve geliştirme

```sh
npm ci
npm test
npm run dev
```

`npm test` geçici veri klasörüyle API, giriş, CSRF, fotoğraf yükleme/silme, içerik güncelleme, yeniden başlatma sonrası kalıcılık ve şifre değişimini test eder. Gerçek site verilerine dokunmaz.

Tarayıcı testi: Chromium kuruluysa `CHROMIUM_PATH=/chromium/tam/yolu npx playwright test`. Linux test ortamında `/usr/bin/chromium` kullanıldı. Test masaüstü ve 390px mobil görünümü, panelden fotoğraf/hizmet işlemlerini ve iletişim bağlantılarını doğrular. 3198 ve 3199 test portlarının boş olması gerekir.

`npm audit --omit=dev`: paketleme sırasında 0 güvenlik açığı. Bağımlılıkların güvenlik güncellemelerini düzenli kontrol edin.

## Dosya yapısı

- `server.js`: web sunucusu, API, SQLite ve güvenlik.
- `public/`: ana sayfa, admin paneli, stiller ve yerel görseller.
- `scripts/`: ilk kurulum ve şifre sıfırlama.
- `test/`: API ve tarayıcı testleri.
- `Dockerfile`, `compose.yaml`, `Caddyfile.example`: yayınlama seçenekleri.
- `package-lock.json`: tekrarlanabilir bağımlılık kurulumu.

DejaVu sembol fontunun lisansı `public/assets/FONT-LICENSE.txt` içindedir. Mimari illüstrasyonlar bu proje için çizildi.
