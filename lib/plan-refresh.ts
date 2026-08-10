import "server-only";

import { generateChannelDrivenPlan } from "./channel-driven-plan";
import { currentIstanbulWeekKey } from "./scheduling";
import type { ChannelState, PlanItem, WeeklyScheduleDay } from "./schema";

const FUTURE_PLAN_REFRESH_MS = 2 * 60_000;
const LEGACY_REFRESH_HOUR = 21;

function istanbulParts(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour") || 0),
    minute: Number(get("minute") || 0),
  };
}

function sortPlan(plan: PlanItem[]) {
  return [...plan].sort(
    (left, right) =>
      left.date.localeCompare(right.date) || left.publishTime.localeCompare(right.publishTime),
  );
}

function planAge(state: ChannelState) {
  if (!state.planning?.generatedAt) return Number.POSITIVE_INFINITY;
  const generated = new Date(state.planning.generatedAt).getTime();
  return Number.isFinite(generated) ? Date.now() - generated : Number.POSITIVE_INFINITY;
}

/**
 * Canlı YouTube verisi iki dakikada bir yenilenebilir. Bugünün seçilmiş konuları
 * gün boyunca kilitlidir; yarın ve sonrası ise yeni izlenme/abone/beğeni sonuçları
 * geldikçe yeniden puanlanabilir. Böylece gün içinde hazırlanmış içerik değişmez,
 * fakat gelecek plan kanalın gerçek performansını takip eder.
 */
export function shouldRefreshFuturePlan(state: ChannelState) {
  if (!state.plan.length) return true;
  return planAge(state) >= FUTURE_PLAN_REFRESH_MS;
}

export function mergeGeneratedPlanPreservingToday(
  state: ChannelState,
  generated: PlanItem[],
  weeklySchedule: WeeklyScheduleDay[],
  now = new Date(),
) {
  const today = istanbulParts(now).date;
  const lockedToday = state.plan.filter((item) => item.date === today);
  const todayPlan = lockedToday.length
    ? lockedToday
    : generated.filter((item) => item.date === today);
  const futurePlan = generated.filter((item) => item.date > today);

  return {
    ...state,
    plan: sortPlan([...todayPlan, ...futurePlan]),
    planning: {
      weekKey: currentIstanbulWeekKey(),
      generatedAt: new Date().toISOString(),
      weeklySchedule,
    },
  };
}

export function rebuildFuturePlan(
  state: ChannelState,
  weeklySchedule: WeeklyScheduleDay[],
  now = new Date(),
) {
  const generated = generateChannelDrivenPlan(state, weeklySchedule);
  return mergeGeneratedPlanPreservingToday(state, generated, weeklySchedule, now);
}

export function maybeRefreshFuturePlan(
  state: ChannelState,
  weeklySchedule: WeeklyScheduleDay[],
  now = new Date(),
) {
  if (!shouldRefreshFuturePlan(state)) return state;
  return rebuildFuturePlan(state, weeklySchedule, now);
}

export function nextDailyPlanRefreshAt(now = new Date()) {
  return new Date(now.getTime() + FUTURE_PLAN_REFRESH_MS).toISOString();
}

// Eski importları bozmamak için tutuluyor; plan artık saat 21:00'ı beklemiyor.
export const DAILY_PLAN_REFRESH_HOUR = LEGACY_REFRESH_HOUR;
export const FUTURE_PLAN_REFRESH_INTERVAL_MS = FUTURE_PLAN_REFRESH_MS;
