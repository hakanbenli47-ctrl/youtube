import "server-only";

import { addDays, format } from "date-fns";
import { tr } from "date-fns/locale";
import { detectHistoryTopic, detectOttomanRuler, titleSimilarity } from "./history";
import type { ChannelState, PlanItem, VideoMetric, WeeklyScheduleDay } from "./schema";
import { audienceAffinityScore, buildViralTopicCandidates, viralDemandScore } from "./topic-sourcing";

type Objective = "İzlenme" | "Abone" | "Beğeni";

type Candidate = {
  title: string;
  sourceTitle: string;
  subjectKey: string;
  subjectAnchors: string[];
  viralBonus: number;
  ruler: string;
  topic: string;
  evidenceSamples: number;
  viewScore: number;
  subscriberScore: number;
  likeScore: number;
  audienceScore: number;
  viralScore: number;
};

const DAY_MS = 86_400_000;
const GENERIC_WORDS = new Set([
  "acaba", "ama", "asil", "asıl", "bir", "bu", "daha", "degil", "değil", "gercekte", "gerçekte",
  "hakkinda", "hakkında", "hangi", "icin", "için", "kadar", "mi", "miydi", "nasil", "nasıl", "neden",
  "neydi", "oldu", "olarak", "osmanli", "osmanlı", "sultan", "padisah", "padişah", "tarih", "tarihi",
  "ve", "veya", "sonra", "dengeleri", "etkiledi", "onemliydi", "önemliydi", "kritik", "ayrinti", "ayrıntı",
]);

type EventFamily = "conquest" | "loss" | "campaign" | "rebellion" | "battle" | "treaty";

const EVENT_FAMILY_RULES: Array<[EventFamily, RegExp]> = [
  ["conquest", /\b(?:feth\w*|fetih\w*|alın\w*|alin\w*|ele\s+geç\w*|ele\s+gec\w*|yönetimine\s+geç\w*|yonetimine\s+gec\w*)/],
  ["loss", /\b(?:kayb\w*|kayıp\w*|kayip\w*|düş\w*|dus\w*|elden\s+çık\w*|elden\s+cik\w*)/],
  ["campaign", /\b(?:sefer\w*|harekat\w*|harekât\w*|yürü\w*|yuru\w*|kuşat\w*|kusat\w*)/],
  ["rebellion", /\b(?:isyan\w*|ayaklan\w*|başkaldır\w*|baskaldir\w*)/],
  ["battle", /\b(?:savaş\w*|savas\w*|muharebe\w*|zafer\w*|baskın\w*|baskin\w*)/],
  ["treaty", /\b(?:antlaşma\w*|antlasma\w*|mütareke\w*|mutareke\w*)/],
];

const EVENT_ANCHOR_NOISE = /^(?:feth|fetih|alın|alin|kayb|kayıp|kayip|düş|dus|sefer|harekat|yürü|yuru|kuşat|kusat|isyan|ayaklan|başkaldır|baskaldir|savaş|savas|muharebe|zafer|baskın|baskin|antlaşma|antlasma|mütareke|mutareke|yönetim|yonetim|geçiş|gecis|denge|değiş|degis|etkile|önem|onem|hakk|kritik|ayrınt|ayrint)/;
const RULER_ANCHOR_NOISE = /^(?:osman|orhan|murad|bayezid|mehmed|mehmet|selim|süleyman|suleyman|ahmed|ahmet|mustafa|mahmud|abdülhamid|abdulhamid|kanuni|fatih|yavuz|genç|genc)$/;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
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

function normalize(value: string) {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9çğıöşü\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulWords(value: string) {
  return normalize(value)
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !GENERIC_WORDS.has(word));
}

function eventFamily(value: string) {
  const normalized = normalize(value);
  return EVENT_FAMILY_RULES.find(([, rule]) => rule.test(normalized))?.[0] || null;
}

function canonicalEventAnchor(word: string) {
  if (/^almanya/.test(word) || /^alman/.test(word)) return "alman";
  if (/^budin/.test(word)) return "budin";
  if (/^belgrad/.test(word)) return "belgrad";
  if (/^viyana/.test(word)) return "viyana";
  return word;
}

function eventAnchorWords(value: string) {
  return new Set(
    meaningfulWords(value)
      .map(canonicalEventAnchor)
      .filter((word) => !EVENT_ANCHOR_NOISE.test(word) && !RULER_ANCHOR_NOISE.test(word)),
  );
}

function sameEventSignature(left: string, right: string) {
  const leftFamily = eventFamily(left);
  const rightFamily = eventFamily(right);
  if (!leftFamily || leftFamily !== rightFamily) return false;

  const leftAnchors = eventAnchorWords(left);
  const rightAnchors = eventAnchorWords(right);
  return [...leftAnchors].some((word) => rightAnchors.has(word));
}

function broadSubjectOverlap(left: string, right: string) {
  const leftAnchors = eventAnchorWords(left);
  const rightAnchors = eventAnchorWords(right);
  if (!leftAnchors.size || !rightAnchors.size) return false;

  const shared = [...leftAnchors].filter((word) => rightAnchors.has(word));
  if (!shared.length) return false;

  // 30 günlük planda aynı merkez konu bir daha kullanılmaz. Olay türü farklı olsa bile
  // Budin, Belgrad, Alman/Almanya gibi aynı tarihî merkez ikinci kez plana giremez.
  if (shared.some((word) => word.length >= 5)) return true;

  const containment = shared.length / Math.max(1, Math.min(leftAnchors.size, rightAnchors.size));
  return shared.length >= 2 && containment >= 0.5;
}

function sameSubject(left: string, right: string) {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (sameEventSignature(left, right)) return true;
  if (titleSimilarity(left, right) >= 0.34) return true;

  const leftRuler = detectOttomanRuler(left);
  const rightRuler = detectOttomanRuler(right);
  const leftWords = meaningfulWords(left);
  const rightWords = meaningfulWords(right);
  const rightSet = new Set(rightWords);
  const shared = leftWords.filter((word) => rightSet.has(word)).length;
  const containment = shared / Math.max(1, Math.min(leftWords.length, rightWords.length));

  if (leftRuler !== "Diğer Osmanlı" && leftRuler === rightRuler && shared >= 2 && containment >= 0.42) return true;
  if (shared >= 3 && containment >= 0.52) return true;
  return shared >= 2 && containment >= 0.72;
}

function canonicalSubjectText(candidate: { title: string; sourceTitle: string }) {
  if (candidate.sourceTitle.startsWith("Yeni konu evreni:")) {
    return candidate.sourceTitle.slice("Yeni konu evreni:".length).trim();
  }
  return candidate.sourceTitle || candidate.title;
}

function subjectIdentity(candidate: { title: string; sourceTitle: string }) {
  const source = canonicalSubjectText(candidate);
  const anchors = [...eventAnchorWords(source || candidate.title)].sort();
  const family = eventFamily(source) || eventFamily(candidate.title) || "topic";
  const normalizedSource = normalize(source);
  return {
    key: anchors.length ? `${family}:${anchors.join("|")}` : `${family}:${normalizedSource}`,
    anchors,
  };
}

function candidatesShareSubject(left: Candidate, right: Candidate) {
  if (left.subjectKey === right.subjectKey) return true;
  if (sameSubject(left.title, right.title)) return true;
  const leftSource = canonicalSubjectText(left);
  const rightSource = canonicalSubjectText(right);
  if (sameSubject(leftSource, rightSource)) return true;
  if (broadSubjectOverlap(leftSource, rightSource)) return true;
  if (broadSubjectOverlap(left.title, right.title)) return true;

  const rightAnchors = new Set(right.subjectAnchors);
  return left.subjectAnchors.some((anchor) => rightAnchors.has(anchor) && anchor.length >= 5);
}

function videoAgeDays(video: VideoMetric) {
  const published = new Date(video.publishedAt).getTime();
  return Number.isFinite(published) ? Math.max(0.25, (Date.now() - published) / DAY_MS) : 365;
}

function videoObjectiveValue(video: VideoMetric, objective: Objective) {
  const quality = video.avgViewPercentage > 0
    ? clamp(video.avgViewPercentage / 80, 0.7, 1.3)
    : 1;
  if (objective === "Abone") {
    const net = Math.max(0, video.subscribersGained - video.subscribersLost);
    return (net / Math.max(video.analyticsViews || video.views, 1)) * 1000 * quality;
  }
  if (objective === "Beğeni") {
    return (video.likes / Math.max(video.views, 1)) * 1000 * quality;
  }
  const liveVelocity = video.recentVelocity || 0;
  const fallbackVelocity = (video.engagedViews || video.views) / Math.max(1, Math.min(21, videoAgeDays(video)));
  return Math.max(liveVelocity, fallbackVelocity) * quality;
}

function relevance(candidate: string, video: VideoMetric) {
  let value = titleSimilarity(candidate, video.title);
  const candidateRuler = detectOttomanRuler(candidate);
  const videoRuler = detectOttomanRuler(video.title);
  if (candidateRuler !== "Diğer Osmanlı" && candidateRuler === videoRuler) value = Math.max(value, 0.46);
  if (detectHistoryTopic(candidate) === detectHistoryTopic(video.title)) value = Math.max(value, 0.2);
  return clamp(value, 0, 1);
}

function evidenceFor(state: ChannelState, title: string, objective: Objective) {
  const rows = state.videos
    .filter((video) => video.contentType === "SHORT" && video.views > 0)
    .map((video) => ({
      video,
      relatedness: relevance(title, video),
    }))
    .filter((row) => row.relatedness >= 0.18)
    .map((row) => ({
      ...row,
      value: videoObjectiveValue(row.video, objective) * row.relatedness,
    }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 8);

  if (!rows.length) return { value: 0, samples: 0 };
  const weighted = rows.reduce((sum, row) => sum + row.value, 0) / rows.length;
  return { value: weighted, samples: rows.length };
}

function buildCandidatePool(state: ChannelState) {
  const publishedTitles = state.videos
    .filter((video) => video.contentType === "SHORT")
    .map((video) => video.title);
  const raw = buildViralTopicCandidates(state, 0);
  const unique: typeof raw = [];

  for (const candidate of raw) {
    if (!candidate.title) continue;
    const sourceSubject = canonicalSubjectText(candidate);
    if (publishedTitles.some((title) => sameSubject(candidate.title, title) || sameSubject(sourceSubject, title))) continue;
    if (unique.some((item) =>
      sameSubject(candidate.title, item.title) ||
      sameSubject(sourceSubject, canonicalSubjectText(item))
    )) continue;
    unique.push(candidate);
  }

  return unique.map((candidate): Candidate => {
    const view = evidenceFor(state, candidate.title, "İzlenme");
    const subscriber = evidenceFor(state, candidate.title, "Abone");
    const like = evidenceFor(state, candidate.title, "Beğeni");
    const identity = subjectIdentity(candidate);
    return {
      title: candidate.title,
      sourceTitle: candidate.sourceTitle,
      subjectKey: identity.key,
      subjectAnchors: identity.anchors,
      viralBonus: candidate.viralBonus,
      ruler: detectOttomanRuler(candidate.title),
      topic: detectHistoryTopic(candidate.title),
      evidenceSamples: Math.max(view.samples, subscriber.samples, like.samples),
      viewScore: view.value,
      subscriberScore: subscriber.value,
      likeScore: like.value,
      audienceScore: Math.max(0, audienceAffinityScore(state, candidate.title)),
      viralScore: Math.max(0, viralDemandScore(state, candidate.title)),
    };
  });
}

function objectiveScore(candidate: Candidate, objective: Objective) {
  const own = objective === "Abone"
    ? candidate.subscriberScore * 55
    : objective === "Beğeni"
      ? candidate.likeScore * 1.8
      : Math.log10(candidate.viewScore + 10) * 32;
  return own + candidate.audienceScore * 1.25 + candidate.viralScore * 0.9 + candidate.viralBonus * 0.35;
}

function objectiveCta(objective: Objective) {
  if (objective === "Abone") return "Tarih için abone ol.";
  if (objective === "Beğeni") return "Şaşırdıysan beğen.";
  return "";
}

function buildContent(title: string, objective: Objective) {
  const hook = title.replace(/\?$/, "?");
  const cta = objectiveCta(objective);
  const voiceover = [
    hook,
    "Hadi birlikte bakalım.",
    "Bu başlıkta olayın başlangıcını kısa kur, kritik ayrıntıyı ilk saniyelerde verme.",
    "Her birkaç saniyede yeni bir bilgi ekle ve asıl cevabı son 10–15 saniyeye taşı.",
    "Finalde tarihsel sonucu net biçimde söyle.",
    cta,
  ].filter(Boolean).join(" ");
  return { hook, cta, voiceover, estimatedSeconds: 45 };
}

function hashtagsFor(title: string) {
  const ruler = detectOttomanRuler(title).replace(/[^\p{L}\p{N}]/gu, "");
  const topic = detectHistoryTopic(title).replace(/[^\p{L}\p{N}]/gu, "");
  return [...new Set(["#tarih", "#osmanlı", "#osmanlıtarihi", ruler && ruler !== "DiğerOsmanlı" ? `#${ruler}` : "#tarihibilgiler", `#${topic}`, "#shorts"])];
}

function reasonFor(state: ChannelState, candidate: Candidate, objective: Objective) {
  const shorts = state.videos.filter((video) => video.contentType === "SHORT").length;
  const source = candidate.sourceTitle.startsWith("Yeni konu evreni:")
    ? "kanalında daha önce işlenmemiş Osmanlı konu havuzundan"
    : "güncel tarih trendlerinden";
  return `${shorts} mevcut Shorts'un gerçek sonuçları esas alındı. Bu konu ${source} seçildi; aynı olay daha önce yayınlanmış videolara ve 30 günlük plandaki diğer konulara karşı tekrar filtresinden geçti. ${candidate.evidenceSamples} benzer izleyici davranışı örneği ve ${objective.toLocaleLowerCase("tr-TR")} performansı birlikte puanlandı.`;
}

function selectCandidate(
  candidates: Candidate[],
  objective: Objective,
  used: Candidate[],
  usedRulersToday: Set<string>,
  seed: number,
) {
  const available = candidates.filter((candidate) =>
    !used.some((item) => candidatesShareSubject(item, candidate)));
  const diverse = available.filter((candidate) =>
    candidate.ruler === "Diğer Osmanlı" || !usedRulersToday.has(candidate.ruler));
  const pool = diverse.length >= 2 ? diverse : available;
  const ranked = pool
    .map((candidate) => ({ candidate, score: objectiveScore(candidate, objective) }))
    .sort((left, right) => right.score - left.score || left.candidate.title.localeCompare(right.candidate.title, "tr"));

  if (!ranked.length) return null;
  // İlk 12 güçlü seçenek içinde deterministik çeşitlilik: aynı veriyle plan zıplamaz,
  // fakat 30 gün boyunca aynı merkez konu ikinci kez kullanılamaz.
  return ranked[seed % Math.min(12, ranked.length)].candidate;
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
    const slots = schedule.shortSlots || schedule.shortsTimes.map((time, index) => ({
      time,
      objective: (["İzlenme", "Abone", "Beğeni", "İzlenme", "Abone", "Beğeni"] as Objective[])[index % 6],
      score: 50,
      sampleSize: 0,
      reason: schedule.evidence,
      change: "Test" as const,
    }));

    slots.forEach((slot, slotIndex) => {
      const objective = slot.objective as Objective;
      const candidate = selectCandidate(candidates, objective, used, usedRulersToday, dayIndex * 13 + slotIndex * 7);
      if (!candidate) return;
      used.push(candidate);
      if (candidate.ruler !== "Diğer Osmanlı") usedRulersToday.add(candidate.ruler);
      const content = buildContent(candidate.title, objective);
      const hashtags = hashtagsFor(candidate.title);
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
        description: `${candidate.title}\n\nBu videoda olayın nedenini, kritik ayrıntısını ve Osmanlı tarihindeki sonucunu kısa ve anlaşılır biçimde ele alıyoruz.\n\n${hashtags.join(" ")}`,
        hashtags,
        cta: content.cta,
        estimatedSeconds: content.estimatedSeconds,
        strategyMode: candidate.viralScore >= 25 ? "Kazananı büyüt" : candidate.evidenceSamples >= 3 ? "Denge" : "Kontrollü test",
      });
    });
  }

  return plan.sort((left, right) => left.date.localeCompare(right.date) || left.publishTime.localeCompare(right.publishTime));
}
