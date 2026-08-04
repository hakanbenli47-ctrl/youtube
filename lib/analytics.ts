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
  DataQuality,
  GrowthPlaybook,
  ModelValidation,
  PostingSlot,
  Recommendation,
  RepetitionAlert,
  TopicInsight,
  VideoMetric,
} from "./schema";
import { publicState } from "./store";
import { buildAdaptiveWeeklySchedule, currentIstanbulWeekKey, nextWeeklyReviewAt } from "./scheduling";

const DAY_MS = 86_400_000;

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]) {
  return values.length ? sum(values) / values.length : 0;
}

function weightedAverage(rows: Array<{ value: number; weight: number }>, fallback = 0) {
  const totalWeight = sum(rows.map((row) => row.weight));
  if (!totalWeight) return fallback;
  return sum(rows.map((row) => row.value * row.weight)) / totalWeight;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function netSubscribers(video: VideoMetric) {
  return video.subscribersGained - video.subscribersLost;
}

function ageDays(video: VideoMetric) {
  const published = new Date(video.publishedAt).getTime();
  if (!Number.isFinite(published)) return 365;
  return Math.max(0.25, (Date.now() - published) / DAY_MS);
}

function percentChange(current: number, previous: number) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

function endOfDay(value: string) {
  return new Date(`${value}T23:59:59`);
}

function videoVelocity(video: VideoMetric) {
  if ((video.recentVelocity || 0) > 0) return video.recentVelocity || 0;
  if ((video.viewsLast7Days || 0) > 0) {
    return (video.viewsLast7Days || 0) / Math.min(7, ageDays(video));
  }
  return video.views / Math.max(1, Math.min(28, ageDays(video)));
}

function engagedRate(video: VideoMetric) {
  if ((video.engagedViewRate || 0) > 0) return video.engagedViewRate || 0;
  const analyticsViews = video.analyticsViews || 0;
  return analyticsViews > 0
    ? clamp(((video.engagedViews || 0) / analyticsViews) * 100, 0, 100)
    : 0;
}

function interactionRate(video: VideoMetric) {
  return ((video.likes + video.comments * 2 + (video.shares || 0) * 3) /
    Math.max(video.views, 1)) * 100;
}

function subscriberRate(video: VideoMetric) {
  return (Math.max(0, netSubscribers(video)) /
    Math.max(video.analyticsViews || video.views, 1)) * 1000;
}

type ScoreBaselines = {
  velocity: number;
  retention: number;
  engaged: number;
  interaction: number;
  conversion: number;
};

function scoreBaselines(videos: VideoMetric[]): ScoreBaselines {
  const positiveRetention = videos.map((video) => video.avgViewPercentage).filter((value) => value > 0);
  const positiveEngaged = videos.map(engagedRate).filter((value) => value > 0);
  return {
    velocity: Math.max(1, median(videos.map(videoVelocity))),
    retention: Math.max(55, median(positiveRetention) || 70),
    engaged: Math.max(45, median(positiveEngaged) || 60),
    interaction: Math.max(0.5, median(videos.map(interactionRate)) || 3),
    conversion: Math.max(0.2, median(videos.map(subscriberRate)) || 2),
  };
}

function indexedScore(value: number, baseline: number, sensitivity = 18) {
  if (value <= 0) return 35;
  const ratio = (value + baseline * 0.2) / Math.max(0.0001, baseline * 1.2);
  return clamp(50 + Math.log2(Math.max(0.05, ratio)) * sensitivity, 5, 100);
}

function videoQualityScore(video: VideoMetric, baselines: ScoreBaselines) {
  const velocity = indexedScore(videoVelocity(video), baselines.velocity, 18);
  const retention =, 100);
}

function videoQualityScore(video: VideoMetric, baselines: ScoreBaselines) {
  const velocity = indexedScore(videoVelocity(video), baselines.velocity, 18);
  const retention = video.avgViewPercentage > 0
    ? indexedScore(video.avgViewPercentage, baselines.retention, 15)
    : 45;
  const engaged = engagedRate(video) > 0
    ? indexedScore(engagedRate(video), baselines.engaged, 14)
    : 45;
  const conversion = indexedScore(subscriberRate(video), baselines.conversion, 13);
  const interaction = indexedScore(interactionRate(video), baselines.interaction, 11);
  const raw = velocity * 0.35 + retention * 0.24 + engaged * 0.16 +
    conversion * 0.15 + interaction * 0.10;
  const reliability = clamp(Math.log10(video.views + 10) / 4, 0.30, 1);
  return clamp(50 + (raw - 50) * reliability, 0, 100);
}

function groupScore(videos: VideoMetric[], baselines: ScoreBaselines) {
  const quality = weightedAverage(
    videos.map((video) => ({
      value: videoQualityScore(video, baselines),
      weight: clamp(Math.log10(video.views + 10), 1, 4),
    })),
    50,
  );
  const priorVideos = 6;
  return clamp((quality * videos.length + 50 * priorVideos) /
    (videos.length + priorVideos), 0, 100);
}

export function buildWinningCombinations(state: ChannelState): CombinationInsight[] {
  const shorts = state.videos.filter((video) => video.contentType === "SHORT" && video.views > 0);
  if (!shorts.length) return [];
  const baselines = scoreBaselines(shorts);
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

  const rows: CombinationInsight[] = [...groups.values()].map((group) => {
    const sampleSize = group.videos.length;
    const totalViews = sum(group.videos.map((video) => video.views));
    const viewsPerDay = weightedAverage(group.videos.map((video) => ({
      value: videoVelocity(video),
      weight: clamp(Math.log10(video.views + 10), 1, 4),
    })));
    const totalInteractions = sum(group.videos.map((video) =>
      video.likes + video.comments * 2 + (video.shares || 0) * 3));
    const totalSubscribers = sum(group.videos.map((video) => Math.max(0, netSubscribers(video))));
    const analyticsViews = sum(group.videos.map((video) => video.analyticsViews || video.views));
    const engagementRate = (totalInteractions / Math.max(totalViews, 1)) * 100;
    const subscribersPerThousand = (totalSubscribers / Math.max(analyticsViews, 1)) * 1000;
    const score = Math.round(groupScore(group.videos, baselines));
    const confidence: CombinationInsight["confidence"] =
      sampleSize >= 15 && totalViews >= 20_000
        ? "Yüksek"
        : sampleSize >= 6 && total "Test"
        ? "ÖLÇEKLE"
        : score < 42 && confidence !== "Test"
          ? "DİNLENDİR"
          : "DOĞRULA";
    return {
      id: `${group.dimension}-${group.label}`,
      dimension: group.dimension,
      label: group.label,
      sampleSize,
      totalViews,
      viewsPerDay,
      engagementRate,
      subscribersPerThousand,
      score,
      confidence,
      decision,
      reason: `${Math.round(viewsPerDay).toLocaleString("tr-TR")} güncel izlenme/gün · %${engagementRate.toFixed(1)} etkileşim · ${subscribersPerThousand.toFixed(1)} abone/1K`,
    };
  });

  return (["Padişah", "Başlık Kalıbı", "Gün × Dönem", "Konu"] as const)
    .flatMap((dimension) => rows
      .filter((row) => row.dimension === dimension)
      .sort((left, right) => {
        const decisionWeight = { "ÖLÇEKLE": 2, "DOĞRULA": 1, "DİNLENDİR": 0 } as const;
        const confidenceWeight = { "Yüksek": 2, "Orta": 1, "Test": 0 } as const;
        return decisionWeight[right.decision] - decisionWeight[left.decision] ||
          confidenceWeight[right.confidence] - confidenceWeight[left.confidence] ||
          right.score - left.score;
      })
      .slice(0, 3));
}

export function buildShortsGrowthGoal(state: ChannelState) {
  const targetViews = 10_000_000;
  const windowDays = 90;
  const cutoff = Date.now() - windowDays * DAY_MS;
  const reportedWindowViews = sum((state.shortsDaily || [])
    .filter((day) => new Date(`${day.date}T23:59:59`).getTime() >= cutoff)
    .map((day) const reportedWindowViews = sum((state.shortsDaily || [])
    .filter((day) => new Date(`${day.date}T23:59:59`).getTime() >= cutoff)
    .map((day) => day.engagedViews || 0));
  const recentVideoViews = sum(state.videos
    .filter((video) => video.contentType === "SHORT" && new Date(video.publishedAt).getTime() >= cutoff)
    .map((video) => video.engagedViews || 0));
  const currentViews = reportedWindowViews || recentVideoViews;
  const sevenDayCutoff = Date.now() - 7 * DAY_MS;
  const recentShortDays = (state.shortsDaily || []).filter((day) =>
    new Date(`${day.date}T23:59:59`).getTime() >= sevenDayCutoff);
  const currentViewsPerDay = recentShortDays.length
    ? sum(recentShortDays.map((day) => day.engagedViews || 0)) / 7
    : sum(state.videos
      .filter((video) => video.contentType === "SHORT")
      .map((video) => video.engagedViewsLast7Days || 0)) / 7(currentViewsPerDay * windowDays);
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
  const shorts = state.videos.filter((video) => video.contentType === "SHORT" && video.views > 0);
  if (!shorts.length) return [];
  const baselines = scoreBaselines(shorts);
  const recentThreshold = Date.now() - 45 * DAY_MS;
  const groups = new Map<string, VideoMetric[]>();
  for (const video of shorts) {
    groups.set(video.topic, [...(groups.get(video.topic) || []), video]);
  }

  return [...groups.entries()]
    .map(([topic, videos]) => {
      const views = sum(videos.map((video) => video.views));
      const averageViews = views / videos.length;
      const analyticsViews = sum(videos.map((video) => video.analyticsViews || video.views));
      const subscribersPerThousand =
        (sum(videos.map((video) => Math.max(0, netSubscribers(video)))) /
          Math.max(analyticsViews, 1)) * 1000;
      const retentionValues = videos
        .map((video) => video.avgViewPercentage)
        .filter((value) => value > 0);
      const averageRetention = average(retentionValues);
      const recentCount = videos.filter((video) =>
        new Date(video.publishedAt).getTime() >= recentThreshold).length;
      const score = Math.round(groupScore(videos, baselines));
      let decision: TopicInsight["decision"] = "DENGELE";
      if (videos.length < 4) decision = "TEST ET";
      else if (recentCount >= 4 && score < 42) decision = "D["decision"] = "DENGELE";
      if (videos.length < 4) decision = "TEST ET";
      else if (recentCount >= 4 && score < 42) decision = "DİNLENDİR";
      else if (videos.length >= 6 && score >= 62) decision = "ÖLÇEKLE";

      const reason = decision === "DİNLENDİR"
        ? `Son 45 günde ${recentCount} kez işlendi ve kalite puanı kanal tabanının altında kaldı.`
        : decision === "ÖLÇEKLE"
          ? `${videos.length} videoda ${score}/100 doğrulanmış kalite ve güçlü dönüşüm üretti.`
          : decision === "TEST ET"
            ? "Örnek az; aynı konuyu kopyalamadan farklı aktör ve farklı sonuçla kontrollü test et."
            : `Kanal ortalamasına yakın; yeni kaynak, yeni çatışma veya karşı tarafın bakışıyla çeşitlendir.`;

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
    .sort((left, right) => right.score - left.score);
}

export function buildRepetitionAlerts(
  state: ChannelState,
  topics = buildTopicInsights(state),
): RepetitionAlert[] {
  const alerts: RepetitionAlert[] = topics
    .filter((topic) => topic.decision === "DİNLENDİR")
    .map((topic) => ({
      id: `topic-${topic.topic}`,
      label: `${topic.topic} konusunu dinlendir`,
      evidence: topic.reason,
      severity: "DİNLENDİR" as const,
      cooldownDays: 21,
      titles: state.videos
        .filter((video) => video.topic === topic.topic)
        .slice(0, 3)
        .map((video) => video.title),
    }));

  const ordered = [...state.videos]
    .filter((video) => video.contentType === "SHORT" && video.title)
    .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
    .slice(0, 100);
  const used = new Set<string>();
  for (let left = 0; left < ordered.length && alerts.length < 7; left += 1) {
    for (let right = left + 1; right < ordered.length && alerts.length < 7; right += 1) {
      const first = ordered[left];
      const second = ordered[right];
      if (used.has(first.id) || used.has(second.id)) continue;
      const similarity = titleSimilarity(first.title, second.title);
      if (similarity < 0.46) continue;
      const common = [...titleTokens(first.title)]
        .filter((token) => titleTokens(second.title).has(token));
      alerts.push({
        id: `similar-${first.id}-${second.id}`,
        label: `${common.slice(0, 3).join(" · ") || first.topic} açısı tekrar ediyor`,
        evidence: `Bu iki başlık %${Math.round(similarity * 100)} benzer. Yeni videoda farklı aktör, belge veya sonuç seç.`,
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
  const eligible = state.videos.filter((video) =>
    video.contentType === "SHORT" &&
    istanbulPublishParts(video.publishedAt) &&
    video.views > 0 &&
    ageDays(video) <= 120,
  );
  if (eligible.length < 12) {
    return DEFAULT_POSTING_SLOTS.slice(0, 4).map((slot, index) => ({
      id: `test-${index}`,
      dayLabel: slot.dayLabel,
      time: slot.time,
      format: slot.format,
      sampleSize: 0,
      score: 0,
      confidence: "Test",
      reason: "Saat kararı için en az 12 son dönem Shorts örneği gerekiyor.",
    }));
  }

  const baselines = scoreBaselines(eligible);
  const overall = average(eligible.map((video) => videoQualityScore(video, baselines)));
  const groups = new Map<string, {
    dayLabel: string;
    time: string;
    format: PostingSlot["format"];
    videos: VideoMetric[];
  }>();
  for (const video of eligible) {
    const parts = istanbulPublishParts(video.publishedAt);
    if (!parts) continue;
    const key = `${parts.dayLabel}-${parts.time}`;
    const group = groups.get(key) || {
      dayLabel: parts.dayLabel,
      time: parts.time,
      format: "Shorts" as const,
      videos: [],
    };
    group.videos.push(video);
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => {
      const quality = average(group.videos.map((video) => videoQualityScore(video, baselines)));
      const shrunk = (quality * group.videos.length + overall * 5) / (group.videos.length + 5);
      return { ...group, shrunk };
    })
    .sort((left, right) => right.shrunk - left.shrunk)
    .slice(0, 7)
    .map((row, index) => ({
      id: `observed-${index}`,
      dayLabel: row.dayLabel,
      time: row.time,
      format: row.format,
      sampleSize: row.videos.length,
      score: Math.round(row.shrunk),
      confidence: row.videos.length >= 12
        ? "Yüksek"
        : row.videos.length >= 5
          ? "Orta"
          : "Test",
      reason: `${row.videos.length} videonun güncel hızı, tutma ve dönüşümü kanal ortalamasına çekilerek hesaplandı.`,
    }));
}

function predictionLabels(video: VideoMetric) {
  const parts = istanbulPublishParts(video.publishedAt);
  return [
    `topic:${video.topic}`,
    `ruler:${detectOttomanRuler(video.title)}`,
    `hook:${detectHookPattern(video.title)}`,
    parts ? `slot:${parts.dayLabel}-${parts.period}` : "slot:unknown",
  ];
}

export function buildModelValidation(state: ChannelState): ModelValidation {
  const shorts = state.videos
    .filter((video) => video.contentType === "SHORT" && video.views >= 100)
    .sort((left, right) => left.publishedAt.localeCompare(right.publishedAt));
  if (shorts.length < 18) {
    return {
      sampleSize: shorts.length,
      holdoutSize: 0,
      pairwiseAccuracy: 0,
      topQuartileLift: 0,
      status: "YETERSİZ VERİ",
      note: "Gerçek geriye dönük test için en az 18 ölçülebilir Shorts gerekiyor.",
    };
  }

  const splitIndex = Math.max(12, Math.floor(shorts.length * 0.7));
  const training = shorts.slice(0, splitIndex);
  const holdout = shorts.slice(splitIndex);
  const trainingBaselines = scoreBaselines(training);
  const holdoutBaselines = scoreBaselines(holdout);
  const labelScores = new Map<string, number[]>();
  for (const video of training) {
    const score = videoQualityScore(video, trainingBaselines);
    for (const label of predictionLabels(video)) {
      labelScores.set(label, [...(labelScores.get(label) || []), score]);
    }
  }
  const fallback = average(training.map((video) => videoQualityScore(video, trainingBaselines)));
  const predictions = holdout.map((video) => {
    const known = predictionLabels(video)
      .map((label) => labelScores.get(label))
      .filter((scores): scores is number[] => Boolean(scores?.length))
      .map((scores) => average(scores));
    return {
      predicted: known.length ? average(known) : fallback,
      actual: videoQualityScore(video, holdoutBaselines),
    };
  });

  let comparablePairs = 0;
  let correctPairs = 0;
  for (let left = 0; left < predictions.length; left += 1) {
    for (let right = left + 1; right < predictions.length; right += 1) {
      const predictedDifference = predictions[left].predicted - predictions[right].predicted;
      if (Math.abs(predictedDifference) < 1.5) continue;
      comparablePairs += 1;
      const actualDifference = predictions[left].actual - predictions[right].actual;
      if (predictedDifference * actualDifference > 0) correctPairs += 1;
    }
  }
  const pairwiseAccuracy = comparablePairs
    ? (correctPairs / comparablePairs) * 100
    : 50;
  const ranked = [...predictions].sort((left, right) => right.predicted - left.predicted);
  const quartileSize = Math.max(1, Math.ceil(ranked.length / 4));
  const overallActual = average(ranked.map((row) => row.actual));
  const topActual = average(ranked.slice(0, quartileSize).map((row) => row.actual));
  const topQuartileLift = overallActual > 0
    ? ((topActual / overallActual) - 1) * 100
    : 0;
  const status: ModelValidation["status"] = holdout.length >= 12 && pairwiseAccuracy >= 65
    ? "GÜÇLÜ"
    : holdout.length >= 7 && pairwiseAccuracy >= 57
      ? "ORTA"
      : "TEST";

  return {
    sampleSize: shorts.length,
    holdoutSize: holdout.length,
    pairwiseAccuracy: Math.round(pairwiseAccuracy * 10) / 10,
    topQuartileLift: Math.round(topQuartileLift * 10) / 10,
    status,
    note: `${training.length} eski video ile öğrenildi; ${holdout.length} daha yeni video hiç görülmeden test edildi.`,
  };
}

export function buildDataQuality(state: ChannelState): DataQuality {
  const videos = state.videos.filter((video) => video.views > 0);
  const missingVideoAnalytics = videos.filter((video) =>
    (video.analyticsViews || 0) === 0).length;
  const analyticsLagDays = state.sync.analyticsLagDays || 0;
  const warnings = [...(state.sync.warnings || [])];
  if (!state.auth.connected) warnings.push("YouTube hesabı bağlı değil.");
  if (!(state.snapshots || []).length) {
    warnings.push("İlk 1/6/24 saat performansını öğrenmek için snapshot geçmişi yeni birikmeye başladı.");
  }
  const gapRatio = state.totals.views > 0
    ? Math.max(0, state.totals.views - (state.totals.analyticsViews || 0)) / state.totals.views
    : 0;
  if (gapRatio > 0.15) {
    warnings.push("Canlı public görüntülenme ile ayrıntılı Analytics arasında beklenen veri gecikmesi var.");
  }
  let score = 100;
  if (!state.auth.connected) score -= 45;
  score -= Math.min(30, analyticsLagDays * 8);
  score -= videos.length ? Math.min(25, (missingVideoAnalytics / videos.length) * 25) : 20;
  if ((state.snapshots || []).length < 2) score -= 10;
  if (!(state.shortsDaily || []).length) score -= 10;
  return {
    score: Math.round(clamp(score, 0, 100)),
    latestAnalyticsDate: state.sync.dataThroughDate || null,
    analyticsLagDays,
    livePublicViews: state.totals.views,
    analyticsViews: state.totals.analyticsViews || 0,
    engagedViews: state.totals.engagedViews || 0,
    missingVideoAnalytics,
    snapshots: (state.snapshots || []).length,
    warnings: [...new Set(warnings)].slice(0, 8),
  };
}

export function buildGrowthPlaybook(state: ChannelState): GrowthPlaybook {
  const shorts = state.videos.filter((video) => video.contentType === "SHORT" && video.views > 0);
  if (!shorts.length) {
    return {
      provenShare: 60,
      adjacentShare: 25,
      experimentShare: 15,
      nextActions: [{
        title: "İlk veri setini oluştur",
        detail: "Aynı kalite standardıyla en az 12 Shorts yayınla; her paylaşım sonrası paneli yenileyerek snapshot biriktir.",
      }],
    };
  }
  const baselines = scoreBaselines(shorts);
  const ranked = [...shorts].sort((left, right) =>
    videoQualityScore(right, baselines) - videoQualityScore(left, baselines));
  const viewMedian = median(shorts.map((video) => video.views));
  const retentionMedian = median(shorts.map((video) => video.avgViewPercentage).filter((value) => value > 0));
  const engagedMedian = median(shorts.map(engagedRate).filter((value) => value > 0));
  const velocityMedian = median(shorts.map(videoVelocity));
  const proven = ranked[0];
  const hiddenGem = ranked.find((video) =>
    video.views < viewMedian &&
    video.avgViewPercentage >= retentionMedian &&
    engagedRate(video) >= engagedMedian);
  const revival = ranked.find((video) =>
    ageDays(video) >= 14 &&
    videoQualityScore(video, baselines) >= 60 &&
    videoVelocity(video) < velocityMedian * 0.55);
  const nextActions: GrowthPlaybook["nextActions"] = [];
  if (proven) nextActions.push({
    title: "Kazananın devam açısını üret",
    detail: `“${proven.title}” başlığını kopyalama; aynı merak mekanizmasını farklı aktör, karşı taraf veya sonuçla yeniden kur.`,
    sourceVideoId: proven.id,
  });
  if (hiddenGem) nextActions.push({
    title: "Gizli cevheri yeniden paketle",
    detail: `“${hiddenGem.title}” düşük erişime rağmen güçlü tutma verdi. İlk iki saniyeyi sertleştirip aynı olayın yeni anlatımını test et.`,
    sourceVideoId: hiddenGem.id,
  });
  if (revival && revival.id !== hiddenGem?.id) nextActions.push({
    title: "Eski kazanana ikinci dalga aç",
    detail: `“${revival.title}” için doğrudan tekrar yerine sonuç, belge veya rakip taraf odaklı devam videosu hazırla.`,
    sourceVideoId: revival.id,
  });
  return {
    provenShare: shorts.length >= 20 ? 70 : 60,
    adjacentShare: shorts.length >= 20 ? 20 : 25,
    experimentShare: shorts.length >= 20 ? 10 : 15,
    nextActions: nextActions.slice(0, 3),
  };
}

export function buildRecommendations(
  state: ChannelState,
  topics = buildTopicInsights(state),
  repetitionAlerts = buildRepetitionAlerts(state, topics),
  postingSlots = buildPostingSlots(state),
): Recommendation[] {
  if (!state.videos.length) return [];
  const playbook = buildGrowthPlaybook(state);
  const recommendations: Recommendation[] = playbook.nextActions.map((action, index) => ({
    id: `playbook-${index}`,
    action: index === 0 ? "YAP" : "TEST ET",
    title: action.title,
    detail: action.detail,
    confidence: index === 0 ? 78 : 66,
    impact: index === 0 ? "Yüksek" : "Orta",
  }));

  if (repetitionAlerts[0] && recommendations.length < 4) recommendations.push({
    id: "avoid-repeat",
    action: "DURDUR",
    title: repetitionAlerts[0].label,
    detail: repetitionAlerts[0].evidence,
    confidence: repetitionAlerts[0].severity === "BENZERLİK" ? 82 : 72,
    impact: "Orta",
  });
  if (postingSlots[0] && recommendations.length < 4) recommendations.push({
    id: "posting-slot",
    action: "TEST ET",
    title: `${postingSlots[0].dayLabel} ${postingSlots[0].time} penceresini doğrula`,
    detail: postingSlots[0].reason,
    confidence: postingSlots[0].confidence === "Yüksek" ? 82 :
      postingSlots[0].confidence === "Orta" ? 68 : 52,
    impact: "Orta",
  });
  return recommendations.slice(0, 4);
}

export function buildDashboard(state: ChannelState): DashboardData {
  const orderedDaily = [...state.daily].sort((left, right) => left.date.localeCompare(right.date));
  const last7 = orderedDaily.slice(-7);
  const previous7 = orderedDaily.slice(-14, -7);
  const last7Views = sum(last7.map((day) => day.views));
  const previous7Views = sum(previous7.map((day) => day.views));
  let last7Subscribers = sum(last7.map((day) => day.subscribersGained - day.subscribersLost));

  if (last7Subscribers === 0) {
    const threshold = new Date(Date.now() - 8 * DAY_MS);
    last7Subscribers = sum(state.videos
      .filter((video) => new Date(video.publishedAt) >= threshold)
      .map(netSubscribers));
  }

  const deadline = endOfDay(state.goals.deadline);
  const daysRemaining = Math.max(1, Math.ceil((deadline.getTime() - Date.now()) / DAY_MS));
  const subscriberGrowthRequired = Math.max(0, state.goals.subscriberTarget - state.channel.subscriberCount);
  const conversionBase = state.totals.analyticsViews || state.totals.views;
  const conversion = conversionBase > 0 && state.totals.netSubscribers > 0
    ? state.totals.netSubscribers / conversionBase
    : 0.003;
  const viewsRequired = Math.ceil(subscriberGrowthRequired / Math.max(conversion, 0.0001));
  const projected30DaySubscribers = Math.round((last7Subscribers / 7) * 30);
  const requiredMonthlySubscribers = (subscriberGrowthRequired / daysRemaining) * 30;
  const ratio = requiredMonthlySubscribers > 0
    ? projected30DaySubscribers / requiredMonthlySubscribers
    : 1;

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
  const modelValidation = buildModelValidation(state);
  const dataQuality = buildDataQuality(state);
  const growthPlaybook = buildGrowthPlaybook(state);
  const weeklySchedule = state.planning?.weeklySchedule || buildAdaptiveWeeklySchedule(state);
  const changedSlotCount = weeklySchedule
    .flatMap((day) => day.shortSlots || [])
    .filter((slot) => slot.change === "Değişti").length;
  const shortsAnalyzed = state.videos
    .filter((video) => video.contentType === "SHORT" && video.views > 0).length;
  const hydratedState = { ...state, recommendations };
  const shorts = state.videos.filter((video) => video.contentType === "SHORT" && video.views > 0);
  const topBaselines = scoreBaselines(shorts.length ? shorts : state.videos.filter((video) => video.views > 0));

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
      targetProbabilityLabel: ratio >= 1
        ? "Planda"
        : ratio >= 0.5
          ? "Sıçrama gerekli"
          : "Kazanan seri gerekli",
      progressPercent: Math.min(100,
        (state.channel.subscriberCount / Math.max(state.goals.subscriberTarget, 1)) * 100),
    },
    formatSplit: [...grouped.values()],
    topVideos: [...state.videos]
      .sort((left, right) =>
        videoQualityScore(right, topBaselines) - videoQualityScore(left, topBaselines) ||
        right.views - left.views)
      .slice(0, 10),
    topicInsights,
    repetitionAlerts,
    postingSlots,
    weeklySchedule,
    winningCombinations,
    shortsGrowthGoal,
    modelValidation,
    dataQuality,
    growthPlaybook,
    weeklyReview: {
      weekKey: currentIstanbulWeekKey(),
      nextReviewAt: nextWeeklyReviewAt(),
      shortsAnalyzed,
      changedSlotCount,
      summary: changedSlotCount
        ? `${changedSlotCount} yayın saati yeterli kanıt oluştuğu için değişti.`
        : "Saatleri değiştirecek kadar güçlü kanıt oluşmadı; güvenli düzen korundu.",
    },
    setup: {
      youtubeCredentialsReady: Boolean(
        process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET),
      hasChannelData: Boolean(
        state.videos.length || state.sync.lastYouTubeSync || state.sync.lastStudioImport),
      dataSource: state.auth.connected && state.sync.lastYouTubeSync
        ? "live"
        : state.sync.lastStudioImport
          ? "studio"
          : "none",
    },
    generatedAt: new Date().toISOString(),
  };
}