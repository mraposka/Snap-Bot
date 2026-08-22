# Snapchat Oto-Accept

Snapchat Web'e otomatik giriş yapıp bekleyen arkadaşlık isteklerini kabul eden,
tarayıcı tabanlı kontrol paneline sahip bir Puppeteer aracı.

- Birden fazla hesabı aynı anda yönetir, her hesabın oturumu ayrı tutulur
- Tur başına kaç istek kabul edileceğini ve turların kaç dakikada bir
  tekrarlanacağını panelden ayarlarsın
- Çalışırken her hesabın durumunu, sayaçlarını ve loglarını canlı gösterir
- Headless (gizli) modda bile canlı önizleme kareleriyle ekranı izleyebilirsin
- Hata olursa otomatik ekran görüntüsü alır, panelden görürsün

> Yalnızca **kendi hesaplarınla** kullan. Snapchat'in kullanım şartları otomatik
> erişimi kısıtlar; bu araç eğitim/kişisel otomasyon amaçlıdır.

---

## Windows'ta hızlı kurulum (tek tık)

Node.js kurmakla uğraşmak istemiyorsan hazır Windows kurulumunu kullan:

1. `setup` klasöründeki **`SnapBot-Setup.exe`** dosyasına çift tıkla.
2. Kurulum Node.js'i, uygulamayı ve kütüphaneleri kendisi kurar.
3. Bitince masaüstünde oluşan **SnapBot** simgesine tıkla — panel tarayıcıda açılır.

Yönetici izni gerekmez; her şey `%LOCALAPPDATA%\SnapBot` altına kurulur.
Ayrıntılar için [`setup/OKUBENI.txt`](setup/OKUBENI.txt) dosyasına bak.

Aşağıdaki adımlar elle kurulum içindir (macOS/Linux veya geliştirme).

---

## Gereksinimler

- **Node.js 18 veya üzeri** (geliştirme ortamı: Node 22, npm 10)
- Windows, macOS veya Linux
- İlk kurulumda Puppeteer kendi Chromium'unu indirir (~150 MB)

Node.js kurulu değilse: <https://nodejs.org> adresinden LTS sürümünü kur.
Kontrol için:

```bash
node -v
npm -v
```

---

## Kurulum

```bash
git clone https://github.com/<kullanici-adin>/<repo-adi>.git
cd <repo-adi>
npm install
```

`npm install` bağımlılıkları ve Puppeteer'ın Chromium'unu indirir; ilk seferde
birkaç dakika sürebilir.

---

## Başlatma (Kontrol Paneli — önerilen)

```bash
npm run ui
```

Ardından tarayıcıdan aç:

```
http://localhost:3000
```

Farklı bir port istersen:

```bash
# macOS / Linux
PORT=8080 npm run ui

# Windows (PowerShell)
$env:PORT=8080; npm run ui
```

### Panelde ilk kullanım

1. **Hesap ekle** — kullanıcı adı ve şifreyi gir, `+ Ekle`'ye bas.
   İstediğin kadar hesap ekleyebilirsin. (Aynı kullanıcı adını tekrar eklersen
   şifresi güncellenir, kopya oluşmaz.)
2. **Ayarlar** bölümünü doldur:
   - **Kaç accept** — tur başına kabul sayısı. `500` yazarsan 500 kabulden sonra
     o tur biter ve tarayıcı kapanır. `0` = sınırsız (bitene kadar).
   - **Kaç dakikada bir** — tur bittikten sonra beklenecek süre. `5` yazarsan
     her 5 dakikada bir aynı işlem tekrarlanır.
   - **Headless** — işaretliyse tarayıcı gizli (arka planda) çalışır.
   - `Ayarları kaydet`'e bas.
3. **▶ Başlat** — tüm hesaplar için döngü başlar.
4. **■ Durdur** — döngüyü durdurur ve açık tarayıcıları anında kapatır.

### İlk çalıştırmada doğrulama

Snapchat ilk girişte captcha, cihaz onayı veya SMS kodu isteyebilir. Bu adımlar
otomatikleştirilemez. İlk turda **Headless'ı kapalı** bırak; doğrulama ekranı
çıkarsa tarayıcıda elle tamamla. Bir kez tamamladıktan sonra oturum çerezleri
kaydedilir ve sonraki turlarda şifre bile sorulmaz.

### Panelde neler var

| Bölüm | Ne işe yarar |
|---|---|
| Hesaplar tablosu | Her hesabın durumu, kabul sayısı, son tur, sıradaki tura kalan süre, hata mesajı |
| SS butonu | O hesabın son ekran görüntüsü (öncelik: hata > Add Friends paneli > tur sonu) |
| Canlı önizleme | Çalışan her hesabın ekranı, saniyede bir tazelenir (headless modda da çalışır) |
| Canlı log | Tüm adımların akışı; üstteki sekmelerden tek hesaba göre filtrelenebilir |

---

## Başlatma (Komut satırı — tek hesap, tek sefer)

Panele ihtiyaç duymadan tek seferlik çalıştırmak için:

```bash
# .env dosyasındaki hesapla
npm start

# Belirli bir hesapla
node login.js -u kullanici -p sifre

# Gizli modda, en fazla 500 kabul
node login.js -u kullanici -p sifre --headless --accepts 500
```

Desteklenen argümanlar:

| Argüman | Açıklama |
|---|---|
| `-u`, `--user` | Kullanıcı adı |
| `-p`, `--pass` | Şifre |
| `--headless` | Tarayıcıyı gizli çalıştır |
| `--accepts N` | En fazla N istek kabul et (yoksa hepsi) |

CLI argümanı verilmezse `.env` dosyası kullanılır. Kurmak için `.env.example`
dosyasını `.env` olarak kopyala ve doldur:

```
SNAP_USERNAME=kullanici_adin
SNAP_PASSWORD=sifren
HEADLESS=false
```

---

## Proje yapısı

```
bot.js             Otomasyon motoru (login, panel açma, kabul etme) + XPath ayarları
server.js          Kontrol paneli sunucusu (hesaplar, zamanlayıcı, canlı akış)
public/index.html  Panel arayüzü
login.js           Tek hesaplık CLI (bot.js'i kullanır)
data/              Hesaplar ve ayarlar        (git'e girmez)
sessions/          Hesap başına çerez + tarayıcı profili + ekran görüntüleri (git'e girmez)
```

Her hesabın oturumu `sessions/<kullanici>/` altında ayrı tutulur; hesaplar
birbirine karışmaz. Bir hesabın oturumunu sıfırlamak için o klasörü sil.

---

## Sorun giderme

**"Add Friends paneli açılamadı" veya kabul sayısı 0 kalıyor**

Snapchat arayüzünü sık değiştiriyor. Loglarda şu satırlara bak:

```
Add Friends açıldı mı: evet / HAYIR
Panel açıldıktan sonra sayfada N adet 'Accept' butonu var.
Görünen butonlar: [...]
```

- Panel açılmıyorsa: tarayıcıda Add Friends butonuna sağ tık → *Copy → Copy XPath*
  yapıp [`bot.js`](bot.js) içindeki `ADD_FRIENDS_XPATH` değerini güncelle.
- Panel açılıyor ama kabul yoksa: `Görünen butonlar` listesinde kabul butonunun
  gerçek yazısını bul ve `ACCEPT_TEXTS` dizisine ekle.
- `VIEW_MORE_XPATH` listeyi genişleten "View more" öğesini işaret eder; değişirse
  aynı şekilde güncellenir.

**Giriş tamamlanmıyor / captcha çıkıyor**

Headless'ı kapat, tarayıcıda doğrulamayı elle tamamla, sonra tekrar başlat.
Çerez kaydedildikten sonra tekrar sorulmaz.

**Durdur'a bastım ama tarayıcılar kapanmıyor**

Kapanır: Durdur, Chrome süreç ağacını zorla sonlandırır (Windows'ta `taskkill /T /F`).
Kapanmayan bir pencere kalırsa sunucuyu (`Ctrl+C`) yeniden başlatman yeterli.

**Port 3000 kullanımda**

Yukarıdaki `PORT` örneğiyle farklı bir port ver.

---

## Güvenlik notları

- `data/accounts.json` şifreleri **düz metin** saklar (yerel araç olduğu için).
  Bu klasör `.gitignore`'dadır; makineni başkasıyla paylaşıyorsan dikkat et.
- `.env`, `data/` ve `sessions/` klasörlerini **asla** commit'leme veya paylaşma;
  oturum çerezleri hesabına erişim sağlar.
- Panel yalnızca `localhost` üzerinden erişilecek şekilde tasarlandı; kimlik
  doğrulaması yoktur, internete açık bir sunucuda çalıştırma.

---

## Lisans

MIT
