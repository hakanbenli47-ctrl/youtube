import "server-only";

import type { ChannelState, WeeklyScheduleDay } from "./schema";
import {
  buildAdaptiveWeeklySchedule as buildBaseWeeklySchedule,
  currentIstanbulWeekKey,
  nextWeeklyReviewAt,
} from "./scheduling-v2";

const DAILY_SHORTS = 4;
const MIN_GAP_HOURS = 3;

function hourOf(time: string) {
  return Number(time.slice(0, 2));
}

function uniqueSlots(day: WeeklyScheduleDay) {
  const byTime = new Map<string, NonNullable<WeeklyScheduleDay["shortSlots"]>[number]>();
  for (const slot of day.shortSlots || []) {
    const current = byTime.get(slot.time);
    if (!current || slot.score > current.score || slot.sampleSize > current.sampleSize) {
      byTime.set(slot.time, slot);
    }
  }
  return [...byTime.values()];
}

function chooseFour(day: WeeklyScheduleDay) {
  const unique = uniqueSlots(day);
  if (unique.length <= DAILY_SHORTS) {
    return [...unique].sort((a, b) => a.time.localeCompare(b.time));
  }

  // Önce kanıt + aktiflik nedeniyle seçilmiş saat puanını koru. Eşitlikte akşam
  // saatlerini öne al; kullanıcının Studio ısı haritasında akşam bandı daha güçlü.
  const ranked = [...unique].sort((a, b) => {
    const aHour = hourOf(a.time);
    const bHour = hourOf(b.time);
    const aEvening = aHour >= 18 ? 8 : aHour >= 12 ? 3 : 0;
    const bEvening = bHour >= 18 ? 8 : bHour >= 12 ? 3 : 0;
    return (b.score + bEvening) - (a.score + aEvening) || b.sampleSize - a.sampleSize;
  });

  const chosen: typeof ranked = [];
  for (const slot of ranked) {
    const hour = hourOf(slot.time);
    if (chosen.some((item) => Math.abs(hourOf(item.time) - hour) < MIN_GAP_HOURS)) continue;
    chosen.push(slot);
    if (chosen.length === DAILY_SHORTS) break;
  }

  // Nadir durumda dört saat çıkmazsa, kalan benzersiz saatlerden aralığı en çok
  // koruyanları tamamla. Aynı saat hiçbir koşulda ikinci kez eklenmez.
  if (chosen.length < DAILY_SHORTS) {
    for (const slot of ranked) {
      if (chosen.some((item) => item.time === slot.time)) continue;
      chosen.push(slot);
      if (chosen.length === DAILY_SHORTS) break;
    }
  }

  return chosen.sort((a, b) => a.time.localeCompare(b.time));
}

export function buildAdaptiveWeeklySchedule(state: ChannelState): WeeklyScheduleDay[] {
  return buildBaseWeeklySchedule(state).map((day) => {
    const slots = chooseFour(day);
    return {
      ...day,
      shortsTimes: slots.map((slot) => slot.time),
      shortSlots: slots,
      evidence: `${day.evidence} Panelde günlük 4 Shorts gösterilir; saatler benzersizdir ve mümkün olduğunca en az 3 saat arayla seçilir.`,
    };
  });
}

export { currentIstanbulWeekKey, nextWeeklyReviewAt };
