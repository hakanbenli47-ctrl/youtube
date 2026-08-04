import "server-only";

import type { ChannelState, VideoMetric, WeeklyScheduleDay } from "./schema";
import { istanbulPublishParts, WEEKLY_OSMANLI_SCHEDULE } from "./history";

type Objective = "İzlenme" | "Abone" | "Beğeni";

const OBJECTIVES: Objective[] = ["İzlenme", "Abone", "Beğeni"];
const CANDIDATE_HOURS = [8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];

function netSubscribers(video: VideoMetric) {
  return video.subscribersGained - video.subscribersLost;
}

function ageDays(video: VideoMetric) {
  return Math.max(1, (Date.now() - new Date(video.publishedAt).getTime()) / 86_400_000);
}

function rawMetric(video: VideoMetric, objective: Objective) {
  if (objective === "İzlenme") {
    return (video.engagedViews ?? video.views) / ageDays(video);
  }
  if (objective === "Abone") {
    return (Math.max(0, netSubscribers(video)) / Math.max(video.views, 1)) * 1000;
  }
  return (video.likes / Math.max(video.views, 1)) * 1000;
}

function mean(values: number[]) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function timeLabel(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function defaultHour(day: WeeklyScheduleDay, objective: Objective) {
  const index = OBJECTIVES.indexOf(objective);
  return Number(day.shortsTimes[index]?.slice(0, 2) || [9, 15, 21][index]);
}

function normalizedMetric(video: VideoMetric, objective: Objective, baseline: number) {
  const ratio = (rawMetric(video, objective) + baseline * 0.15) / Math.max(baseline * 1.15, 0.0001);
  const retentionFactor = Math.max(0.75, Math.min(1.2, (video.avgViewPercentage || 70) / 70));
  return Math.max(5, Math.min(100, 50 * Math.sqrt(Math.max(ratio, 0)) * retentionFactor));
}

function scoreCandidate(
  videos: VideoMetric[],
  dayLabel: string,
  hour: number,
  objective: Objective,
  baseline: number,
  fallbackHour: number,
) {
  let weightedTotal = 0;
  let totalWeight = 0;
  let directSamples = 0;

  for (const video of videos) {
    const parts = istanbulPublishParts(video.publishedAt);
    if (!parts) continue;
    const distance = Math.abs(parts.hour - hour);
    const sameDay = parts.dayLabel === dayLabel;
    let weight = 0;
    if (sameDay && distance <= 1) weight = 1;
    else if (sameDay && distance <= 2) weight = 0.55;
    else if (distance <= 1) weight = 0.22;
    if (!weight) continue;
    weightedTotal += normalizedMetric(video, objective, baseline) * weight;
    totalWeight += weight;
    if (sameDay && distance <= 1) directSamples += 1;
  }

  const distanceFromFallback = Math.abs(hour - fallbackHour);
  const prior = distanceFromFallback === 0 ? 56 : distanceFromFallback <= 2 ? 47 : 36;
  const priorWeight = 3.5;
  const score = (weightedTotal + prior * priorWeight) / (totalWeight + priorWeight);
  return { hour, score, sampleSize: directSamples, evidenceWeight: totalWeight };
}

export function buildAdaptiveWeeklySchedule(state: ChannelState): WeeklyScheduleDay[] {
  const shorts = state.videos.filter((video) => video.contentType === "SHORT" && video.views > 0 && istanbulPublishParts(video.publishedAt));
  if (shorts.length < 6) {
    return WEEKLY_OSMANLI_SCHEDULE.map((day) => ({
      ...day,
      shortSlots: day.shortsTimes.map((time, index) => ({
        time,
        objective: OBJECTIVES[index],
        score: 50,
        sampleSize: 0,
        reason: "Yeni kanal başlangıç testi; haftalık veri geldikçe saat değişebilir.",
        change: "Test" as const,
      })),
    }));
  }

  const baselines = new Map<Objective, number>();
  for (const objective of OBJECTIVES) {
    baselines.set(objective, Math.max(mean(shorts.map((video) => rawMetric(video, objective))), 0.001));
  }

  return WEEKLY_OSMANLI_SCHEDULE.map((day) => {
    const rankings = new Map<Objective, ReturnType<typeof scoreCandidate>[]>();
    for (const objective of OBJECTIVES) {
      const fallback = defaultHour(day, objective);
      const rows = CANDIDATE_HOURS.map((hour) => scoreCandidate(
        shorts,
        day.dayLabel,
        hour,
        objective,
        baselines.get(objective) || 1,
        fallback,
      )).sort((a, b) => b.score - a.score);
      rankings.set(objective, rows);
    }

    let best:
      | { rows: ReturnType<typeof scoreCandidate>[]; value: number }
      | undefined;
    for (const view of rankings.get("İzlenme") || []) {
      for (const subscriber of rankings.get("Abone") || []) {
        for (const like of rankings.get("Beğeni") || []) {
          const hours = [view.hour, subscriber.hour, like.hour];
          const ordered = [...hours].sort((a, b) => a - b);
          if (ordered[1] - ordered[0] < 3 || ordered[2] - ordered[1] < 3) continue;
          const stability = OBJECTIVES.reduce((sum, objective, index) =>
            sum + (hours[index] === defaultHour(day, objective) ? 5 : 0), 0);
          const evidence = view.evidenceWeight + subscriber.evidenceWeight + like.evidenceWeight;
          const value = view.score + subscriber.score + like.score + stability + Math.min(6, evidence);
          if (!best || value > best.value) best = { rows: [view, subscriber, like], value };
        }
      }
    }

    const selected = best?.rows || OBJECTIVES.map((objective) =>
      rankings.get(objective)?.find((row) => row.hour === defaultHour(day, objective)) || rankings.get(objective)![0]);
    const slots = selected.map((row, index) => {
      const objective = OBJECTIVES[index];
      const fallback = defaultHour(day, objective);
      const changed = row.hour !== fallback;
      const enoughEvidence = row.sampleSize >= 2 || row.evidenceWeight >= 2.5;
      return {
        time: timeLabel(row.hour),
        objective,
        score: Math.round(row.score),
        sampleSize: row.sampleSize,
        reason: enoughEvidence
          ? `${objective} amacı için ${day.dayLabel} günü ve yakın saatlerdeki kanal sonuçlarından hesaplandı.`
          : `${day.dayLabel} için veri sınırlı; kanal geneli ve güvenli başlangıç saati birlikte kullanıldı.`,
        change: !enoughEvidence ? "Test" as const : changed ? "Değişti" as const : "Korundu" as const,
      };
    }).sort((a, b) => a.time.localeCompare(b.time));

    return {
      ...day,
      shortsTimes: slots.map((slot) => slot.time),
      shortSlots: slots,
      evidence: `${shorts.length} Shorts; izlenme hızı, beğeni oranı, abone dönüşümü ve izleyici tutma birlikte ölçüldü.`,
      confidence: shorts.length >= 35 ? "Yüksek" : shorts.length >= 15 ? "Orta" : "Test",
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
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
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
