import { buildDashboard } from "@/lib/analytics";
import { generateMonthlyPlan, planReviewStamp } from "@/lib/planner";
import { buildAdaptiveWeeklySchedule } from "@/lib/scheduling";
import { getState, saveState, withStateLock } from "@/lib/store";
import { scanTrends, syncYouTube } from "@/lib/youtube-v2";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    return await withStateLock("youtube-sync", async () => {
      const url = new URL(request.url);
      const automatic = url.searchParams.get("auto") === "1";
      let state = await getState();
      if (!state.auth.connected) {
        return Response.json({
          skipped: true,
          reason: "YouTube bağlantısı bekleniyor",
          dashboard: buildDashboard(state),
        });
      }

      const lastSync = state.sync.lastSuccessfulYouTubeSync || state.sync.lastYouTubeSync;
      const lastSyncAge = lastSync
        ? Date.now() - new Date(lastSync).getTime()
        : Number.POSITIVE_INFINITY;
      const intervalMinutes = Number(process.env.YOUTUBE_SYNC_INTERVAL_MINUTES || 60);
      if (automatic && lastSyncAge < intervalMinutes * 60_000) {
        return Response.json({
          skipped: true,
          reason: "Canlı veri henüz yenileme aralığında",
          dashboard: buildDashboard(state),
        });
      }

      state = await syncYouTube();
      const trendAge = state.sync.lastTrendScan
        ? Date.now() - new Date(state.sync.lastTrendScan).getTime()
        : Number.POSITIVE_INFINITY;
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
      return Response.json({ skipped: false, dashboard: buildDashboard(state) });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Senkron başarısız.";
    const status = message.includes("zaten çalışıyor") ? 409 : 500;
    return Response.json({ error: message }, { status });
  }
}
