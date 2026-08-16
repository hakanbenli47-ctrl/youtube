import "server-only";

import { generateChannelDrivenPlan } from "./fixed-topic-plan";
import { currentIstanbulWeekKey } from "./scheduling";
import type { ChannelState, PlanItem, WeeklyScheduleDay } from "./schema";

const DAILY_PLAN_REFRESH_HOUR_VALUE = 21;
const FUTURE_PLAN_REFRESH_MS = 24 * 60 * 60_000;
const PLANNER_VERSION = 4;

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

function archiveCoveredSubjects(state: ChannelState, now = new Date()) {
  const today = istanbulParts(now).date;
  const previous = planningMemory(state)?.coveredSubjects || [];

  // Kanaldaki bütün yayın başlıkları kalıcı konu engel listesine alınır.
  // Böylece mevcut 96+ konu, başlık biçimi değişse veya eski plan hafızası eksik olsa bile
  // tekrar aday havuzuna dönmez.
  const publishedSubjects = state.videos
    .map((video) => video.title)
    .filter(Boolean);

  // Saat 21:00 sonrası günün konuları tamamlanmış kabul edilir. Yeni sabit plan motorunda
  // item.title doğrudan canonical konu başlığıdır; bu yüzden sonraki günlerde yeniden seçilemez.
  const completedPlanSubjects = state.plan
    .filter((item) => item.date <= today)
    .map((item) => item.title)
    .filter(Boolean);

  const coveredSubjects = [...new Set([
    ...previous,
    ...publishedSubjects,
    ...completedPlanSubjects,
  ])].slice(-4000);
  const basePlanning = state.planning || {
    weekKey: currentIstanbulWeekKey(),
    generatedAt: new Date(0).toISOString(),
  };

  return {
    ...state,
    planning: {
      ...basePlanning,
      coveredSubjects,
      plannerVersion: PLANNER_VERSION,
    },
  } as ChannelState;
}

/**
 * Canlı metrikler iki dakikada bir yenilenebilir; içerik listesi iki dakikada bir
 * değişmez. Konular gün boyunca sabit kalır. Yeni plan motoru sürümü geldiğinde ise
 * mevcut plan bir kez zorunlu yenilenir; böylece eski tekrar hataları ekranda kalmaz.
 */
export function shouldRefreshFuturePlan(state: ChannelState, now = new Date()) {
  if (!state.plan.length || !state.planning?.generatedAt) return true;
  if ((planningMemory(state)?.plannerVersion || 0) !== PLANNER_VERSION) return true;

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
  const memory = planningMemory(state);

  return {
    ...state,
    plan: sortPlan([...todayPlan, ...futurePlan]),
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
  const stateWithMemory = archiveCoveredSubjects(state, now);
  const generated = generateChannelDrivenPlan(stateWithMemory, weeklySchedule);
  return mergeGeneratedPlanPreservingToday(stateWithMemory, generated, weeklySchedule, now);
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
