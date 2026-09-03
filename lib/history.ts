import "server-only";

import type { WeeklyScheduleDay } from "./schema";

const TOPIC_RULES: Array<[string, RegExp]> = [
  ["Ölüm & Miras", /ölüm|öldü|öldür|zehir|son gün|cenaze|naaş|saklandı/],
  ["Taht & Hanedan", /taht|şehzade|oğl|kardeş|isyan|veraset|evlilik|hanedan|cem sultan/],
  ["Fetih & Savaş", /fetih|fethet|savaş|zafer|kale|kuşatma|sefer|muharebe|haliç|pelekanon|çaldıran|mohaç|kosova|ankara savaşı/],
  ["Kurumlar & Ordu", /ordu|yeniçeri|tımar|divan|sadrazam|nizam-ı cedid|donanma|kapıkulu|devşirme|vakıf/],
  ["Saray & Gündelik Hayat", /saray|otağ|şiir|alışkanlık|altın|çarşı|kahve|sofra|kıyafet|gündelik|eğitim/],
  ["Diplomasi & İttifaklar", /bizans|venedik|avrupa|elçi|antlaşma|ittifak|imtiyaz|kapitülasyon|diplomasi/],
  ["Padişahların Kararları", /osman gazi|orhan gazi|murad|bayezid|mehmed|fatih|yavuz|kanuni|selim|süleyman|ahmed|mustafa|mahmud|abdül/],
];

const RULER_RULES: Array<[string, RegExp]> = [
  ["Osman Gazi", /osman gazi/i],
  ["Orhan Gazi", /orhan gazi|orhangazi/i],
  ["I. Murad", /i\.? murad|murad hüdavendigâr|sultan murad/i],
  ["Yıldırım Bayezid", /yıldırım|bayezid/i],
  ["Çelebi Mehmed", /çelebi mehmed|i\.? mehmed/i],
  ["II. Murad", /ii\.? murad/i],
  ["Fatih Sultan Mehmed", /fatih|ii\.? mehmed/i],
  ["Yavuz Sultan Selim", /yavuz|i\.? selim/i],
  ["Kanuni Sultan Süleyman", /kanuni|süleyman/i],
  ["II. Selim", /ii\.? selim/i],
  ["III. Murad", /iii\.? murad/i],
  ["II. Mahmud", /ii\.? mahmud/i],
  ["II. Abdülhamid", /abdülhamid/i],
];

const STOP_WORDS = new Set([
  "acaba", "ama", "artık", "asıl", "aslında", "bile", "bir", "bize", "bunu", "bu",
  "da", "daha", "de", "diye", "en", "gerçek", "hakkında", "ile", "için", "kadar",
  "karşı", "kim", "mı", "mi", "mu", "mü", "nasıl", "neden", "ne", "olan", "olarak",
  "oldu", "son", "tarih", "tarihi", "tarihinde", "ve", "veya", "video", "yıl", "yıllık",
  "yüzyıl", "şey", "şimdi", "çok", "history", "shorts", "osmanlı", "ottoman", "empire",
]);

export const WEEKLY_OSMANLI_SCHEDULE: WeeklyScheduleDay[] = [
  {
    day: 1,
    dayLabel: "Pazartesi",
    shortsTimes: ["09:00", "15:00", "21:00"],
    longVideoTime: null,
    evidence: "Sabah erişim, öğleden sonra etkileşim, akşam sadakat testi.",
    confidence: "Orta",
  },
  {
    day: 2,
    dayLabel: "Salı",
    shortsTimes: ["09:00", "14:00", "21:00"],
    longVideoTime: null,
    evidence: "Yeni Salı videolarında 09:00 ve 14:00 hızlı ilk dağıtım üretti.",
    confidence: "Orta",
  },
  {
    day: 3,
    dayLabel: "Çarşamba",
    shortsTimes: ["09:00", "15:00", "21:00"],
    longVideoTime: null,
    evidence: "Üç pencere de yaklaşık 1,2 bin izlenmeyle dengeli çalıştı.",
    confidence: "Orta",
  },
  {
    day: 4,
    dayLabel: "Perşembe",
    shortsTimes: ["09:00", "14:00", "17:00"],
    longVideoTime: "20:30",
    evidence: "Kanalın en güçlü günü; uzun video için akşam kontrollü test penceresi.",
    confidence: "Orta",
  },
  {
    day: 5,
    dayLabel: "Cuma",
    shortsTimes: ["09:00", "15:00", "21:00"],
    longVideoTime: null,
    evidence: "15:00 videosu 2.704 izlenme ve 16 aboneyle güçlü dönüşüm verdi.",
    confidence: "Orta",
  },
  {
    day: 6,
    dayLabel: "Cumartesi",
    shortsTimes: ["09:00", "12:00", "15:00"],
    longVideoTime: null,
    evidence: "18:00–21:00 denemeleri zayıf; üç Shorts gündüz pencerelerine alındı.",
    confidence: "Orta",
  },
  {
    day: 0,
    dayLabel: "Pazar",
    shortsTimes: ["09:00", "15:00", "21:00"],
    longVideoTime: null,
    evidence: "15:00 ve 21:00 yeni Fatih videolarında en iyi Pazar hızını verdi.",
    confidence: "Orta",
  },
];

export const DEFAULT_POSTING_SLOTS = WEEKLY_OSMANLI_SCHEDULE.flatMap((day) => [
  ...day.shortsTimes.map((time) => ({ day: day.day, dayLabel: day.dayLabel, time, format: "Shorts" as const })),
  ...(day.longVideoTime
    ? [{ day: day.day, dayLabel: day.dayLabel, time: day.longVideoTime, format: "Uzun Video" as const }]
    : []),
]);

export function detectHistoryTopic(title: string) {
  const normalized = title.toLocaleLowerCase("tr-TR");
  return TOPIC_RULES.find(([, rule]) => rule.test(normalized))?.[0] || "Osmanlı Tarihi";
}

export function detectOttomanRuler(title: string) {
  return RULER_RULES.find(([, rule]) => rule.test(title))?.[0] || "Diğer Osmanlı";
}

export function detectHookPattern(title: string) {
  if (/\b5\b|en\s+(?:çok|iyi|büyük|güçlü|önemli|şaşırtıcı|inanılmaz)/i.test(title)) return "Liste / En Güçlü";
  if (/giz|saklan|şaşırt|inanılmaz/i.test(title)) return "Gizem / Şaşırtıcı";
  if (/neden/i.test(title)) return "Neden?";
  if (/nasıl/i.test(title)) return "Nasıl?";
  if (/ilk|başlangıç/i.test(title)) return "İlk / Başlangıç";
  if (/öl|öldür|son gün/i.test(title)) return "Ölüm / Son Günler";
  if (/\?/.test(title)) return "Doğrudan Soru";
  return "Net Sonuç";
}

export function titleTokens(title: string) {
  return new Set(
    title
      .toLocaleLowerCase("tr-TR")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9çğıöşü\s]/gi, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
  );
}

export function titleSimilarity(first: string, second: string) {
  const left = titleTokens(first);
  const right = titleTokens(second);
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return intersection / Math.max(union, 1);
}

export function istanbulPublishParts(value: string) {
  if (!value.includes("T")) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    weekday: "long",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const rawDayLabel = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  if (!rawDayLabel || !Number.isFinite(hour)) return null;
  const dayLabel = rawDayLabel.charAt(0).toLocaleUpperCase("tr-TR") + rawDayLabel.slice(1);
  const bucketHour = Math.min(22, Math.floor(hour / 2) * 2);
  const period = hour < 12 ? "Sabah" : hour < 18 ? "Öğleden sonra" : "Akşam";
  return {
    dayLabel,
    hour,
    period,
    time: `${String(bucketHour).padStart(2, "0")}:00–${String(bucketHour + 2).padStart(2, "0")}:00`,
  };
}
