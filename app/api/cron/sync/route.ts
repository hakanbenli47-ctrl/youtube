import { buildDashboard } from "@/lib/analytics";
import { maybeRefreshFuturePlan } from "@/lib/plan-refresh";
import { buildAdaptiveWeeklySchedule } from "@/lib/scheduling";
import { getState, saveState, withStateLock } from "@/lib/store";
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
    return await withStateLock("youtube-sync", async () => {
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
      state = maybeRefreshFuturePlan(state, weeklySchedule);

      await saveState(state);
      return Response.json({ skipped: false, dashboard: buildDashboard(state) });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cron senkronu başarısız.";
    const status = message.includes("zaten çalışıyor") ? 409 : 500;
    return Response.json({ error: message }, { status });
  }
}
