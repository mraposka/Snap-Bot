# Snapchat Oto-Accept

Snapchat Web'e otomatik giriş yapıp bekleyen arkadaşlık isteklerini kabul eden,
tarayıcı tabanlı kontrol paneline sahip bir Puppeteer aracı.

- Birden fazla hesabı yönetir, her hesabın oturumu ayrı tutulur
- Hesapları **tek tek** (sıralı) ya da hepsini aynı anda (paralel) çalıştırır;
  sıralı modda hesap değişimleri arasına istediğin kadar bekleme koyarsın
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
   - **Kaç dakikada bir** — tüm hesaplar bittikten sonra beklenecek süre.
     `5` yazarsan her 5 dakikada bir aynı işlem tekrarlanır.
   - **Çalışma modu** —
     `Sıralı` (varsayılan): hesaplar sırayla çalışır. 1. hesap accept'lerini
     bitirir, tarayıcısı kapanır, bekleme süresi dolar, sonra 2. hesap başlar.
     Aynı anda yalnızca tek tarayıcı açık olur.
     `Paralel`: bütün hesaplar aynı anda açılır (hızlı ama Snapchat aynı IP'den
     eşzamanlı girişleri sevmez, "Hay aksi" hatası buradan gelir).
     Mod değişikliği bir sonraki **Başlat**'ta geçerli olur.
   - **Hesaplar arası bekleme (dk)** — sıralı modda bir hesap bittikten sonra
     sıradakine geçmeden önce beklenecek süre. Örn. `3`.
   - **Accept arası en az / en çok (ms)** — iki accept tıklaması arasındaki
     bekleme. Her tıklamada bu iki değer arasından rastgele bir süre seçilir,
     böylece tempo sabit görünmez. Varsayılan `600`–`1200`. Yavaşlatmak için
     ikisini birden büyüt (örn. `1500`–`3000`); `200` accept için tur süresi
     yaklaşık `accept sayısı × ortalama bekleme` kadar olur.
   - **Çerezleri sakla** — kapalıyken (varsayılan) hiçbir oturum kaydedilmez:
     her turda şifreyle giriş yapılır ve tarayıcı geçici profille açılır,
     kapanınca profil silinir. Açarsan oturum `sessions/` altında saklanır ve
     sonraki turlarda şifre sorulmaz.
     Not: çerezler kapalıyken her tur yeni bir giriş demektir — Snapchat
     captcha veya SMS doğrulaması isterse tur orada takılır. Headless kapalıyken
     ilk turu izle.
   - **Headless** — işaretliyse tarayıcı gizli (arka planda) çalışır.
   - **Yedek şifreler / En fazla giriş denemesi** — aşağıdaki "Yedek şifreler"
     bölümüne bak.
   - `Ayarları kaydet`'e bas.
3. **▶ Başlat** — döngü başlar (sıralı modda ilk hesaptan itibaren).
   Çalışırken eklenen hesap sıraya girer, bir sonraki turda dahil olur.
4. **■ Durdur** — döngüyü durdurur ve açık tarayıcıları anında kapatır.

### Yedek şifreler

Bir hesabın iki şifreden hangisiyle açıldığını hatırlamıyorsan, **Ayarlar**
bölümündeki **Yedek şifreler** alanına ikisini de virgülle yaz (örn.
`12345, 123456`). Giriş sırası şöyle işler:

1. Önce hesabın kendi şifresi (Hesap ekle'de girdiğin) denenir.
2. Tutmazsa yedek şifreler sırayla denenir.
3. **En fazla giriş denemesi** kadar (varsayılan **2**) şifre denenince durur.

> Bu bir şifre kırma aracı **değildir** — yalnızca kendi bildiğin birkaç sabit
> şifreyi sırayla dener. Sınırı düşük tut: Snapchat üst üste başarısız girişte
> hesabı geçici olarak kilitler. Bir denemede **captcha / SMS / cihaz
> doğrulaması** çıkarsa araç ikinci şifreyi denemez, hemen durur (hesabı riske
> atmamak için). Varsayılan 2 deneme bu yüzden makul bir sınırdır.

### Tarayıcı eklentisi

Panelin **Tarayıcı eklentisi** bölümünden Chrome'a bir eklenti yükletebilirsin
(örn. captcha çıkınca seni uyaran bir bildirim eklentisi). Kurulum:

1. Eklentinin `.crx` dosyasını proje köküne **`alarm.crx`** adıyla koy.
2. **"alarm.crx'i klasöre aç"** — eklentiyi `extensions/alarm` klasörüne açar.
3. **"Eklentiyi kullan"** kutusunu işaretle, **Kaydet**.
4. **"Eklentiyi ayarla"** — pencereli bir Chrome açar; eklentinin ayarını
   (telefon no vb.) bir kez yap ve pencereyi kapat.

Bundan sonra her tur (kabul + story) eklenti yüklü olarak çalışır.

**Ayar / oturum ayrımı:** Eklentinin kendi ayarı `data/ext-profile` profilinde
**kalıcı** tutulur (bir kez ayarlarsın). Ama **Snapchat login çerezleri her turun
başında temizlenir** — oturum saklanmaz, hesaplar birbirine karışmaz.

> Eklenti yüklüyken **headless otomatik kapanır** (eklentiler yalnızca pencereli
> Chrome'da çalışır). `.crx` doğrudan değil, açılmış klasör olarak yüklenir;
> panel bunu senin için yapar.

### Çalışma saatleri (kabul döngüsü)

**Ayarlar** bölümündeki **Çalışma saatleri** ile döngünün yalnızca belirli
saatler arasında çalışmasını sağlarsın (örn. `09:00`–`23:00`). Kapalıyken 7/24
çalışır. Aralık gece yarısını aşabilir (`22:00`–`06:00`). Pencere dışındayken
hesaplar "Bekliyor" durumunda kalır, tarayıcı açılmaz.

---

## Story otomasyonu

Panelin **Story otomasyonu** bölümü, kendi hesaplarında belirlediğin saatlerde
(örn. günde 2 kez) otomatik hikaye paylaşır. Adımlar, web arayüzünde elle
yaptığının aynısı:

1. Ortadaki **kameraya** tıklar
2. Snapchat izin isterse geçer (tarayıcı izni otomatik verilir)
3. **Fotoğrafı çeker**
4. **T** düğmesiyle yazı alanını açar ve senin yazını yazar
5. **Gönder** → **Hikayem** → **Gönder**

### Ayarlar

| Ayar | Açıklama |
|---|---|
| Otomatik story atmayı aç | Zamanlayıcıyı açar/kapatır |
| Zamanlama | **Belirli saatlerde** (örn. `12:00, 23:00`) veya **her N saatte bir** |
| Saatler | Virgülle ayrılmış saat listesi. Günde 2 kez için iki saat yaz |
| Arka plan | Sahte kameranın rengi (varsayılan siyah) |
| Gerçek webcam'i kullan | Kapalıyken odan görünmez; açıkken gerçek kamera kullanılır |
| Toplu yazı | Tüm hesaplar için varsayılan metin |

**Hesap başına yazı:** Aynı bölümdeki tabloda her hesaba ayrı metin
yazabilirsin. Boş bırakırsan o hesap için toplu yazı kullanılır.

**Şimdi at:** Zamanlayıcıyı beklemeden tek hesaba ya da **Hepsine şimdi at** ile
tüm hesaplara anında paylaştırır. Hesaplar aynı anda değil, sırayla çalışır.

### Sahte kamera

Varsayılan olarak gerçek webcam yerine düz renkli bir görüntü kullanılır. Bunun
üç faydası var: odandaki görüntü yanlışlıkla hikayeye düşmez, headless modda da
çalışır ve sonuç her seferinde aynı olur. Renk ayarlardan değiştirilir.

### Zamanlama davranışı

- Aynı saat dilimi iki kez atılmaz (son paylaşım `data/story.json`'a yazılır).
- Panel kapalıyken kaçan bir saat, 2 saat içinde açılırsa yakalanır; daha
  geç açılırsa o dilim atlanır ve log'a yazılır.
- Yazısı olmayan hesaplar sessizce atlanır.

### Takılırsa

Her adımın ekran görüntüsü `sessions/<hesap>/story-N-*.png` olarak kaydedilir.
Tablodaki **SS** düğmesi sonuncusunu gösterir — hangi adımda takıldığı oradan
anlaşılır. Canlı log'da da her adım yazılır (`[story] Fotoğraf çekiliyor` gibi).

Adımlar [`bot.js`](bot.js) başındaki **`STORY_XPATH`** tablosundaki XPath'lerle
bulunur. Snapchat arayüzünü değiştirirse ilgili satırı güncelle: tarayıcıda o
öğeye sağ tık → *İncele* → öğeye sağ tık → *Copy → Copy XPath* ve buraya yapıştır.

| Anahtar | Hangi düğme |
|---|---|
| `camera` | Ortadaki kamera ikonu |
| `capture` | Fotoğrafı çeken düğme |
| `textTool` | Yazı ekleyen "T" düğmesi |
| `send` | Alıcı listesini açan Gönder |
| `myStory` | Listedeki "Hikayem" satırı |
| `sendStory` | Alttaki Gönder (hikayeye yollar) |

XPath bulunamazsa etiket (`aria-label`) ve metin listelerine düşülür
(`CAMERA_LABELS`, `CAPTURE_LABELS`, `TEXT_TOOL_LABELS`, `SEND_TEXTS`,
`MY_STORY_TEXTS`). Konuma göre tahmin **yapılmaz**: yanlış bir öğeye tıklamak
yerine adım hata verip durur.

---

### Hız sınırı ("Limit reached")

Snapchat çok hızlı kabul edildiğinde sayfada kırmızı bir
**"Limit reached. Try again in a few minutes."** uyarısı gösterir. Bot bunu
her tıklamadan önce kontrol eder; görürse:

1. O hesapta tıklamayı **hemen** durdurur (ısrar etmek hesabı riske atar),
2. Tarayıcıyı kapatır,
3. Sıralı modda bekleme süresi kadar durup **sıradaki hesaba** geçer.

Panelde o hesap **Limit doldu** rozetiyle işaretlenir, log'a kaç accept sonra
takıldığı yazılır. Hesap bir sonraki turda normal şekilde tekrar denenir.

Sık takılıyorsan **Accept arası en az/en çok** değerlerini büyüt (örn.
`1500`–`3000`) ve **Kaç accept** sınırını düşür.

### Eski hesaplar (oturumdan geri yükleme)

Panelin **Eski hesaplar** bölümü, `sessions/` klasöründe izi bulunan — yani daha
önce en az bir kez çalıştırılmış — hesapları listeler. Hesap listesi silindiyse
ya da yeni bir kuruluma geçtiysen, kullanıcı adlarını buradan geri alabilirsin.

| Sütun | Anlamı |
|---|---|
| Kullanıcı | Oturum klasörünün adı (kullanıcı adı, küçük harfe çevrilmiş) |
| Oturum | **çerez var** = kayıtlı oturum duruyor, şifresiz girebilir · **şifre gerekir** = çerez yok |
| Son kullanım | O klasördeki en yeni dosyanın tarihi |
| Durum | Hesap zaten listede mi |

**Geri yükle** hesabı listeye ekler; **Hepsini geri yükle** listede olmayanların
hepsini birden ekler.

> **Şifreler `sessions/` içinde saklanmaz** (yalnızca `data/accounts.json`'da
> tutulur). Bu yüzden geri yüklerken şifre sorulur; kutuda hazır olarak `12345`
> gelir. Boş bırakırsan **varsayılan `12345`** atanır, İptal dersen hesap
> eklenmez. Toplu geri yüklemede girilen şifre hepsine uygulanır.
>
> Varsayılan şifreyle eklenen hesap Snapchat'e giremez — doğru şifreyi sonradan
> **Hesap ekle** bölümüne aynı kullanıcı adıyla yazman yeterlidir, kopya oluşmaz,
> yalnızca şifresi güncellenir. Kayıtlı çerezi olan ve "Çerezleri sakla" açık
> olan hesaplarda şifre gerekmeyebilir.

Liste iki yerden okunur: projenin kendi `sessions/` klasörü ve varsa kurulu
sürümün klasörü (`%LOCALAPPDATA%\SnapBot\app\sessions`). İkincisinden gelenler
"kurulu sürümden" etiketiyle gösterilir.

### Çerez / oturum silme

Kayıtlı oturum bozulduğunda ("Hay aksi", giriş döngüsü, yanlış hesapla açılma)
temizlemek için:

- Hesap satırındaki **Çerez** düğmesi — o hesabın `cookies.json` dosyasını ve
  Chrome profilini siler.
- **Hesaplar** başlığındaki **Tüm çerezleri sil** — hepsini birden temizler.

Ekran görüntüleri silinmez, teşhis için kalır. Tarayıcı açıkken profil klasörü
kilitli olduğu için panel uyarır — önce **Durdur**'a bas. Bir hesabı silersen
oturumu da otomatik silinir.

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
| Eski hesaplar | `sessions/` klasöründeki eski hesapları listeler, listeye geri ekler |
| Story otomasyonu | Belirlediğin saatlerde otomatik hikaye paylaşımı (aşağıya bak) |
| Canlı önizleme | Çalışan her hesabın ekranı, saniyede bir tazelenir (headless modda da çalışır) |
| Canlı log | Tüm adımların akışı; üstteki sekmelerden tek hesaba göre filtrelenebilir |

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
bot.js             Otomasyon motoru (login, panel açma, kabul etme, story atma) + XPath ayarları
server.js          Kontrol paneli sunucusu (hesaplar, zamanlayıcı, canlı akış)
public/index.html  Panel arayüzü
login.js           Tek hesaplık CLI (bot.js'i kullanır)
data/              Hesaplar, ayarlar ve story geçmişi   (git'e girmez)
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
