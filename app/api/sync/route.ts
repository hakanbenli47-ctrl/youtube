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
  try {
    const weeklySchedule = buildAdaptiveWeeklySchedule(state);
    const planned = maybeRefreshFuturePlan(state, weeklySchedule);
    if (planned !== state) await saveState(planned);
    return planned;
  } catch (error) {
    // Plan motoru hiçbir zaman YouTube bağlantısını veya veri senkronunu düşürmemeli.
    // Plan hatası ayrı kaydedilir; canlı kanal verisi kullanıcıya yine döner.
    console.error("Konu planı yenilenemedi; YouTube senkronu korunuyor.", error);
    return {
      ...state,
      sync: {
        ...state.sync,
        warnings: [
          ...(state.sync.warnings || []).filter((warning) => !warning.startsWith("Plan motoru:")),
          `Plan motoru: ${error instanceof Error ? error.message : "yenilenemedi"}`,
        ].slice(-8),
      },
    };
  }
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

      if (state.videos.length === 0) {
        state = await bootstrapPublicYouTubeState(state);
        state = await applyLivePlan(state);
        await saveState(state);
        if (automatic) {
          return Response.json({
            skipped: false,
            lightweight: true,
            bootstrapped: true,
            reason: `${state.videos.length} video konu hafızasına alındı; kanal bağlantısı hazır.`,
            dashboard: buildDashboard(state),
          });
        }
      }

      const fullIntervalMinutes = Math.max(
        15,
        Number(process.env.YOUTUBE_SYNC_INTERVAL_MINUTES || 60),
      );
      const publicIntervalMinutes = 2;
      const fullSyncDue =
        ageOf(state.sync.lastSuccessfulYouTubeSync || state.sync.lastYouTubeSync) >=
        fullIntervalMinutes * 60_000;

      if (automatic && !fullSyncDue) {
        const publicSyncDue = ageOf(state.sync.lastPublicStatsSync) >= publicIntervalMinutes * 60_000;

        if (publicSyncDue) {
          state = await refreshPublicYouTubeStats(state);
          const discoveredNewUpload = state.channel.videoCount > state.videos.length;

          if (!discoveredNewUpload) {
            state = await applyLivePlan(state);
            await saveState(state);
            return Response.json({
              skipped: false,
              lightweight: true,
              reason: "Canlı izlenmeler yenilendi; bağlantı ve kanal verisi plan motorundan bağımsız tutuluyor.",
              dashboard: buildDashboard(state),
            });
          }
        } else {
          state = await applyLivePlan(state);
          await saveState(state);
          return Response.json({
            skipped: true,
            reason: "İki dakikalık canlı veri aralığı henüz dolmadı.",
            dashboard: buildDashboard(state),
          });
        }
      }

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
        reason: "YouTube verileri başarıyla yenilendi; konu planı ayrı ve güvenli şekilde işlendi.",
        dashboard: buildDashboard(state),
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Senkron başarısız.";
    const status = message.includes("zaten çalışıyor") ? 409 : 500;
    return Response.json({ error: message }, { status });
  }
}
