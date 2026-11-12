# Jarvis

Küçük ajanlardan oluşan kişisel asistan. İlk ajan: **Canvas bildirimleri**.

Her 10 dakikada bir Canvas'a bakar; yeni duyuru, ödev, teslim tarihi değişikliği, not ve mesajları Telegram'dan telefonuna ve bilgisayarına gönderir.

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

Canvas adresi `https://canvas.agu.edu.tr` olarak ayarlı. Değiştirmek istersen aynı sayfada **Variables** sekmesine `CANVAS_BASE_URL` ekle.

### 4. İlk çalıştırma

1. Repoda **Actions** sekmesi > **Canvas bildirimleri** > **Run workflow**.
2. Bir dakika içinde Telegram'a "Jarvis Canvas ajanı çalışıyor" mesajı gelmeli.
3. Bundan sonra kendiliğinden 10 dakikada bir çalışır. İlk çalışmada eski olaylar bildirilmez, sadece kaydedilir.

## Bilmen gerekenler

- GitHub zamanlamayı yoğun saatlerde birkaç dakika geciktirebilir.
- Repoda 60 gün hiç değişiklik olmazsa GitHub zamanlanmış görevi durdurur ve sana e-posta atar; Actions sekmesinden tek tıkla yeniden açılır.
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

Testler: `python -m unittest discover tests`

## Yapı

```
jarvis/
  agents/canvas_notifier.py   Kaynak: Canvas'ı okur, yeni olayları bulur
  channels/telegram.py        Kanal: mesaj gönderir (bütün ajanlar ortak kullanır)
  state.py                    Hafıza: görülen olayları tutar
.github/workflows/canvas.yml  Zamanlayıcı
```

Yeni bir ajan eklemek için `agents/` altına bir dosya, `.github/workflows/` altına bir zamanlayıcı eklemek yeterli. Başka bir kanal (ör. WhatsApp) eklemek için `channels/` altına `send(text)` fonksiyonu olan bir dosya yazılır.
