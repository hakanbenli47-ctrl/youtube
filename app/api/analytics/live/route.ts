import { buildLiveAnalytics } from "@/lib/live-analytics";
import { restoreAuthFromRequest } from "@/lib/auth-cookie";
import { getState, saveState, withStateLock } from "@/lib/store";
import { refreshPublicYouTubeStats, syncYouTube } from "@/lib/youtube-v2";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function ageOf(value: string | null | undefined) {
  if (!value) return Number.POSITIVE_INFINITY;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? Date.now() - time : Number.POSITIVE_INFINITY;
}

function todayInIstanbul() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function cleanWarnings(warnings: string[]) {
  return warnings.filter((warning) => {
    const normalized = warning.toLocaleLowerCase("tr-TR");
    return !normalized.includes("upstash") && !normalized.includes("geçici depo");
  });
}

export async function GET(request: Request) {
  try {
    return await withStateLock("live-analytics", async () => {
      let state = await getState();
      const restored = restoreAuthFromRequest(state, request);
      state = restored.state;
      if (restored.restored) await saveState(state);

      let syncWarning = "";
      if (state.auth.connected && state.auth.tokens) {
        try {
          const needsFullSync =
            !state.videos.length ||
            ageOf(state.sync.lastSuccessfulYouTubeSync || state.sync.lastYouTubeSync) >= 60 * 60_000;

          if (needsFullSync) {
            state = await syncYouTube();
          } else if (ageOf(state.sync.lastPublicStatsSync) >= 90_000) {
            state = await refreshPublicYouTubeStats(state);
          }
        } catch (error) {
          syncWarning = error instanceof Error
            ? `Canlı yenileme geçici olarak tamamlanamadı: ${error.message}`
            : "Canlı yenileme geçici olarak tamamlanamadı.";
        }
      }

      const payload = buildLiveAnalytics(state);
      const hasTodayAnalytics = state.daily.some((day) => day.date === todayInIstanbul());
      if (!hasTodayAnalytics && payload.today.length) {
        payload.summary.todayViews = payload.today.reduce((sum, video) => sum + video.views, 0);
        payload.summary.todayNetSubscribers = 0;
      }

      const connected = Boolean(state.auth.connected && state.auth.tokens);
      const warnings = cleanWarnings(payload.warnings);
      if (!connected) {
        warnings.unshift("YouTube bağlantısı bu tarayıcı oturumunda bulunamadı. Ana panelde Bağlantı ve hedef bölümünden bağlantıyı bir kez yenile.");
      }
      if (syncWarning) warnings.unshift(syncWarning);

      return Response.json({
        ...payload,
        connected,
        syncMessage: state.sync.message,
        warnings,
      }, {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      });
    });
  } catch (error) {
    const state = await getState();
    const payload = buildLiveAnalytics(state);
    const message = error instanceof Error ? error.message : "Canlı analiz hazırlanamadı.";
    return Response.json({
      ...payload,
      connected: Boolean(state.auth.connected && state.auth.tokens),
      syncMessage: state.sync.message,
      warnings: [message, ...cleanWarnings(payload.warnings)],
    }, {
      status: 200,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }
}
