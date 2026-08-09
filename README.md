# Kronik — Tarih Kanalı Büyüme Sistemi

Tarih içerikleri üreten bir YouTube kanalını analiz eden karar paneli.

## Paneli açma

`PANELI_BASLAT.bat` dosyasına çift tıklayın. Panel `http://localhost:3000`
adresinde açılır.

## Canlı YouTube bağlantısı

1. Google Cloud Console içinde bir proje oluşturun.
2. **YouTube Data API v3** ve **YouTube Analytics API** servislerini etkinleştirin.
3. OAuth izin ekranını oluşturun. Test modundaysa kanalı yöneten Google hesabını
   test kullanıcısı olarak ekleyin.
4. “Web application” türünde OAuth istemcisi oluşturun.
5. Yetkili yönlendirme adresine şunu ekleyin:

   `http://localhost:3000/api/auth/youtube/callback`

6. `.env.local` içindeki `YOUTUBE_CLIENT_ID` ve `YOUTUBE_CLIENT_SECRET`
   alanlarını doldurun.
7. Paneli yeniden başlatın ve **Bağlantılar → Google ile bağlan** düğmesini kullanın.

Panel yalnızca `youtube.readonly` ve `yt-analytics.readonly` izinlerini ister;
video yükleyemez, düzenleyemez veya silemez.

## Panel ne hesaplar?

- Son 365 günlük kanal ve video performansı
- Tarih dönemi/olay kümelerine göre içerik portföyü
- Benzer başlıklar ve kısa sürede fazla tekrarlanan konular
- Geçmiş yayın zamanı, ilk 36 saat dağıtım hızı, tutma, beğeni ve abone dönüşümüne dayalı saat/slot gücü
- Her gün 09:00, 11:00, 13:00, 15:00, 17:00 ve 19:00 olmak üzere 6 Shorts içeren 30 günlük plan
- Her sabit slot için kanal verisine göre İzlenme / Abone / Beğeni amacı ataması
- Türkiye’de son 30 günde yükselen tarih videoları

YouTube Analytics API, YouTube Studio’daki **“İzleyicileriniz ne zaman YouTube’da”** ısı haritasını doğrudan sunmaz. Bu nedenle panel aktiflik sinyali olarak kanalın gerçek geçmiş yayın sonuçlarını; aynı gün/saat çevresindeki ilk dağıtım hızı, son dönem izlenme temposu, izlenme yüzdesi, beğeni ve abone dönüşümüyle birlikte kullanır.

## Otomatik çalışma

- Kanal verileri panel kullanıldıkça canlı olarak yenilenebilir.
- Türkçe tarih trendleri düzenli olarak taranır.
- Bugünün 6 videosu gün boyunca kilitli kalır.
- Yarın ve sonrası plan her gün Türkiye saatiyle 21:00’da, 19:00’daki son Shorts sonrasında güncel veriye göre yeniden hesaplanır.

## İsteğe bağlı yerel yapay zekâ

Ollama kullanılıyorsa `.env.local` içinde `OLLAMA_URL` ve `OLLAMA_MODEL`
değerlerini ayarlayın. Plan sayfasındaki **Yerel AI ile güçlendir** düğmesi
başlıkları kaynaklandırılabilir ve tekrarsız olacak şekilde yeniden yazar.

## Geliştirici komutları

- `npm run dev`: panel ve otomatik senkron görevi
- `npm run build`: üretim derlemesi
- `npm run start`: üretim paneli ve otomatik senkron görevi
