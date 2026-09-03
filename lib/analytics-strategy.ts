import "server-only";

import { detectHookPattern, detectOttomanRuler, istanbulPublishParts } from "./history";
import type {
  ChannelState,
  DataQuality,
  GrowthPlaybook,
  ModelValidation,
  PostingSlot,
  Recommendation,
  RepetitionAlert,
  TopicInsight,
  VideoMetric,
} from "./schema";
import {
  ageDays,
  baselines,
  buildPostingSlots,
  buildRepetitionAlerts,
  buildTopicInsights,
} from "./analytics-metrics";

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const average = (values: number[]) => values.length ? sum(values) / values.length : 0;
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
function median(values: number[]) {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}
function netSubscribers(video: VideoMetric) { return video.subscribersGained - video.subscribersLost; }
function engagedRate(video: VideoMetric) {
  if ((video.engagedViewRate || 0) > 0) return video.engagedViewRate || 0;
  const analyticsViews = video.analyticsViews || 0;
  return analyticsViews > 0 ? clamp(((video.engagedViews || 0) / analyticsViews) * 100, 0, 100) : 0;
}
function velocity(video: VideoMetric) {
  if ((video.recentVelocity || 0) > 0) return video.recentVelocity || 0;
  const age = ageDays(video);
  if ((video.viewsLast7Days || 0) > 0) return (video.viewsLast7Days || 0) / Math.max(1, Math.min(7, age));
  if ((video.viewsLast28Days || 0) > 0) return (video.viewsLast28Days || 0) / Math.max(1, Math.min(28, age));
  if (age <= 28) return video.views / Math.max(1, age);
  return 0;
}
function interactionRate(video: VideoMetric) {
  return ((video.likes + video.comments * 2 + (video.shares || 0) * 3) / Math.max(video.views, 1)) * 100;
}
function subscriberRate(video: VideoMetric) {
  return (Math.max(0, netSubscribers(video)) / Math.max(video.analyticsViews || video.views, 1)) * 1000;
}
function indexed(value: number, baseline: number, sensitivity: number) {
  if (value <= 0) return 35;
  const ratio = (value + baseline * 0.2) / Math.max(0.0001, baseline * 1.2);
  return clamp(50 + Math.log2(Math.max(0.05, ratio)) * sensitivity, 5, 100);
}
function quality(video: VideoMetric, base: ReturnType<typeof baselines>) {
  const reach = indexed(velocity(video), base.velocity, 18);
  const retention = video.avgViewPercentage > 0 ? indexed(video.avgViewPercentage, base.retention, 15) : 45;
  const engaged = engagedRate(video) > 0 ? indexed(engagedRate(video), base.engaged, 14) : 45;
  const conversion = indexed(subscriberRate(video), base.conversion, 13);
  const interaction = indexed(interactionRate(video), base.interaction, 11);
  const raw = reach * 0.35 + retention * 0.24 + engaged * 0.16 + conversion * 0.15 + interaction * 0.10;
  const reliability = clamp(Math.log10(video.views + 10) / 4, 0.3, 1);
  return clamp(50 + (raw - 50) * reliability, 0, 100);
}

function labels(video: VideoMetric) {
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
  const split = Math.max(12, Math.floor(shorts.length * 0.7));
  const training = shorts.slice(0, split);
  const holdout = shorts.slice(split);
  const trainBase = baselines(training);
  const testBase = baselines(holdout);
  const labelScores = new Map<string, number[]>();
  for (const video of training) {
    for (const label of labels(video)) {
      labelScores.set(label, [...(labelScores.get(label) || []), quality(video, trainBase)]);
    }
  }
  const fallback = average(training.map((video) => quality(video, trainBase)));
  const predictions = holdout.map((video) => {
    const known = labels(video).flatMap((label) => labelScores.get(label) || []);
    return { predicted: known.length ? average(known) : fallback, actual: quality(video, testBase) };
  });
  let pairs = 0;
  let correct = 0;
  for (let left = 0; left < predictions.length; left += 1) {
    for (let right = left + 1; right < predictions.length; right += 1) {
      const predicted = predictions[left].predicted - predictions[right].predicted;
      if (Math.abs(predicted) < 1.5) continue;
      pairs += 1;
      if (predicted * (predictions[left].actual - predictions[right].actual) > 0) correct += 1;
    }
  }
  const accuracy = pairs ? correct / pairs * 100 : 50;
  const ranked = [...predictions].sort((left, right) => right.predicted - left.predicted);
  const size = Math.max(1, Math.ceil(ranked.length / 4));
  const overall = average(ranked.map((row) => row.actual));
  const lift = overall > 0 ? (average(ranked.slice(0, size).map((row) => row.actual)) / overall - 1) * 100 : 0;
  const status: ModelValidation["status"] = holdout.length >= 12 && accuracy >= 65
    ? "GÜÇLÜ"
    : holdout.length >= 7 && accuracy >= 57
      ? "ORTA"
      : "TEST";
  return {
    sampleSize: shorts.length,
    holdoutSize: holdout.length,
    pairwiseAccuracy: Math.round(accuracy * 10) / 10,
    topQuartileLift: Math.round(lift * 10) / 10,
    status,
    note: `${training.length} eski video ile öğrenildi; ${holdout.length} yeni video ayrı test edildi.`,
  };
}

export function buildDataQuality(state: ChannelState): DataQuality {
  const videos = state.videos.filter((video) => video.views > 0);
  const missing = videos.filter((video) => (video.analyticsViews || 0) === 0).length;
  const lag = state.sync.analyticsLagDays || 0;
  const warnings = [...(state.sync.warnings || [])];
  if (!state.auth.connected) warnings.push("YouTube hesabı bağlı değil.");
  if ((state.snapshots || []).length < 2) warnings.push("İlk saat performansı için snapshot geçmişi birikiyor.");
  let score = 100;
  if (!state.auth.connected) score -= 45;
  score -= Math.min(30, lag * 8);
  score -= videos.length ? Math.min(25, missing / videos.length * 25) : 20;
  if ((state.snapshots || []).length < 2) score -= 10;
  if (!(state.shortsDaily || []).length) score -= 10;
  return {
    score: Math.round(clamp(score, 0, 100)),
    latestAnalyticsDate: state.sync.dataThroughDate || null,
    analyticsLagDays: lag,
    livePublicViews: state.totals.views,
    analyticsViews: state.totals.analyticsViews || 0,
    engagedViews: state.totals.engagedViews || 0,
    missingVideoAnalytics: missing,
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
      nextActions: [{ title: "İlk veri setini oluştur", detail: "En az 12 Shorts yayınla ve paneli düzenli yenile." }],
    };
  }
  const base = baselines(shorts);
  const ranked = [...shorts].sort((left, right) => quality(right, base) - quality(left, base));
  const viewsMedian = median(shorts.map((video) => video.views));
  const retentionMedian = median(shorts.map((video) => video.avgViewPercentage).filter((value) => value > 0));
  const engagedMedian = median(shorts.map(engagedRate).filter((value) => value > 0));
  const velocityMedian = median(shorts.map(velocity));
  const proven = ranked[0];
  const hidden = ranked.find((video) =>
    video.views < viewsMedian && video.avgViewPercentage >= retentionMedian && engagedRate(video) >= engagedMedian);
  const revival = ranked.find((video) =>
    ageDays(video) >= 14 && quality(video, base) >= 60 && velocity(video) < velocityMedian * 0.55);
  const nextActions: GrowthPlaybook["nextActions"] = [];
  if (proven) nextActions.push({
    title: "Kazananın devam açısını üret",
    detail: `“${proven.title}” başlığını kopyalama; aynı merakı farklı aktör veya sonuçla yeniden kur.`,
    sourceVideoId: proven.id,
  });
  if (hidden) nextActions.push({
    title: "Gizli cevheri yeniden paketle",
    detail: `“${hidden.title}” düşük erişime rağmen güçlü tutma verdi. İlk iki saniyeyi sertleştirip yeni anlatımını test et.`,
    sourceVideoId: hidden.id,
  });
  if (revival && revival.id !== hidden?.id) nextActions.push({
    title: "Eski kazanana ikinci dalga aç",
    detail: `“${revival.title}” için sonuç, belge veya karşı taraf odaklı devam videosu üret.`,
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
  const recommendations: Recommendation[] = buildGrowthPlaybook(state).nextActions.map((action, index) => ({
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
    confidence: 76,
    impact: "Orta",
  });
  if (postingSlots[0] && recommendations.length < 4) recommendations.push({
    id: "posting-slot",
    action: "TEST ET",
    title: `${postingSlots[0].dayLabel} ${postingSlots[0].time} penceresini doğrula`,
    detail: postingSlots[0].reason,
    confidence: postingSlots[0].confidence === "Yüksek" ? 82 : postingSlots[0].confidence === "Orta" ? 68 : 52,
    impact: "Orta",
  });
  return recommendations.slice(0, 4);
}
