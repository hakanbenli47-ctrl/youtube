import { buildDashboard } from "@/lib/analytics";
import { restoreAuthFromRequest } from "@/lib/auth-cookie";
import { getState, saveState, withStateLock } from "@/lib/store";
import { bootstrapPublicYouTubeState, refreshPublicYouTubeStats, scanTrends, syncYouTube } from "@/lib/youtube-v2";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function ageOf(value: string | null | undefined) {
  if (!value) return Number.POSITIVE_INFINITY;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? Date.now() - timestamp : Number.POSITIVE_INFINITY;
}

export async function POST(request: Request) {
  try {
    return await withStateLock("youtube-sync", async () => {
      const url = new URL(request.url);
      const automatic = url.searchParams.get("auto") === "1";
      let state = await getState();
      const restored = restoreAuthFromRequest(state, request);
      state = restored.state;
      if (restored.restored) await saveState(state);

      if (!state.auth.connected || !state.auth.tokens) {
        return Response.json({
          skipped: true,
          reason: "YouTube bağlantısı bekleniyor",
          dashboard: buildDashboard(state),
        });
      }

      let bootstrapped = false;

      // Vercel yeni instance açıp /tmp durumunu kaybettiyse önce yalnızca YouTube
      // Data API ile kanal ve tüm yüklenmiş videoların public verisini geri kur.
      // Ardından aynı istekte ayrıntılı Analytics tamamlanmaya çalışılır.
      if (automatic && state.videos.length === 0) {
        state = await bootstrapPublicYouTubeState(state);
        bootstrapped = true;
      }

      const fullIntervalMinutes = Math.max(
        15,
        Number(process.env.YOUTUBE_SYNC_INTERVAL_MINUTES || 60),
      );
      const publicIntervalMinutes = Math.max(
        2,
        Number(process.env.YOUTUBE_PUBLIC_SYNC_INTERVAL_MINUTES || 2),
      );
      const fullSyncDue =
        ageOf(state.sync.lastSuccessfulYouTubeSync || state.sync.lastYouTubeSync) >=
        fullIntervalMinutes * 60_000;

      if (automatic && !fullSyncDue) {
        const publicSyncDue =
          ageOf(state.sync.lastPublicStatsSync) >= publicIntervalMinutes * 60_000;
        if (publicSyncDue) {
          state = await refreshPublicYouTubeStats(state);
          const discoveredNewUpload = state.channel.videoCount > state.videos.length;
          if (!discoveredNewUpload) {
            return Response.json({
              skipped: false,
              lightweight: true,
              reason: "Canlı görüntülenmeler yenilendi; ayrıntılı Analytics henüz yenileme aralığında.",
              dashboard: buildDashboard(state),
            });
          }
        } else {
          return Response.json({
            skipped: true,
            reason: "Canlı veri henüz yenileme aralığında",
            dashboard: buildDashboard(state),
          });
        }
      }

      // Kanal verisini tamamla. Plan üretimi bu isteğin parçası değildir.
      try {
        state = await syncYouTube();
      } catch (error) {
        // Public bootstrap başarılıysa Analytics geçici hata verse bile kullanıcıya
        // 0 veri döndürme; temel canlı veriyi koru ve paneli aç.
        if (bootstrapped && state.videos.length > 0) {
          const message = error instanceof Error ? error.message : "Analytics senkronu tamamlanamadı.";
          return Response.json({
            skipped: false,
            lightweight: true,
            partial: true,
            reason: `Temel kanal verileri yüklendi; ayrıntılı Analytics geçici olarak tamamlanamadı: ${message}`,
            dashboard: buildDashboard(state),
          });
        }
        throw error;
      }

      // Otomatik açılış senkronunda trend taraması ve 30 günlük plan hesabı yapma.
      if (automatic) {
        return Response.json({
          skipped: false,
          lightweight: false,
          reason: "Kanal ve ayrıntılı Analytics verileri yenilendi.",
          dashboard: buildDashboard(state),
        });
      }

      const trendAge = ageOf(state.sync.lastTrendScan);
      if (trendAge > 24 * 60 * 60_000) {
        try {
          state = await scanTrends();
        } catch (error) {
          console.error("Trend taraması ana senkronu engellemeden atlandı.", error);
        }
      }

      // Manuel veri yenilemede de ağır 30 günlük plan hesabını çalıştırma.
      await saveState(state);
      return Response.json({
        skipped: false,
        lightweight: false,
        dashboard: buildDashboard(state),
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Senkron başarısız.";
    const status = message.includes("zaten çalışıyor") ? 409 : 500;
    return Response.json({ error: message }, { status });
  }
}
