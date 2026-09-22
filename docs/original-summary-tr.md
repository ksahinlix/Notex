# Not Uygulaması — Proje Özeti (Claude Code'a devam için)

## Ne yapıyoruz
Kişisel, kategorili not uygulaması. Şu ana kadar Claude.ai'de (chat) bir **React
prototipi** geliştirildi (tam özellikli, tek dosya, tarayıcı depolaması
kullanıyor). Şimdi bunu gerçek bir **web + mobil uygulamaya** dönüştürüyoruz.

## Mimari kararlar (bunlar tartışılıp kesinleşti, tekrar açmaya gerek yok)

1. **AI sınıflandırma/arama: WebLLM (istemci tarafında, tarayıcıda)**
   Sunucuda LLM YOK. Sebep: home server donanımı (aşağıda) LLM için yetersiz.
   WebLLM, WebGPU üzerinden küçük modelleri (1-3B) doğrudan kullanıcının
   cihazında çalıştırıyor, sunucuya hiç gitmiyor. Henüz frontend'e entegre
   edilmedi — sıradaki büyük iş bu.

2. **Backend: Node.js + Express**, sadece not CRUD yapan hafif bir servis.
   AI mantığı burada yok.

3. **Veritabanı: Postgres (Neon ücretsiz katman)**, SQLite değil.
   Sebep: Render'ın ücretsiz servisinde disk kalıcı değil (her restart'ta
   silinir), Render'ın ücretsiz Postgres'i de 30 gün sonra sona eriyor.
   Neon'un ücretsiz katmanı kalıcı (sadece uzun süre kullanılmazsa "uyur").

4. **Hosting (Faz 1): Render (backend) + Neon (DB)** — home server'a HİÇ
   dokunmuyoruz. Kartsız, ücretsiz.

5. **Home server, Faz 2'de sadece yedek hedefi olacak** (örn. Neon'dan
   periyodik `pg_dump` alıp eve çekmek). Şimdilik dokunulmuyor.

6. **Mobil: önce PWA, gerekirse sonra Expo/React Native.** PWA'lar 2026'da
   iOS'ta push notification desteği kazandı, bu yüzden hatırlatma özelliği
   için native'e hemen geçmeye gerek yok.

7. **Şifreleme:** Prototipte zaten var — AES-GCM, tarayıcıda (Web Crypto API),
   şifre sunucuya asla gitmiyor. Aynı yaklaşım korunacak.

## Home server bilgileri (Faz 2 için, referans)
- Debian GNU/Linux 13 (Trixie), kernel 6.12.107+deb13-amd64
- CPU: Intel i5-7500T (4C/4T, 2.7–3.3GHz, 35W) — entegre grafik, LLM için yetersiz
- RAM: 16GB DDR4
- Disk: 320GB WD Scorpio Blue 5400RPM HDD (SMART temiz ama eski/yavaş — bu yüzden yedekleme önemli)
- Docker 29.8.0, Compose v5.5.1 kurulu
- LAN IP: 192.168.1.180 (statik)
- Tailscale IP: 100.73.186.112 (kurulu, test edildi, mobil veriden erişim çalışıyor)
- Meşgul portlar: 22 (SSH), 53/8080 (Pi-hole), 3001 (Uptime Kuma), 3389 (XRDP), 5201 (iperf3), 631 (CUPS), 5353 (mDNS), 41641 (Tailscale)
- Boş/kullanılabilir port: 8000 (backend için ayrılmıştı, Faz 1'de kullanılmıyor ama Faz 2'de gerekebilir)

## Şu ana kadar üretilen dosyalar

**`not-app-backend/`** klasörü (Postgres/Neon/Render için, v0.2):
- `package.json` — express, pg, cors, dotenv
- `server.js` — `/api/health`, `/api/notes` (GET/POST/DELETE)
- `db/schema.sql` — Postgres şeması (notes, protected_folders tabloları)
- `db/migrate.js` — şemayı Neon'da oluşturan script
- `.env.example` — `DATABASE_URL` (Neon connection string), `PORT=8000`
- `README.md` — kurulum adımları

**Henüz test edilmedi** — bir sonraki adım Neon'da proje açıp bağlantıyı doğrulamak.

**Prototip referansı:** Claude.ai'de üretilen `not_uygulamasi_prototip.jsx` —
tüm frontend özelliklerinin tasarım referansı. İçindekiler:
- Hiyerarşik kategori ağacı (Kategori > Klasör > ... > Sayfa, sınırsız derinlik)
- AI destekli otomatik kategori önerisi (prototipte Claude API kullanıyordu,
  gerçek uygulamada WebLLM'e çevrilecek)
- Liste öğeleri (checkbox'lı, örn. "İzlenecekler")
- Hatırlatmalar (tarih/saat çıkarımı)
- Klasör bazlı şifreleme (AES-GCM, Web Crypto API)
- Notlara yorum ekleme, görsel ekleme (yapıştırma/sürükle-bırak dahil, Word'den
  metin+görsel kopyalama desteği — bazı siteler için CORS/CSP kısıtı var, bu
  normal bir web app'te (Claude sandbox değil) ortadan kalkacak)
- Not düzenleme, sürükle-bırak ile kategori değiştirme, okuma modu (büyütme)
- Not verisi modeli: `{id, path[], encrypted, cipher, text, listItemText,
  isListItem, checked, isReminder, reminderAt, reminderLabel, blocks[],
  images[], comments[], createdAt}`

## Sıradaki adımlar (öncelik sırasıyla)
1. Neon'da proje aç, `DATABASE_URL`'i al, backend'i yerelde test et
   (`npm install && npm run migrate && npm start`, sonra `/api/health`)
2. Render'a deploy et
3. Frontend'i prototipten gerçek bir proje yapısına taşı (window.storage
   çağrılarını gerçek API'ye bağla)
4. WebLLM entegrasyonu — AI sınıflandırma/arama artık tarayıcıda çalışacak
5. Basit auth ekle
6. PWA manifest + service worker
7. Faz 2: home server'a düzenli yedek mekanizması

## Notlar / açık kararlar
- Backend'i Docker'sız, düz Node servisi olarak Render'a deploy ediyoruz
  (Faz 1'de Docker dosyaları bilerek kaldırıldı)
- WebLLM için hangi modelin (Gemma/Qwen/Phi, 1-3B) kullanılacağı henüz
  seçilmedi — cihaz uyumluluğu ve kalite testine göre karar verilecek
- Auth yaklaşımı henüz netleşmedi (tek kullanıcı basit şifre mi, yoksa
  daha standart bir çözüm mü)
