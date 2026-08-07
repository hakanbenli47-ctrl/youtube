import { buildLiveAnalytics } from "@/lib/live-analytics";
import { getState } from "@/lib/store";

export const dynamic = "force-dynamic";

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

export async function GET() {
  const state = await getState();
  const payload = buildLiveAnalytics(state);
  const hasTodayAnalytics = state.daily.some((day) => day.date === todayInIstanbul());
  if (!hasTodayAnalytics && payload.today.length) {
    payload.summary.todayViews = payload.today.reduce((sum, video) => sum + video.views, 0);
    payload.summary.todayNetSubscribers = 0;
  }
  return Response.json(payload, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
