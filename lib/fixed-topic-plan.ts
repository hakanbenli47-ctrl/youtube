import "server-only";

import { addDays, format } from "date-fns";
import { tr } from "date-fns/locale";
import { detectHistoryTopic, detectOttomanRuler, titleSimilarity } from "./history";
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

type LaneId =
  | "conquest-loss"
  | "ruler-intrigue"
  | "throne-dynasty"
  | "war-siege"
  | "army-reform"
  | "rebellion-crisis";

type FixedLane = {
  id: LaneId;
  label: string;
  keywords: RegExp;
  familyWeights: Partial<Record<EventFamily, number>>;
};

type Candidate = {
  subject: string;
  sourceTitle: string;
  family: EventFamily;
  topic: string;
  ruler: string;
  viewScore: number;
  subscriberScore: number;
  likeScore: number;
  evidenceSamples: number;
  viralBonus: number;
};

type PlanningMemory = {
  coveredSubjects?: string[];
  plannerVersion?: number;
};

const DAY_MS = 86_400_000;
const SUBJECT_PREFIX = "Yeni konu evreni:";
const FIXED_SHORT_TIMES = ["09:00", "11:00", "13:00", "15:00", "17:00", "19:00"];
const DEFAULT_OBJECTIVES: Objective[] = ["İzlenme", "Abone", "Beğeni", "İzlenme", "Abone", "Beğeni"];

// Kanalın şimdiye kadarki kazanan desenleri artık altı sabit içerik hattına ayrılıyor.
// Başlık/olay her gün değişir; kategori ve yayın sırası değişmez.
const FIXED_LANES: FixedLane[] = [
  {
    id: "conquest-loss",
    label: "Fetih & Toprak Kazanımı/Kaybı",
    keywords: /fetih|fethi|alınış|alinis|alınması|alinmasi|ele geç|ele gec|kayb|düşüş|dusus|elden çık|elden cik|toprak|kale|şehir|sehir/,
    familyWeights: { conquest: 72, loss: 72, treaty: 34, campaign: 20 },
  },
  {
    id: "ruler-intrigue",
    label: "Padişah Kararları & Saray/Diplomasi",
    keywords: /padişah|padisah|sultan|paşa|pasa|vezir|sadrazam|harem|valide|saray|elçi|elci|diplomasi|ittifak|evlilik|seyahat|ferman|kanunname/,
    familyWeights: { person: 58, treaty: 48, other: 26, reform: 22, crisis: 18 },
  },
  {
    id: "throne-dynasty",
    label: "Taht & Hanedan Mücadelesi",
    keywords: /taht|şehzade|sehzade|hanedan|veraset|kardeş|kardes|cülus|culus|kafes|sürgün|surgun|cem sultan|tahttan|saltanat|miras/,
    familyWeights: { crisis: 64, person: 46, rebellion: 32, other: 22 },
  },
  {
    id: "war-siege",
    label: "Savaş & Kuşatma",
    keywords: /savaş|savas|muharebe|kuşatma|kusatma|sefer|harekat|harekât|savunma|baskın|baskin|zafer|cephe|donanma savaşı|deniz savaşı/,
    familyWeights: { battle: 78, campaign: 72, conquest: 34, loss: 34 },
  },
  {
    id: "army-reform",
    label: "Ordu & Reform/Teknoloji",
    keywords: /ordu|asker|yeniçeri|yeniceri|ocak|topçu|topcu|donanma|tersane|nizam|reform|mekteb|tımar|timar|devşirme|devsirme|silah|top dök|top dok|humbar|lağım|lagim|zırhlı|zirhli|teknoloji/,
    familyWeights: { reform: 76, institution: 70, person: 22, other: 18 },
  },
  {
    id: "rebellion-crisis",
    label: "İsyan & Büyük Kriz",
    keywords: /isyan|ayaklan|vakası|vakasi|kriz|suikast|baskını|baskini|darbe|tahttan indir|bozgun|felaket|işgal|isgal|ihanet|kargaşa|kargasa/,
    familyWeights: { rebellion: 80, crisis: 76, loss: 28, treaty: 16 },
  },
];

const LONG_VIDEO_LANE: FixedLane = {
  id: "war-siege",
  label: "Uzun Video — Büyük Savaş/Sefer Dosyası",
  keywords: /savaş|savas|muharebe|kuşatma|kusatma|sefer|harekat|harekât|savunma|fetih|fethi|cephe|donanma/,
  familyWeights: { battle: 84, campaign: 80, conquest: 62, loss: 44 },
};

const NOISE_WORDS = new Set([
  "acaba", "ama", "asıl", "asil", "bir", "bu", "daha", "değil", "degil", "gerçekte", "gercekte",
  "hakkında", "hakkinda", "hangi", "için", "icin", "kadar", "mi", "mı", "mu", "mü", "nasıl", "nasil",
  "neden", "neydi", "oldu", "olarak", "osmanlı", "osmanli", "tarih", "tarihi", "ve", "veya", "sonra",
  "dengeleri", "etkiledi", "önemliydi", "onemliydi", "kritik", "ayrıntı", "ayrinti", "konusu", "olayı", "olayi",
]);

const RULER_ONLY_WORDS = new Set([
  "osman", "orhan", "murad", "bayezid", "mehmed", "mehmet", "selim", "süleyman", "suleyman", "ahmed", "ahmet",
  "mustafa", "mahmud", "abdülhamid", "abdulhamid", "kanuni", "fatih", "yavuz", "genç", "genc", "ibrahim",
]);

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

function words(value: string) {
  return normalize(value).split(/\s+/).filter(Boolean);
}

function qualifiers(value: string) {
  return new Set(words(value).filter((word) => /^(?:i|ii|iii|iv|v|vi|vii|viii|ix|x|birinci|ikinci|üçüncü|ucuncu|dördüncü|dorduncu|\d{3,4})$/.test(word)));
}

function meaningfulWords(value: string) {
  return new Set(words(value).filter((word) => word.length >= 3 && !NOISE_WORDS.has(word)));
}

function family(value: string): EventFamily {
  const n = normalize(value);
  if (/feth|fetih|alın|alin|ele geç|ele gec|yönetimine geç|yonetimine gec|geri alın|geri alin/.test(n)) return "conquest";
  if (/kayb|kayıp|kayip|düş|dus|elden çık|elden cik|işgal|isgal/.test(n)) return "loss";
  if (/sefer|harekat|harekât|yürü|yuru|kuşat|kusat|savunma/.test(n)) return "campaign";
  if (/isyan|ayaklan|başkaldır|baskaldir/.test(n)) return "rebellion";
  if (/savaş|savas|muharebe|zafer|baskın|baskin/.test(n)) return "battle";
  if (/antlaşma|antlasma|mütareke|mutareke|konferans/.test(n)) return "treaty";
  if (/kriz|vakası|vakasi|olayı|olayi|tahttan indir|suikast|darbe/.test(n)) return "crisis";
  if (/reform|kanun|ferman|meşrutiyet|mesrutiyet|cedid|kıyafet|kiyafet/.test(n)) return "reform";
  if (/sistem|teşkilat|teskilat|ocak|divan|vakıf|vakif|mekteb|nezaret|hazine|lonca|tersane|demiryolu|telgraf/.test(n)) return "institution";
  if (/paşa|pasa|reis|sultan|çelebi|celebi|mimar|evliya|katip|kâtip|valide/.test(n)) return "person";
  return "other";
}

function overlap(left: string, right: string) {
  const a = meaningfulWords(left);
  const b = meaningfulWords(right);
  const shared = [...a].filter((word) => b.has(word));
  const containment = shared.length / Math.max(1, Math.min(a.size, b.size));
  return { shared, containment };
}

/**
 * Yayındaki bütün başlıklar (kullanıcının mevcut 96+ konusu) sert engel listesidir.
 * Aynı olay farklı hook ile yazılsa bile plan havuzuna geri giremez. Aynı yer adında
 * gerçekten farklı olayları ayırmak için iki tarafta da yıl/sıra bilgisi varsa farklı
 * niteleyiciler çakışma sayılmaz.
 */
function sameHistoricalSubject(left: string, right: string) {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return false;
  if (a === b || (a.length >= 10 && b.includes(a)) || (b.length >= 10 && a.includes(b))) return true;

  const leftQualifiers = qualifiers(left);
  const rightQualifiers = qualifiers(right);
  if (leftQualifiers.size && rightQualifiers.size) {
    const sameQualifier = [...leftQualifiers].some((value) => rightQualifiers.has(value));
    if (!sameQualifier) return false;
  }

  if (titleSimilarity(left, right) >= 0.32) return true;

  const comparison = overlap(left, right);
  if (comparison.shared.length >= 3 && comparison.containment >= 0.45) return true;
  if (comparison.shared.length >= 2 && comparison.containment >= 0.58) return true;

  const leftFamily = family(left);
  const rightFamily = family(right);
  const single = comparison.shared[0];
  if (
    comparison.shared.length === 1 &&
    leftFamily === rightFamily &&
    leftFamily !== "other" &&
    single &&
    single.length >= 5 &&
    !RULER_ONLY_WORDS.has(single) &&
    comparison.containment >= 0.5
  ) return true;

  return false;
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
  if (objective === "Beğeni") return (video.likes / Math.max(video.views, 1)) * 1000 * quality;
  const speed = video.recentVelocity || (video.engagedViews || video.views) / Math.max(1, Math.min(21, videoAgeDays(video)));
  return Math.log10(speed + 10) * 25 * quality;
}

function themeRelevance(subject: string, video: VideoMetric) {
  let score = 0.06;
  if (detectHistoryTopic(subject) === detectHistoryTopic(video.title)) score += 0.38;
  if (family(subject) === family(video.title) && family(subject) !== "other") score += 0.28;
  const subjectRuler = detectOttomanRuler(subject);
  const videoRuler = detectOttomanRuler(video.title);
  if (subjectRuler !== "Diğer Osmanlı" && subjectRuler === videoRuler) score += 0.18;
  score += Math.min(0.28, titleSimilarity(subject, video.title) * 0.7);
  return clamp(score, 0.06, 1);
}

function evidenceFor(state: ChannelState, subject: string, objective: Objective) {
  const rows = state.videos
    .filter((video) => video.contentType === "SHORT" && video.views > 0)
    .map((video) => ({ video, relevance: themeRelevance(subject, video) }))
    .sort((left, right) => right.relevance - left.relevance || right.video.views - left.video.views)
    .slice(0, 12);
  if (!rows.length) return { score: 0, samples: 0 };
  const weight = rows.reduce((sum, row) => sum + row.relevance, 0);
  const score = rows.reduce((sum, row) => sum + objectiveValue(row.video, objective) * row.relevance, 0) / Math.max(weight, 0.001);
  return { score, samples: rows.filter((row) => row.relevance >= 0.34).length };
}

function laneFit(candidate: Candidate, lane: FixedLane) {
  const normalized = normalize(candidate.subject);
  let score = lane.familyWeights[candidate.family] || 0;
  if (lane.keywords.test(normalized)) score += 72;

  const topic = candidate.topic;
  if (lane.id === "war-siege" && topic === "Fetih & Savaş") score += 28;
  if (lane.id === "throne-dynasty" && topic === "Taht & Hanedan") score += 36;
  if (lane.id === "army-reform" && topic === "Kurumlar & Ordu") score += 36;
  if (lane.id === "ruler-intrigue" && (topic === "Padişahların Kararları" || topic === "Saray & Gündelik Hayat" || topic === "Diplomasi & İttifaklar")) score += 30;
  if (lane.id === "conquest-loss" && topic === "Fetih & Savaş") score += 16;
  if (lane.id === "rebellion-crisis" && (topic === "Taht & Hanedan" || candidate.family === "crisis" || candidate.family === "rebellion")) score += 22;
  return score;
}

function buildCandidatePool(state: ChannelState) {
  const published = state.videos.map((video) => video.title).filter(Boolean);
  const memory = ((state.planning as (typeof state.planning & PlanningMemory) | undefined)?.coveredSubjects || []).filter(Boolean);
  const blocked = [...published, ...memory];
  const all = buildViralTopicCandidates(state, 0);
  const fresh = all.filter((item) => item.sourceTitle.startsWith(SUBJECT_PREFIX));
  const source = fresh.length >= 160 ? fresh : all;
  const candidates: Candidate[] = [];

  source.forEach((item) => {
    const subject = subjectFromSource(item.title, item.sourceTitle);
    if (!subject) return;
    if (blocked.some((covered) => sameHistoricalSubject(subject, covered))) return;
    if (candidates.some((candidate) => sameHistoricalSubject(subject, candidate.subject))) return;

    const view = evidenceFor(state, subject, "İzlenme");
    const subscriber = evidenceFor(state, subject, "Abone");
    const like = evidenceFor(state, subject, "Beğeni");
    candidates.push({
      subject,
      sourceTitle: item.sourceTitle,
      family: family(subject),
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

function candidateScore(candidate: Candidate, objective: Objective, lane: FixedLane) {
  const evidence = objective === "Abone"
    ? candidate.subscriberScore * 17
    : objective === "Beğeni"
      ? candidate.likeScore * 0.88
      : candidate.viewScore * 1.2;
  const confidence = Math.min(12, candidate.evidenceSamples * 1.4);
  return laneFit(candidate, lane) * 1.45 + evidence + confidence + candidate.viralBonus * 0.1;
}

function selectCandidate(
  candidates: Candidate[],
  lane: FixedLane,
  objective: Objective,
  used: Candidate[],
  seed: number,
) {
  const available = candidates.filter((candidate) =>
    !used.some((usedCandidate) => sameHistoricalSubject(usedCandidate.subject, candidate.subject)));
  if (!available.length) return null;

  const matching = available.filter((candidate) => laneFit(candidate, lane) >= 48);
  const pool = matching.length ? matching : available.filter((candidate) => laneFit(candidate, lane) >= 24);
  const finalPool = pool.length ? pool : available;
  const ranked = finalPool
    .map((candidate) => ({ candidate, score: candidateScore(candidate, objective, lane) }))
    .sort((left, right) => right.score - left.score || left.candidate.subject.localeCompare(right.candidate.subject, "tr"));

  const top = ranked.slice(0, Math.min(4, ranked.length));
  return top[seed % top.length]?.candidate || ranked[0]?.candidate || null;
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

function shortObjective(schedule: WeeklyScheduleDay, time: string, index: number): Objective {
  return (schedule.shortSlots?.find((slot) => slot.time === time)?.objective as Objective | undefined) || DEFAULT_OBJECTIVES[index];
}

function shortPlanItem(
  state: ChannelState,
  candidate: Candidate,
  lane: FixedLane,
  objective: Objective,
  dateKey: string,
  dayLabel: string,
  time: string,
  slotIndex: number,
): PlanItem {
  const publishedCount = state.videos.length;
  return {
    id: `${dateKey}-short-${slotIndex}`,
    date: dateKey,
    dayLabel,
    format: "Shorts",
    title: candidate.subject,
    hook: "",
    duration: "45–60 sn",
    publishTime: time,
    pillar: lane.label,
    objective,
    priority: slotIndex === 3 || slotIndex === 4 ? "Yüksek" : "Normal",
    reason: `${lane.label} sabit içerik hattı. Kanaldaki ${publishedCount} yayın başlığı ve kalıcı konu hafızası tekrar engeli olarak kontrol edildi; seçim aynı kategorideki gerçek izlenme, tutma, beğeni ve abone sinyallerine göre yapıldı.`,
    voiceover: "",
    description: "",
    hashtags: [],
    cta: "",
    estimatedSeconds: 55,
    strategyMode: candidate.evidenceSamples >= 5 ? "Kazananı büyüt" : candidate.evidenceSamples >= 2 ? "Denge" : "Kontrollü test",
  };
}

function longPlanItem(
  state: ChannelState,
  candidate: Candidate,
  dateKey: string,
  dayLabel: string,
  time: string,
): PlanItem {
  return {
    id: `${dateKey}-long`,
    date: dateKey,
    dayLabel,
    format: "Uzun Video",
    title: candidate.subject,
    hook: "",
    duration: "8–12 dk",
    publishTime: time,
    pillar: LONG_VIDEO_LANE.label,
    objective: "İzlenme Süresi",
    priority: "Yüksek",
    reason: `Haftada bir sabit uzun video. Büyük savaş/sefer dosyası seçilir; kanaldaki ${state.videos.length} yayınlanmış konu ve daha önce planlanıp tamamlanan konular tekrar kullanılamaz.`,
    voiceover: "",
    description: "",
    hashtags: [],
    cta: "",
    estimatedSeconds: 600,
    strategyMode: "Kazananı büyüt",
  };
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
    const dayLabel = format(date, "EEEE", { locale: tr });
    const schedule = adaptiveSchedule.find((item) => item.day === date.getDay());
    if (!schedule) continue;

    for (let slotIndex = 0; slotIndex < FIXED_SHORT_TIMES.length; slotIndex += 1) {
      const time = FIXED_SHORT_TIMES[slotIndex];
      const lane = FIXED_LANES[slotIndex];
      const objective = shortObjective(schedule, time, slotIndex);
      const candidate = selectCandidate(
        candidates,
        lane,
        objective,
        used,
        dayIndex * 29 + slotIndex * 13,
      );
      if (!candidate) continue;
      used.push(candidate);
      plan.push(shortPlanItem(state, candidate, lane, objective, dateKey, dayLabel, time, slotIndex));
    }

    if (schedule.longVideoTime) {
      const candidate = selectCandidate(
        candidates,
        LONG_VIDEO_LANE,
        "İzlenme",
        used,
        dayIndex * 31 + 7,
      );
      if (candidate) {
        used.push(candidate);
        plan.push(longPlanItem(state, candidate, dateKey, dayLabel, schedule.longVideoTime));
      }
    }
  }

  return plan.sort((left, right) => left.date.localeCompare(right.date) || left.publishTime.localeCompare(right.publishTime));
}
