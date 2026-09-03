import "server-only";

import type { ChannelState, DashboardData, VideoMetric } from "./schema";
import { publicState } from "./store";
import { buildAdaptiveWeeklySchedule, currentIstanbulWeekKey, nextWeeklyReviewAt } from "./scheduling";
import {
  baselines,
  buildPostingSlots,
  buildRepetitionAlerts,
  buildTopicInsights,
  buildWinningCombinations,
  quality,
} from "./analytics-metrics";
import { buildShortsGrowthGoal } from "./growth-goal";
import {
  buildDataQuality,
  buildGrowthPlaybook,
  buildModelValidation,
  buildRecommendations,
} from "./analytics-strategy";

const DAY_MS = 86_400_000;
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
function netSubscribers(video: VideoMetric) { return video.subscribersGained - video.subscribersLost; }

export {
  buildPostingSlots,
  buildRepetitionAlerts,
  buildShortsGrowthGoal,
  buildTopicInsights,
  buildWinningCombinations,
  buildDataQuality,
  buildGrowthPlaybook,
  buildModelValidation,
  buildRecommendations,
};

function percentChange(current: number, previous: number) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return (current - previous) / previous * 100;
}

export function buildDashboard(state: ChannelState): DashboardData {
  const daily = [...state.daily].sort((left, right) => left.date.localeCompare(right.date));
  const latestDate = daily.at(-1)?.date;
  const latestTime = latestDate ? new Date(`${latestDate}T12:00:00Z`).getTime() : Date.now();
  const last7Start = latestTime - 6 * DAY_MS;
  const previous7Start = latestTime - 13 * DAY_MS;
  const previous7End = latestTime - 7 * DAY_MS;
  const last7 = daily.filter((day) => {
    const time = new Date(`${day.date}T12:00:00Z`).getTime();
    return time >= last7Start && time <= latestTime;
  });
  const previous7 = daily.filter((day) => {
    const time = new Date(`${day.date}T12:00:00Z`).getTime();
    return time >= previous7Start && time <= previous7End;
  });
  const last7Views = sum(last7.map((day) => day.views));
  const previous7Views = sum(previous7.map((day) => day.views));
  let last7Subscribers = sum(last7.map((day) => day.subscribersGained - day.subscribersLost));
  if (!last7.length) {
    const threshold = Date.now() - 8 * DAY_MS;
    last7Subscribers = sum(state.videos
      .filter((video) => new Date(video.publishedAt).getTime() >= threshold)
      .map(netSubscribers));
  }

  const deadline = new Date(`${state.goals.deadline}T23:59:59`).getTime();
  const daysRemaining = Math.max(1, Math.ceil((deadline - Date.now()) / DAY_MS));
  const subscriberGrowthRequired = Math.max(0, state.goals.subscriberTarget - state.channel.subscriberCount);
  const conversionBase = state.totals.analyticsViews || state.totals.views;
  const conversion = conversionBase > 0 && state.totals.netSubscribers > 0
    ? state.totals.netSubscribers / conversionBase
    : 0.003;
  const viewsRequired = Math.ceil(subscriberGrowthRequired / Math.max(conversion, 0.0001));
  const observedDays = Math.max(1, Math.min(7, last7.length));
  const projected30DaySubscribers = Math.round(last7Subscribers / observedDays * 30);
  const requiredMonthlySubscribers = subscriberGrowthRequired / daysRemaining * 30;
  const ratio = requiredMonthlySubscribers > 0 ? projected30DaySubscribers / requiredMonthlySubscribers : 1;

  const grouped = new Map<string, { name: string; views: number; subscribers: number; watchHours: number }>();
  for (const video of state.videos) {
    const name = video.contentType === "SHORT"
      ? "Shorts"
      : video.contentType === "LONG"
        ? "Uzun Video"
        : "Türü doğrulanıyor";
    const row = grouped.get(name) || { name, views: 0, subscribers: 0, watchHours: 0 };
    row.views += video.views;
    row.subscribers += netSubscribers(video);
    row.watchHours += video.watchHours;
    grouped.set(name, row);
  }

  const topicInsights = buildTopicInsights(state);
  const repetitionAlerts = buildRepetitionAlerts(state, topicInsights);
  const postingSlots = buildPostingSlots(state);
  const weeklySchedule = buildAdaptiveWeeklySchedule(state);
  const recommendations = buildRecommendations(state, topicInsights, repetitionAlerts, postingSlots);
  const shorts = state.videos.filter((video) => video.contentType === "SHORT" && video.views > 0);
  const base = baselines(shorts.length ? shorts : state.videos.filter((video) => video.views > 0));
  const hydratedState = { ...state, recommendations };
  const changedSlotCount = weeklySchedule.flatMap((day) => day.shortSlots || [])
    .filter((slot) => slot.change === "Değişti").length;
  const dailyCount = weeklySchedule[0]?.shortSlots?.length || weeklySchedule[0]?.shortsTimes.length || 0;
  const hasAudienceActivity = (state.audienceActivity || []).some((day) => day.hours.length > 0);
  const dailyLockSummary = `Günlük düzen şu an ${dailyCount} Shorts. Saatler ${hasAudienceActivity ? "Studio son 28 günlük aktif izleyici saatleri ve gerçek kanal performansı" : "gerçek kanal performansı"} ile seçiliyor; gelecek plan her İstanbul gününde yeniden hesaplanıyor.`;

  return {
    state: publicState(hydratedState),
    momentum: {
      last7Views,
      previous7Views,
      viewGrowthPercent: percentChange(last7Views, previous7Views),
      last7Subscribers,
      subscriberGrowthRequired,
      subscribersPerDayRequired: subscriberGrowthRequired / daysRemaining,
      viewsRequired,
      viewsPerDayRequired: viewsRequired / daysRemaining,
      projected30DaySubscribers,
      targetProbabilityLabel: ratio >= 1 ? "Planda" : ratio >= 0.5 ? "Sıçrama gerekli" : "Kazanan seri gerekli",
      progressPercent: Math.min(100, state.channel.subscriberCount / Math.max(state.goals.subscriberTarget, 1) * 100),
    },
    formatSplit: [...grouped.values()],
    topVideos: [...state.videos]
      .sort((left, right) => quality(right, base) - quality(left, base) || right.views - left.views)
      .slice(0, 10),
    topicInsights,
    repetitionAlerts,
    postingSlots,
    weeklySchedule,
    winningCombinations: buildWinningCombinations(state),
    shortsGrowthGoal: buildShortsGrowthGoal(state),
    modelValidation: buildModelValidation(state),
    dataQuality: buildDataQuality(state),
    growthPlaybook: buildGrowthPlaybook(state),
    weeklyReview: {
      weekKey: currentIstanbulWeekKey(),
      nextReviewAt: nextWeeklyReviewAt(),
      shortsAnalyzed: shorts.length,
      changedSlotCount,
      summary: `${dailyLockSummary} ${changedSlotCount
        ? `${changedSlotCount} slotta veri rolü değişti.`
        : "Saat omurgası sabit tutuluyor; her slotun içerik amacı ve gücü kanal verisine göre puanlanıyor."}`,
    },
    setup: {
      youtubeCredentialsReady: Boolean(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET),
      hasChannelData: Boolean(state.videos.length || state.sync.lastYouTubeSync || state.sync.lastStudioImport),
      dataSource: state.auth.connected && (state.sync.lastYouTubeSync || state.sync.lastPublicStatsSync)
        ? "live"
        : state.sync.lastStudioImport
          ? "studio"
          : "none",
    },
    generatedAt: new Date().toISOString(),
  };
}
