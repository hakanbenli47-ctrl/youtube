import "server-only";

import type { ChannelState, ShortsGrowthGoal } from "./schema";

const DAY_MS = 86_400_000;
const TARGET_VIEWS = 10_000_000;
const WINDOW_DAYS = 90;
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

function dayTime(value: string) {
  const timestamp = new Date(`${value}T12:00:00Z`).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function buildShortsGrowthGoal(state: ChannelState): ShortsGrowthGoal {
  const now = Date.now();
  const cutoff = now - WINDOW_DAYS * DAY_MS;
  const shortsDays = (state.shortsDaily || [])
    .filter((day) => dayTime(day.date) >= cutoff)
    .sort((left, right) => left.date.localeCompare(right.date));
  const reportedViews = sum(shortsDays.map((day) => day.engagedViews || 0));
  const fallbackViews = sum(state.videos
    .filter((video) =>
      video.contentType === "SHORT" &&
      new Date(video.publishedAt).getTime() >= cutoff)
    .map((video) => video.engagedViews || 0));
  const currentViews = reportedViews > 0 ? reportedViews : fallbackViews;

  const earliestShortDate = shortsDays[0]?.date || state.videos
    .filter((video) => video.contentType === "SHORT" && video.publishedAt)
    .map((video) => video.publishedAt.slice(0, 10))
    .sort()[0];
  const elapsedDays = earliestShortDate
    ? Math.min(WINDOW_DAYS, Math.max(1, Math.floor((now - dayTime(earliestShortDate)) / DAY_MS) + 1))
    : 1;
  const daysRemaining = Math.max(1, WINDOW_DAYS - elapsedDays);

  const sevenDayCutoff = now - 6 * DAY_MS;
  const recentDays = shortsDays.filter((day) => dayTime(day.date) >= sevenDayCutoff);
  const recentViews = sum(recentDays.map((day) => day.engagedViews || 0));
  const observedRecentDays = Math.max(1, Math.min(7, elapsedDays));
  const fallbackRecentViews = sum(state.videos
    .filter((video) => video.contentType === "SHORT")
    .map((video) => video.engagedViewsLast7Days || 0));
  const currentViewsPerDay = (recentViews > 0 ? recentViews : fallbackRecentViews) / observedRecentDays;

  const remainingViews = Math.max(0, TARGET_VIEWS - currentViews);
  const subscribersRemaining = Math.max(0, 1000 - state.channel.subscriberCount);
  const requiredViewsPerDay = remainingViews / daysRemaining;
  const paceRatio = currentViewsPerDay / Math.max(requiredViewsPerDay, 1);

  return {
    targetViews: TARGET_VIEWS,
    windowDays: WINDOW_DAYS,
    currentViews,
    remainingViews,
    requiredViewsPerDay,
    currentViewsPerDay,
    projectedWindowViews: Math.round(currentViews + currentViewsPerDay * daysRemaining),
    progressPercent: Math.min(100, currentViews / TARGET_VIEWS * 100),
    subscriberTarget: 1000,
    currentSubscribers: state.channel.subscriberCount,
    subscribersRemaining,
    requiredSubscribersPerDay: subscribersRemaining / daysRemaining,
    status: paceRatio >= 1
      ? "HEDEF HIZINDA"
      : state.videos.filter((video) => video.contentType === "SHORT").length < 45
        ? "TEST AŞAMASI"
        : "SIÇRAMA GEREKLİ",
  };
}
