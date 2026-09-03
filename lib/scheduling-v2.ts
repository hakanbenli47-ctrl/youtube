import "server-only";

import type { AudienceActivityDay, ChannelState, VideoMetric, WeeklyScheduleDay } from "./schema";
import { istanbulPublishParts, WEEKLY_OSMANLI_SCHEDULE } from "./history";

type Objective = "İzlenme" | "Abone" | "Beğeni";

type ScoredSlot = {
  hour: number;
  objective: Objective;
  score: number;
  sampleSize: number;
  evidenceWeight: number;
  activityScore: number;
};

type DailyCountEvidence = {
  date: string;
  count: number;
  score: number;
};

const OBJECTIVES: Objective[] = ["İzlenme", "Abone", "Beğeni"];
const DAY_MS = 86_400_000;
const BASE_DAILY_SHORTS = 4;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function mean(values: number[]) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function ageDays(video: VideoMetric) {
  const published = new Date(video.publishedAt).getTime();
  if (!Number.isFinite(published)) return 365;
  return Math.max(0.25, (Date.now() - published) / DAY_MS);
}

function netSubscribers(video: VideoMetric) {
  return video.subscribersGained - video.subscribersLost;
}

function istanbulDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
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

function launchViews(state: ChannelState, video: VideoMetric) {
  const publishedAt = new Date(video.publishedAt).getTime();
  if (!Number.isFinite(publishedAt)) return null;
  const snapshots = [...(state.snapshots || [])]
    .filter((snapshot) => snapshot.videos[video.id])
    .sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));
  if (snapshots.length < 2) return null;

  const start = snapshots
    .filter((snapshot) => {
      const capturedAt = new Date(snapshot.capturedAt).getTime();
      return capturedAt >= publishedAt - 30 * 60_000 && capturedAt <= publishedAt + 90 * 60_000;
    })
    .sort((left, right) =>
      Math.abs(new Date(left.capturedAt).getTime() - publishedAt) -
      Math.abs(new Date(right.capturedAt).getTime() - publishedAt))[0];
  if (!start) return null;

  const startTime = new Date(start.capturedAt).getTime();
  const end = snapshots
    .filter((snapshot) => {
      const capturedAt = new Date(snapshot.capturedAt).getTime();
      return capturedAt > startTime + 60 * 60_000 && capturedAt <= publishedAt + 24 * 60 * 60_000;
    })
    .at(-1);
  if (!end) return null;

  const elapsedHours = (new Date(end.capturedAt).getTime() - startTime) / 3_600_000;
  if (!Number.isFinite(elapsedHours) || elapsedHours < 1) return null;
  const delta = Math.max(0, end.videos[video.id].views - start.videos[video.id].views);
  return delta / elapsedHours * 24;
}

function lifetimeReach(video: VideoMetric) {
  return Math.log10(Math.max(10, video.views + 10)) * 25;
}

function viewSignal(state: ChannelState, video: VideoMetric) {
  const launch = launchViews(state, video);
  if (launch !== null) return Math.log10(launch + 10) * 28;
  return lifetimeReach(video);
}

function retentionSignal(video: VideoMetric) {
  const average = video.avgViewPercentage || 0;
  const early = video.retention10Percent || 0;
  if (average > 0 && early > 0) return average * 0.65 + early * 0.35;
  return average || early || 60;
}

function subscriberSignal(video: VideoMetric) {
  const denominator = Math.max(video.analyticsViews || video.views, 1);
  return Math.max(0, netSubscribers(video)) / denominator * 1000;
}

function likeSignal(video: VideoMetric) {
  return video.likes / Math.max(video.views, 1) * 1000;
}

function recencyWeight(video: VideoMetric) {
  const age = ageDays(video);
  if (age <= 30) return 1;
  if (age <= 90) return 0.82;
  if (age <= 180) return 0.62;
  if (age <= 365) return 0.42;
  return 0.25;
}

function performanceConfidenceWeight(video: VideoMetric) {
  const viewsWeight = clamp(Math.log10(video.views + 10) / 4, 0.35, 1.2);
  return recencyWeight(video) * viewsWeight;
}

function normalized(value: number, baseline: number) {
  if (baseline <= 0) return 50;
  return clamp(50 * Math.sqrt(Math.max(0, value / baseline)), 8, 100);
}

function objectiveValue(state: ChannelState, video: VideoMetric, objective: Objective) {
  if (objective === "İzlenme") return viewSignal(state, video);
  if (objective === "Abone") return subscriberSignal(video);
  return likeSignal(video);
}

function qualityFactor(video: VideoMetric) {
  const retention = clamp(retentionSignal(video) / 75, 0.72, 1.3);
  const engaged = (video.engagedViewRate || 0) > 0
    ? clamp((video.engagedViewRate || 0) / 60, 0.78, 1.22)
    : 1;
  return Math.sqrt(retention * engaged);
}

function activityForDay(state: ChannelState, day: number) {
  return (state.audienceActivity || []).find((item) => item.day === day);
}

function activityScore(day: AudienceActivityDay | undefined, hour: number) {
  if (!day?.hours?.length) return 0;
  let best = 0;
  for (const row of day.hours) {
    const distance = Math.abs(row.hour - hour);
    if (distance > 2) continue;
    const distanceWeight = distance === 0 ? 1 : distance === 1 ? 0.72 : 0.4;
    best = Math.max(best, clamp(row.score, 0, 100) * distanceWeight);
  }
  return best;
}

function scoreSlot(
  state: ChannelState,
  videos: VideoMetric[],
  dayLabel: string,
  hour: number,
  objective: Objective,
  baseline: number,
  studioActivity: number,
): ScoredSlot {
  let weightedTotal = 0;
  let totalWeight = 0;
  let directSamples = 0;

  for (const video of videos) {
    const parts = istanbulPublishParts(video.publishedAt);
    if (!parts) continue;

    const sameDay = parts.dayLabel === dayLabel;
    const distance = Math.abs(parts.hour - hour);
    let proximity = 0;
    if (sameDay && distance === 0) proximity = 1;
    else if (sameDay && distance === 1) proximity = 0.78;
    else if (sameDay && distance === 2) proximity = 0.48;
    else if (distance === 0) proximity = 0.08;
    if (!proximity) continue;

    const weight = proximity * performanceConfidenceWeight(video);
    const metricScore = normalized(objectiveValue(state, video, objective), baseline) * qualityFactor(video);
    weightedTotal += metricScore * weight;
    totalWeight += weight;
    if (sameDay && distance <= 1) directSamples += 1;
  }

  const historicalScore = (weightedTotal + 50 * 3) / (totalWeight + 3);

  // Çok veri olan gün/saatlerde kanalın kendi geçmişi daha ağır basar.
  const historyWeight = directSamples >= 8
    ? 0.6
    : directSamples >= 5
      ? 0.55
      : directSamples >= 3
        ? 0.45
        : 0.35;
  const score = studioActivity > 0
    ? historicalScore * historyWeight + studioActivity * (1 - historyWeight)
    : historicalScore;

  return {
    hour,
    objective,
    score,
    sampleSize: directSamples,
    evidenceWeight: totalWeight,
    activityScore: studioActivity,
  };
}

function candidateHours(day: WeeklyScheduleDay, activity: AudienceActivityDay | undefined, videos: VideoMetric[]) {
  const hours = new Set<number>();
  for (const item of activity?.hours || []) {
    if (item.score > 0 && item.hour >= 6 && item.hour <= 23) hours.add(Math.round(item.hour));
  }
  for (const time of day.shortsTimes) {
    const hour = Number(time.slice(0, 2));
    if (Number.isFinite(hour)) hours.add(hour);
  }
  for (const video of videos) {
    const parts = istanbulPublishParts(video.publishedAt);
    if (parts?.dayLabel === day.dayLabel) hours.add(parts.hour);
  }
  return [...hours].filter((hour) => hour >= 6 && hour <= 23).sort((a, b) => a - b);
}

function dailyPerformanceScore(state: ChannelState, videos: VideoMetric[]) {
  if (!videos.length) return 0;
  const perVideoScores = videos.map((video) => {
    const reach = viewSignal(state, video);
    const retention = retentionSignal(video);
    const subscriber = subscriberSignal(video);
    const likes = likeSignal(video);
    return reach * 0.55 + retention * 0.25 + Math.min(100, subscriber * 8) * 0.12 + Math.min(100, likes * 1.5) * 0.08;
  });
  const perVideo = median(perVideoScores);
  const dailyOutput = perVideoScores.reduce((total, value) => total + value, 0) /
    Math.sqrt(Math.max(1, videos.length));
  return perVideo * 0.75 + dailyOutput * 0.25;
}

function evidenceRecencyWeight(date: string) {
  const time = new Date(`${date}T12:00:00+03:00`).getTime();
  if (!Number.isFinite(time)) return 0.2;
  const daysAgo = Math.max(0, (Date.now() - time) / DAY_MS);
  if (daysAgo <= 30) return 1;
  if (daysAgo <= 90) return 0.8;
  if (daysAgo <= 180) return 0.58;
  if (daysAgo <= 365) return 0.4;
  return 0.22;
}

function weightedEvidenceScore(rows: DailyCountEvidence[]) {
  if (!rows.length) return 0;
  let weighted = 0;
  let totalWeight = 0;
  for (const row of rows) {
    const weight = evidenceRecencyWeight(row.date);
    weighted += row.score * weight;
    totalWeight += weight;
  }
  return totalWeight ? weighted / totalWeight : 0;
}

function chooseDailyShortCount(state: ChannelState) {
  // 4/gün mevcut çalışma düzeni. Tüm geçmiş yalnızca 3 veya 5'e geçmek için kanıt sağlar.
  const eligible = state.videos.filter((video) =>
    video.contentType === "SHORT" &&
    video.views > 0 &&
    ageDays(video) >= 2);

  const byDay = new Map<string, VideoMetric[]>();
  for (const video of eligible) {
    const key = istanbulDate(video.publishedAt);
    if (!key) continue;
    byDay.set(key, [...(byDay.get(key) || []), video]);
  }

  const evidence: DailyCountEvidence[] = [];
  for (const [date, videos] of byDay.entries()) {
    if (videos.length < 1 || videos.length > 6) continue;
    evidence.push({ date, count: videos.length, score: dailyPerformanceScore(state, videos) });
  }

  const baseRows = evidence.filter((row) => row.count === BASE_DAILY_SHORTS);
  if (baseRows.length < 3) return BASE_DAILY_SHORTS;
  const baseScore = weightedEvidenceScore(baseRows);

  const candidates = [
    { count: 3, requiredLift: 1.12 },
    { count: 5, requiredLift: 1.1 },
  ];
  let selected = BASE_DAILY_SHORTS;
  let selectedScore = baseScore;

  for (const candidate of candidates) {
    const rows = evidence.filter((row) => row.count === candidate.count);
    if (rows.length < 4) continue;
    const score = weightedEvidenceScore(rows);
    if (score >= baseScore * candidate.requiredLift && score > selectedScore) {
      selected = candidate.count;
      selectedScore = score;
    }
  }

  return selected;
}

function chooseSlots(rows: ScoredSlot[], count: number) {
  const ranked = [...rows].sort((left, right) =>
    right.score - left.score ||
    right.activityScore - left.activityScore ||
    right.sampleSize - left.sampleSize);
  const chosen: ScoredSlot[] = [];
  const usedObjectives = new Set<Objective>();

  while (chosen.length < count) {
    const preferNewObjective = usedObjectives.size < OBJECTIVES.length;
    const candidate = ranked.find((row) => {
      if (chosen.some((item) => Math.abs(item.hour - row.hour) < 3)) return false;
      if (preferNewObjective && usedObjectives.has(row.objective)) return false;
      return true;
    }) || ranked.find((row) => !chosen.some((item) => Math.abs(item.hour - row.hour) < 3));
    if (!candidate) break;

    chosen.push(candidate);
    usedObjectives.add(candidate.objective);
    for (let index = ranked.length - 1; index >= 0; index -= 1) {
      if (ranked[index].hour === candidate.hour) ranked.splice(index, 1);
    }
  }

  return chosen.sort((left, right) => left.hour - right.hour);
}

export function buildAdaptiveWeeklySchedule(state: ChannelState): WeeklyScheduleDay[] {
  // Gün/saat modeli, kanalın sahip olduğu tüm Shorts geçmişini kullanır.
  const shorts = state.videos.filter((video) =>
    video.contentType === "SHORT" &&
    video.views > 0 &&
    Boolean(istanbulPublishParts(video.publishedAt)));

  const dailyShortCount = chooseDailyShortCount(state);
  const viewBaseline = Math.max(median(shorts.map((video) => viewSignal(state, video))), 1);
  const subscriberBaseline = Math.max(mean(shorts.map(subscriberSignal)), 0.001);
  const likeBaseline = Math.max(mean(shorts.map(likeSignal)), 0.001);
  const baselines: Record<Objective, number> = {
    İzlenme: viewBaseline,
    Abone: subscriberBaseline,
    Beğeni: likeBaseline,
  };

  return WEEKLY_OSMANLI_SCHEDULE.map((day) => {
    const activity = activityForDay(state, day.day);
    const hours = candidateHours(day, activity, shorts);
    const rows = hours.flatMap((hour) => OBJECTIVES.map((objective) => scoreSlot(
      state,
      shorts,
      day.dayLabel,
      hour,
      objective,
      baselines[objective],
      activityScore(activity, hour),
    )));

    const selected = chooseSlots(rows, dailyShortCount);
    const fallbackHours = day.shortsTimes
      .slice(0, dailyShortCount)
      .map((time) => Number(time.slice(0, 2)))
      .filter(Number.isFinite);
    const finalRows = selected.length === dailyShortCount
      ? selected
      : fallbackHours.map((hour, index) => ({
          hour,
          objective: OBJECTIVES[index % OBJECTIVES.length],
          score: 50,
          sampleSize: 0,
          evidenceWeight: 0,
          activityScore: activityScore(activity, hour),
        }));

    const slots = finalRows.map((row) => {
      const time = `${String(row.hour).padStart(2, "0")}:00`;
      const studioUsed = row.activityScore > 0;
      return {
        time,
        objective: row.objective,
        score: Math.round(row.score),
        sampleSize: row.sampleSize,
        reason: studioUsed
          ? `${day.dayLabel} ${time}: tüm Shorts geçmişindeki aynı gün/saat sonuçları ile Studio son 28 günlük aktiflik skoru ${Math.round(row.activityScore)}/100 birlikte hesaplandı. Bu saate yakın ${row.sampleSize} doğrudan yayın örneği var.`
          : `${day.dayLabel} ${time}: Studio aktiflik verisi olmadığı için kanalın tüm geçmiş yayın sonuçları kullanıldı.`,
        change: row.sampleSize >= 3 || studioUsed ? "Korundu" as const : "Test" as const,
      };
    });

    const studioAvailable = Boolean(activity?.hours?.length);
    return {
      ...day,
      shortsTimes: slots.map((slot) => slot.time),
      shortSlots: slots,
      evidence: studioAvailable
        ? `${shorts.length} Shorts'un tamamı analiz edildi. Eski videolar daha düşük, yeni videolar daha yüksek ağırlık aldı. Günlük başlangıç düzeni 4 Shorts; yalnızca 3 veya 5 içerikli günler belirgin üstünlük gösterirse değişir. Saatlerde yeterli geçmiş örneği varsa kanal performansı %55-60'a kadar, Studio aktif izleyici sinyali kalan ağırlıkla kullanılır.`
        : `${shorts.length} Shorts'un tamamı analiz edildi. Günlük başlangıç düzeni 4 Shorts; saatler tüm geçmiş yayın performansından seçiliyor.`,
      confidence: shorts.length >= 80 && studioAvailable
        ? "Yüksek"
        : shorts.length >= 30
          ? "Orta"
          : "Test",
    };
  });
}

export function currentIstanbulWeekKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  const date = new Date(`${value("year")}-${value("month")}-${value("day")}T12:00:00+03:00`);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return date.toISOString().slice(0, 10);
}

export function nextWeeklyReviewAt() {
  const monday = new Date(`${currentIstanbulWeekKey()}T00:00:00+03:00`);
  monday.setDate(monday.getDate() + 7);
  return monday.toISOString();
}
