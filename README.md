# Jarvis

Küçük ajanlardan oluşan kişisel asistan. Bütün ajanlar Telegram'dan telefonuna ve bilgisayarına yazar.

| Ajan | Ne zaman | Ne yapar |
| --- | --- | --- |
| **Canvas bildirimleri** | 10 dakikada bir | Yeni duyuru, ödev, teslim tarihi değişikliği, not, mesaj ve ders materyalini (dosya, sayfa, bağlantı) haber verir. Teslim etmediğin ödevler için teslime 24 saat ve 3 saat kala hatırlatır |
| **Okul maili** | 10 dakikada bir | Okul mailine (Zimbra) gelen yeni mailleri gönderen, konu ve kısa önizlemeyle haber verir. Mailleri okunmuş işaretlemez |
| **Sabah özeti** | Her sabah 08:00 | Gecikmiş ödevleri, bugün ve önümüzdeki 7 günde teslim edilecekleri (teslim ettiklerin hariç), son 24 saatin duyurularını ve günün yemek menüsünü tek mesajda toplar |
| **Bot** | Anında | Telegram'dan yazdığın komutlara cevap verir, kişisel hatırlatmaları zamanında gönderir |

Özeti beklemeden görmek için: **Actions** sekmesi > **Sabah özeti** > **Run workflow**.

## Komutlar

Telegram'da Jarvis botuna yazılır:

| Komut | Ne yapar |
| --- | --- |
| `/yemek` | Bugünün menüsü. `/yemek yarın`, `/yemek cuma`, `/yemek 17.11` de olur |
| `/hatirlat 15:00 kütüphane` | Bugün 15:00'te hatırlatır (saat geçtiyse yarın) |
| `/hatirlat yarın 09:30 hocaya mail` | Gün adıyla: `yarın`, `cuma`, `20.11` |
| `/hatirlat 30 dk çay` | Şu andan itibaren: `dk`, `saat`, `gün` |
| `/hatirlatmalar` | Bekleyen hatırlatmalar |
| `/sil 2` | Listedeki 2 numaralı hatırlatmayı siler |
| `/yardim` | Komut listesi |

Hatırlatmalar 2 dakikada bir kontrol edilir, yani en fazla 2 dakika gecikebilir. Bot sadece kendi sohbetine cevap verir.

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
| `DISPATCH_TOKEN` | GitHub'da üretilen, yalnızca bu repoda "Actions: Read and write" izni olan anahtar (isteğe bağlı ama önerilir: kontrollerin zamanında çalışması için) |

Canvas adresi `https://canvas.agu.edu.tr` olarak ayarlı. Değiştirmek istersen aynı sayfada **Variables** sekmesine `CANVAS_BASE_URL` ekle.

### 4. İlk çalıştırma

1. Repoda **Actions** sekmesi > **Canvas bildirimleri** > **Run workflow**.
2. Bir dakika içinde Telegram'a "Jarvis Canvas ajanı çalışıyor" mesajı gelmeli.
3. Bundan sonra kendiliğinden 10 dakikada bir çalışır. İlk çalışmada eski olaylar bildirilmez, sadece kaydedilir.

## Bilmen gerekenler

- GitHub'ın kendi zamanlayıcısı güvenilir değil: 10 dakikalık bir işi saatlerce geciktirebiliyor. Bu yüzden `DISPATCH_TOKEN` girildiğinde Canvas/mail kontrolünü (10 dakikada bir) ve sabah özetini (08:00) bot başlatır. GitHub'ın zamanlayıcısı yedek olarak durur; sabah özeti ikisi birden çalışsa da günde bir kez gider.
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
  channels/telegram.py        Kanal: mesaj gönderir (bütün ajanlar ortak kullanır)
  state.py                    Hafıza: görülen olayları tutar
  menu.py, menu_ocr.py        Yemek menüsünü okur; listeyi resimden çıkarır
  menu_import.py              Mailden gelen listeyi menü dosyasına işler
worker/                       Bot: komutlara anında cevap veren Cloudflare Worker
data/menu.json                Yemek menüsü
.github/workflows/canvas.yml  10 dakikalık zamanlayıcı (Canvas + mail)
.github/workflows/morning.yml 08:00 zamanlayıcısı
.github/workflows/deploy-worker.yml  Botu Cloudflare'e kurar
```

Yeni bir ajan eklemek için `agents/` altına bir dosya, `.github/workflows/` altına bir zamanlayıcı eklemek yeterli. Başka bir kanal (ör. WhatsApp) eklemek için `channels/` altına `send(text)` fonksiyonu olan bir dosya yazılır.
