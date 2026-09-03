import "server-only";

import { generateChannelDrivenPlan } from "./channel-driven-plan";
import { currentIstanbulWeekKey } from "./scheduling";
import type { ChannelState, PlanItem, WeeklyScheduleDay } from "./schema";

const DAILY_PLAN_REFRESH_HOUR_VALUE = 21;
const FUTURE_PLAN_REFRESH_MS = 24 * 60 * 60_000;
const PLANNER_VERSION = 9;

type PlanningMemory = NonNullable<ChannelState["planning"]> & {
  coveredSubjects?: string[];
  plannerVersion?: number;
};

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

function planningMemory(state: ChannelState) {
  return state.planning as PlanningMemory | undefined;
}

/**
 * Sürüm 9: Tüm Shorts geçmişi + Studio aktiflik saatleri kullanan yeni zamanlama
 * modeline geçişte mevcut plan bir kez zorla yeniden hesaplanır. Sonrasında günlük
 * 21:00 kuralı devam eder.
 */
export function shouldRefreshFuturePlan(state: ChannelState, now = new Date()) {
  if (!state.plan.length || !state.planning?.generatedAt) return true;
  if ((planningMemory(state)?.plannerVersion || 0) !== PLANNER_VERSION) return true;
  const generated = istanbulParts(new Date(state.planning.generatedAt));
  const current = istanbulParts(now);
  if (current.hour < DAILY_PLAN_REFRESH_HOUR_VALUE) return false;
  return generated.date !== current.date || generated.hour < DAILY_PLAN_REFRESH_HOUR_VALUE;
}

export function mergeGeneratedPlanPreservingToday(
  state: ChannelState,
  generated: PlanItem[],
  weeklySchedule: WeeklyScheduleDay[],
  now = new Date(),
) {
  const today = istanbulParts(now).date;
  const publishingStartedToday = state.videos.some((video) =>
    video.contentType === "SHORT" &&
    istanbulParts(new Date(video.publishedAt)).date === today,
  );

  // Gün içinde yayın başladıysa hazırlanmış bugünü bozma. Henüz yayın yoksa yeni
  // modelin bugünkü saat/adet kararının hemen uygulanmasına izin ver.
  const todayPlan = publishingStartedToday
    ? state.plan.filter((item) => item.date === today)
    : generated.filter((item) => item.date === today);
  const future = generated.filter((item) => item.date > today);
  const memory = planningMemory(state);

  return {
    ...state,
    plan: sortPlan([...todayPlan, ...future]),
    planning: {
      weekKey: currentIstanbulWeekKey(),
      generatedAt: new Date().toISOString(),
      weeklySchedule,
      coveredSubjects: memory?.coveredSubjects || [],
      plannerVersion: PLANNER_VERSION,
    },
  } as ChannelState;
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
