# Jarvis

Küçük ajanlardan oluşan kişisel asistan. Bütün ajanlar Telegram'dan telefonuna ve bilgisayarına yazar.

| Ajan | Ne zaman | Ne yapar |
| --- | --- | --- |
| **Canvas bildirimleri** | 10 dakikada bir | Yeni duyuru, ödev, teslim tarihi değişikliği, not, mesaj ve ders materyalini (dosya, sayfa, bağlantı) haber verir. Duyuruların tamamını gönderir (paragraflar, kalın yazı ve bağlantılarla). Teslim etmediğin ödevler için teslime 24 saat ve 3 saat kala hatırlatır |
| **Okul maili** | 10 dakikada bir | Okul mailine (Zimbra) gelen yeni mailleri gönderen, konu ve kısa önizlemeyle haber verir. Mailleri okunmuş işaretlemez |
| **Sabah özeti** | Her sabah 08:00 | Günün derslerini, gecikmiş ödevleri, bugün ve önümüzdeki 7 günde teslim edilecekleri (teslim ettiklerin hariç), son 24 saatin duyurularını ve günün yemek menüsünü tek mesajda toplar |
| **Akşam önizlemesi** | Her akşam 21:00 | Bu gece ve yarın teslim edilecekleri, yarının derslerini ve yemek menüsünü tek mesajda toplar. Yarın için söylenecek bir şey yoksa mesaj atmaz |
| **Fitness randevusu** | Randevu açılınca | Söylediğin gün ve saatler için okulun rezervasyon sitesinden fitness randevusu alır, sonucu haber verir |
| **Bot** | Anında | Telegram'dan yazdığın komutlara cevap verir, kişisel hatırlatmaları zamanında gönderir |

Özeti beklemeden görmek için: **Actions** sekmesi > **Sabah özeti** > **Run workflow**.

## Komutlar

Telegram'da Jarvis botuna yazılır:

| Komut | Ne yapar |
| --- | --- |
| `/odevler` | Bekleyen ve geciken ödevler (Canvas'tan o an okunur) |
| `/notlar` | Son girilen notlar ve derslerdeki güncel durum |
| `/dersler` | Bugünün dersleri. `/dersler yarın`, `/dersler salı` da olur |
| `/fitness salı 13:00-14:30` | Her salı o saate fitness randevusu alır. Ayrıntı aşağıda |
| `/yemek` | Bugünün menüsü. `/yemek yarın`, `/yemek cuma`, `/yemek 17.11` de olur |
| `/hatirlat 15:00 kütüphane` | Bugün 15:00'te hatırlatır (saat geçtiyse yarın) |
| `/hatirlat yarın 09:30 hocaya mail` | Gün adıyla: `yarın`, `cuma`, `20.11` |
| `/hatirlat 30 dk çay` | Şu andan itibaren: `dk`, `saat`, `gün` |
| `/hatirlatmalar` | Bekleyen hatırlatmalar |
| `/sil 2` | Listedeki 2 numaralı hatırlatmayı siler |
| `/yardim` | Komut listesi |

Hatırlatmalar 2 dakikada bir kontrol edilir, yani en fazla 2 dakika gecikebilir. Bot sadece kendi sohbetine cevap verir.

## Fitness randevusu

Bot, okulun rezervasyon sitesinden (LibreBooking) senin hesabınla fitness randevusu alır. Sitenin programlar için açtığı resmi kapıyı (API) kullanır; giriş ekranındaki güvenlik kodunu aşmaya çalışmaz. Kişi sayısını elle yaptığın gibi 1 olarak bildirir.

| Komut | Ne yapar |
| --- | --- |
| `/fitness salı 13:00-14:30` | Her salı için ister. Açık olan haftaları hemen alır, sonrakileri açıldıkça alır |
| `/fitness 27.11 13:00-14:30` | Sadece o gün için ister. `yarın`, `bu cuma` da olur |
| `/fitness` | İsteklerin ve önümüzdeki 2 haftanın randevuları |
| `/fitness sil 1` | Listedeki 1 numaralı isteği kaldırır (alınmış randevular durur) |
| `/fitness iptal 17.11` | O günün randevusunu sitede iptal eder ve o günü atlar |
| `/fitness dene` | Alınamayan randevuları beklemeden yeniden dener |

Bitiş saati yazılmazsa 1,5 saat sayılır. Site en fazla 2 hafta sonrasına randevu verdiği için her randevu, tarihinden 2 hafta önce aynı saatte açılır; bot en geç 2 dakika içinde alır ve haber verir. Alamazsa bir kez haber verir, önce yarım saat sonra 6 saat arayla yeniden dener.

Giriş için rezervasyon sitesindeki kullanıcı adın ve şifren `BOOKED_USERNAME` ve `BOOKED_PASSWORD` secret'larına girilir, ardından **Botu kur** iş akışı bir kez çalıştırılır. Bu ikisi girilmeden `/fitness` çalışmaz. Şifreyi değiştirirsen secret'ı güncelleyip **Botu kur**'u yeniden çalıştır.

## Ders programı

Ders programı kişisel bilgi olduğu ve repo herkese açık olduğu için dosyada değil, `DERS_PROGRAMI` adlı secret'ta durur. Her satırda bir ders yazılır; sıra gün, saat aralığı, ders, derslik ve isteğe bağlı bir nottur:

```
Pazartesi 10:00-11:45 EE452 F0C04
Salı 11:00-12:45 EE4005 EECAPSLAB uygulama
```

Dersin adını yazmana gerek yok: Jarvis kodu Canvas'taki derslerinle eşleştirir ve adın ilk kelimesini kodun önüne yazar (ör. `Digital EE452`). Canvas'ta bulamazsa sadece kodu gösterir.

Programı değiştirdikten sonra botun yeni programı görmesi için **Actions** > **Botu kur** > **Run workflow** ile botu bir kez yeniden kur.

## Yemek menüsü

Menü `data/menu.json` dosyasında durur. Her ay yemek listesi maille resim olarak geldiğinde mail ajanı resmi kendisi okur (OCR), dosyayı günceller ve Telegram'a haber verir. Okuma neredeyse hatasızdır ama resimdeki "+" işaretini ya da tek bir harfi yanlış okuyabilir; yanlış bir satır görürsen `data/menu.json` içinde elle düzeltebilirsin.

Son gelen listeyi yeniden okutmak için: **Actions** > **Canvas bildirimleri** > **Run workflow** > "Gelen kutusundaki son yemek listesini yeniden oku" kutusunu işaretle.

## Kurulum (yaklaşık 15 dakika)

Hiçbir anahtarı koda, sohbete ya da herkesin görebileceği bir yere yazma. Üçü de sadece GitHub Secrets'a girilecek.

### 1. Telegram botu

1. Telegram'da **@BotFather**'a yaz, `/newbot` gönder, bota bir isim ver.
2. BotFather'ın verdiği anahtarı kopyala (`123456:ABC...` biçiminde). Bu `TELEGRAM_BOT_TOKEN`.
3. Yeni botunun sohbetini aç ve ona herhangi bir mesaj yaz (ör. "merhaba"). Bunu yapmazsan bot sana yazamaz.
4. Tarayıcıda şu adresi aç (`<ANAHTAR>` yerine bot anahtarını koy):
   `https://api.telegram.org/bot<ANAHTAR>/getUpdates`
5. Çıkan yazıda `"chat":{"id":123456789` kısmındaki sayı senin `TELEGRAM_CHAT_ID` değerin.

### 2. Canvas erişim anahtarı

1. Canvas > Hesap > Ayarlar > **Yeni Erişim Anahtarı**.
2. Amaç: `Jarvis`. Son kullanma tarihini boş bırakabilir ya da dönem sonunu seçebilirsin.
3. Oluşan anahtarı hemen kopyala, bir daha gösterilmez. Bu `CANVAS_TOKEN`.

### 3. GitHub Secrets

Repoda **Settings > Secrets and variables > Actions > New repository secret** ile üç secret ekle:

| İsim | Değer |
| --- | --- |
| `CANVAS_TOKEN` | Canvas erişim anahtarı |
| `TELEGRAM_BOT_TOKEN` | BotFather'ın verdiği anahtar |
| `TELEGRAM_CHAT_ID` | getUpdates'te gördüğün sayı |
| `ZIMBRA_EMAIL` | Okul mail adresi (isteğe bağlı, mail ajanı için) |
| `ZIMBRA_PASSWORD` | Okul maili şifresi (isteğe bağlı, mail ajanı için) |
| `CLOUDFLARE_API_TOKEN` | Cloudflare'de "Edit Cloudflare Workers" şablonuyla üretilen anahtar (isteğe bağlı, bot için) |
| `BOOKED_USERNAME`, `BOOKED_PASSWORD` | Rezervasyon sitesindeki kullanıcı adın ve şifren (isteğe bağlı, `/fitness` için) |
| `DERS_PROGRAMI` | Ders programın, yukarıdaki biçimde (isteğe bağlı: `/dersler`, sabah özeti ve akşam önizlemesi için) |
| `DISPATCH_TOKEN` | GitHub'da üretilen, yalnızca bu repoda "Actions: Read and write" izni olan anahtar (isteğe bağlı ama önerilir: kontrollerin zamanında çalışması için) |

Canvas adresi `https://canvas.agu.edu.tr` olarak ayarlı. Değiştirmek istersen aynı sayfada **Variables** sekmesine `CANVAS_BASE_URL` ekle.

### 4. İlk çalıştırma

1. Repoda **Actions** sekmesi > **Canvas bildirimleri** > **Run workflow**.
2. Bir dakika içinde Telegram'a "Jarvis Canvas ajanı çalışıyor" mesajı gelmeli.
3. Bundan sonra kendiliğinden 10 dakikada bir çalışır. İlk çalışmada eski olaylar bildirilmez, sadece kaydedilir.

## Bilmen gerekenler

- **Sessiz saatler:** 00:00 ile 07:00 arasında Canvas ve mail kontrolü yapılmaz, yani bildirim gelmez. Gece biriken her şey 07:00'deki ilk kontrolde gönderilir. Teslim hatırlatması geceye denk gelen ödevin hatırlatması öne çekilir ve 23:30'da gelir. Kendi kurduğun `/hatirlat` hatırlatmaları ve komut cevapları gece de çalışır. Saatleri değiştirmek için `jarvis/agents/canvas_notifier.py` ve `worker/src/logic.js` içindeki `QUIET_FROM` ve `QUIET_UNTIL` değerlerini değiştir.
- GitHub'ın kendi zamanlayıcısı güvenilir değil: 10 dakikalık bir işi saatlerce geciktirebiliyor. Bu yüzden `DISPATCH_TOKEN` girildiğinde Canvas/mail kontrolünü (10 dakikada bir), sabah özetini (08:00) ve akşam önizlemesini (21:00) bot başlatır. GitHub'ın zamanlayıcısı yedek olarak durur; sabah özeti ikisi birden çalışsa da günde bir kez gider.
- `DISPATCH_TOKEN` şuradan üretilir: GitHub > Settings > Developer settings > Fine-grained tokens. Yalnızca bu repo seçilir, izin olarak yalnızca **Actions: Read and write** verilir. Süresi dolarsa bot Telegram'dan haber verir.
- Repoda 60 gün hiç değişiklik olmazsa GitHub zamanlanmış görevi durdurur ve sana e-posta atar; Actions sekmesinden tek tıkla yeniden açılır.
- Bot Cloudflare Workers'ta (ücretsiz plan) çalışır. `worker/` klasörü değişince **Botu kur** iş akışı onu kendiliğinden yeniden kurar ve Telegram'a bağlar.
- Repo herkese açık olduğu için iş akışı kayıtlarını herkes görebilir. Kod bu yüzden kayıtlara mail konusu, adres ya da hesap bilgisi yazmaz.
- Bir çalışma hata verirse (ör. Canvas anahtarının süresi dolarsa) GitHub sana e-posta gönderir.
- Canvas anahtarı senin hesabınla her şeyi yapabilir. Sızdığından şüphelenirsen Canvas > Ayarlar'dan sil ve yenisini oluştur.

## Kendi bilgisayarında denemek

```bash
export CANVAS_BASE_URL=https://canvas.agu.edu.tr
export CANVAS_TOKEN=...
export TELEGRAM_BOT_TOKEN=...
export TELEGRAM_CHAT_ID=...
python -m jarvis.agents.canvas_notifier
```

Testler: `python -m unittest discover tests` ve `cd worker && node --test`

## Yapı

```
jarvis/
  agents/canvas_notifier.py   Canvas'ı okur, yeni olayları bulur, teslimleri hatırlatır
  agents/mail_notifier.py     Okul mailine bakar, yeni mailleri ve yemek listesini bulur
  agents/morning_summary.py   Sabah özetini hazırlar
  agents/evening_preview.py   Akşam önizlemesini hazırlar
  schedule.py                 Ders programını okur (DERS_PROGRAMI secret'ından)
  channels/telegram.py        Kanal: mesaj gönderir (bütün ajanlar ortak kullanır)
  richtext.py                 Canvas'taki biçimli metni Telegram'ın anladığı biçime çevirir
  state.py                    Hafıza: görülen olayları tutar
  menu.py, menu_ocr.py        Yemek menüsünü okur; listeyi resimden çıkarır
  menu_import.py              Mailden gelen listeyi menü dosyasına işler
worker/                       Bot: komutlara anında cevap veren Cloudflare Worker
worker/src/fitness.js         Fitness randevuları (rezervasyon sitesinin API'si)
data/menu.json                Yemek menüsü
.github/workflows/canvas.yml  10 dakikalık zamanlayıcı (Canvas + mail)
.github/workflows/morning.yml 08:00 zamanlayıcısı
.github/workflows/evening.yml 21:00 zamanlayıcısı
.github/workflows/deploy-worker.yml  Botu Cloudflare'e kurar
```

Yeni bir ajan eklemek için `agents/` altına bir dosya, `.github/workflows/` altına bir zamanlayıcı eklemek yeterli. Başka bir kanal (ör. WhatsApp) eklemek için `channels/` altına `send(text)` fonksiyonu olan bir dosya yazılır.
