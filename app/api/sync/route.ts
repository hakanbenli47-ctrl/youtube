import { buildDashboard } from "@/lib/analytics";
import { generateMonthlyPlan, planReviewStamp } from "@/lib/planner";
import { buildAdaptiveWeeklySchedule, currentIstanbulWeekKey } from "@/lib/scheduling";
import { getState, saveState } from "@/lib/store";
import { scanTrends, syncYouTube } from "@/lib/youtube";

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const automatic = url.searchParams.get("auto") === "1";
    let state = await getState();
    if (!state.auth.connected) {
      return Response.json(
        { skipped: true, reason: "YouTube bağlantısı bekleniyor", dashboard: buildDashboard(state) },
      );
    }

    const lastSyncAge = state.sync.lastYouTubeSync
      ? Date.now() - new Date(state.sync.lastYouTubeSync).getTime()
      : Number.POSITIVE_INFINITY;
    const intervalMinutes = Number(process.env.YOUTUBE_SYNC_INTERVAL_MINUTES || 360);
    if (automatic && lastSyncAge < intervalMinutes * 60_000) {
      return Response.json({ skipped: true, reason: "Henüz yenileme zamanı değil" });
    }

    state = await syncYouTube();
    const trendAge = state.sync.lastTrendScan
      ? Date.now() - new Date(state.sync.lastTrendScan).getTime()
      : Number.POSITIVE_INFINITY;
    if (!automatic || trendAge > 24 * 60 * 60_000) {
      try {
        state = await scanTrends();
      } catch {
        // Kanal verisi senkronu başarılıysa trend kotası hatası ana akışı bozmaz.
      }
    }
    const needsWeeklyReview = state.planning?.weekKey !== currentIstanbulWeekKey() || !state.planning?.weeklySchedule;
    if (needsWeeklyReview) {
      const weeklySchedule = buildAdaptiveWeeklySchedule(state);
      state = { ...state, plan: generateMonthlyPlan(state, weeklySchedule), planning: planReviewStamp(weeklySchedule) };
    }
    await saveState(state);
    return Response.json({ skipped: false, dashboard: buildDashboard(state) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Senkron başarısız.";
    return Response.json({ error: message }, { status: 500 });
  }
}
