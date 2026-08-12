import "server-only";

import { addDays, format } from "date-fns";
import { tr } from "date-fns/locale";
import { detectHistoryTopic, detectOttomanRuler } from "./history";
import type { ChannelState, PlanItem, VideoMetric, WeeklyScheduleDay } from "./schema";
import { buildViralTopicCandidates } from "./topic-sourcing";

type Objective = "İzlenme" | "Abone" | "Beğeni";
type EventFamily =
  | "conquest"
  | "loss"
  | "campaign"
  | "rebellion"
  | "battle"
  | "treaty"
  | "crisis"
  | "reform"
  | "institution"
  | "person"
  | "other";

type Candidate = {
  subject: string;
  sourceTitle: string;
  title: string;
  family: EventFamily;
  topic: string;
  ruler: string;
  viewScore: number;
  subscriberScore: number;
  likeScore: number;
  evidenceSamples: number;
  viralBonus: number;
};

const DAY_MS = 86_400_000;
const SUBJECT_PREFIX = "Yeni konu evreni:";
const STOP_WORDS = new Set([
  "acaba", "ama", "asıl", "asil", "bir", "bu", "daha", "değil", "degil", "gerçekte", "gercekte",
  "hakkında", "hakkinda", "hangi", "için", "icin", "kadar", "mi", "mı", "mu", "mü", "nasıl", "nasil",
  "neden", "neydi", "oldu", "olarak", "osmanlı", "osmanli", "tarih", "tarihi", "ve", "veya", "sonra",
  "dengeleri", "etkiledi", "önemliydi", "onemliydi", "kritik", "ayrıntı", "ayrinti", "hakkında", "hakkinda",
  "sultan", "padişah", "padisah",
]);
const RULER_WORDS = new Set([
  "osman", "orhan", "murad", "bayezid", "mehmed", "mehmet", "selim", "süleyman", "suleyman", "ahmed", "ahmet",
  "mustafa", "mahmud", "abdülhamid", "abdulhamid", "kanuni", "fatih", "yavuz", "genç", "genc",
]);
const ACTION_WORD = /^(?:feth|fetih|alın|alin|kayb|kayıp|kayip|düş|dus|sefer|harekat|harekât|yürü|yuru|kuşat|kusat|isyan|ayaklan|savaş|savas|muharebe|zafer|baskın|baskin|antlaşma|antlasma|mütareke|mutareke|yönetim|yonetim|geçiş|gecis|kriz|reform|sistem|teşkilat|teskilat|uygulama|dönem|donem|olay)/;
const ORDINALS = new Set(["birinci", "ikinci", "üçüncü", "ucuncu", "dördüncü", "dorduncu", "i", "ii", "iii", "iv", "v"]);

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalize(value: string) {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9çğıöşü\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function alias(word: string) {
  if (/^almanya/.test(word) || /^alman/.test(word)) return "alman";
  if (/^budin/.test(word)) return "budin";
  if (/^belgrad/.test(word)) return "belgrad";
  if (/^viyana/.test(word)) return "viyana";
  if (/^çanakkale/.test(word) || /^canakkale/.test(word)) return "canakkale";
  if (/^düzmece/.test(word) || /^duzmece/.test(word)) return "duzmece";
  return word;
}

function words(value: string) {
  return normalize(value).split(/\s+/).filter(Boolean);
}

function anchors(value: string) {
  return new Set(
    words(value)
      .filter((word) => word.length >= 3 && !STOP_WORDS.has(word) && !RULER_WORDS.has(word) && !ACTION_WORD.test(word))
      .map(alias),
  );
}

function qualifiers(value: string) {
  return new Set(words(value).filter((word) => ORDINALS.has(word) || /^\d{3,4}$/.test(word)));
}

function family(value: string): EventFamily {
  const n = normalize(value);
  if (/feth|fetih|alın|alin|ele geç|ele gec|yönetimine geç|yonetimine gec/.test(n)) return "conquest";
  if (/kayb|kayıp|kayip|düş|dus|elden çık|elden cik/.test(n)) return "loss";
  if (/sefer|harekat|harekât|yürü|yuru|kuşat|kusat/.test(n)) return "campaign";
  if (/isyan|ayaklan|başkaldır|baskaldir/.test(n)) return "rebellion";
  if (/savaş|savas|muharebe|zafer|baskın|baskin/.test(n)) return "battle";
  if (/antlaşma|antlasma|mütareke|mutareke/.test(n)) return "treaty";
  if (/kriz|vakası|vakasi|olayı|olayi|tahttan indir|suikast/.test(n)) return "crisis";
  if (/reform|kanun|ferman|meşrutiyet|mesrutiyet|cedid|kıyafet|kiyafet/.test(n)) return "reform";
  if (/sistem|teşkilat|teskilat|ocak|divan|vakıf|vakif|mekteb|nezaret|hazine|lonca/.test(n)) return "institution";
  if (/paşa|pasa|reis|sultan|çelebi|celebi|mimar|evliya|katip|kâtip/.test(n)) return "person";
  return "other";
}

function sameHistoricalEvent(left: string, right: string) {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return false;
  if (a === b || (a.length >= 8 && b.includes(a)) || (b.length >= 8 && a.includes(b))) return true;

  const leftQualifiers = qualifiers(left);
  const rightQualifiers = qualifiers(right);
  if (leftQualifiers.size && rightQualifiers.size) {
    const sameQualifier = [...leftQualifiers].some((value) => rightQualifiers.has(value));
    if (!sameQualifier) return false;
  }

  const leftFamily = family(left);
  const rightFamily = family(right);
  const leftAnchors = anchors(left);
  const rightAnchors = anchors(right);
  const shared = [...leftAnchors].filter((word) => rightAnchors.has(word));
  if (!shared.length) return false;

  if (leftFamily !== "other" && rightFamily !== "other" && leftFamily !== rightFamily) return false;
  if (leftFamily === rightFamily && leftFamily !== "other") return true;

  const containment = shared.length / Math.max(1, Math.min(leftAnchors.size, rightAnchors.size));
  if (shared.length >= 2 && containment >= 0.6) return true;
  return shared.length === 1 && shared[0].length >= 5 && Math.min(leftAnchors.size, rightAnchors.size) === 1;
}

function subjectFromSource(title: string, sourceTitle: string) {
  if (sourceTitle.startsWith(SUBJECT_PREFIX)) return sourceTitle.slice(SUBJECT_PREFIX.length).trim();
  return sourceTitle || title;
}

function videoAgeDays(video: VideoMetric) {
  const published = new Date(video.publishedAt).getTime();
  return Number.isFinite(published) ? Math.max(0.25, (Date.now() - published) / DAY_MS) : 365;
}

function objectiveValue(video: VideoMetric, objective: Objective) {
  const retention = video.avgViewPercentage > 0 ? clamp(video.avgViewPercentage / 80, 0.65, 1.35) : 1;
  const engaged = (video.engagedViewRate || 0) > 0 ? clamp((video.engagedViewRate || 0) / 60, 0.7, 1.3) : 1;
  const quality = Math.sqrt(retention * engaged);
  if (objective === "Abone") {
    const net = Math.max(0, video.subscribersGained - video.subscribersLost);
    return (net / Math.max(video.analyticsViews || video.views, 1)) * 1000 * quality;
  }
  if (objective === "Beğeni") {
    return (video.likes / Math.max(video.views, 1)) * 1000 * quality;
  }
  const speed = video.recentVelocity || (video.engagedViews || video.views) / Math.max(1, Math.min(21, videoAgeDays(video)));
  return Math.log10(speed + 10) * 25 * quality;
}

function themeRelevance(subject: string, video: VideoMetric) {
  let score = 0.08;
  const subjectTopic = detectHistoryTopic(subject);
  const videoTopic = detectHistoryTopic(video.title);
  if (subjectTopic === videoTopic) score += 0.42;

  const subjectRuler = detectOttomanRuler(subject);
  const videoRuler = detectOttomanRuler(video.title);
  if (subjectRuler !== "Diğer Osmanlı" && subjectRuler === videoRuler) score += 0.28;
  if (family(subject) === family(video.title) && family(subject) !== "other") score += 0.22;
  return clamp(score, 0.08, 1);
}

function evidenceFor(state: ChannelState, subject: string, objective: Objective) {
  const rows = state.videos
    .filter((video) => video.contentType === "SHORT" && video.views > 0)
    .map((video) => ({ video, relevance: themeRelevance(subject, video) }))
    .sort((left, right) => right.relevance - left.relevance || right.video.views - left.video.views)
    .slice(0, 10);
  if (!rows.length) return { score: 0, samples: 0 };
  const weight = rows.reduce((sum, row) => sum + row.relevance, 0);
  const score = rows.reduce((sum, row) => sum + objectiveValue(row.video, objective) * row.relevance, 0) / Math.max(weight, 0.001);
  return { score, samples: rows.filter((row) => row.relevance >= 0.35).length };
}

function titleFor(subject: string, eventFamily: EventFamily, seed: number) {
  const templates: Record<EventFamily, string[]> = {
    conquest: [`${subject} Osmanlı İçin Neden Bu Kadar Önemliydi?`, `${subject} Sonrası Ne Değişti?`],
    loss: [`${subject} Osmanlı'yı Nasıl Sarstı?`, `${subject} Sonrası Osmanlı'da Ne Değişti?`],
    campaign: [`${subject} Neden Başlatıldı?`, `${subject} Osmanlı'yı Nasıl Etkiledi?`],
    rebellion: [`${subject} Osmanlı'yı Nasıl Krize Sürükledi?`, `${subject} Neden Bu Kadar Tehlikeliydi?`],
    battle: [`${subject} Neden Bir Dönüm Noktasıydı?`, `${subject} Osmanlı'yı Nasıl Etkiledi?`],
    treaty: [`${subject} Osmanlı İçin Neyi Değiştirdi?`, `${subject} Sonrası Dengeler Nasıl Değişti?`],
    crisis: [`${subject} Osmanlı'yı Nasıl Etkiledi?`, `${subject} Neden Büyük Bir Krize Dönüştü?`],
    reform: [`${subject} Osmanlı'da Neyi Değiştirdi?`, `${subject} Neden Gerekli Görüldü?`],
    institution: [`${subject} Osmanlı İçin Neden Önemliydi?`, `${subject} Devletin İşleyişini Nasıl Değiştirdi?`],
    person: [`${subject} Osmanlı İçin Neden Önemliydi?`, `${subject} Osmanlı'yı Nasıl Etkiledi?`],
    other: [`${subject} Osmanlı İçin Neden Önemliydi?`, `${subject} Osmanlı'yı Nasıl Etkiledi?`],
  };
  const list = templates[eventFamily];
  return list[seed % list.length];
}

function buildCandidatePool(state: ChannelState) {
  const published = state.videos.filter((video) => video.contentType === "SHORT").map((video) => video.title);
  const all = buildViralTopicCandidates(state, 0);
  const freshOnly = all.filter((item) => item.sourceTitle.startsWith(SUBJECT_PREFIX));
  const source = freshOnly.length >= 180 ? freshOnly : all;
  const seen = new Set<string>();
  const candidates: Candidate[] = [];

  source.forEach((item, index) => {
    const subject = subjectFromSource(item.title, item.sourceTitle);
    const key = normalize(subject);
    if (!subject || seen.has(key)) return;
    if (published.some((title) => sameHistoricalEvent(subject, title))) return;
    if (candidates.some((candidate) => sameHistoricalEvent(subject, candidate.subject))) return;

    const view = evidenceFor(state, subject, "İzlenme");
    const subscriber = evidenceFor(state, subject, "Abone");
    const like = evidenceFor(state, subject, "Beğeni");
    const eventFamily = family(subject);
    seen.add(key);
    candidates.push({
      subject,
      sourceTitle: item.sourceTitle,
      title: titleFor(subject, eventFamily, index),
      family: eventFamily,
      topic: detectHistoryTopic(subject),
      ruler: detectOttomanRuler(subject),
      viewScore: view.score,
      subscriberScore: subscriber.score,
      likeScore: like.score,
      evidenceSamples: Math.max(view.samples, subscriber.samples, like.samples),
      viralBonus: item.viralBonus,
    });
  });

  return candidates;
}

function candidateScore(candidate: Candidate, objective: Objective) {
  const evidence = objective === "Abone"
    ? candidate.subscriberScore * 18
    : objective === "Beğeni"
      ? candidate.likeScore * 0.9
      : candidate.viewScore * 1.25;
  const confidence = Math.min(12, candidate.evidenceSamples * 1.5);
  return evidence + confidence + candidate.viralBonus * 0.12;
}

function selectCandidate(
  candidates: Candidate[],
  objective: Objective,
  used: Candidate[],
  usedRulersToday: Set<string>,
  usedFamiliesToday: Set<EventFamily>,
  seed: number,
) {
  const available = candidates.filter((candidate) =>
    !used.some((item) => sameHistoricalEvent(item.subject, candidate.subject)));
  if (!available.length) return null;

  const diverse = available.filter((candidate) =>
    (candidate.ruler === "Diğer Osmanlı" || !usedRulersToday.has(candidate.ruler)) &&
    !usedFamiliesToday.has(candidate.family));
  const pool = diverse.length >= 3 ? diverse : available;
  const ranked = pool
    .map((candidate) => ({ candidate, score: candidateScore(candidate, objective) }))
    .sort((left, right) => right.score - left.score || left.candidate.subject.localeCompare(right.candidate.subject, "tr"));

  const top = ranked.slice(0, Math.min(5, ranked.length));
  return top[seed % top.length]?.candidate || ranked[0]?.candidate || null;
}

function objectiveCta(objective: Objective) {
  if (objective === "Abone") return "Bu tarz Osmanlı tarihi içerikler için abone olmayı unutmayın.";
  if (objective === "Beğeni") return "Bu bilgi şaşırttıysa videoyu beğen.";
  return "";
}

function contentFor(candidate: Candidate, objective: Objective) {
  const hook = candidate.title;
  const cta = objectiveCta(objective);
  const voiceover = [
    hook,
    "Hadi birlikte bakalım.",
    `Konu: ${candidate.subject}. İlk 8 saniyede krizi veya merakı kur; cevabı hemen verme.`,
    "Olayı doğal ve hızlı konuşma diliyle anlat. Her birkaç saniyede yeni bir bilgi ekle.",
    "Ana nedeni veya sonucu son 10–15 saniyeye taşı ve finalde tarihsel sonucu net söyle.",
    cta,
  ].filter(Boolean).join(" ");
  return { hook, cta, voiceover, estimatedSeconds: 45 };
}

function hashtagsFor(candidate: Candidate) {
  const ruler = candidate.ruler.replace(/[^\p{L}\p{N}]/gu, "");
  const topic = candidate.topic.replace(/[^\p{L}\p{N}]/gu, "");
  return [...new Set(["#tarih", "#osmanlı", "#osmanlıtarihi", ruler && ruler !== "DiğerOsmanlı" ? `#${ruler}` : "#tarihibilgiler", `#${topic}`, "#shorts"])];
}

function reasonFor(state: ChannelState, candidate: Candidate, objective: Objective) {
  const shorts = state.videos.filter((video) => video.contentType === "SHORT").length;
  return `${shorts} Shorts'un izlenme hızı, tutma, beğeni ve abone dönüşümü tema düzeyinde analiz edildi. ${candidate.subject} daha önce yayınlanmış aynı tarihî olayla eşleşmedi ve 30 günlük planda başka hiçbir slotta tekrar kullanılmıyor. Seçim ${candidate.evidenceSamples} yakın tema örneğinin ${objective.toLocaleLowerCase("tr-TR")} sinyaline göre puanlandı.`;
}

function istanbulTodayAtNoon() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return new Date(`${get("year")}-${get("month")}-${get("day")}T12:00:00+03:00`);
}

export function generateChannelDrivenPlan(
  state: ChannelState,
  adaptiveSchedule: WeeklyScheduleDay[],
): PlanItem[] {
  const start = istanbulTodayAtNoon();
  const candidates = buildCandidatePool(state);
  const plan: PlanItem[] = [];
  const used: Candidate[] = [];

  for (let dayIndex = 0; dayIndex < 30; dayIndex += 1) {
    const date = addDays(start, dayIndex);
    const dateKey = format(date, "yyyy-MM-dd");
    const schedule = adaptiveSchedule.find((item) => item.day === date.getDay());
    if (!schedule) continue;
    const usedRulersToday = new Set<string>();
    const usedFamiliesToday = new Set<EventFamily>();
    const slots = schedule.shortSlots || schedule.shortsTimes.map((time, index) => ({
      time,
      objective: (["İzlenme", "Abone", "Beğeni", "İzlenme", "Abone", "Beğeni"] as Objective[])[index % 6],
      score: 50,
      sampleSize: 0,
      reason: schedule.evidence,
      change: "Test" as const,
    }));

    for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
      const slot = slots[slotIndex];
      const objective = slot.objective as Objective;
      const candidate = selectCandidate(
        candidates,
        objective,
        used,
        usedRulersToday,
        usedFamiliesToday,
        dayIndex * 17 + slotIndex * 11,
      );
      if (!candidate) continue;
      used.push(candidate);
      if (candidate.ruler !== "Diğer Osmanlı") usedRulersToday.add(candidate.ruler);
      usedFamiliesToday.add(candidate.family);
      const content = contentFor(candidate, objective);
      const hashtags = hashtagsFor(candidate);
      plan.push({
        id: `${dateKey}-short-${slotIndex}`,
        date: dateKey,
        dayLabel: format(date, "EEEE", { locale: tr }),
        format: "Shorts",
        title: candidate.title,
        hook: content.hook,
        duration: "45 sn",
        publishTime: slot.time,
        pillar: candidate.topic,
        objective,
        priority: dayIndex <= 1 ? "Yüksek" : "Normal",
        reason: `${reasonFor(state, candidate, objective)} Saat: ${slot.reason}`,
        voiceover: content.voiceover,
        description: `${candidate.title}\n\n${candidate.subject} konusunun Osmanlı tarihindeki yerini kısa ve anlaşılır biçimde ele alıyoruz.\n\n${hashtags.join(" ")}`,
        hashtags,
        cta: content.cta,
        estimatedSeconds: content.estimatedSeconds,
        strategyMode: candidate.evidenceSamples >= 5 ? "Kazananı büyüt" : candidate.evidenceSamples >= 2 ? "Denge" : "Kontrollü test",
      });
    }
  }

  return plan.sort((left, right) => left.date.localeCompare(right.date) || left.publishTime.localeCompare(right.publishTime));
}
