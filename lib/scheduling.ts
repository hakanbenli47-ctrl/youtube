import "server-only";

import type { ChannelState, VideoMetric, WeeklyScheduleDay } from "./schema";
import { istanbulPublishParts, WEEKLY_OSMANLI_SCHEDULE } from "./history";

type Objective = "İzlenme" | "Abone" | "Beğeni";
type ScoredSlot = {
  hour: number;
  objective: Objective;
  score: number;
  sampleSize: number;
  evidenceWeight: number;
};

const OBJECTIVES: Objective[] = ["İzlenme", "Abone", "Beğeni"];
const FIXED_SHORTS_HOURS = [9, 11, 13, 15, 17, 19];
const FIXED_SHORTS_TIMES = FIXED_SHORTS_HOURS.map((hour) => `${String(hour).padStart(2, "0")}:00`);
const DEFAULT_OBJECTIVE_SEQUENCE: Objective[] = ["İzlenme", "Abone", "Beğeni", "İzlenme", "Abone", "Beğeni"];
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

function scoreSlot(
  state: ChannelState,
  videos: VideoMetric[],
  dayLabel: string,
  hour: number,
  objective: Objective,
  baseline: number,
  priors: Record<Objective, number>,
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
    else if (distance <= 1) evidenceWeight = 0.15;
    if (!evidenceWeight) continue;

    const weight = evidenceWeight * recencyWeight(video) * clamp(Math.log10(video.views + 10) / 3, 0.35, 1.35);
    weightedTotal += normalizedMetric(state, video, objective, baseline, priors) * weight;
    totalWeight += weight;
    if (sameDay && distance <= 1) directSamples += 1;
  }

  // YouTube Analytics API, Studio'daki "izleyicileriniz ne zaman YouTube'da" ısı haritasını
  // doğrudan vermiyor. Bu nedenle gerçek kanal geçmişindeki aynı gün/saat yayınlarının
  // ilk dağıtım hızı ve kalite/dönüşüm sinyalleri aktiflik vekili olarak kullanılıyor.
  const priorScore = 50;
  const priorWeight = 4;
  const score = (weightedTotal + priorScore * priorWeight) / (totalWeight + priorWeight);
  return { hour, objective, score, sampleSize: directSamples, evidenceWeight: totalWeight };
}

function chooseBalancedObjectives(rowsByHour: ScoredSlot[][]) {
  let best: { rows: ScoredSlot[]; value: number } | undefined;

  function walk(index: number, counts: Record<Objective, number>, rows: ScoredSlot[], value: number) {
    if (index === rowsByHour.length) {
      if (OBJECTIVES.every((objective) => counts[objective] === 2) && (!best || value > best.value)) {
        best = { rows: [...rows], value };
      }
      return;
    }

    for (const row of rowsByHour[index]) {
      if (counts[row.objective] >= 2) continue;
      const stability = row.objective === DEFAULT_OBJECTIVE_SEQUENCE[index] ? 2.5 : 0;
      const evidenceBonus = Math.min(3, row.sampleSize * 0.45) + Math.min(2, row.evidenceWeight * 0.12);
      counts[row.objective] += 1;
      rows.push(row);
      walk(index + 1, counts, rows, value + row.score + stability + evidenceBonus);
      rows.pop();
      counts[row.objective] -= 1;
    }
  }

  walk(0, { İzlenme: 0, Abone: 0, Beğeni: 0 }, [], 0);
  return best?.rows || rowsByHour.map((rows, index) =>
    rows.find((row) => row.objective === DEFAULT_OBJECTIVE_SEQUENCE[index]) || rows[0]);
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
      shortsTimes: [...FIXED_SHORTS_TIMES],
      confidence: "Test" as const,
      evidence: "Yeni 6 Shorts düzeni: 09:00'dan 19:00'a kadar iki saatte bir. Veri biriktikçe her slotun içerik amacı kanal sonuçlarına göre ayarlanır.",
      shortSlots: FIXED_SHORTS_TIMES.map((time, index) => ({
        time,
        objective: DEFAULT_OBJECTIVE_SEQUENCE[index],
        score: 50,
        sampleSize: 0,
        reason: "Aynı gün/saat için yeterli kanal örneği yok; 6 videoluk güvenli başlangıç düzeni kullanılıyor.",
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
    const rowsByHour = FIXED_SHORTS_HOURS.map((hour) =>
      OBJECTIVES.map((objective) => scoreSlot(
        state,
        shorts,
        day.dayLabel,
        hour,
        objective,
        baselines[objective],
        priors,
      )));

    const selected = chooseBalancedObjectives(rowsByHour);
    const slots = selected.map((row, index) => {
      const enoughEvidence = row.sampleSize >= 3 && row.evidenceWeight >= 2.5;
      const strength = row.score >= 62 ? "güçlü" : row.score >= 52 ? "olumlu" : row.score >= 44 ? "nötr" : "zayıf";
      return {
        time: FIXED_SHORTS_TIMES[index],
        objective: row.objective,
        score: Math.round(row.score),
        sampleSize: row.sampleSize,
        reason: enoughEvidence
          ? `${day.dayLabel} ${FIXED_SHORTS_TIMES[index]} slotu ${strength}: aynı gün/saat çevresindeki ${row.sampleSize} doğrudan Shorts örneği; ilk dağıtım hızı, tutma, beğeni ve abone dönüşümü birlikte puanlandı.`
          : `${day.dayLabel} ${FIXED_SHORTS_TIMES[index]} için doğrudan örnek sınırlı; kanal geneli ve yakın saat performansı birlikte kullanıldı.`,
        change: enoughEvidence ? "Korundu" as const : "Test" as const,
      };
    });

    const directSamples = slots.reduce((sum, slot) => sum + slot.sampleSize, 0);
    const strongest = [...slots].sort((left, right) => right.score - left.score).slice(0, 2).map((slot) => slot.time).join(" ve ");
    return {
      ...day,
      shortsTimes: [...FIXED_SHORTS_TIMES],
      shortSlots: slots,
      evidence: `${shorts.length} son dönem Shorts analiz edildi. Sabit 09:00–19:00 iki saatlik düzende bu günün en güçlü veri pencereleri ${strongest || "henüz belirleniyor"}. Studio aktiflik ısı haritası API'de olmadığı için gerçek yayın sonuçları aktiflik vekili olarak kullanıldı.`,
      confidence: shorts.length >= 60 && directSamples >= 24
        ? "Yüksek"
        : shorts.length >= 25 && directSamples >= 12
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
