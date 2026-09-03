import "server-only";

import type { ChannelState, WeeklyScheduleDay } from "./schema";
import {
  buildAdaptiveWeeklySchedule as buildBaseWeeklySchedule,
  currentIstanbulWeekKey,
  nextWeeklyReviewAt,
} from "./scheduling-v2";

const DAILY_SHORTS = 4;
const MIN_GAP_HOURS = 3;
const OBJECTIVES = ["İzlenme", "Abone", "Beğeni", "İzlenme"] as const;

type Slot = NonNullable<WeeklyScheduleDay["shortSlots"]>[number];

function hourOf(time: string) {
  return Number(time.slice(0, 2));
}

function uniqueSlots(day: WeeklyScheduleDay) {
  const byTime = new Map<string, Slot>();
  for (const slot of day.shortSlots || []) {
    const current = byTime.get(slot.time);
    if (!current || slot.score > current.score || slot.sampleSize > current.sampleSize) {
      byTime.set(slot.time, slot);
    }
  }
  return [...byTime.values()];
}

function rankedExisting(day: WeeklyScheduleDay) {
  return uniqueSlots(day).sort((a, b) => {
    const aHour = hourOf(a.time);
    const bHour = hourOf(b.time);
    const aAudienceBias = aHour >= 18 ? 8 : aHour >= 12 ? 3 : 0;
    const bAudienceBias = bHour >= 18 ? 8 : bHour >= 12 ? 3 : 0;
    return (b.score + bAudienceBias) - (a.score + aAudienceBias) || b.sampleSize - a.sampleSize;
  });
}

function canAdd(chosen: Slot[], hour: number) {
  return !chosen.some((item) => Math.abs(hourOf(item.time) - hour) < MIN_GAP_HOURS);
}

function chooseFour(state: ChannelState, day: WeeklyScheduleDay) {
  const ranked = rankedExisting(day);
  const chosen: Slot[] = [];

  for (const slot of ranked) {
    if (!canAdd(chosen, hourOf(slot.time))) continue;
    chosen.push(slot);
    if (chosen.length === DAILY_SHORTS) break;
  }

  // Temel model 3 saat seçmişse, eksik saatleri doğrudan kullanıcının Studio
  // son-28-gün ısı haritasından tamamla. En aktif saatler önce gelir.
  if (chosen.length < DAILY_SHORTS) {
    const activity = (state.audienceActivity || []).find((item) => item.day === day.day);
    const activityHours = [...(activity?.hours || [])]
      .filter((item) => item.hour >= 6 && item.hour <= 23 && item.score > 0)
      .sort((a, b) => b.score - a.score || b.hour - a.hour);

    for (const item of activityHours) {
      const time = `${String(item.hour).padStart(2, "0")}:00`;
      if (chosen.some((slot) => slot.time === time)) continue;
      if (!canAdd(chosen, item.hour)) continue;
      const index = chosen.length;
      chosen.push({
        time,
        objective: OBJECTIVES[index],
        score: Math.round(item.score),
        sampleSize: 0,
        reason: `${day.dayLabel} ${time}: eksik yayın penceresi Studio son 28 günlük aktif izleyici haritasındaki ${Math.round(item.score)}/100 yoğunluk sinyalinden tamamlandı.`,
        change: "Test",
      });
      if (chosen.length === DAILY_SHORTS) break;
    }
  }

  // Dört pencereye ulaşmak için zorunlu kalınırsa aralık şartını gevşet, ancak
  // aynı saati asla ikinci kez ekleme.
  if (chosen.length < DAILY_SHORTS) {
    for (const slot of ranked) {
      if (chosen.some((item) => item.time === slot.time)) continue;
      chosen.push(slot);
      if (chosen.length === DAILY_SHORTS) break;
    }
  }

  return chosen
    .slice(0, DAILY_SHORTS)
    .sort((a, b) => a.time.localeCompare(b.time));
}

export function buildAdaptiveWeeklySchedule(state: ChannelState): WeeklyScheduleDay[] {
  return buildBaseWeeklySchedule(state).map((day) => {
    const slots = chooseFour(state, day);
    return {
      ...day,
      shortsTimes: slots.map((slot) => slot.time),
      shortSlots: slots,
      evidence: `${day.evidence} Panelde günlük tam 4 Shorts gösterilir; saatler benzersizdir ve mümkün olduğunca en az 3 saat arayla seçilir. Studio ısı haritasındaki güçlü akşam saatleri eşit puanlı daha zayıf saatlere göre önceliklidir.`,
    };
  });
}

export { currentIstanbulWeekKey, nextWeeklyReviewAt };
