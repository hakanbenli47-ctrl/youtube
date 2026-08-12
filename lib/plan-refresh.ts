import "server-only";

import { generateChannelDrivenPlan } from "./channel-driven-plan";
import { currentIstanbulWeekKey } from "./scheduling";
import type { ChannelState, PlanItem, WeeklyScheduleDay } from "./schema";

const DAILY_PLAN_REFRESH_HOUR_VALUE = 21;
const FUTURE_PLAN_REFRESH_MS = 24 * 60 * 60_000;

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

/**
 * Canlı metrikler iki dakikada bir yenilenebilir; içerik listesi iki dakikada bir
 * değişmez. Konular gün boyunca sabit kalır. Gelecek 30 günlük plan en fazla günde
 * bir kez, İstanbul saatiyle 21:00 sonrasında yeni sonuçlarla yeniden sıralanır.
 */
export function shouldRefreshFuturePlan(state: ChannelState, now = new Date()) {
  if (!state.plan.length || !state.planning?.generatedAt) return true;
  const current = istanbulParts(now);
  if (current.hour < DAILY_PLAN_REFRESH_HOUR_VALUE) return false;
  const generatedAt = new Date(state.planning.generatedAt);
  if (Number.isNaN(generatedAt.getTime())) return true;
  const generated = istanbulParts(generatedAt);
  return generated.date !== current.date;
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
  if (!shouldRefreshFuturePlan(state, now)) return state;
  return rebuildFuturePlan(state, weeklySchedule, now);
}

export function nextDailyPlanRefreshAt(now = new Date()) {
  const parts = istanbulParts(now);
  const todayAt21 = new Date(`${parts.date}T21:00:00+03:00`);
  if (todayAt21.getTime() > now.getTime()) return todayAt21.toISOString();
  return new Date(todayAt21.getTime() + FUTURE_PLAN_REFRESH_MS).toISOString();
}

export const DAILY_PLAN_REFRESH_HOUR = DAILY_PLAN_REFRESH_HOUR_VALUE;
export const FUTURE_PLAN_REFRESH_INTERVAL_MS = FUTURE_PLAN_REFRESH_MS;
