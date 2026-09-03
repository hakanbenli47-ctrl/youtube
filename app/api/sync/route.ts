import { buildDashboard } from "@/lib/analytics";
import { restoreAuthFromRequest } from "@/lib/auth-cookie";
import { persistServerAuth, recoverServerAuth } from "@/lib/auth-vault";
import { maybeRefreshFuturePlan } from "@/lib/plan-refresh";
import { buildAdaptiveWeeklySchedule } from "@/lib/scheduling";
import { getState, saveState, withStateLock } from "@/lib/store";
import { bootstrapPublicYouTubeState, refreshPublicYouTubeStats } from "@/lib/youtube-v2";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

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

      // Bağlantıyı önce kalıcı OAuth kasasından, sonra tarayıcı cookie'sinden kurtar.
      const serverRecovery = await recoverServerAuth(state);
      state = serverRecovery.state;
      const browserRecovery = restoreAuthFromRequest(state, request);
      state = browserRecovery.state;

      if (state.auth.tokens) await persistServerAuth(state.auth.tokens);
      if (serverRecovery.recovered || browserRecovery.restored) await saveState(state);

      if (!state.auth.connected || !state.auth.tokens) {
        return Response.json({
          skipped: true,
          reason: "YouTube bağlantısı bekleniyor",
          dashboard: buildDashboard(state),
        });
      }

      // İlk bağlantıda yalnızca hızlı public bootstrap yap. Ağır Analytics işi cron'a aittir.
      if (state.videos.length === 0) {
        state = await bootstrapPublicYouTubeState(state);
        state = await applyLivePlan(state);
        await saveState(state);
        return Response.json({
          skipped: false,
          lightweight: true,
          bootstrapped: true,
          reason: `${state.videos.length} video hafızaya alındı; canlı bağlantı hazır.`,
          dashboard: buildDashboard(state),
        });
      }

      const publicIntervalMinutes = 2;
      const publicSyncDue = ageOf(state.sync.lastPublicStatsSync) >= publicIntervalMinutes * 60_000;

      // Arka plandaki iki dakikalık tur gereksiz API çağrısı yapmasın.
      // Manuel "Verileri yenile" ise her zaman hızlı canlı istatistiği çeker.
      if (automatic && !publicSyncDue) {
        state = await applyLivePlan(state);
        await saveState(state);
        return Response.json({
          skipped: true,
          lightweight: true,
          reason: "İki dakikalık canlı veri aralığı henüz dolmadı.",
          dashboard: buildDashboard(state),
        });
      }

      state = await refreshPublicYouTubeStats(state);

      // Yeni yükleme bulunduysa public video listesini hızlıca tazele.
      if (state.channel.videoCount > state.videos.length) {
        state = await bootstrapPublicYouTubeState(state);
      }

      state = await applyLivePlan(state);
      await saveState(state);

      return Response.json({
        skipped: false,
        lightweight: true,
        reason: "Canlı izlenme, abone ve video istatistikleri yenilendi. Ayrıntılı Analytics her gün 21:00'da güncellenir.",
        dashboard: buildDashboard(state),
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Canlı veri yenileme başarısız.";
    const status = message.includes("zaten çalışıyor") ? 409 : 500;
    return Response.json({ error: message }, { status });
  }
}
