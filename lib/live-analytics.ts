import "server-only";

import type { ChannelState, MetricSnapshot, VideoMetric } from "./schema";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const THRESHOLDS = [10_000, 20_000, 50_000, 100_000] as const;

export type ThresholdForecast = {
  threshold: number;
  probability: number;
  remaining: number;
};

export type LivePoint = {
  capturedAt: string;
  views: number;
  viewsPerMinute: number;
};

export type LiveVideoAnalysis = {
  id: string;
  title: string;
  thumbnailUrl?: string;
  publishedAt: string;
  ageHours: number;
  views: number;
  viewsPerMinute: number;
  viewsPerHour: number;
  viewsPerMinute60m: number;
  viewsPerMinute6h: number;
  accelerationPercent: number;
  lastDeltaViews: number;
  lastDeltaMinutes: number;
  avgViewDurationSeconds: number;
  avgViewPercentage: number;
  engagedViewRate: number;
  likeRate: number;
  commentRate: number;
  shareRate: number;
  subscribersPerThousand: number;
  sustainProbability: number;
  momentumScore: number;
  qualityScore: number;
  status: "YÜKSELİYOR" | "STABİL" | "YAVAŞLIYOR" | "YENİ TEST";
  confidence: "YÜKSEK" | "ORTA" | "TEST";
  projected24h: number;
  projected72h: number;
  projected7d: number;
  forecastLow: number;
  forecastHigh: number;
  thresholds: ThresholdForecast[];
  history: LivePoint[];
  signal: string;
};

export type LiveAnalyticsPayload = {
  generatedAt: string;
  dataThroughDate: string | null;
  analyticsLagDays: number;
  snapshotCount: number;
  refreshEveryMinutes: number;
  summary: {
    activeVideos: number;
    liveViewsPerMinute: number;
    liveViewsPerHour: number;
    todayViews: number;
    todayNetSubscribers: number;
    bestMomentumTitle: string | null;
    bestMomentumScore: number;
    channelMedianViewsPerDay: number;
  };
  today: LiveVideoAnalysis[];
  active: LiveVideoAnalysis[];
  recent: LiveVideoAnalysis[];
  warnings: string[];
  note: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function sigmoid(value: number) {
  return 1 / (1 + Math.exp(-value));
}

function round(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function istanbulDate(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function snapshotsForVideo(snapshots: MetricSnapshot[], videoId: string) {
  return snapshots
    .filter((snapshot) => snapshot.videos[videoId])
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}

function velocityBetween(a: MetricSnapshot, b: MetricSnapshot, videoId: string) {
  const start = new Date(a.capturedAt).getTime();
  const end = new Date(b.capturedAt).getTime();
  const minutes = Math.max(0, (end - start) / MINUTE_MS);
  if (!Number.isFinite(minutes) || minutes < 0.5) return null;
  const first = a.videos[videoId]?.views ?? 0;
  const last = b.videos[videoId]?.views ?? 0;
  return {
    viewsPerMinute: Math.max(0, last - first) / minutes,
    deltaViews: Math.max(0, last - first),
    deltaMinutes: minutes,
  };
}

function windowVelocity(rows: MetricSnapshot[], videoId: string, windowMs: number) {
  if (rows.length < 2) return null;
  const latest = rows.at(-1)!;
  const latestTime = new Date(latest.capturedAt).getTime();
  const target = latestTime - windowMs;
  let anchor = rows[0];
  let bestDistance = Math.abs(new Date(anchor.capturedAt).getTime() - target);
  for (const row of rows.slice(0, -1)) {
    const distance = Math.abs(new Date(row.capturedAt).getTime() - target);
    if (distance < bestDistance) {
      anchor = row;
      bestDistance = distance;
    }
  }
  return velocityBetween(anchor, latest, videoId);
}

function latestVelocity(rows: MetricSnapshot[], videoId: string) {
  if (rows.length < 2) return null;
  const latest = rows.at(-1)!;
  for (let index = rows.length - 2; index >= 0; index -= 1) {
    const candidate = velocityBetween(rows[index], latest, videoId);
    if (candidate && candidate.deltaMinutes >= 2) return candidate;
  }
  return null;
}

function historyPoints(rows: MetricSnapshot[], videoId: string) {
  const cutoff = Date.now() - 24 * HOUR_MS;
  const recent = rows.filter((row) => new Date(row.capturedAt).getTime() >= cutoff).slice(-80);
  return recent.map((row, index) => {
    const previous = index ? recent[index - 1] : undefined;
    const velocity = previous ? velocityBetween(previous, row, videoId)?.viewsPerMinute || 0 : 0;
    return {
      capturedAt: row.capturedAt,
      views: row.videos[videoId]?.views || 0,
      viewsPerMinute: round(velocity, 2),
    };
  });
}

function qualitySignals(video: VideoMetric) {
  const retention = video.avgViewPercentage > 0
    ? clamp((video.avgViewPercentage - 45) / 50, 0, 1)
    : 0.45;
  const engaged = (video.engagedViewRate || 0) > 0
    ? clamp(((video.engagedViewRate || 0) - 40) / 40, 0, 1)
    : 0.45;
  const likeRate = video.likes / Math.max(video.views, 1);
  const commentRate = video.comments / Math.max(video.views, 1);
  const shareRate = (video.shares || 0) / Math.max(video.views, 1);
  const interaction = clamp((likeRate + commentRate * 2 + shareRate * 3) / 0.065, 0, 1);
  const qualityScore = (retention * 0.48 + engaged * 0.32 + interaction * 0.2) * 100;
  return { retention, engaged, interaction, qualityScore, likeRate, commentRate, shareRate };
}

function statusFor(ageHours: number, acceleration: number, vpm: number) {
  if (ageHours < 2 || vpm <= 0) return "YENİ TEST" as const;
  if (acceleration >= 1.22 && vpm >= 0.12) return "YÜKSELİYOR" as const;
  if (acceleration <= 0.62) return "YAVAŞLIYOR" as const;
  return "STABİL" as const;
}

function thresholdProbability(
  currentViews: number,
  threshold: number,
  potential: number,
  sustainProbability: number,
  acceleration: number,
  confidenceWeight: number,
) {
  if (currentViews >= threshold) return 100;
  const ratio = Math.max(0.001, potential / threshold);
  const progress = clamp(currentViews / threshold, 0, 1);
  const sustain = (sustainProbability - 50) / 50;
  const momentum = Math.log(Math.max(0.25, acceleration));
  const logit = Math.log(ratio) * 2.75 + progress * 1.1 + sustain * 0.95 + momentum * 0.45;
  const raw = sigmoid(logit) * 100;
  const conservative = 50 + (raw - 50) * confidenceWeight;
  return Math.round(clamp(conservative, 1, 98));
}

function buildVideoAnalysis(
  state: ChannelState,
  video: VideoMetric,
  channelMedianViewsPerDay: number,
): LiveVideoAnalysis {
  const rows = snapshotsForVideo(state.snapshots || [], video.id);
  const latest = latestVelocity(rows, video.id);
  const hour = windowVelocity(rows, video.id, HOUR_MS);
  const sixHour = windowVelocity(rows, video.id, 6 * HOUR_MS);
  const fallbackVpm = Math.max(0, video.recentVelocity || 0) / 1440;
  const vpm = latest?.viewsPerMinute ?? hour?.viewsPerMinute ?? fallbackVpm;
  const vpm60 = hour?.viewsPerMinute ?? vpm;
  const vpm6h = sixHour?.viewsPerMinute ?? vpm60;
  const acceleration = vpm6h > 0.001 ? clamp(vpm / vpm6h, 0.15, 4) : vpm > 0 ? 1.35 : 0.5;
  const published = new Date(video.publishedAt).getTime();
  const ageHours = Math.max(0.1, Number.isFinite(published) ? (Date.now() - published) / HOUR_MS : 24);
  const quality = qualitySignals(video);
  const velocityDaily = vpm * 1440;
  const velocityRelative = clamp(
    Math.log10(1 + velocityDaily) / Math.log10(1 + Math.max(channelMedianViewsPerDay, 100)),
    0,
    1.6,
  );
  const accelerationScore = clamp((Math.log(Math.max(acceleration, 0.2)) + 1.4) / 2.4, 0, 1);
  const velocityScore = clamp(velocityRelative / 1.25, 0, 1);
  const sustainProbability = Math.round(clamp(
    (quality.retention * 0.31 +
      quality.engaged * 0.23 +
      quality.interaction * 0.12 +
      accelerationScore * 0.19 +
      velocityScore * 0.15) * 100,
    3,
    97,
  ));
  const momentumScore = Math.round(clamp(
    (accelerationScore * 0.4 + velocityScore * 0.35 + quality.qualityScore / 100 * 0.25) * 100,
    0,
    100,
  ));

  const blendedVpm = Math.max(0,
    vpm * 0.55 +
    vpm60 * 0.3 +
    vpm6h * 0.15,
  );
  const ageDecay = ageHours <= 6 ? 0.82 : ageHours <= 24 ? 0.66 : ageHours <= 72 ? 0.46 : 0.28;
  const momentumMultiplier = clamp(0.72 + acceleration * 0.28, 0.55, 1.55);
  const qualityMultiplier = clamp(0.72 + quality.qualityScore / 100 * 0.52, 0.72, 1.24);
  const effectiveVpm = blendedVpm * ageDecay * momentumMultiplier * qualityMultiplier;
  const currentViews = video.views;
  const projected24h = Math.round(currentViews + effectiveVpm * 60 * Math.min(24, Math.max(4, 24 - Math.min(ageHours, 20))));
  const projected72h = Math.round(currentViews + effectiveVpm * 60 * 72 * 0.72);
  const projected7d = Math.round(currentViews + effectiveVpm * 60 * 24 * 7 * 0.43);
  const historicalFloor = Math.round(currentViews + Math.max(video.recentVelocity || 0, 0) * Math.max(1, 7 - ageHours / 24));
  const potential = Math.max(projected72h, projected7d, historicalFloor, currentViews);

  const hasRetention = video.avgViewPercentage > 0 || (video.engagedViewRate || 0) > 0;
  const confidence = rows.length >= 5 && hasRetention
    ? "YÜKSEK" as const
    : rows.length >= 2 || hasRetention
      ? "ORTA" as const
      : "TEST" as const;
  const confidenceWeight = confidence === "YÜKSEK" ? 0.94 : confidence === "ORTA" ? 0.72 : 0.48;
  const thresholds = THRESHOLDS.map((threshold) => ({
    threshold,
    probability: thresholdProbability(currentViews, threshold, potential, sustainProbability, acceleration, confidenceWeight),
    remaining: Math.max(0, threshold - currentViews),
  }));
  const spread = confidence === "YÜKSEK" ? 0.3 : confidence === "ORTA" ? 0.45 : 0.62;
  const forecastLow = Math.max(currentViews, Math.round(potential * (1 - spread)));
  const forecastHigh = Math.max(currentViews, Math.round(potential * (1 + spread)));
  const status = statusFor(ageHours, acceleration, vpm);
  const signal = status === "YÜKSELİYOR"
    ? `Dağıtım hızı son ölçümlerde güçleniyor; 6 saatlik hıza göre yaklaşık %${Math.round((acceleration - 1) * 100)} yukarıda.`
    : status === "YAVAŞLIYOR"
      ? "Dağıtım hızı zayıflıyor; yeni bir ikinci dağıtım dalgası gelmezse tahmin aralığının alt tarafı daha olası."
      : status === "STABİL"
        ? "Dağıtım şu an dengeli; tutma ve etkileşim sinyali sonraki sıçramayı belirleyecek."
        : "Video henüz erken test aşamasında; birkaç canlı snapshot daha geldikçe tahmin daralacak.";

  return {
    id: video.id,
    title: video.title,
    thumbnailUrl: video.thumbnailUrl,
    publishedAt: video.publishedAt,
    ageHours: round(ageHours, 1),
    views: currentViews,
    viewsPerMinute: round(vpm, 2),
    viewsPerHour: Math.round(vpm * 60),
    viewsPerMinute60m: round(vpm60, 2),
    viewsPerMinute6h: round(vpm6h, 2),
    accelerationPercent: Math.round((acceleration - 1) * 100),
    lastDeltaViews: latest?.deltaViews || 0,
    lastDeltaMinutes: round(latest?.deltaMinutes || 0, 1),
    avgViewDurationSeconds: round(video.avgViewDurationSeconds || 0, 1),
    avgViewPercentage: round(video.avgViewPercentage || 0, 1),
    engagedViewRate: round(video.engagedViewRate || 0, 1),
    likeRate: round(quality.likeRate * 100, 2),
    commentRate: round(quality.commentRate * 100, 2),
    shareRate: round(quality.shareRate * 100, 2),
    subscribersPerThousand: round(((video.subscribersGained - video.subscribersLost) / Math.max(video.views, 1)) * 1000, 2),
    sustainProbability,
    momentumScore,
    qualityScore: Math.round(quality.qualityScore),
    status,
    confidence,
    projected24h,
    projected72h,
    projected7d,
    forecastLow,
    forecastHigh,
    thresholds,
    history: historyPoints(rows, video.id),
    signal,
  };
}

export function buildLiveAnalytics(state: ChannelState): LiveAnalyticsPayload {
  const shorts = state.videos.filter((video) => video.contentType === "SHORT" && video.views >= 0);
  const recentShorts = shorts.filter((video) => {
    const published = new Date(video.publishedAt).getTime();
    return Number.isFinite(published) && Date.now() - published <= 14 * DAY_MS;
  });
  const channelMedianViewsPerDay = Math.max(1, median(
    recentShorts
      .map((video) => video.recentVelocity || 0)
      .filter((value) => value > 0),
  ));
  const analyses = recentShorts
    .map((video) => buildVideoAnalysis(state, video, channelMedianViewsPerDay))
    .sort((a, b) => b.momentumScore - a.momentumScore || b.viewsPerMinute - a.viewsPerMinute);
  const active = analyses.filter((item) => item.ageHours <= 7 * 24).slice(0, 16);
  const todayKey = istanbulDate(new Date());
  const today = analyses
    .filter((item) => istanbulDate(item.publishedAt) === todayKey)
    .sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime());
  const todayMetric = state.daily.find((day) => day.date === todayKey) || state.daily.at(-1);
  const best = active[0];
  const liveViewsPerMinute = mean(active.slice(0, 8).map((item) => item.viewsPerMinute));

  return {
    generatedAt: new Date().toISOString(),
    dataThroughDate: state.sync.dataThroughDate || null,
    analyticsLagDays: state.sync.analyticsLagDays || 0,
    snapshotCount: state.snapshots?.length || 0,
    refreshEveryMinutes: Math.max(2, Number(process.env.YOUTUBE_PUBLIC_SYNC_INTERVAL_MINUTES || 2)),
    summary: {
      activeVideos: active.length,
      liveViewsPerMinute: round(liveViewsPerMinute, 2),
      liveViewsPerHour: Math.round(liveViewsPerMinute * 60),
      todayViews: todayMetric?.views || 0,
      todayNetSubscribers: todayMetric ? todayMetric.subscribersGained - todayMetric.subscribersLost : 0,
      bestMomentumTitle: best?.title || null,
      bestMomentumScore: best?.momentumScore || 0,
      channelMedianViewsPerDay: Math.round(channelMedianViewsPerDay),
    },
    today,
    active,
    recent: analyses.slice(0, 24),
    warnings: [...(state.sync.warnings || [])],
    note: "Eşik yüzdeleri kesin YouTube olasılığı değildir; kanalın canlı izlenme hızı, hızlanma/yavaşlama, izleyici tutma, etkileşim ve geçmiş performans sinyallerinden üretilen model tahminidir. Snapshot arttıkça güven seviyesi yükselir.",
  };
}
