import "server-only";

import type { ChannelState, VideoMetric, WeeklyScheduleDay } from "./schema";
import { istanbulPublishParts, WEEKLY_OSMANLI_SCHEDULE } from "./history";

type Objective = "İzlenme" | "Abone" | "Beğeni";

const OBJECTIVES: Objective[] = ["İzlenme", "Abone", "Beğeni"];
const CANDIDATE_HOURS = [8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
const DAY_MS = 86_400_000;

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

function mean(values: number[]) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function timeLabel(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function defaultHour(day: WeeklyScheduleDay, objective: Objective) {
  const index = OBJECTIVES.indexOf(objective);
  return Number(day.shortsTimes[index]?.slice(0, 2) || [9, 15, 21][index]);
}

function launchViews(state: ChannelState, video: VideoMetric) {
  const publishedAt = new Date(video.publishedAt).getTime();
  if (!Number.isFinite(publishedAt)) return null;
  const snapshots = [...(state.snapshots || [])]
    .filter((snapshot) => snapshot.videos[video.id])
    .sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));
  if (snapshots.length < 2) return null;

  const start = snapshots.find((snapshot) =>
    new Date(snapshot.capturedAt).getTime() >= publishedAt - 30 * 60_000);
  const endCandidates = snapshots.filter((snapshot) => {
    const capturedAt = new Date(snapshot.capturedAt).getTime();
    return capturedAt > publishedAt && capturedAt <= publishedAt + 36 * 60 * 60_000;
  });
  const end = endCandidates.at(-1);
  if (!start || !end || start === end) return null;
  const elapsedHours = Math.max(
    1,
    (new Date(end.capturedAt).getTime() - new Date(start.capturedAt).getTime()) / 3_600_000,
  );
  const delta = Math.max(0, end.videos[video.id].views - start.videos[video.id].views);
  return (delta / elapsedHours) * 24;
}

function bayesianRate(successes: number, trials: number, priorRate: number, priorTrials: number) {
  return (Math.max(0, successes) + priorRate * priorTrials) /
    Math.max(1, trials + priorTrials);
}

function rawMetric(state: ChannelState, video: VideoMetric, objective: Objective, priors: Record<Objective, number>) {
  if (objective === "İzlenme") {
    const launch = launchViews(state, video);
    if (launch !== null) return launch;
    if ((video.viewsLast7Days || 0) > 0) {
      return (video.viewsLast7Days || 0) / Math.min(7, ageDays(video));
    }
    return video.views / Math.max(1, Math.min(14, ageDays(video)));
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
  const retention = video.avgViewPercentage > 0
    ? clamp(video.avgViewPercentage / 75, 0.72, 1.28)
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

function scoreCandidate(
  state: ChannelState,
  videos: VideoMetric[],
  dayLabel: string,
  hour: number,
  objective: Objective,
  baseline: number,
  fallbackHour: number,
  priors: Record<Objective, number>,
) {
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
    else if (distance <= 1) evidenceWeight = 0.15;
    if (!evidenceWeight) continue;

    const weight = evidenceWeight * recencyWeight(video) * clamp(Math.log10(video.views + 10) / 3, 0.35, 1.35);
    weightedTotal += normalizedMetric(state, video, objective, baseline, priors) * weight;
    totalWeight += weight;
    if (sameDay && distance <= 1) directSamples += 1;
  }

  const distanceFromFallback = Math.abs(hour - fallbackHour);
  const prior = distanceFromFallback === 0 ? 54 : distanceFromFallback <= 2 ? 48 : 40;
  const priorWeight = 5;
  const score = (weightedTotal + prior * priorWeight) / (totalWeight + priorWeight);
  return { hour, score, sampleSize: directSamples, evidenceWeight: totalWeight };
}

export function buildAdaptiveWeeklySchedule(state: ChannelState): WeeklyScheduleDay[] {
  const shorts = state.videos.filter((video) =>
    video.contentType === "SHORT" &&
    video.views > 0 &&
    istanbulPublishParts(video.publishedAt) &&
    ageDays(video) <= 120,
  );

  if (shorts.length < 12) {
    return WEEKLY_OSMANLI_SCHEDULE.map((day) => ({
      ...day,
      confidence: "Test" as const,
      shortSlots: day.shortsTimes.map((time, index) => ({
        time,
        objective: OBJECTIVES[index],
        score: 50,
        sampleSize: 0,
        reason: "Saat değiştirmek için yeterli erken performans örneği yok; güvenli başlangıç düzeni korunuyor.",
        change: "Test" as const,
      })),
    }));
  }

  const totalViews = Math.max(shorts.reduce((sum, video) => sum + video.views, 0), 1);
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
    const rankings = new Map<Objective, ReturnType<typeof scoreCandidate>[]>();
    for (const objective of OBJECTIVES) {
      const fallback = defaultHour(day, objective);
      const rows = CANDIDATE_HOURS.map((hour) => scoreCandidate(
        state,
        shorts,
        day.dayLabel,
        hour,
        objective,
        baselines[objective],
        fallback,
        priors,
      )).sort((left, right) => right.score - left.score);
      rankings.set(objective, rows);
    }

    let best: { rows: ReturnType<typeof scoreCandidate>[]; value: number } | undefined;
    for (const view of rankings.get("İzlenme") || []) {
      for (const subscriber of rankings.get("Abone") || []) {
        for (const like of rankings.get("Beğeni") || []) {
          const hours = [view.hour, subscriber.hour, like.hour];
          const ordered = [...hours].sort((left, right) => left - right);
          if (ordered[1] - ordered[0] < 4 || ordered[2] - ordered[1] < 4) continue;
          const stability = OBJECTIVES.reduce((sum, objective, index) =>
            sum + (hours[index] === defaultHour(day, objective) ? 6 : 0), 0);
          const directEvidence = view.sampleSize + subscriber.sampleSize + like.sampleSize;
          const evidence = view.evidenceWeight + subscriber.evidenceWeight + like.evidenceWeight;
          const value = view.score + subscriber.score + like.score + stability +
            Math.min(8, directEvidence) + Math.min(5, evidence / 2);
          if (!best || value > best.value) best = { rows: [view, subscriber, like], value };
        }
      }
    }

    const selected = best?.rows || OBJECTIVES.map((objective) =>
      rankings.get(objective)?.find((row) => row.hour === defaultHour(day, objective)) ||
      rankings.get(objective)![0]);

    const slots = selected.map((row, index) => {
      const objective = OBJECTIVES[index];
      const fallback = defaultHour(day, objective);
      const changed = row.hour !== fallback;
      const enoughEvidence = row.sampleSize >= 4 && row.evidenceWeight >= 3.5;
      return {
        time: timeLabel(row.hour),
        objective,
        score: Math.round(row.score),
        sampleSize: row.sampleSize,
        reason: enoughEvidence
          ? `${objective} amacı için aynı gün ve yakın saatteki ${row.sampleSize} doğrudan örnek, son dönem ağırlığıyla hesaplandı.`
          : `${day.dayLabel} için doğrudan kanıt sınırlı; kanal geneli ve mevcut güvenli saat birlikte kullanıldı.`,
        change: !enoughEvidence ? "Test" as const : changed ? "Değişti" as const : "Korundu" as const,
      };
    }).sort((left, right) => left.time.localeCompare(right.time));

    const directSamples = slots.reduce((sum, slot) => sum + slot.sampleSize, 0);
    return {
      ...day,
      shortsTimes: slots.map((slot) => slot.time),
      shortSlots: slots,
      evidence: `${shorts.length} son dönem Shorts; canlı hız, ilk 36 saat snapshotları, tutma, beğeni ve abone dönüşümü birlikte ölçüldü.`,
      confidence: shorts.length >= 60 && directSamples >= 18
        ? "Yüksek"
        : shorts.length >= 25 && directSamples >= 9
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