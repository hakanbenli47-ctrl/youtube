import { buildDashboard } from "@/lib/analytics";
import { restoreAuthFromRequest } from "@/lib/auth-cookie";
import { maybeRefreshFuturePlan } from "@/lib/plan-refresh";
import { buildAdaptiveWeeklySchedule } from "@/lib/scheduling";
import { getState, saveState, withStateLock } from "@/lib/store";
import { bootstrapPublicYouTubeState, refreshPublicYouTubeStats, scanTrends, syncYouTube } from "@/lib/youtube-v2";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function ageOf(value: string | null | undefined) {
  if (!value) return Number.POSITIVE_INFINITY;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? Date.now() - timestamp : Number.POSITIVE_INFINITY;
}

async function applyLivePlan(state: Awaited<ReturnType<typeof getState>>) {
  const weeklySchedule = buildAdaptiveWeeklySchedule(state);
  const planned = maybeRefreshFuturePlan(state, weeklySchedule);
  if (planned !== state) await saveState(planned);
  return planned;
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

      // Deploy sonrası geçici hafıza boşalmışsa önce Data API ile kanalın TÜM
      // yüklenmiş videolarını ve başlıklarını geri al. Planı da hemen bu gerçek
      // konu hafızasından kur; ağır Analytics raporunu bekletme.
      if (state.videos.length === 0) {
        state = await bootstrapPublicYouTubeState(state);
        state = await applyLivePlan(state);
        if (automatic) {
          return Response.json({
            skipped: false,
            lightweight: true,
            bootstrapped: true,
            reason: `${state.videos.length} video konu hafızasına alındı; bugünün konuları kilitlendi, gelecek plan kanal verisinden oluşturuldu.`,
            dashboard: buildDashboard(state),
          });
        }
      }

      const fullIntervalMinutes = Math.max(
        15,
        Number(process.env.YOUTUBE_SYNC_INTERVAL_MINUTES || 60),
      );
      // Canlı public izlenmeler kullanıcının istediği gibi iki dakikada bir alınır.
      const publicIntervalMinutes = 2;
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
            state = await applyLivePlan(state);
            return Response.json({
              skipped: false,
              lightweight: true,
              reason: "Canlı izlenmeler 2 dakikalık ölçümle yenilendi; bugünün konuları sabit, gelecek konular yeni sonuçlara göre puanlandı.",
              dashboard: buildDashboard(state),
            });
          }
        } else {
          state = await applyLivePlan(state);
          return Response.json({
            skipped: true,
            reason: "İki dakikalık canlı veri aralığı henüz dolmadı; mevcut konu kilidi korundu.",
            dashboard: buildDashboard(state),
          });
        }
      }

      // Saatlik/manuel tam senkron: bütün videoların Analytics metriklerini çek.
      // Bu veriler hem konu seçiminde hem yayın saatlerinin puanında kullanılır.
      state = await syncYouTube();

      const trendAge = ageOf(state.sync.lastTrendScan);
      if (trendAge > 24 * 60 * 60_000) {
        try {
          state = await scanTrends();
        } catch (error) {
          console.error("Trend taraması ana senkronu engellemeden atlandı.", error);
        }
      }

      state = await applyLivePlan(state);
      await saveState(state);

      return Response.json({
        skipped: false,
        lightweight: false,
        reason: "Tüm video sonuçları, saat modeli ve tekrarsız gelecek konu planı yenilendi.",
        dashboard: buildDashboard(state),
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Senkron başarısız.";
    const status = message.includes("zaten çalışıyor") ? 409 : 500;
    return Response.json({ error: message }, { status });
  }
}
