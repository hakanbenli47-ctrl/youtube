import "server-only";

import {
  DEFAULT_POSTING_SLOTS,
  detectHookPattern,
  detectOttomanRuler,
  istanbulPublishParts,
  titleSimilarity,
  titleTokens,
} from "./history";
import type {
  ChannelState,
  CombinationInsight,
  DashboardData,
  PostingSlot,
  Recommendation,
  RepetitionAlert,
  TopicInsight,
  VideoMetric,
} from "./schema";
import { publicState } from "./store";
import { buildAdaptiveWeeklySchedule, currentIstanbulWeekKey, nextWeeklyReviewAt } from "./scheduling";

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]) {
  return values.length ? sum(values) / values.length : 0;
}

function netSubscribers(video: VideoMetric) {
  return video.subscribersGained - video.subscribersLost;
}

function percentChange(current: number, previous: number) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

function endOfDay(value: string) {
  return new Date(`${value}T23:59:59`);
}

function performanceScore(video: VideoMetric) {
  const published = new Date(video.publishedAt);
  const ageDays = Number.isNaN(published.getTime())
    ? 30
    : Math.max(0.5, (Date.now() - published.getTime()) / 86_400_000);
  const viewsPerDay = Math.min(1500, video.views / ageDays);
  const conversion = (netSubscribers(video) / Math.max(video.views, 1)) * 1000;
  const retention = Math.min(100, Math.max(0, video.avgViewPercentage));
  const engagement = ((video.likes + video.comments * 2) / Math.max(video.views, 1)) * 100;
  return Math.log10(viewsPerDay + 1) * 25
    + Math.min(24, Math.max(0, conversion) * 2.4)
    + Math.min(18, engagement * 1.5)
    + retention * 0.18;
}

function videoViewsPerDay(video: VideoMetric) {
  const published = new Date(video.publishedAt);
  const ageDays = Number.isNaN(published.getTime())
    ? 30
    : Math.max(0.5, (Date.now() - published.getTime()) / 86_400_000);
  return Math.min(1500, video.views / ageDays);
}

export function buildWinningCombinations(state: ChannelState): CombinationInsight[] {
  const shorts = state.videos.filter((video) => video.contentType === "SHORT" && video.views > 0);
  if (!shorts.length) return [];
  const overallReach = average(shorts.map(videoViewsPerDay));
  const overallViews = Math.max(sum(shorts.map((video) => video.views)), 1);
  const overallEngagement =
    (sum(shorts.map((video) => video.likes + video.comments * 2)) / overallViews) * 100;
  const overallConversion =
    (sum(shorts.map(netSubscribers)) / overallViews) * 1000;
  const groups = new Map<string, {
    dimension: CombinationInsight["dimension"];
    label: string;
    videos: VideoMetric[];
  }>();

  function add(dimension: CombinationInsight["dimension"], label: string, video: VideoMetric) {
    const key = `${dimension}-${label}`;
    const current = groups.get(key) || { dimension, label, videos: [] };
    current.videos.push(video);
    groups.set(key, current);
  }

  for (const video of shorts) {
    add("Padişah", detectOttomanRuler(video.title), video);
    add("Başlık Kalıbı", detectHookPattern(video.title), video);
    add("Konu", video.topic, video);
    const parts = istanbulPublishParts(video.publishedAt);
    if (parts) add("Gün × Dönem", `${parts.dayLabel} · ${parts.period}`, video);
  }

  const raw = [...groups.values()].map((group) => {
    const sampleSize = group.videos.length;
    const totalViews = sum(group.videos.map((video) => video.views));
    const viewsPerDay = average(group.videos.map(videoViewsPerDay));
    const interactionCount = sum(group.videos.map((video) => video.likes + video.comments * 2));
    const subscriberCount = sum(group.videos.map(netSubscribers));
    const engagementRate = (interactionCount / Math.max(totalViews, 1)) * 100;
    const subscribersPerThousand = (subscriberCount / Math.max(totalViews, 1)) * 1000;
    const prior = 3;
    const priorViews = 3000;
    const adjustedReach = (viewsPerDay * sampleSize + overallReach * prior) / (sampleSize + prior);
    const adjustedEngagement =
      ((interactionCount + (overallEngagement / 100) * priorViews) / (totalViews + priorViews)) * 100;
    const adjustedConversion =
      ((subscriberCount + (overallConversion / 1000) * priorViews) / (totalViews + priorViews)) * 1000;
    const rawScore = Math.log10(adjustedReach + 1) * 28
      + Math.min(30, adjustedEngagement * 2.2)
      + Math.min(28, Math.max(0, adjustedConversion) * 4);
    return { ...group, sampleSize, totalViews, viewsPerDay, engagementRate, subscribersPerThousand, rawScore };
  });
  const bestScore = Math.max(...raw.map((item) => item.rawScore), 1);
  const rows: CombinationInsight[] = raw.map((item) => {
    const score = Math.round((item.rawScore / bestScore) * 100);
    const confidence = item.sampleSize >= 8 ? "Yüksek" : item.sampleSize >= 3 ? "Orta" : "Test";
    const decision = score >= 72 && item.sampleSize >= 3
      ? "ÖLÇEKLE"
      : score < 48 && item.sampleSize >= 3
        ? "DİNLENDİR"
        : "DOĞRULA";
    return {
      id: `${item.dimension}-${item.label}`,
      dimension: item.dimension,
      label: item.label,
      sampleSize: item.sampleSize,
      totalViews: item.totalViews,
      viewsPerDay: item.viewsPerDay,
      engagementRate: item.engagementRate,
      subscribersPerThousand: item.subscribersPerThousand,
      score,
      confidence,
      decision,
      reason: `${Math.round(item.viewsPerDay).toLocaleString("tr-TR")} izlenme/gün · %${item.engagementRate.toFixed(1)} etkileşim · ${item.subscribersPerThousand.toFixed(1)} abone/1K`,
    };
  });

  return (["Padişah", "Başlık Kalıbı", "Gün × Dönem", "Konu"] as const)
    .flatMap((dimension) => rows
      .filter((row) => row.dimension === dimension)
      .sort((left, right) => {
        const decisionWeight = { "ÖLÇEKLE": 2, "DOĞRULA": 1, "DİNLENDİR": 0 } as const;
        const confidenceWeight = { "Yüksek": 2, "Orta": 1, "Test": 0 } as const;
        return decisionWeight[right.decision] - decisionWeight[left.decision]
          || confidenceWeight[right.confidence] - confidenceWeight[left.confidence]
          || right.score - left.score;
      })
      .slice(0, 3));
}

export function buildShortsGrowthGoal(state: ChannelState) {
  const targetViews = 10_000_000;
  const windowDays = 90;
  const cutoff = Date.now() - windowDays * 86_400_000;
  const reportedWindowViews = sum((state.shortsDaily || [])
    .filter((day) => new Date(`${day.date}T23:59:59`).getTime() >= cutoff)
    .map((day) => day.engagedViews || 0));
  const recentVideoViews = sum(state.videos
    .filter((video) => video.contentType === "SHORT" && new Date(video.publishedAt).getTime() >= cutoff)
    .map((video) => video.engagedViews || 0));
  const currentViews = reportedWindowViews || recentVideoViews;
  const sevenDayCutoff = Date.now() - 7 * 86_400_000;
  const recentShortDays = (state.shortsDaily || []).filter((day) =>
    new Date(`${day.date}T23:59:59`).getTime() >= sevenDayCutoff);
  const currentViewsPerDay = recentShortDays.length
    ? sum(recentShortDays.map((day) => day.engagedViews || 0)) / 7
    : sum(state.videos
      .filter((video) => video.contentType === "SHORT" && new Date(video.publishedAt).getTime() >= sevenDayCutoff)
      .map((video) => video.engagedViews || 0)) / 7;
  const remainingViews = Math.max(0, targetViews - currentViews);
  const subscribersRemaining = Math.max(0, 1000 - state.channel.subscriberCount);
  const projectedWindowViews = Math.round(currentViewsPerDay * windowDays);
  const progressPercent = Math.min(100, (currentViews / targetViews) * 100);
  const paceRatio = currentViewsPerDay / Math.max(remainingViews / windowDays, 1);
  return {
    targetViews,
    windowDays,
    currentViews,
    remainingViews,
    requiredViewsPerDay: remainingViews / windowDays,
    currentViewsPerDay,
    projectedWindowViews,
    progressPercent,
    subscriberTarget: 1000,
    currentSubscribers: state.channel.subscriberCount,
    subscribersRemaining,
    requiredSubscribersPerDay: subscribersRemaining / windowDays,
    status: paceRatio >= 1
      ? "HEDEF HIZINDA" as const
      : state.videos.filter((video) => video.contentType === "SHORT").length < 45
        ? "TEST AŞAMASI" as const
        : "SIÇRAMA GEREKLİ" as const,
  };
}

export function buildTopicInsights(state: ChannelState): TopicInsight[] {
  if (!state.videos.length) return [];
  const recentThreshold = Date.now() - 45 * 86_400_000;
  const overallViews = average(state.videos.map((video) => video.views));
  const overallConversion =
    (sum(state.videos.map(netSubscribers)) / Math.max(sum(state.videos.map((video) => video.views)), 1)) * 1000;
  const groups = new Map<string, VideoMetric[]>();

  for (const video of state.videos) {
    groups.set(video.topic, [...(groups.get(video.topic) || []), video]);
  }

  return [...groups.entries()]
    .map(([topic, videos]) => {
      const views = sum(videos.map((video) => video.views));
      const averageViews = views / videos.length;
      const subscribersPerThousand =
        (sum(videos.map(netSubscribers)) / Math.max(views, 1)) * 1000;
      const retentionValues = videos
        .map((video) => video.avgViewPercentage)
        .filter((value) => value > 0);
      const averageRetention = average(retentionValues);
      const recentCount = videos.filter((video) => {
        const date = new Date(video.publishedAt);
        return !Number.isNaN(date.getTime()) && date.getTime() >= recentThreshold;
      }).length;
      const reachIndex = averageViews / Math.max(overallViews, 1);
      const conversionIndex =
        overallConversion > 0 ? subscribersPerThousand / overallConversion : subscribersPerThousand > 0 ? 1.2 : 1;
      const score = Math.round(Math.min(100, (reachIndex * 0.68 + conversionIndex * 0.32) * 55));
      let decision: TopicInsight["decision"] = "DENGELE";
      if (videos.length < 2) decision = "TEST ET";
      else if (recentCount >= 3 && score < 48) decision = "DİNLENDİR";
      else if (score >= 68) decision = "ÖLÇEKLE";

      const reason =
        decision === "DİNLENDİR"
          ? `Son 45 günde ${recentCount} kez işlendi ve kanal ortalamasının altında kaldı.`
          : decision === "ÖLÇEKLE"
            ? `Video başına ${Math.round(averageViews).toLocaleString("tr-TR")} izlenme ve güçlü abone dönüşümü üretiyor.`
            : decision === "TEST ET"
              ? "Karar vermek için yeterli örnek yok; farklı bir anlatım açısıyla bir kez daha test et."
              : `Kanal ortalamasına yakın; aynı başlığı değil, yeni kaynak ve yeni soruyla devam et.`;

      return {
        topic,
        videoCount: videos.length,
        recentCount,
        averageViews,
        subscribersPerThousand,
        averageRetention,
        score,
        decision,
        reason,
      };
    })
    .sort((a, b) => b.score - a.score);
}

export function buildRepetitionAlerts(state: ChannelState, topics = buildTopicInsights(state)): RepetitionAlert[] {
  const alerts: RepetitionAlert[] = topics
    .filter((topic) => topic.decision === "DİNLENDİR")
    .map((topic) => ({
      id: `topic-${topic.topic}`,
      label: `${topic.topic} konusunu dinlendir`,
      evidence: topic.reason,
      severity: "DİNLENDİR" as const,
      cooldownDays: 21,
      titles: state.videos.filter((video) => video.topic === topic.topic).slice(0, 3).map((video) => video.title),
    }));

  const ordered = [...state.videos]
    .filter((video) => video.title)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 80);
  const used = new Set<string>();
  for (let left = 0; left < ordered.length && alerts.length < 7; left += 1) {
    for (let right = left + 1; right < ordered.length && alerts.length < 7; right += 1) {
      const first = ordered[left];
      const second = ordered[right];
      if (used.has(first.id) || used.has(second.id)) continue;
      const similarity = titleSimilarity(first.title, second.title);
      if (similarity < 0.42) continue;
      const common = [...titleTokens(first.title)].filter((token) => titleTokens(second.title).has(token));
      alerts.push({
        id: `similar-${first.id}-${second.id}`,
        label: `${common.slice(0, 3).join(" · ") || first.topic} açısı tekrar ediyor`,
        evidence: `Bu iki başlık %${Math.round(similarity * 100)} benzer. Aynı olay yerine farklı dönem, aktör veya birincil kaynak seç.`,
        severity: "BENZERLİK",
        cooldownDays: 30,
        titles: [first.title, second.title],
      });
      used.add(first.id);
      used.add(second.id);
    }
  }
  return alerts;
}

export function buildPostingSlots(state: ChannelState): PostingSlot[] {
  const eligible = state.videos.filter((video) => istanbulPublishParts(video.publishedAt) && video.views > 0);
  if (eligible.length < 6) {
    return DEFAULT_POSTING_SLOTS.slice(0, 4).map((slot, index) => ({
      id: `test-${index}`,
      dayLabel: slot.dayLabel,
      time: slot.time,
      format: slot.format,
      sampleSize: 0,
      score: 0,
      confidence: "Test",
      reason: "Canlı kanal verisi oluşana kadar dört haftalık başlangıç testi.",
    }));
  }

  const overall = average(eligible.map(performanceScore));
  const groups = new Map<string, { dayLabel: string; time: string; format: PostingSlot["format"]; scores: number[] }>();
  for (const video of eligible) {
    const parts = istanbulPublishParts(video.publishedAt);
    if (!parts) continue;
    const format = video.contentType === "SHORT" ? "Shorts" : "Uzun Video";
    const time = parts.period === "Sabah" ? "08:00–11:00" : parts.period === "Öğleden sonra" ? "12:00–17:00" : "18:00–22:00";
    const key = `${parts.dayLabel}-${parts.period}-${format}`;
    const group = groups.get(key) || { dayLabel: parts.dayLabel, time, format, scores: [] };
    group.scores.push(performanceScore(video));
    groups.set(key, group);
  }
  const rows = [...groups.values()].map((group) => {
    const shrunk = (average(group.scores) * group.scores.length + overall * 2) / (group.scores.length + 2);
    return { ...group, shrunk };
  });
  const best = Math.max(...rows.map((row) => row.shrunk), 1);
  return rows
    .sort((a, b) => b.shrunk - a.shrunk)
    .slice(0, 7)
    .map((row, index) => ({
      id: `observed-${index}`,
      dayLabel: row.dayLabel,
      time: row.time,
      format: row.format,
      sampleSize: row.scores.length,
      score: Math.round((row.shrunk / best) * 100),
      confidence: row.scores.length >= 6 ? "Yüksek" : row.scores.length >= 3 ? "Orta" : "Test",
      reason: `${row.scores.length} videonun izlenme hızı, izleyici tutma ve abone dönüşümünden hesaplandı.`,
    }));
}

export function buildRecommendations(
  state: ChannelState,
  topics = buildTopicInsights(state),
  repetitionAlerts = buildRepetitionAlerts(state, topics),
  postingSlots = buildPostingSlots(state),
): Recommendation[] {
  if (!state.videos.length) return [];
  const scaleTopic = topics.find((topic) => topic.decision === "ÖLÇEKLE") || topics[0];
  const packagingOpportunity = state.videos
    .filter((video) => video.contentType === "LONG" && video.ctr !== null && video.ctr < 3.5 && video.avgViewPercentage >= 28)
    .sort((a, b) => (b.impressions || 0) - (a.impressions || 0))[0];
  const subscriberWinner = [...state.videos]
    .filter((video) => video.views >= 100)
    .sort((a, b) => netSubscribers(b) / Math.max(b.views, 1) - netSubscribers(a) / Math.max(a.views, 1))[0];
  const weakTitles = state.videos.filter(
    (video) => video.views < average(state.videos.map((item) => item.views)) * 0.6 && /bilinmeyen gerçek|inanılmaz olay|şaşırtıcı tarih|bunu biliyor muydunuz|tarihin gizemi/i.test(video.title),
  );
  const recommendations: Recommendation[] = [];

  if (scaleTopic) recommendations.push({
    id: "scale-topic",
    action: "YAP",
    title: `${scaleTopic.topic} için yeni bir seri aç`,
    detail: `${scaleTopic.videoCount} video ortalama ${Math.round(scaleTopic.averageViews).toLocaleString("tr-TR")} izlenme üretti. Aynı başlığı tekrarlamadan yeni aktör, belge veya sonuç üzerinden üç parçalık seri tasarla.`,
    confidence: Math.max(62, Math.min(94, scaleTopic.score)),
    impact: "Yüksek",
  });
  if (repetitionAlerts[0]) recommendations.push({
    id: "avoid-repeat",
    action: "DURDUR",
    title: repetitionAlerts[0].label,
    detail: repetitionAlerts[0].evidence,
    confidence: 88,
    impact: "Orta",
  });
  if (subscriberWinner) recommendations.push({
    id: "clone-conversion",
    action: "TEST ET",
    title: "En iyi abone dönüştürücünün devam açısını çek",
    detail: `“${subscriberWinner.title}” güçlü abone dönüşümü verdi. Devam videosunda aynı olayı özetleme; karşı tarafın bakışı, birincil kaynak veya uzun vadeli sonucu seç.`,
    confidence: 84,
    impact: "Yüksek",
  });
  if (packagingOpportunity) recommendations.push({
    id: "fix-packaging",
    action: "DÜZELT",
    title: "İzlenen ama tıklanmayan videoyu yeniden paketle",
    detail: `“${packagingOpportunity.title}” %${packagingOpportunity.avgViewPercentage.toFixed(0)} izlenme oranına rağmen %${packagingOpportunity.ctr?.toFixed(2)} CTR’da. Başlıkta aktör + çatışma, kapakta tek tarih veya tek nesne kullan.`,
    confidence: 91,
    impact: "Yüksek",
  });
  if (!packagingOpportunity && postingSlots[0]) recommendations.push({
    id: "posting-slot",
    action: "TEST ET",
    title: `${postingSlots[0].dayLabel} ${postingSlots[0].time} yayın penceresini kullan`,
    detail: postingSlots[0].reason,
    confidence: postingSlots[0].confidence === "Yüksek" ? 86 : postingSlots[0].confidence === "Orta" ? 72 : 55,
    impact: "Orta",
  });
  if (weakTitles.length && recommendations.length < 4) recommendations.push({
    id: "stop-vague",
    action: "DURDUR",
    title: "Genel ve kanıtsız başlık kalıbını bırak",
    detail: `${weakTitles.length} başlıkta kişi, dönem veya çatışma belirsiz. Başlığın ilk yarısında özel isim; ikinci yarısında net soru ya da sonuç kullan.`,
    confidence: 86,
    impact: "Orta",
  });
  return recommendations.slice(0, 4);
}

export function buildDashboard(state: ChannelState): DashboardData {
  const orderedDaily = [...state.daily].sort((a, b) => a.date.localeCompare(b.date));
  const last7 = orderedDaily.slice(-7);
  const previous7 = orderedDaily.slice(-14, -7);
  const last7Views = sum(last7.map((day) => day.views));
  const previous7Views = sum(previous7.map((day) => day.views));
  let last7Subscribers = sum(last7.map((day) => day.subscribersGained - day.subscribersLost));

  if (last7Subscribers === 0) {
    const threshold = new Date();
    threshold.setDate(threshold.getDate() - 8);
    last7Subscribers = sum(state.videos.filter((video) => new Date(video.publishedAt) >= threshold).map(netSubscribers));
  }

  const deadline = endOfDay(state.goals.deadline);
  const daysRemaining = Math.max(1, Math.ceil((deadline.getTime() - Date.now()) / 86_400_000));
  const subscriberGrowthRequired = Math.max(0, state.goals.subscriberTarget - state.channel.subscriberCount);
  const conversion = state.totals.views > 0 && state.totals.netSubscribers > 0
    ? state.totals.netSubscribers / state.totals.views
    : 0.003;
  const viewsRequired = Math.ceil(subscriberGrowthRequired / Math.max(conversion, 0.0001));
  const projected30DaySubscribers = Math.round((last7Subscribers / 7) * 30);
  const requiredMonthlySubscribers = (subscriberGrowthRequired / daysRemaining) * 30;
  const ratio = requiredMonthlySubscribers > 0 ? projected30DaySubscribers / requiredMonthlySubscribers : 1;

  const grouped = new Map<string, { name: string; views: number; subscribers: number; watchHours: number }>();
  for (const video of state.videos) {
    const name = video.contentType === "SHORT" ? "Shorts" : "Uzun Video";
    const row = grouped.get(name) || { name, views: 0, subscribers: 0, watchHours: 0 };
    row.views += video.views;
    row.subscribers += netSubscribers(video);
    row.watchHours += video.watchHours;
    grouped.set(name, row);
  }

  const topicInsights = buildTopicInsights(state);
  const repetitionAlerts = buildRepetitionAlerts(state, topicInsights);
  const postingSlots = buildPostingSlots(state);
  const winningCombinations = buildWinningCombinations(state);
  const shortsGrowthGoal = buildShortsGrowthGoal(state);
  const recommendations = buildRecommendations(state, topicInsights, repetitionAlerts, postingSlots);
  const weeklySchedule = state.planning?.weeklySchedule || buildAdaptiveWeeklySchedule(state);
  const changedSlotCount = weeklySchedule.flatMap((day) => day.shortSlots || []).filter((slot) => slot.change === "Değişti").length;
  const shortsAnalyzed = state.videos.filter((video) => video.contentType === "SHORT" && video.views > 0).length;
  const hydratedState = { ...state, recommendations };

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
      targetProbabilityLabel: ratio >= 1 ? "Planda" : ratio >= 0.5 ? "Sıçrama gerekli" : "Yeni seri gerekli",
      progressPercent: Math.min(100, (state.channel.subscriberCount / Math.max(state.goals.subscriberTarget, 1)) * 100),
    },
    formatSplit: [...grouped.values()],
    topVideos: [...state.videos].sort((a, b) => b.views - a.views).slice(0, 10),
    topicInsights,
    repetitionAlerts,
    postingSlots,
    weeklySchedule,
    winningCombinations,
    shortsGrowthGoal,
    weeklyReview: {
      weekKey: currentIstanbulWeekKey(),
      nextReviewAt: nextWeeklyReviewAt(),
      shortsAnalyzed,
      changedSlotCount,
      summary: changedSlotCount
        ? `${changedSlotCount} yayın saati bu haftaki performansa göre değişti.`
        : "Anlamlı bir fark oluşmadığı için güçlü saatler korundu.",
    },
    setup: {
      youtubeCredentialsReady: Boolean(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET),
      hasChannelData: Boolean(state.videos.length || state.sync.lastYouTubeSync || state.sync.lastStudioImport),
      dataSource: state.auth.connected && state.sync.lastYouTubeSync
        ? "live"
        : state.sync.lastStudioImport
          ? "studio"
          : "none",
    },
    generatedAt: new Date().toISOString(),
  };
}
