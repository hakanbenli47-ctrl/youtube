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

const OBJECTIVES: Objective[] = ["İzlenme", "Abone", "Beğeni"];
const DAY_MS = 86_400_000;

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

function netSubscribers(video: VideoMetric) {
  return video.subscribersGained - video.subscribersLost;
}

function ageDays(video: VideoMetric) {
  const published = new Date(video.publishedAt).getTime();
  if (!Number.isFinite(published)) return 365;
  return Math.max(0.25, (Date.now() - published) / DAY_MS);
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

  const startCandidates = snapshots
    .filter((snapshot) => {
      const capturedAt = new Date(snapshot.capturedAt).getTime();
      return capturedAt >= publishedAt - 30 * 60_000 && capturedAt <= publishedAt + 90 * 60_000;
    })
    .sort((left, right) =>
      Math.abs(new Date(left.capturedAt).getTime() - publishedAt) -
      Math.abs(new Date(right.capturedAt).getTime() - publishedAt));
  const start = startCandidates[0];
  if (!start) return null;

  const startTime = new Date(start.capturedAt).getTime();
  const endCandidates = snapshots.filter((snapshot) => {
    const capturedAt = new Date(snapshot.capturedAt).getTime();
    return capturedAt > startTime + 60 * 60_000 && capturedAt <= publishedAt + 24 * 60 * 60_000;
  });
  const end = endCandidates.at(-1);
  if (!end) return null;

  const elapsedHours = (new Date(end.capturedAt).getTime() - startTime) / 3_600_000;
  if (!Number.isFinite(elapsedHours) || elapsedHours < 1) return null;
  const delta = Math.max(0, end.videos[video.id].views - start.videos[video.id].views);
  return delta / elapsedHours * 24;
}

function bayesianRate(successes: number, trials: number, priorRate: number, priorTrials: number) {
  return (Math.max(0, successes) + priorRate * priorTrials) /
    Math.max(1, trials + priorTrials);
}

function recentDailyViews(video: VideoMetric) {
  const age = ageDays(video);
  if ((video.viewsLast7Days || 0) > 0) {
    return (video.viewsLast7Days || 0) / Math.max(1, Math.min(7, age));
  }
  if ((video.viewsLast28Days || 0) > 0) {
    return (video.viewsLast28Days || 0) / Math.max(1, Math.min(28, age));
  }
  if ((video.recentVelocity || 0) > 0 && age <= 8) return video.recentVelocity || 0;
  if (age <= 28) return video.views / Math.max(1, age);
  return 0;
}

function rawMetric(
  state: ChannelState,
  video: VideoMetric,
  objective: Objective,
  priors: Record<Objective, number>,
) {
  if (objective === "İzlenme") {
    const launch = launchViews(state, video);
    return launch ?? recentDailyViews(video);
  }
  if (objective === "Abone") {
    return bayesianRate(
      Math.max(0, netSubscribers(video)),
      Math.max(video.analyticsViews || video.views, 1),
      priors.Abone,
      1500,
    ) * 1000;
  }
  return bayesianRate(
    video.likes,
    Math.max(video.views, 1),
    priors.Beğeni,
    1000,
  ) * 1000;
}

function qualityFactor(video: VideoMetric) {
  const retentionValue = video.avgViewPercentage > 0 && (video.retention10Percent || 0) > 0
    ? video.avgViewPercentage * 0.65 + (video.retention10Percent || 0) * 0.35
    : video.avgViewPercentage || video.retention10Percent || 0;
  const retention = retentionValue > 0
    ? clamp(retentionValue / 75, 0.72, 1.28)
    : 1;
  const engaged = (video.engagedViewRate || 0) > 0
    ? clamp((video.engagedViewRate || 0) / 60, 0.78, 1.22)
    : 1;
  return Math.sqrt(retention * engaged);
}

function recencyWeight(video: VideoMetric) {
  return clamp(Math.exp(-ageDays(video) / 55), 0.2, 1);
}

function normalizedMetric(
  state: ChannelState,
  video: VideoMetric,
  objective: Objective,
  baseline: number,
  priors: Record<Objective, number>,
) {
  const raw = rawMetric(state, video, objective, priors);
  const ratio = (raw + baseline * 0.25) / Math.max(baseline * 1.25, 0.0001);
  return clamp(50 * Math.sqrt(Math.max(ratio, 0)) * qualityFactor(video), 5, 100);
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
  priors: Record<Objective, number>,
  studioActivity: number,
): ScoredSlot {
  let weightedTotal = 0;
  let totalWeight = 0;
  let directSamples = 0;

  for (const video of videos) {
    const parts = istanbulPublishParts(video.publishedAt);
    if (!parts) continue;
    const distance = Math.abs(parts.hour - hour);
    const sameDay = parts.dayLabel === dayLabel;
    let evidenceWeight = 0;
    if (sameDay && distance <= 1) evidenceWeight = 1;
    else if (sameDay && distance <= 2) evidenceWeight = 0.5;
    else if (distance <= 1) evidenceWeight = 0.12;
    if (!evidenceWeight) continue;

    const weight = evidenceWeight * recencyWeight(video) *
      clamp(Math.log10(video.views + 10) / 3, 0.35, 1.35);
    weightedTotal += normalizedMetric(state, video, objective, baseline, priors) * weight;
    totalWeight += weight;
    if (sameDay && distance <= 1) directSamples += 1;
  }

  const historicalScore = (weightedTotal + 50 * 4) / (totalWeight + 4);
  const score = studioActivity > 0
    ? historicalScore * 0.35 + studioActivity * 0.65
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
  return median(videos.map((video) => {
    const speed = launchViews(state, video) ?? recentDailyViews(video);
    return Math.log10(speed + 10) * 25 * qualityFactor(video);
  }));
}

function chooseDailyShortCount(state: ChannelState) {
  const cutoff = Date.now() - 70 * DAY_MS;
  const eligible = state.videos.filter((video) =>
    video.contentType === "SHORT" &&
    video.views > 0 &&
    ageDays(video) >= 2 &&
    new Date(video.publishedAt).getTime() >= cutoff);
  const byDay = new Map<string, VideoMetric[]>();
  for (const video of eligible) {
    const key = istanbulDate(video.publishedAt);
    if (!key) continue;
    byDay.set(key, [...(byDay.get(key) || []), video]);
  }

  const byCount = new Map<number, number[]>();
  for (const videos of byDay.values()) {
    const count = videos.length;
    if (count < 1 || count > 6) continue;
    const score = dailyPerformanceScore(state, videos);
    byCount.set(count, [...(byCount.get(count) || []), score]);
  }

  const two = byCount.get(2) || [];
  const three = byCount.get(3) || [];
  const twoScore = median(two);
  const threeScore = median(three);

  if (three.length >= 4 && (two.length < 3 || threeScore >= twoScore * 1.12)) return 3;
  return 2;
}

function chooseSlots(rows: ScoredSlot[], count: number) {
  const chosen: ScoredSlot[] = [];
  const usedObjectives = new Set<Objective>();
  const ranked = [...rows].sort((a, b) =>
    b.score - a.score ||
    b.activityScore - a.activityScore ||
    b.sampleSize - a.sampleSize);

  while (chosen.length < count) {
    const candidate = ranked.find((row) => {
      if (chosen.some((item) => Math.abs(item.hour - row.hour) < 3)) return false;
      if (usedObjectives.size < Math.min(count, OBJECTIVES.length) && usedObjectives.has(row.objective)) return false;
      return true;
    }) || ranked.find((row) => !chosen.some((item) => Math.abs(item.hour - row.hour) < 3));
    if (!candidate) break;
    chosen.push(candidate);
    usedObjectives.add(candidate.objective);
    for (let index = ranked.length - 1; index >= 0; index -= 1) {
      if (ranked[index].hour === candidate.hour) ranked.splice(index, 1);
    }
  }

  return chosen.sort((a, b) => a.hour - b.hour);
}

export function buildAdaptiveWeeklySchedule(state: ChannelState): WeeklyScheduleDay[] {
  const shorts = state.videos.filter((video) =>
    video.contentType === "SHORT" &&
    video.views > 0 &&
    istanbulPublishParts(video.publishedAt) &&
    ageDays(video) <= 120);

  const dailyShortCount = chooseDailyShortCount(state);
  const totalViews = Math.max(shorts.reduce((sum, video) => sum + (video.analyticsViews || video.views), 0), 1);
  const totalLikes = shorts.reduce((sum, video) => sum + video.likes, 0);
  const totalSubscribers = shorts.reduce((sum, video) => sum + Math.max(0, netSubscribers(video)), 0);
  const priors: Record<Objective, number> = {
    İzlenme: 0,
    Abone: totalSubscribers / totalViews,
    Beğeni: totalLikes / totalViews,
  };
  const baselines: Record<Objective, number> = {
    İzlenme: Math.max(median(shorts.map((video) => rawMetric(state, video, "İzlenme", priors))), 1),
    Abone: Math.max(mean(shorts.map((video) => rawMetric(state, video, "Abone", priors))), 0.001),
    Beğeni: Math.max(mean(shorts.map((video) => rawMetric(state, video, "Beğeni", priors))), 0.001),
  };

  return WEEKLY_OSMANLI_SCHEDULE.map((day) => {
    const activity = activityForDay(state, day.day);
    const hours = candidateHours(day, activity, shorts);
    const rows = hours.flatMap((hour) =>
      OBJECTIVES.map((objective) => scoreSlot(
        state,
        shorts,
        day.dayLabel,
        hour,
        objective,
        baselines[objective],
        priors,
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
      const enoughEvidence = row.sampleSize >= 3 || studioUsed;
      return {
        time,
        objective: row.objective,
        score: Math.round(row.score),
        sampleSize: row.sampleSize,
        reason: studioUsed
          ? `Studio son 28 gün aktiflik skoru ${Math.round(row.activityScore)}/100; aynı saat çevresindeki ${row.sampleSize} Shorts'un gerçek performansıyla birlikte puanlandı.`
          : `${day.dayLabel} ${time} için Studio aktiflik verisi girilmedi; kanalın aynı gün/saat performansı kullanıldı.`,
        change: enoughEvidence ? "Korundu" as const : "Test" as const,
      };
    });

    const studioAvailable = Boolean(activity?.hours?.length);
    return {
      ...day,
      shortsTimes: slots.map((slot) => slot.time),
      shortSlots: slots,
      evidence: studioAvailable
        ? `Paylaşım sayısı son dönem cannibalization verisinden ${dailyShortCount}/gün seçildi. Saatlerde Studio'nun son 28 günlük aktif izleyici verisi %65, gerçek kanal performansı %35 ağırlıkla kullanıldı.`
        : `Paylaşım sayısı son dönem performansından ${dailyShortCount}/gün seçildi. Studio aktiflik saatleri eklenene kadar gerçek yayın performansı kullanılıyor.`,
      confidence: studioAvailable && shorts.length >= 25
        ? "Yüksek"
        : shorts.length >= 25
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
