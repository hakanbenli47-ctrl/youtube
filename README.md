# Kronik — Tarih Kanalı Büyüme Sistemi

Tarih içerikleri üreten bir YouTube kanalını yerel olarak analiz eden karar paneli.

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
- Geçmiş yayın zamanı ile performans arasındaki ilişkiye dayalı saat önerileri
- Haftada iki uzun video ve dört Shorts içeren 30 günlük başlangıç planı
- Türkiye’de son 30 günde yükselen tarih videoları

YouTube Analytics API küçük resim gösterimi ve CTR bilgisini hedefli sorgularda
sunmadığı için bu alanlar YouTube Studio ZIP dışa aktarımıyla tamamlanabilir.

## Otomatik çalışma

- Kanal verileri varsayılan olarak 6 saatte bir yenilenir.
- Türkçe tarih trendleri günde bir kez taranır.
- 30 günlük plan her senkron sonrasında yeniden hesaplanır.

## İsteğe bağlı yerel yapay zekâ

Ollama kullanılıyorsa `.env.local` içinde `OLLAMA_URL` ve `OLLAMA_MODEL`
değerlerini ayarlayın. Plan sayfasındaki **Yerel AI ile güçlendir** düğmesi
başlıkları kaynaklandırılabilir ve tekrarsız olacak şekilde yeniden yazar.

## Geliştirici komutları

- `npm run dev`: panel ve otomatik senkron görevi
- `npm run build`: üretim derlemesi
- `npm run start`: üretim paneli ve otomatik senkron görevi
