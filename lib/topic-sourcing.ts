import "server-only";

import { detectHistoryTopic, detectOttomanRuler, titleSimilarity } from "./history";
import type { ChannelState, TrendVideo, VideoMetric } from "./schema";

const DAY_MS = 86_400_000;

const TREND_NOISE = new Set([
  "short", "shorts", "youtube", "yt", "tarih", "tarihi", "osmanli", "osmanlı",
  "inanilmaz", "inanılmaz", "sok", "şok", "gercek", "gerçek", "bilinmeyen", "bak",
  "izle", "kesfet", "keşfet", "viral", "video",
]);

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function ageDays(video: VideoMetric) {
  const publishedAt = new Date(video.publishedAt).getTime();
  if (!Number.isFinite(publishedAt)) return 365;
  return Math.max(0.25, (Date.now() - publishedAt) / DAY_MS);
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

function cleanTrendTitle(value: string) {
  const withoutTags = value
    .replace(/#[\p{L}\p{N}_]+/gu, " ")
    .replace(/[|•·]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = withoutTags.split(/\s+/).filter((word) => {
    const key = normalize(word);
    return key.length > 1 && !TREND_NOISE.has(key);
  });

  return words.join(" ")
    .replace(/^[\-–—:;,]+|[\-–—:;,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function adaptTrendTitle(trend: TrendVideo, index: number) {
  const clean = cleanTrendTitle(trend.title).replace(/[?!\.]+$/g, "").trim();
  if (clean.length < 10) return null;

  const ruler = detectOttomanRuler(clean);
  const templates = ruler !== "Diğer Osmanlı"
    ? [
        `${clean}: Asıl Kırılma Noktası Neydi?`,
        `${clean}: Kaynaklar Ne Söylüyor?`,
        `${clean}: ${ruler} İçin Neden Önemliydi?`,
      ]
    : [
        `${clean}: Osmanlı İçin Neden Önemliydi?`,
        `${clean}: Gerçekte Ne Oldu?`,
        `${clean}: Dengeleri Nasıl Değiştirdi?`,
      ];

  return templates[index % templates.length];
}

function ownVideoStrength(video: VideoMetric) {
  const dailyVelocity = (video.recentVelocity || 0) > 0
    ? video.recentVelocity || 0
    : (video.engagedViews ?? video.views) / Math.max(1, Math.min(21, ageDays(video)));
  const retention = video.avgViewPercentage > 0 ? clamp(video.avgViewPercentage / 85, 0.5, 1.35) : 0.85;
  const engaged = (video.engagedViewRate || 0) > 0 ? clamp((video.engagedViewRate || 0) / 65, 0.55, 1.35) : 0.85;
  const likeRate = video.likes / Math.max(video.views, 1) * 100;
  const subscriberRate = Math.max(0, video.subscribersGained - video.subscribersLost) /
    Math.max(video.analyticsViews || video.views, 1) * 1000;

  return Math.log10(dailyVelocity + 10) * 12 * Math.sqrt(retention * engaged) +
    clamp(likeRate, 0, 12) * 1.2 + clamp(subscriberRate, 0, 15) * 1.6;
}

function topicRelatedness(candidate: string, reference: string) {
  let relatedness = titleSimilarity(candidate, reference);
  const candidateRuler = detectOttomanRuler(candidate);
  const referenceRuler = detectOttomanRuler(reference);
  if (candidateRuler !== "Diğer Osmanlı" && candidateRuler === referenceRuler) {
    relatedness = Math.max(relatedness, 0.34);
  }
  if (detectHistoryTopic(candidate) === detectHistoryTopic(reference)) {
    relatedness = Math.max(relatedness, 0.2);
  }
  return clamp(relatedness, 0, 1);
}

/**
 * YouTube API takipçilerin tek tek izleme geçmişini vermez. Bu skor bunun yerine
 * kanalın kendi Shorts kitlesinin hangi padişah, olay ve başlık kümelerinde
 * yüksek hız, tutma, beğeni ve abone dönüşümü ürettiğini kullanır.
 */
export function audienceAffinityScore(state: ChannelState, candidate: string) {
  const shorts = state.videos
    .filter((video) => video.contentType === "SHORT" && video.views > 0)
    .sort((left, right) => ownVideoStrength(right) - ownVideoStrength(left))
    .slice(0, 30);
  if (!shorts.length) return 0;

  const weighted = shorts
    .map((video) => {
      const relatedness = topicRelatedness(candidate, video.title);
      return { relatedness, value: ownVideoStrength(video) * relatedness };
    })
    .filter((row) => row.relatedness >= 0.18)
    .sort((left, right) => right.value - left.value)
    .slice(0, 6);

  if (!weighted.length) return 0;
  const average = weighted.reduce((sum, row) => sum + row.value, 0) / weighted.length;
  return clamp(average * 0.42, 0, 38);
}

export function viralDemandScore(state: ChannelState, candidate: string) {
  const trends = [...(state.trends || [])]
    .filter((trend) => trend.title && trend.trendScore > 0)
    .sort((left, right) => right.trendScore - left.trendScore)
    .slice(0, 30);
  if (!trends.length) return 0;

  const maxTrend = Math.max(...trends.map((trend) => trend.trendScore), 1);
  let best = 0;
  for (const trend of trends) {
    const demand = clamp(trend.trendScore / maxTrend, 0, 1);
    const relatedness = topicRelatedness(candidate, trend.title);
    best = Math.max(best, relatedness * (18 + demand * 42));
  }
  return clamp(best, 0, 60);
}

export function buildViralTopicCandidates(state: ChannelState, seed = 0) {
  const trends = [...(state.trends || [])]
    .filter((trend) => trend.title && trend.trendScore > 0)
    .sort((left, right) => right.trendScore - left.trendScore || right.viewsPerDay - left.viewsPerDay)
    .slice(0, 30);
  if (!trends.length) return [];

  const maxTrend = Math.max(...trends.map((trend) => trend.trendScore), 1);
  const seen = new Set<string>();
  const results: Array<{ title: string; viralBonus: number; sourceTitle: string }> = [];

  trends.forEach((trend, index) => {
    const title = adaptTrendTitle(trend, index + seed);
    if (!title) return;
    const key = normalize(title);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const demand = clamp(trend.trendScore / maxTrend, 0, 1);
    results.push({
      title,
      viralBonus: 22 + demand * 48,
      sourceTitle: trend.title,
    });
  });

  return results;
}
