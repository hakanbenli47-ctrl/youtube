import "server-only";

import { generateMonthlyPlan, planReviewStamp } from "./planner";
import type { ChannelState, PlanItem, WeeklyScheduleDay } from "./schema";

const PLAN_REFRESH_HOUR = 19;

function istanbulParts(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour") || 0),
  };
}

function sortPlan(plan: PlanItem[]) {
  return [...plan].sort(
    (left, right) =>
      left.date.localeCompare(right.date) || left.publishTime.localeCompare(right.publishTime),
  );
}

function refreshedAfterCutoffToday(state: ChannelState, now: Date) {
  if (!state.planning?.generatedAt) return false;
  const current = istanbulParts(now);
  const generated = istanbulParts(new Date(state.planning.generatedAt));
  return generated.date === current.date && generated.hour >= PLAN_REFRESH_HOUR;
}

/**
 * Konu planı canlı veri her yenilendiğinde değişmemeli.
 * Günün başlıkları o gün boyunca kilitlidir. Saat 19:00'dan sonra yalnızca
 * yarın ve sonrası, güncel performans verisiyle bir kez yeniden hesaplanır.
 */
export function shouldRefreshFuturePlan(state: ChannelState, now = new Date()) {
  if (!state.plan.length) return true;
  const current = istanbulParts(now);
  if (current.hour < PLAN_REFRESH_HOUR) return false;
  return !refreshedAfterCutoffToday(state, now);
}

export function mergeGeneratedPlanPreservingToday(
  state: ChannelState,
  generated: PlanItem[],
  weeklySchedule: WeeklyScheduleDay[],
  now = new Date(),
) {
  const today = istanbulParts(now).date;

  // Bugün seçilmiş içerikler varsa onları kesinlikle koru. Böylece 21:00 videosu
  // 19:00 plan güncellemesinden etkilenmez. İlk kurulumda bugünü yeni plandan al.
  const lockedToday = state.plan.filter((item) => item.date === today);
  const todayPlan = lockedToday.length
    ? lockedToday
    : generated.filter((item) => item.date === today);
  const futurePlan = generated.filter((item) => item.date > today);

  return {
    ...state,
    plan: sortPlan([...todayPlan, ...futurePlan]),
    planning: planReviewStamp(weeklySchedule),
  };
}

export function rebuildFuturePlan(
  state: ChannelState,
  weeklySchedule: WeeklyScheduleDay[],
  now = new Date(),
) {
  const generated = generateMonthlyPlan(state, weeklySchedule);
  return mergeGeneratedPlanPreservingToday(state, generated, weeklySchedule, now);
}

export function maybeRefreshFuturePlan(
  state: ChannelState,
  weeklySchedule: WeeklyScheduleDay[],
  now = new Date(),
) {
  if (!shouldRefreshFuturePlan(state, now)) return state;
  return rebuildFuturePlan(state, weeklySchedule, now);
}

export function nextDailyPlanRefreshAt(now = new Date()) {
  const current = istanbulParts(now);
  const todayAtRefresh = new Date(`${current.date}T${String(PLAN_REFRESH_HOUR).padStart(2, "0")}:00:00+03:00`);
  if (now.getTime() < todayAtRefresh.getTime()) return todayAtRefresh.toISOString();
  return new Date(todayAtRefresh.getTime() + 86_400_000).toISOString();
}

export const DAILY_PLAN_REFRESH_HOUR = PLAN_REFRESH_HOUR;
