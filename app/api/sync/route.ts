import { buildDashboard } from "@/lib/analytics";
import { restoreAuthFromRequest } from "@/lib/auth-cookie";
import { generateMonthlyPlan, planReviewStamp } from "@/lib/planner";
import { buildAdaptiveWeeklySchedule } from "@/lib/scheduling";
import { getState, saveState, withStateLock } from "@/lib/store";
import { refreshPublicYouTubeStats, scanTrends, syncYouTube } from "@/lib/youtube-v2";

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

      const fullIntervalMinutes = Math.max(
        15,
        Number(process.env.YOUTUBE_SYNC_INTERVAL_MINUTES || 60),
      );
      const publicIntervalMinutes = Math.max(
        2,
        Number(process.env.YOUTUBE_PUBLIC_SYNC_INTERVAL_MINUTES || 5),
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

      state = await syncYouTube();
      const trendAge = ageOf(state.sync.lastTrendScan);
      if (!automatic || trendAge > 24 * 60 * 60_000) {
        try {
          state = await scanTrends();
        } catch (error) {
          console.error("Trend taraması ana senkronu engellemeden atlandı.", error);
        }
      }

      const weeklySchedule = buildAdaptiveWeeklySchedule(state);
      state = {
        ...state,
        plan: generateMonthlyPlan(state, weeklySchedule),
        planning: planReviewStamp(weeklySchedule),
      };
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
