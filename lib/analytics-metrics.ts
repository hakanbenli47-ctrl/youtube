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
  PostingSlot,
  RepetitionAlert,
  TopicInsight,
  VideoMetric,
} from "./schema";

const DAY_MS = 86_400_000;

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const average = (values: number[]) => values.length ? sum(values) / values.length : 0;
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

function median(values: number[]) {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

function netSubscribers(video: VideoMetric) {
  return video.subscribersGained - video.subscribersLost;
}

export function ageDays(video: VideoMetric) {
  const published = new Date(video.publishedAt).getTime();
  if (!Number.isFinite(published)) return 365;
  return Math.max(0.25, (Date.now() - published) / DAY_MS);
}

export function velocity(video: VideoMetric) {
  const age = ageDays(video);
  if ((video.viewsLast7Days || 0) > 0) {
    return (video.viewsLast7Days || 0) / Math.max(1, Math.min(7, age));
  }
  if ((video.viewsLast28Days || 0) > 0) {
    return (video.viewsLast28Days || 0) / Math.max(1, Math.min(28, age));
  }
  if (age <= 8 && (video.recentVelocity || 0) > 0) return video.recentVelocity || 0;
  if (age <= 28) return video.views / Math.max(1, age);
  return 0;
}

export function engagedRate(video: VideoMetric) {
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

function retentionSignal(video: VideoMetric) {
  const averageRetention = video.avgViewPercentage || 0;
  const earlyRetention = video.retention10Percent || 0;
  if (averageRetention > 0 && earlyRetention > 0) return averageRetention * 0.65 + earlyRetention * 0.35;
  return averageRetention || earlyRetention;
}

type Baselines = {
  velocity: number;
  retention: number;
  engaged: number;
  interaction: number;
  conversion: number;
};

export function baselines(videos: VideoMetric[]): Baselines {
  const retentions = videos.map(retentionSignal).filter((value) => value > 0);
  const engaged = videos.map(engagedRate).filter((value) => value > 0);
  return {
    velocity: Math.max(1, median(videos.map(velocity))),
    retention: Math.max(50, median(retentions) || 70),
    engaged: Math.max(40, median(engaged) || 60),
    interaction: Math.max(0.5, median(videos.map(interactionRate)) || 3),
    conversion: Math.max(0.2, median(videos.map(subscriberRate)) || 2),
  };
}

function indexed(value: number, baseline: number, sensitivity: number) {
  if (value <= 0) return 35;
  const ratio = (value + baseline * 0.2) / Math.max(0.0001, baseline * 1.2);
  return clamp(50 + Math.log2(Math.max(0.05, ratio)) * sensitivity, 5, 100);
}

export function quality(video: VideoMetric, base: Baselines) {
  const reach = indexed(velocity(video), base.velocity, 18);
  const retentionValue = retentionSignal(video);
  const retention = retentionValue > 0
    ? indexed(retentionValue, base.retention, 15)
    : 45;
  const engaged = engagedRate(video) > 0
    ? indexed(engagedRate(video), base.engaged, 14)
    : 45;
  const conversion = indexed(subscriberRate(video), base.conversion, 13);
  const interaction = indexed(interactionRate(video), base.interaction, 11);
  const raw = reach * 0.35 + retention * 0.24 + engaged * 0.16 +
    conversion * 0.15 + interaction * 0.10;
  const reliability = clamp(Math.log10(video.views + 10) / 4, 0.3, 1);
  return clamp(50 + (raw - 50) * reliability, 0, 100);
}

function groupQuality(videos: VideoMetric[], base: Baselines) {
  const weights = videos.map((video) => clamp(Math.log10(video.views + 10), 1, 4));
  const totalWeight = sum(weights);
  const observed = totalWeight
    ? sum(videos.map((video, index) => quality(video, base) * weights[index])) / totalWeight
    : 50;
  return (observed * videos.length + 50 * 6) / (videos.length + 6);
}

export function buildWinningCombinations(state: ChannelState): CombinationInsight[] {
  const shorts = state.videos.filter((video) => video.contentType === "SHORT" && video.views > 0);
  if (!shorts.length) return [];
  const base = baselines(shorts);
  const groups = new Map<string, {
    dimension: CombinationInsight["dimension"];
    label: string;
    videos: VideoMetric[];
  }>();

  const add = (dimension: CombinationInsight["dimension"], label: string, video: VideoMetric) => {
    const key = `${dimension}:${label}`;
    const current = groups.get(key) || { dimension, label, videos: [] };
    current.videos.push(video);
    groups.set(key, current);
  };

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
    const score = Math.round(groupQuality(group.videos, base));
    const confidence: CombinationInsight["confidence"] =
      sampleSize >= 15 && totalViews >= 20_000
        ? "Yüksek"
        : sampleSize >= 6 && totalViews >= 5_000
          ? "Orta"
          : "Test";
    const decision: CombinationInsight["decision"] =
      score >= 62 && confidence !== "Test"
        ? "ÖLÇEKLE"
        : score < 42 && confidence !== "Test"
          ? "DİNLENDİR"
          : "DOĞRULA";
    const viewsPerDay = average(group.videos.map(velocity));
    const interactions = sum(group.videos.map((video) =>
      video.likes + video.comments * 2 + (video.shares || 0) * 3));
    const analyticsViews = sum(group.videos.map((video) => video.analyticsViews || video.views));
    const subscribers = sum(group.videos.map((video) => Math.max(0, netSubscribers(video))));
    const engagementRate = interactions / Math.max(totalViews, 1) * 100;
    const subscribersPerThousand = subscribers / Math.max(analyticsViews, 1) * 1000;
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

  const decisionWeight = { "ÖLÇEKLE": 2, "DOĞRULA": 1, "DİNLENDİR": 0 } as const;
  const confidenceWeight = { "Yüksek": 2, "Orta": 1, "Test": 0 } as const;
  return (["Padişah", "Başlık Kalıbı", "Gün × Dönem", "Konu"] as const)
    .flatMap((dimension) => rows
      .filter((row) => row.dimension === dimension)
      .sort((left, right) =>
        decisionWeight[right.decision] - decisionWeight[left.decision] ||
        confidenceWeight[right.confidence] - confidenceWeight[left.confidence] ||
        right.score - left.score)
      .slice(0, 3));
}

export function buildShortsGrowthGoal(state: ChannelState) {
  const targetViews = 10_000_000;
  const windowDays = 90;
  const cutoff = Date.now() - (windowDays - 1) * DAY_MS;
  const reported = sum((state.shortsDaily || [])
    .filter((day) => new Date(`${day.date}T12:00:00+03:00`).getTime() >= cutoff)
    .map((day) => day.engagedViews || 0));
  const fallback = sum(state.videos
    .filter((video) => video.contentType === "SHORT" && new Date(video.publishedAt).getTime() >= cutoff)
    .map((video) => video.engagedViews || 0));
  const currentViews = reported || fallback;
  const last7 = (state.shortsDaily || []).filter((day) =>
    new Date(`${day.date}T12:00:00+03:00`).getTime() >= Date.now() - 6 * DAY_MS);
  const currentViewsPerDay = last7.length
    ? sum(last7.map((day) => day.engagedViews || 0)) / last7.length
    : sum(state.videos
      .filter((video) => video.contentType === "SHORT")
      .map((video) => video.engagedViewsLast7Days || 0)) / 7;
  const remainingViews = Math.max(0, targetViews - currentViews);
  const subscribersRemaining = Math.max(0, 1000 - state.channel.subscriberCount);
  const requiredViewsPerDay = targetViews / windowDays;
  const paceRatio = currentViewsPerDay / Math.max(requiredViewsPerDay, 1);
  return {
    targetViews,
    windowDays,
    currentViews,
    remainingViews,
    requiredViewsPerDay,
    currentViewsPerDay,
    projectedWindowViews: Math.round(currentViewsPerDay * windowDays),
    progressPercent: Math.min(100, currentViews / targetViews * 100),
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
  const base = baselines(shorts);
  const recentThreshold = Date.now() - 45 * DAY_MS;
  const groups = new Map<string, VideoMetric[]>();
  for (const video of shorts) groups.set(video.topic, [...(groups.get(video.topic) || []), video]);

  return [...groups.entries()].map(([topic, videos]) => {
    const views = sum(videos.map((video) => video.views));
    const analyticsViews = sum(videos.map((video) => video.analyticsViews || video.views));
    const subscribersPerThousand = sum(videos.map((video) => Math.max(0, netSubscribers(video)))) /
      Math.max(analyticsViews, 1) * 1000;
    const retentionValues = videos.map((video) => video.avgViewPercentage).filter((value) => value > 0);
    const recentCount = videos.filter((video) => new Date(video.publishedAt).getTime() >= recentThreshold).length;
    const score = Math.round(groupQuality(videos, base));
    let decision: TopicInsight["decision"] = "DENGELE";
    if (videos.length < 4) decision = "TEST ET";
    else if (recentCount >= 4 && score < 42) decision = "DİNLENDİR";
    else if (videos.length >= 6 && score >= 62) decision = "ÖLÇEKLE";
    return {
      topic,
      videoCount: videos.length,
      recentCount,
      averageViews: views / videos.length,
      subscribersPerThousand,
      averageRetention: average(retentionValues),
      score,
      decision,
      reason: decision === "ÖLÇEKLE"
        ? `${videos.length} videoda ${score}/100 doğrulanmış kalite üretti.`
        : decision === "DİNLENDİR"
          ? `Son 45 günde ${recentCount} kez işlendi ve kalite puanı zayıf kaldı.`
          : decision === "TEST ET"
            ? "Örnek az; farklı aktör ve sonuçla kontrollü test et."
            : "Kanal ortalamasına yakın; yeni kaynak veya karşı taraf açısıyla çeşitlendir.",
    };
  }).sort((left, right) => right.score - left.score);
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
      titles: state.videos.filter((video) => video.topic === topic.topic).slice(0, 3).map((video) => video.title),
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
      const common = [...titleTokens(first.title)].filter((token) => titleTokens(second.title).has(token));
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
    video.contentType === "SHORT" && video.views > 0 && ageDays(video) <= 120 &&
    istanbulPublishParts(video.publishedAt));
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
  const base = baselines(eligible);
  const groups = new Map<string, { dayLabel: string; time: string; videos: VideoMetric[] }>();
  for (const video of eligible) {
    const parts = istanbulPublishParts(video.publishedAt);
    if (!parts) continue;
    const key = `${parts.dayLabel}-${parts.time}`;
    const current = groups.get(key) || { dayLabel: parts.dayLabel, time: parts.time, videos: [] };
    current.videos.push(video);
    groups.set(key, current);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, score: groupQuality(group.videos, base) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 7)
    .map((group, index) => ({
      id: `observed-${index}`,
      dayLabel: group.dayLabel,
      time: group.time,
      format: "Shorts" as const,
      sampleSize: group.videos.length,
      score: Math.round(group.score),
      confidence: group.videos.length >= 12 ? "Yüksek" : group.videos.length >= 5 ? "Orta" : "Test",
      reason: `${group.videos.length} videonun güncel hızı, tutma ve dönüşümü birlikte hesaplandı.`,
    }));
}
