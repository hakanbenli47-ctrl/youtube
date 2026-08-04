import { buildDashboard } from "@/lib/analytics";
import { generateMonthlyPlan, planReviewStamp } from "@/lib/planner";
import { buildAdaptiveWeeklySchedule } from "@/lib/scheduling";
import { getState, saveState } from "@/lib/store";
import { scanTrends, syncYouTube } from "@/lib/youtube-v2";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Yetkisiz cron isteği." }, { status: 401 });
  }

  try {
    let state = await getState();
    if (!state.auth.connected) {
      return Response.json({
        skipped: true,
        reason: "YouTube bağlantısı bekleniyor",
        dashboard: buildDashboard(state),
      });
    }

    state = await syncYouTube();
    const trendAge = state.sync.lastTrendScan
      ? Date.now() - new Date(state.sync.lastTrendScan).getTime()
      : Number.POSITIVE_INFINITY;
    if (trendAge > 24 * 60 * 60_000) {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cron senkronu başarısız.";
    return Response.json({ error: message }, { status: 500 });
  }
}
