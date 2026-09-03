import "server-only";

import type { ChannelState, ShortsGrowthGoal } from "./schema";

const DAY_MS = 86_400_000;
const TARGET_VIEWS = 10_000_000;
const WINDOW_DAYS = 90;
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

function dayTime(value: string) {
  const timestamp = new Date(`${value}T12:00:00+03:00`).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function buildShortsGrowthGoal(state: ChannelState): ShortsGrowthGoal {
  const now = Date.now();
  const cutoff = now - (WINDOW_DAYS - 1) * DAY_MS;
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

  const recentCutoff = now - 6 * DAY_MS;
  const recentDays = shortsDays.filter((day) => dayTime(day.date) >= recentCutoff);
  const recentViews = sum(recentDays.map((day) => day.engagedViews || 0));
  const observedRecentDays = Math.max(1, recentDays.length || Math.min(7, shortsDays.length) || 1);
  const fallbackRecentViews = sum(state.videos
    .filter((video) => video.contentType === "SHORT")
    .map((video) => video.engagedViewsLast7Days || 0));
  const currentViewsPerDay = (recentViews > 0 ? recentViews : fallbackRecentViews) / observedRecentDays;

  // YPP Shorts hedefi sabit başlangıçlı 90 günlük sayaç değil, kayan son 90 gündür.
  // Bu yüzden hedef hızını "kalan / kalan gün" diye hesaplamak yanlış olur.
  // Sürdürülebilir hedef hızı, herhangi bir 90 günlük pencerede 10M üretecek günlük tempodur.
  const requiredViewsPerDay = TARGET_VIEWS / WINDOW_DAYS;
  const projectedWindowViews = Math.round(currentViewsPerDay * WINDOW_DAYS);
  const remainingViews = Math.max(0, TARGET_VIEWS - currentViews);
  const subscribersRemaining = Math.max(0, 1000 - state.channel.subscriberCount);
  const paceRatio = currentViewsPerDay / requiredViewsPerDay;

  return {
    targetViews: TARGET_VIEWS,
    windowDays: WINDOW_DAYS,
    currentViews,
    remainingViews,
    requiredViewsPerDay,
    currentViewsPerDay,
    projectedWindowViews,
    progressPercent: Math.min(100, currentViews / TARGET_VIEWS * 100),
    subscriberTarget: 1000,
    currentSubscribers: state.channel.subscriberCount,
    subscribersRemaining,
    requiredSubscribersPerDay: subscribersRemaining / WINDOW_DAYS,
    status: paceRatio >= 1
      ? "HEDEF HIZINDA"
      : state.videos.filter((video) => video.contentType === "SHORT").length < 45
        ? "TEST AŞAMASI"
        : "SIÇRAMA GEREKLİ",
  };
}
