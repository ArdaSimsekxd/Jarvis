# Jarvis

Küçük ajanlardan oluşan kişisel asistan. Bütün ajanlar Telegram'dan telefonuna ve bilgisayarına yazar.

| Ajan | Ne zaman | Ne yapar |
| --- | --- | --- |
| **Canvas bildirimleri** | 10 dakikada bir | Yeni duyuru, ödev, teslim tarihi değişikliği, not, mesaj ve ders materyalini (dosya, sayfa, bağlantı) haber verir. Duyuruların tamamını gönderir (paragraflar, kalın yazı ve bağlantılarla). Yeni yüklenen dosyaların (PDF, slayt vb.) kendisini de gönderir; 45 MB'tan büyük ya da indirilemeyen dosyaların yalnızca bağlantısı gelir. Teslim etmediğin ödevler için teslime 24 saat ve 3 saat kala hatırlatır |
| **Okul maili** | 10 dakikada bir | Okul mailine (Zimbra) gelen yeni mailleri gönderen, konu ve kısa önizlemeyle haber verir. Mailleri okunmuş işaretlemez. Son 15 mailin kısa hâlini bota aktarır; böylece `/mailler` komutu ve "en son ne mail geldi?" sorusu çalışır. Canvas'ın duyuru, tartışma ve ödevler için attığı kopya mailleri atlar, çünkü onları Canvas bildirimi zaten gönderir |
| **Sabah özeti** | Her sabah 08:00 | Günün derslerini, gecikmiş ödevleri, bugün ve önümüzdeki 7 günde teslim edilecekleri (teslim ettiklerin hariç), son 24 saatin duyurularını ve günün yemek menüsünü tek mesajda toplar |
| **Akşam önizlemesi** | Her akşam 21:00 | Bu gece ve yarın teslim edilecekleri, yarının derslerini ve yemek menüsünü tek mesajda toplar. Yarın için söylenecek bir şey yoksa mesaj atmaz |
| **Fitness randevusu** | Randevu açılınca | Söylediğin gün ve saatler için okulun rezervasyon sitesinden fitness randevusu alır, sonucu haber verir |
| **Bot** | Anında | Telegram'dan yazdığın komutlara, normal cümlelere ve sesli mesajlara cevap verir, kişisel hatırlatmaları zamanında gönderir |

Özeti beklemeden görmek için: **Actions** sekmesi > **Sabah özeti** > **Run workflow**.

## Konuşarak kullanmak

Komut ezberlemek gerekmez; Jarvis'e normal cümleyle ya da sesli mesajla yazabilirsin:

- "Yarın 3'te dişçim var, bir saat önce hatırlat"
- "Bu hafta beni ne bekliyor?"
- "Pazartesi ilk dersim kaçta?"
- "En son ne mail geldi?" ya da "Burs ile ilgili mail var mı?"
- "Her salı 13:00-14:30 fitness'a yaz beni" ya da "Salı günkü fitness'ı iptal et"
- "Dişçi hatırlatmasını sil"
- "Ahmet'in doğum günü 3 Mart, kaydet" ve sonra "Ahmet'in doğum günü ne zamandı?"
- "Kahveye 120 TL verdim" ya da "Bu ay yemeğe ne kadar harcadım?"

Nasıl çalışır: yapay zekâ yalnızca ne istediğini anlar ve bunu aşağıdaki komutlara çevirir; işi yine o komutlar yapar. Silme ve iptal gibi işlerden önce "evet" diye onayını ister. Sesli mesajda önce ne duyduğunu yazar. Ödev ve ders sorularına da genel sorulara da cevap verir, ama her yapay zekâ gibi yanılabilir; önemli bir tarih ya da not için `/odevler` ve `/notlar` komutlarının çıktısı esastır.

Yapay zekâ Cloudflare Workers AI üzerinde, botla aynı yerde çalışır ve günlük ücretsiz kotayı kullanır (gece 03:00'te yenilenir). Kota dolarsa komutlar çalışmaya devam eder. Yazdıkların ve cevap için gereken bilgiler (ör. ders programın) işlenmek üzere Cloudflare'in modeline gider; başka bir şirkete gitmez. Kullanılan model `worker/wrangler.toml` içindeki `AI_MODEL` satırından değiştirilir.

## Hafıza (ikinci beyin)

Aklında tutmak istediğin her şeyi Jarvis'e bırakabilirsin, sonra normal cümleyle sorarsın:

- **Not:** "Spor salonundaki dolabım 45 numara, kaydet" ya da `/not Kütüphane kartı numaram 2231`
- **Bağlantı:** Yalnızca bir bağlantı gönderirsen sayfanın başlığıyla birlikte saklar.
- **Fotoğraf:** Gönderdiğin her fotoğrafı saklar. Yapay zekâ fotoğrafta ne olduğunu ve üzerindeki yazıyı (fiş, afiş, tahta, belge) okur; böylece sonra "geçen hafta fotoğrafını attığım fişte toplam ne kadardı?" diye sorabilirsin, ilgili fotoğrafı da geri gönderir. Fotoğrafın altına bir soru yazarsan ("bu ne zaman?") hem kaydeder hem cevaplar.
- **Sormak:** "Ahmet'in doğum günü ne zamandı?", "staj ile ilgili ne kaydetmiştim?"
- **Silmek:** "Dolap notunu hafızadan sil" (önce onay ister) ya da `/hafiza sil 12`

**Mail ve duyurulardaki tarihler:** Yeni gelen okul maillerine ve Canvas duyurularına 10 dakikada bir bakar. İçlerinde ileri tarihli bir olay (sınav, son başvuru, etkinlik, toplantı) varsa onu hafızaya kaydeder, **3 gün, 1 gün ve 2 saat önce** hatırlatır ve sana "Mailde tarih buldum" diye haber verir. Saat yazmıyorsa hatırlatmalar o günlerin sabahı 09:00'da gelir; gece 00:00-07:00 arasına düşen hatırlatma önceki akşam 23:30'a alınır. Canvas ödevlerinin teslim tarihlerini almaz, onlar zaten ayrıca hatırlatılıyor. Yapay zekâ yanlış bir tarih bulduysa haber mesajındaki `/hafiza sil 12` komutu notu ve hatırlatmalarını birlikte siler. Yaklaşanları görmek için: `/tarihler`. Son 3 günden eski mail ve duyurulara bakmaz.

En fazla 300 not saklanır. Fotoğrafların kendisi Telegram'da kalır; botun kendi Cloudflare hesabında yalnızca yazıların ve fotoğrafın Telegram kimliği durur. Şifre gibi çok hassas bilgileri kaydetmeden önce bunu düşün: sorduğunda notların cevap için Cloudflare'in yapay zekâsına gider.

## Harcamalar ve bütçe

- **Kaydetmek:** "Kahveye 120 TL verdim", "dün markete 450 lira gitti" ya da `/harcama 120 kahve`. Türü (yemek, kafe, market, ulaşım...) kendisi tahmin eder.
- **Fiş:** Fişin fotoğrafını atman yeter. Yapay zekâ genel toplamı, işletmeyi ve türü okuyup harcama olarak kaydeder; fotoğraf da hafızada kalır.
- **Sormak:** "Bu ay yemeğe ne kadar harcadım?", "bütçem ne durumda?" ya da `/harcamalar`, `/harcamalar ekim`, `/harcamalar kafe`.
- **Bütçe:** `/butce 6000` aylık bütçeyi ayarlar. Bütçenin %80'ine gelince ve aşınca haber verir, ay içinde günde ne kadar harcayabileceğini söyler.
- **Ay sonu:** Her ayın 1'inde sabah 10:00'da geçen ayın özeti gelir: toplam, türlere göre dağılım, önceki aya göre fark, en büyük harcamalar.
- **Silmek:** Kayıt mesajındaki `/harcama sil 5` ya da "kahve harcamasını sil" (önce onay ister).

Harcamalar botun kendi Cloudflare deposunda, her ay için tek bir kayıtta durur. Fişi okumak için fotoğraftaki yazı Cloudflare'in yapay zekâsına gider. Yapay zekâ tutarı yanlış okuyabilir; kayıt mesajındaki tutara bir göz at.

## İnternet

Jarvis güncel bilgi için internette arar: "yarın Kayseri'den Ankara'ya otobüs var mı?", "dolar bugün kaç TL?", "RTX 5070 fiyatları ne kadar?" gibi sorularda arama yapar, bulduğu sayfaları okuyup kısa bir cevap yazar ve altına tıklanabilir kaynakları koyar. Bir bağlantı atıp "bunu özetle" ya da "son başvuru ne zaman?" dersen sayfayı okuyup özetler.

- **Komutla:** `/ara soru` ve `/ozetle bağlantı [istek]`.
- **Kurulum:** [tavily.com](https://app.tavily.com)'a ücretsiz üye ol (kredi kartı istemez, ayda 1.000 arama), anahtarı GitHub'da `TAVILY_API_KEY` secret'ı olarak ekle ve **Botu kur**'u çalıştır.
- Kendi bilgilerin (ödev, ders, hafıza, harcama) için internete çıkmaz; onları botun kendisinden okur.
- Soru Tavily'ye, bulunan yazılar Cloudflare'in yapay zekâsına gider. Kişisel bir şey aratmadan önce bunu düşün.
- Cevaplar internetten geldiği için yanlış ya da eski olabilir; fiyat ve saat gibi bilgileri kaynağından kontrol et. Sayfalardaki yazılar yalnızca veri olarak okunur, içlerindeki talimatlar uygulanmaz.

## Bilgisayar (Windows)

Jarvis Windows bilgisayarını Telegram'dan yönetebilir: "bilgisayarı kilitle", "sesi 30 yap", "Spotify'ı aç", "ekranın fotoğrafını at", "indirilenlerdeki son dosyayı gönder" ya da `/pc kilitle`, `/pc ekran`, `/pc ses 30`, `/pc aç spotify`, `/pc dosyalar`. Bütün liste: `/pc yardım`.

**Kurulum (bir kez):**
1. Bilgisayarda Python yoksa [python.org/downloads](https://www.python.org/downloads/) adresinden kur. Kurulumun ilk ekranında **Add python.exe to PATH** kutusunu işaretle.
2. Telegram'da Jarvis'e `/pc bağla` yaz. Gelen `jarvis_pc.py` dosyasını bilgisayarına indir ve çift tıkla. (Çift tıklayınca açılmazsa: sağ tık > Birlikte aç > Python.)
3. Açılan pencerede "Kuruldu" yazınca bitti. Telegram'a "Bilgisayarın Jarvis'e bağlandı" mesajı gelir.

Nasıl çalışır: Program `%LOCALAPPDATA%\Jarvis` klasörüne kopyalanır, bilgisayar her açıldığında arka planda (pencere açmadan) başlar ve Jarvis'e bağlanır. Bağlantıyı program kendisi açtığı için modemde ayar gerekmez. Bilgisayar kapalı ya da uykudayken komut gelmez; Jarvis bunu söyler.

Güvenlik:
- Program yalnızca listedeki işleri yapar, rastgele komut çalıştırmaz. Kamera ve konum yalnızca senin komutunla ya da kayıp modunda kullanılır.
- Dosya olarak yalnızca İndirilenler ve Masaüstündeki son dosyaları gönderebilir.
- Kapatma ve yeniden başlatma 1 dakika sonra olur, `/pc iptal` ile durdurulur. Normal cümleyle istenince önce onay ister.
- `/pc bağla` ile gelen dosyadaki kod tek kullanımlıktır ve 1 saat geçerlidir. Bağlantı anahtarı yalnızca bilgisayardaki `config.json` dosyasında durur; Jarvis yalnızca anahtarın özetini saklar.
- Bağlantıyı kaldırmak için `/pc ayır`. Programı bilgisayardan silmek için `jarvis_pc.py` dosyasını yeniden açıp `kaldir` yaz.

**Kayıp/çalıntı modu:** Bilgisayar kaybolur ya da çalınırsa Telegram'a `/pc kayıp` yaz (ya da "laptopum çalındı"). Bilgisayar bağlıysa hemen, kapalıysa açılıp internete bağlandığı anda Jarvis sırayla ekran görüntüsü ve kamera fotoğrafı gönderir, konumu yazar ve bilgisayarı kilitler. Bilgisayar açık kaldıkça bunu 15 dakikada bir tekrarlar; gece 00:00-07:00 arası mesajlar sessiz gelir. Bulununca `/pc bulundu`. Yalnızca nerede olduğunu görmek için `/pc konum`, kameradan tek fotoğraf için `/pc kamera`.
- Konum iki yerden gelir: Windows'un konumu (Wi-Fi ağlarına göre, genelde birkaç yüz metre içinde) ve internet bağlantısının IP adresine göre şehir. Ayrıca bağlı olduğu Wi-Fi ağının adı yazılır.
- Windows konumu için bir kez: **Ayarlar > Gizlilik ve güvenlik > Konum**: **Konum hizmetleri** açık, **Masaüstü uygulamalarının konumunuza erişmesine izin verin** açık. Kamera için aynı yerde **Kamera > Masaüstü uygulamalarının kameranıza erişmesine izin verin** açık.
- Kamera için program bir parça (opencv) kurar. Eski kurulumu olanlar `/pc bağla` ile gelen dosyayı yeniden açmalı.
- Çalındıysa önce polise başvur; fotoğrafları, konumu ve IP adresini onlara verebilirsin. Bilgisayarı kendin geri almaya çalışma.

Kendi uygulamanı eklemek için `%LOCALAPPDATA%\Jarvis\config.json` içindeki `"uygulamalar"` bölümüne `"oyun": "C:\\Games\\oyun.exe"` gibi bir satır yaz. Başlat menüsündeki uygulamaları zaten adıyla açabilir.

## Jarvis paneli

Jarvis'in bildiği her şeyi tek ekranda gösteren, Iron Man tarzı bir sayfa:
- bugünün dersleri (bittiyse sıradaki gün)
- bekleyen ve geciken ödevler (geri sayımla)
- mail ve duyurulardan bulunan tarihler, hatırlatmalar ve fitness randevuları
- bu ayın harcaması ve bütçe göstergesi
- son mailler ve yemekhane menüsü
- bilgisayarın açık mı (kilitle, ekran görüntüsü, uyku, ses ve müzik düğmeleriyle)

- **Açmak:** Telegram'da `/panel` yaz, gelen bağlantıya dokun.
- **iPhone uygulaması:** Bağlantıyı Safari'de aç, paylaş düğmesinden **Ana Ekrana Ekle**'yi seç. Ana ekrandaki Jarvis simgesi tam ekran açılır. İlk açılışta kod sorarsa `/panel` mesajındaki kodu gir (15 dakika geçerli). Uygulamada:
  - **Eş zamanlı:** Telegram'a yazdığında, hatırlatma geldiğinde ya da bilgisayar açılıp kapandığında ekran hemen yenilenir (üstteki "Canlı" ışığı).
  - **Sohbet:** "Jarvis ile konuş" kutusundan Telegram'daki gibi yazabilirsin.
  - **Bildirimler:** "🔔 Bildirimler" düğmesine bas ve izin ver (iOS 16.4 ve üstü, yalnızca ana ekrandaki uygulamada). Jarvis'in kendiliğinden gönderdiği mesajlar (hatırlatmalar, mailde bulunan tarihler, bütçe uyarıları, fitness, ay sonu özeti) bildirim olarak da gelir. Canvas, mail ve sabah özeti bildirimleri şimdilik yalnızca Telegram'a gelir.
- Sayfa 3 dakikada bir kendini yeniler. Canvas ödevleri 10 dakikada bir okunur.
- **Güvenlik:** Bağlantının sonundaki gizli anahtar olmadan sayfa boş gelir ve veri okunamaz. Anahtar adresin `#` kısmında durduğu için sunucu kayıtlarına düşmez. Bağlantıyı yanlışlıkla paylaştıysan `/panel yenile` yaz; eski bağlantı ve uygulamadaki girişler çalışmaz olur, eski cihazlara bildirim gitmez. Panelden bilgisayar kapatılamaz, yalnızca kilitlenir ya da uyutulur.

## Deprem, kargo, telefonumu bul, nöbetçi eczane

- **Deprem uyarısı:** Jarvis AFAD'ın son depremler listesine 2 dakikada bir bakar (AFAD'a ulaşamazsa EMSC, o da olmazsa USGS). Kayseri'ye 150 km içinde 3.5 ve üstü, 400 km içinde 4.5 ve üstü, Türkiye'nin her yerinde 5.0 ve üstü depremleri Telegram'a ve telefondaki uygulamaya yazar. Gece 00:00-07:00 arası 4.0 altını bildirmez. `/deprem` son depremleri gösterir; `/deprem ekle İzmir` bir şehri de takip eder (en fazla 5), `/deprem sil İzmir` çıkarır, `/deprem esik 4` yakındaki depremler için eşiği değiştirir, `/deprem kapat` / `/deprem ac`. Kurulum gerekmez.
- **Kargo takibi:** `/kargo 123456789012 kulaklık` kargoyu kaydeder (sondaki ad isteğe bağlı) ve takip sayfasının bağlantısını verir. Firmayı da yazabilirsin: `/kargo aras 123456789012`. Yurtiçi, Aras ve PTT'de firmanın kendi sayfası açılır, diğerlerinde firmayı kendisi bulan 17TRACK sayfası. Jarvis her sabah 10:00'da bekleyen kargoları bağlantılarıyla hatırlatır. `/kargo` hepsini gösterir; gelince `/kargo geldi 1` yaz. Kayıtlar 30 gün sonra kendiliğinden düşer.
  - **İsteğe bağlı otomatik takip:** 17TRACK API anahtarın olursa (`TRACK17_KEY` secret'ı) Jarvis durumu yarım saatte bir kendisi okur. Kargo yola çıkınca, dağıtıma çıkınca ve teslim edilince haber verir.
- **Nöbetçi eczane:** `/eczane` (ya da "açık eczane var mı?") Kayseri merkezde (Melikgazi, Kocasinan, Talas) o gece nöbetçi olan eczaneleri adres, telefon ve harita bağlantısıyla verir. `/eczane talas` tek ilçeyi, `/eczane hepsi` bütün ilçeleri gösterir. Liste haber sitelerinin herkese açık nöbetçi eczane sayfalarından okunur (Posta, olmazsa Sabah, Habertürk, Gazete Vatan). Sabah 09:00'a kadar dün akşam başlayan nöbet listesi gösterilir. Bulunan liste o geceye ait değilse uyarı yazılır. Gitmeden önce aramak iyi olur. Kurulum gerekmez.
- **Telefonumu bul:** `/bul` (ya da "telefonumu bulamıyorum") yazınca iPhone'daki Jarvis uygulamasına 3 dakika boyunca 20 saniyede bir bildirim gider. Bulunca bildirime dokun, durur (`/bul dur` da olur). Bilgisayardan da çalışır: Telegram Desktop'tan yaz ya da paneli bilgisayarda açıp "📱 Telefonumu bul"a bas. Uygulamada bildirimlerin açık olması gerekir. Telefon sessizdeyse yalnızca titrer; sessizdeyken de ses çıkarması için [iCloud Bul](https://www.icloud.com/find) sayfasındaki "Ses Çal" kullanılmalı.

## Komutlar

Telegram'da Jarvis botuna yazılır:

| Komut | Ne yapar |
| --- | --- |
| `/mailler` | Okul mailine gelen son mailler; `/mailler 1` en son maili tam metniyle, `/mailler burs` içinde "burs" geçenleri gösterir (liste 10 dakikada bir güncellenir) |
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
| `/not metin` | Metni hafızaya kaydeder |
| `/hafiza` | Hafızaya son kaydedilenler; `/hafiza staj` içinde "staj" geçenleri, `/hafiza 12` 12 numaralı notu (fotoğrafsa fotoğrafıyla) gösterir, `/hafiza sil 12` siler |
| `/harcama 120 kahve` | Harcama kaydeder; `/harcama sil 5` siler |
| `/harcamalar` | Bu ayın harcamaları, türlere göre toplam ve bütçe; `/harcamalar ekim`, `/harcamalar kafe` de olur |
| `/butce 6000` | Aylık bütçeyi ayarlar; `/butce` durumu gösterir, `/butce sil` kaldırır |
| `/tarihler` | Mail ve Canvas duyurularından bulunan yaklaşan tarihler |
| `/ara yarın Kayseri Ankara otobüs` | İnternette arar, kaynaklı kısa cevap yazar (`TAVILY_API_KEY` gerekir) |
| `/ozetle https://...` | Bağlantıdaki sayfayı okuyup özetler; arkasına soru da yazılabilir |
| `/panel` | Jarvis panelinin özel bağlantısı; `/panel yenile` bağlantıyı değiştirir |
| `/deprem` | Son depremler ve uyarı ayarları; `/deprem ekle İzmir`, `/deprem esik 4`, `/deprem kapat` |
| `/kargo 123456789012 kulaklık` | Kargoyu kaydeder, takip bağlantısını verir, her sabah hatırlatır; `/kargo` hepsi, `/kargo geldi 1` |
| `/eczane` | Kayseri'de bu gece nöbetçi eczaneler; `/eczane talas`, `/eczane hepsi` |
| `/bul` | Telefonumu bul: iPhone'daki Jarvis uygulaması 3 dakika bildirimle çalar; `/bul dur` |
| `/pc kilitle` | Bilgisayarı yönetir: `/pc`, `/pc ekran`, `/pc kamera`, `/pc konum`, `/pc ses 30`, `/pc aç spotify`, `/pc dosyalar`; çalınırsa `/pc kayıp`, bulununca `/pc bulundu`; ilk kez `/pc bağla` |
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
| `TAVILY_API_KEY` | tavily.com'un verdiği anahtar (isteğe bağlı: internette arama ve sayfa özeti için) |
| `TRACK17_KEY` | 17track.net API'nin verdiği anahtar (isteğe bağlı: kargo takibi için) |
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
  channels/telegram.py        Kanal: mesaj ve dosya gönderir (bütün ajanlar ortak kullanır)
  richtext.py                 Canvas'taki biçimli metni Telegram'ın anladığı biçime çevirir
  state.py                    Hafıza: görülen olayları tutar
  menu.py, menu_ocr.py        Yemek menüsünü okur; listeyi resimden çıkarır
  menu_import.py              Mailden gelen listeyi menü dosyasına işler
worker/                       Bot: komutlara anında cevap veren Cloudflare Worker
worker/src/fitness.js         Fitness randevuları (rezervasyon sitesinin API'si)
jarvis/recent_mail.py         Son mailleri botun deposuna (Cloudflare KV) aktarır
worker/src/brain.js           Yapay zekâ: normal cümleleri ve sesli mesajları komutlara çevirir
worker/src/web.js             İnternette arama ve sayfa özeti (Tavily)
worker/src/pc.js              Bilgisayar bağlantısı (Durable Object, WebSocket)
worker/src/quake.js           Deprem uyarısı (AFAD, yedekte EMSC ve USGS)
worker/src/pharmacy.js        Nöbetçi eczaneler (haber sitelerinin listeleri)
worker/src/cargo.js           Kargo takibi (bağlantı + hatırlatma; anahtar varsa 17TRACK)
worker/src/panel.js           Jarvis paneli ve iPhone uygulaması: veriler, giriş, sohbet; sayfası panel_page.js
worker/src/webpush.js         Uygulama bildirimleri (Web Push, VAPID)
pc/jarvis_pc.py               Windows'ta çalışan Jarvis programı (kurulum + komutlar)
data/menu.json                Yemek menüsü
.github/workflows/canvas.yml  10 dakikalık zamanlayıcı (Canvas + mail)
.github/workflows/morning.yml 08:00 zamanlayıcısı
.github/workflows/evening.yml 21:00 zamanlayıcısı
.github/workflows/deploy-worker.yml  Botu Cloudflare'e kurar
```

Yeni bir ajan eklemek için `agents/` altına bir dosya, `.github/workflows/` altına bir zamanlayıcı eklemek yeterli. Başka bir kanal (ör. WhatsApp) eklemek için `channels/` altına `send(text)` fonksiyonu olan bir dosya yazılır.
