import "server-only";

import { google } from "googleapis";
import type { Credentials } from "google-auth-library";
import { detectHistoryTopic } from "./history";
import { getState, saveState, updateState } from "./store";
import type {
  ChannelState,
  DailyMetric,
  MetricSnapshot,
  ShortsDailyMetric,
  TrendVideo,
  VideoMetric,
} from "./schema";

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];
const DAY_MS = 86_400_000;
const VIDEO_REPORT_METRICS = [
  "engagedViews",
  "views",
  "estimatedMinutesWatched",
  "averageViewDuration",
  "averageViewPercentage",
  "subscribersGained",
  "subscribersLost",
  "likes",
  "comments",
  "shares",
].join(",");

type AnalyticsClient = ReturnType<typeof google.youtubeAnalytics>;
type AnalyticsQuery = Parameters<AnalyticsClient["reports"]["query"]>[0];
type AnalyticsRow = Record<string, unknown>;

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} ayarı eksik.`);
  return value;
}

function resolvedRedirectUri() {
  if (process.env.YOUTUBE_REDIRECT_URI?.trim()) {
    return process.env.YOUTUBE_REDIRECT_URI.trim();
  }
  const productionHost =
    process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (productionHost) {
    return `https://${productionHost.replace(/^https?:\/\//, "")}/api/auth/youtube/callback`;
  }
  return "http://localhost:3000/api/auth/youtube/callback";
}

export function oauthClient() {
  return new google.auth.OAuth2(
    requiredEnv("YOUTUBE_CLIENT_ID"),
    requiredEnv("YOUTUBE_CLIENT_SECRET"),
    resolvedRedirectUri(),
  );
}

export async function createYouTubeAuthUrl() {
  const stateValue = crypto.randomUUID();
  await updateState((state) => ({
    ...state,
    auth: { ...state.auth, oauthState: stateValue },
  }));
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: SCOPES,
    state: stateValue,
  });
}

export async function exchangeYouTubeCode(code: string, stateValue: string | null) {
  const state = await getState();
  if (!stateValue || stateValue !== state.auth.oauthState) {
    throw new Error(
      "Google bağlantı doğrulaması geçersiz. Kalıcı depolama bağlı değilse OAuth durumu kaybolmuş olabilir.",
    );
  }
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token && !state.auth.tokens?.refresh_token) {
    throw new Error("Google yenileme anahtarı vermedi. Erişimi kaldırıp yeniden bağlan.");
  }
  await saveState({
    ...state,
    auth: {
      connected: true,
      tokens: { ...(state.auth.tokens || {}), ...(tokens as Record<string, unknown>) },
    },
    sync: {
      ...state.sync,
      status: "ready",
      message: "YouTube bağlandı; ilk kapsamlı senkron başlatılabilir.",
    },
  });
}

async function authenticatedClient(state: ChannelState) {
  if (!state.auth.connected || !state.auth.tokens) {
    throw new Error("YouTube hesabı henüz bağlı değil.");
  }
  const client = oauthClient();
  client.setCredentials(state.auth.tokens as Credentials);
  return client;
}

function parseDuration(value?: string | null) {
  if (!value) return 0;
  const match = value.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

function rowsToObjects(
  headers: Array<{ name?: string | null }> | undefined,
  rows: unknown[][] | null | undefined,
): AnalyticsRow[] {
  const names = (headers || []).map((header) => header.name || "");
  return (rows || []).map((row) =>
    Object.fromEntries(names.map((name, index) => [name, row[index]])),
  );
}

function numeric(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function istanbulDateKey(offsetDays = 0) {
  const shifted = new Date(Date.now() + offsetDays * DAY_MS);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(shifted);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function dateDifferenceDays(older: string, newer: string) {
  const first = new Date(`${older}T12:00:00Z`).getTime();
  const second = new Date(`${newer}T12:00:00Z`).getTime();
  if (!Number.isFinite(first) || !Number.isFinite(second)) return 0;
  return Math.max(0, Math.round((second - first) / DAY_MS));
}

async function queryWithCurrentDayFallback(
  analytics: AnalyticsClient,
  params: AnalyticsQuery,
) {
  try {
    const response = await analytics.reports.query(params);
    return { response, endDate: String(params.endDate || istanbulDateKey()) };
  } catch (error) {
    const today = istanbulDateKey();
    if (params.endDate !== today) throw error;
    const fallbackEndDate = istanbulDateKey(-1);
    const response = await analytics.reports.query({
      ...params,
      endDate: fallbackEndDate,
    });
    return { response, endDate: fallbackEndDate };
  }
}

async function queryVideoReport(
  analytics: AnalyticsClient,
  videoIds: string[],
  startDate: string,
  endDate: string,
  metrics = VIDEO_REPORT_METRICS,
) {
  const rows: AnalyticsRow[] = [];
  for (const ids of chunks(videoIds, 200)) {
    if (!ids.length) continue;
    const { response } = await queryWithCurrentDayFallback(analytics, {
      ids: "channel==MINE",
      startDate,
      endDate,
      dimensions: "video,creatorContentType",
      metrics,
      filters: `video==${ids.join(",")}`,
      sort: "-views",
      maxResults: 200,
    });
    rows.push(...rowsToObjects(response.data.columnHeaders, response.data.rows));
  }
  return rows;
}

async function queryShortsFeedByVideo(
  analytics: AnalyticsClient,
  videoIds: string[],
  startDate: string,
  endDate: string,
) {
  const rows: AnalyticsRow[] = [];
  for (const ids of chunks(videoIds, 150)) {
    if (!ids.length) continue;
    const { response } = await queryWithCurrentDayFallback(analytics, {
      ids: "channel==MINE",
      startDate,
      endDate,
      dimensions: "video,creatorContentType,insightTrafficSourceType",
      metrics: "engagedViews,views,estimatedMinutesWatched",
      filters: `video==${ids.join(",")};insightTrafficSourceType==SHORTS`,
      sort: "-views",
      maxResults: 200,
    });
    rows.push(...rowsToObjects(response.data.columnHeaders, response.data.rows));
  }
  return rows;
}

function rowsByVideo(rows: AnalyticsRow[]) {
  return new Map(rows.map((row) => [String(row.video), row]));
}

function contentTypeFromAnalytics(value: unknown, durationSeconds: number): VideoMetric["contentType"] {
  const normalized = String(value || "").toUpperCase();
  if (normalized === "SHORTS") return "SHORT";
  if (normalized === "VIDEO_ON_DEMAND" || normalized === "LIVE_STREAM") return "LONG";
  return durationSeconds > 0 && durationSeconds <= 180 ? "SHORT" : durationSeconds > 180 ? "LONG" : "UNKNOWN";
}

function appendSnapshot(state: ChannelState, videos: VideoMetric[]): MetricSnapshot[] {
  const now = new Date().toISOString();
  const snapshot: MetricSnapshot = {
    capturedAt: now,
    videos: Object.fromEntries(videos.map((video) => [video.id, {
      views: video.views,
      engagedViews: video.engagedViews || 0,
      likes: video.likes,
      comments: video.comments,
      subscribersGained: video.subscribersGained,
      subscribersLost: video.subscribersLost,
    }])),
  };
  const current = [...(state.snapshots || [])]
    .filter((item) => Date.now() - new Date(item.capturedAt).getTime() <= 120 * DAY_MS)
    .sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));
  const last = current.at(-1);
  if (last && Date.now() - new Date(last.capturedAt).getTime() < 10 * 60_000) {
    current[current.length - 1] = snapshot;
  } else {
    current.push(snapshot);
  }
  return current.slice(-360);
}

export async function syncYouTube() {
  let state = await updateState((current) => ({
    ...current,
    sync: {
      ...current.sync,
      status: "syncing",
      message: "YouTube canlı görüntülenmeleri ve Analytics raporları yenileniyor.",
    },
  }));

  try {
    const auth = await authenticatedClient(state);
    const youtube = google.youtube({ version: "v3", auth });
    const analytics = google.youtubeAnalytics({ version: "v2", auth });
    const warnings: string[] = [];

    const channelResponse = await youtube.channels.list({
      part: ["snippet", "statistics", "contentDetails"],
      mine: true,
    });
    const channel = channelResponse.data.items?.[0];
    if (!channel) throw new Error("Bağlı hesapta YouTube kanalı bulunamadı.");

    const expectedChannelId = process.env.YOUTUBE_TARGET_CHANNEL_ID?.trim();
    if (expectedChannelId && channel.id !== expectedChannelId) {
      throw new Error(
        `Yanlış kanal seçildi. ${process.env.YOUTUBE_TARGET_TITLE || "hedef tarih kanalı"} hesabını yöneten Google profiliyle bağlan.`,
      );
    }

    const uploadsId = channel.contentDetails?.relatedPlaylists?.uploads;
    const uploadedIds: string[] = [];
    let pageToken: string | undefined;
    if (uploadsId) {
      do {
        const playlist = await youtube.playlistItems.list({
          part: ["contentDetails"],
          playlistId: uploadsId,
          maxResults: 50,
          pageToken,
        });
        uploadedIds.push(
          ...(playlist.data.items || [])
            .map((item) => item.contentDetails?.videoId)
            .filter((id): id is string => Boolean(id)),
        );
        pageToken = playlist.data.nextPageToken || undefined;
      } while (pageToken);
    }

    const metadata = new Map<string, {
      title: string;
      publishedAt: string;
      duration: number;
      thumbnailUrl: string;
      views: number;
      likes: number;
      comments: number;
    }>();

    for (const ids of chunks(uploadedIds, 50)) {
      const response = await youtube.videos.list({
        part: ["snippet", "statistics", "contentDetails"],
        id: ids,
      });
      for (const item of response.data.items || []) {
        if (!item.id) continue;
        metadata.set(item.id, {
          title: item.snippet?.title || "Başlıksız video",
          publishedAt: item.snippet?.publishedAt || "",
          duration: parseDuration(item.contentDetails?.duration),
          thumbnailUrl:
            item.snippet?.thumbnails?.medium?.url ||
            item.snippet?.thumbnails?.default?.url ||
            "",
          views: numeric(item.statistics?.viewCount),
          likes: numeric(item.statistics?.likeCount),
          comments: numeric(item.statistics?.commentCount),
        });
      }
    }

    const today = istanbulDateKey();
    const dailyStartDate = istanbulDateKey(-365);
    const lifetimeStartDate = "2005-01-01";

    const dailyQuery = await queryWithCurrentDayFallback(analytics, {
      ids: "channel==MINE",
      startDate: dailyStartDate,
      endDate: today,
      dimensions: "day,creatorContentType",
      metrics: "engagedViews,views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost,likes,comments,shares,uniques",
      sort: "day",
    });
    const analyticsEndDate = dailyQuery.endDate;

    const shortsFeedQuery = await queryWithCurrentDayFallback(analytics, {
      ids: "channel==MINE",
      startDate: dailyStartDate,
      endDate: analyticsEndDate,
      dimensions: "day,creatorContentType,insightTrafficSourceType",
      metrics: "engagedViews,views,estimatedMinutesWatched",
      sort: "day",
    });

    const [lifetimeRows, recent7Rows, recent28Rows] = await Promise.all([
      queryVideoReport(analytics, uploadedIds, lifetimeStartDate, analyticsEndDate),
      queryVideoReport(analytics, uploadedIds, istanbulDateKey(-6), analyticsEndDate),
      queryVideoReport(analytics, uploadedIds, istanbulDateKey(-27), analyticsEndDate),
    ]);

    let shortsFeedVideoRows: AnalyticsRow[] = [];
    try {
      shortsFeedVideoRows = await queryShortsFeedByVideo(
        analytics,
        uploadedIds,
        lifetimeStartDate,
        analyticsEndDate,
      );
    } catch (error) {
      warnings.push("Video bazlı Shorts akış kaynağı raporu alınamadı; toplam Shorts raporu kullanılacak.");
      console.error("Shorts feed video report failed", error);
    }

    const dailyByDate = new Map<string, DailyMetric>();
    for (const row of rowsToObjects(dailyQuery.response.data.columnHeaders, dailyQuery.response.data.rows)) {
      const date = String(row.day);
      const current = dailyByDate.get(date) || {
        date,
        views: 0,
        engagedViews: 0,
        watchMinutes: 0,
        subscribersGained: 0,
        subscribersLost: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        uniques: 0,
      };
      current.views += numeric(row.views);
      current.engagedViews = numeric(current.engagedViews) + numeric(row.engagedViews);
      current.watchMinutes += numeric(row.estimatedMinutesWatched);
      current.subscribersGained += numeric(row.subscribersGained);
      current.subscribersLost += numeric(row.subscribersLost);
      current.likes += numeric(row.likes);
      current.comments += numeric(row.comments);
      current.shares += numeric(row.shares);
      current.uniques = numeric(current.uniques) + numeric(row.uniques);
      dailyByDate.set(date, current);
    }
    const daily = [...dailyByDate.values()].sort((left, right) => left.date.localeCompare(right.date));

    const shortsDailyByDate = new Map<string, ShortsDailyMetric>();
    for (const row of rowsToObjects(
      shortsFeedQuery.response.data.columnHeaders,
      shortsFeedQuery.response.data.rows,
    )) {
      if (
        String(row.creatorContentType).toUpperCase() !== "SHORTS" ||
        String(row.insightTrafficSourceType).toUpperCase() !== "SHORTS"
      ) continue;
      const date = String(row.day);
      const current = shortsDailyByDate.get(date) || {
        date,
        contentType: "SHORTS" as const,
        views: 0,
        engagedViews: 0,
        watchMinutes: 0,
        subscribersGained: 0,
        subscribersLost: 0,
        likes: 0,
        comments: 0,
        shares: 0,
      };
      current.views += numeric(row.views);
      current.engagedViews = numeric(current.engagedViews) + numeric(row.engagedViews);
      current.watchMinutes += numeric(row.estimatedMinutesWatched);
      shortsDailyByDate.set(date, current);
    }
    const shortsDaily = [...shortsDailyByDate.values()]
      .sort((left, right) => left.date.localeCompare(right.date));

    const existingById = new Map(state.videos.map((video) => [video.id, video]));
    const lifetimeById = rowsByVideo(lifetimeRows);
    const recent7ById = rowsByVideo(recent7Rows);
    const recent28ById = rowsByVideo(recent28Rows);
    const shortsFeedById = rowsByVideo(shortsFeedVideoRows);

    const videos: VideoMetric[] = uploadedIds.map((id) => {
      const item = metadata.get(id);
      const lifetime = lifetimeById.get(id) || {};
      const recent7 = recent7ById.get(id) || {};
      const recent28 = recent28ById.get(id) || {};
      const shortsFeed = shortsFeedById.get(id) || {};
      const existing = existingById.get(id);
      const title = item?.title || existing?.title || "Başlıksız video";
      const durationSeconds = item?.duration || existing?.durationSeconds || 0;
      const creatorContentType = String(
        lifetime.creatorContentType || recent7.creatorContentType || existing?.creatorContentType || "",
      );
      const contentType = contentTypeFromAnalytics(creatorContentType, durationSeconds);
      const analyticsViews = numeric(lifetime.views);
      const publicViews = Math.max(item?.views || 0, existing?.publicViews || 0);
      const views = Math.max(publicViews, analyticsViews, existing?.views || 0);
      const engagedViews = numeric(lifetime.engagedViews);
      const viewsLast7Days = numeric(recent7.views);
      const engagedViewsLast7Days = numeric(recent7.engagedViews);
      const viewsLast28Days = numeric(recent28.views);
      const engagedViewsLast28Days = numeric(recent28.engagedViews);
      const ageDays = Math.max(
        0.25,
        (Date.now() - new Date(item?.publishedAt || existing?.publishedAt || Date.now()).getTime()) / DAY_MS,
      );
      const recentVelocity = viewsLast7Days > 0
        ? viewsLast7Days / Math.min(7, ageDays)
        : views / Math.max(1, Math.min(28, ageDays));
      const engagedViewRate = analyticsViews > 0
        ? clamp((engagedViews / analyticsViews) * 100, 0, 100)
        : 0;

      return {
        id,
        title,
        publishedAt: item?.publishedAt || existing?.publishedAt || "",
        durationSeconds,
        contentType,
        creatorContentType,
        views,
        publicViews,
        analyticsViews,
        engagedViews,
        viewsLast7Days,
        engagedViewsLast7Days,
        viewsLast28Days,
        engagedViewsLast28Days,
        shortsFeedViews: numeric(shortsFeed.views),
        shortsFeedEngagedViews: numeric(shortsFeed.engagedViews),
        engagedViewRate,
        recentVelocity,
        watchHours: numeric(lifetime.estimatedMinutesWatched) / 60,
        subscribersGained: numeric(lifetime.subscribersGained),
        subscribersLost: numeric(lifetime.subscribersLost),
        impressions: existing?.impressions ?? null,
        ctr: existing?.ctr ?? null,
        avgViewDurationSeconds: numeric(lifetime.averageViewDuration),
        avgViewPercentage: numeric(lifetime.averageViewPercentage),
        likes: Math.max(numeric(lifetime.likes), item?.likes || 0),
        comments: Math.max(numeric(lifetime.comments), item?.comments || 0),
        shares: numeric(lifetime.shares),
        thumbnailUrl: item?.thumbnailUrl,
        topic: detectHistoryTopic(title),
        dataThroughDate: analyticsEndDate,
      };
    });

    const publicViews = numeric(channel.statistics?.viewCount);
    const analyticsViews = videos.reduce((total, video) => total + (video.analyticsViews || 0), 0);
    const engagedViews = videos.reduce((total, video) => total + (video.engagedViews || 0), 0);
    const dailyNetSubscribers = daily.reduce(
      (total, day) => total + day.subscribersGained - day.subscribersLost,
      0,
    );
    const videoNetSubscribers = videos.reduce(
      (total, video) => total + video.subscribersGained - video.subscribersLost,
      0,
    );
    const dataThroughDate = daily.at(-1)?.date || analyticsEndDate;
    const analyticsLagDays = dateDifferenceDays(dataThroughDate, today);
    if (analyticsLagDays > 1) {
      warnings.push(`YouTube Analytics raporu ${analyticsLagDays} gün geriden geliyor; canlı görüntülenme Data API'den gösteriliyor.`);
    }
    const missingVideoAnalytics = videos.filter((video) =>
      video.views > 0 && (video.analyticsViews || 0) === 0).length;
    if (missingVideoAnalytics) {
      warnings.push(`${missingVideoAnalytics} yeni videoda ayrıntılı Analytics henüz oluşmadı; canlı görüntülenme yine gösteriliyor.`);
    }

    const snapshots = appendSnapshot(state, videos);
    state = {
      ...state,
      channel: {
        id: channel.id || "",
        title: channel.snippet?.title?.trim() || state.channel.title,
        handle: channel.snippet?.customUrl || state.channel.handle,
        thumbnailUrl:
          channel.snippet?.thumbnails?.medium?.url ||
          channel.snippet?.thumbnails?.default?.url ||
          "",
        subscriberCount: numeric(channel.statistics?.subscriberCount),
        videoCount: numeric(channel.statistics?.videoCount),
        viewCount: publicViews,
      },
      totals: {
        ...state.totals,
        views: publicViews,
        analyticsViews,
        engagedViews,
        watchHours: daily.reduce((total, day) => total + day.watchMinutes, 0) / 60,
        netSubscribers: dailyNetSubscribers || videoNetSubscribers,
      },
      videos,
      daily,
      shortsDaily,
      snapshots,
      auth: {
        connected: true,
        tokens: { ...(state.auth.tokens || {}), ...(auth.credentials as Record<string, unknown>) },
      },
      sync: {
        ...state.sync,
        lastYouTubeSync: new Date().toISOString(),
        lastSuccessfulYouTubeSync: new Date().toISOString(),
        dataThroughDate,
        analyticsLagDays,
        warnings,
        status: "ready",
        message: `${videos.length} video yenilendi. Canlı görüntülenmeler güncel; ayrıntılı Analytics ${dataThroughDate} tarihine kadar.`,
      },
    };
    await saveState(state);
    return state;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Senkron hatası";
    await updateState((current) => ({
      ...current,
      sync: {
        ...current.sync,
        status: "error",
        message,
        warnings: [...(current.sync.warnings || []), message].slice(-8),
      },
    }));
    throw error;
  }
}

export async function scanTrends() {
  const state = await getState();
  const auth = await authenticatedClient(state);
  const youtube = google.youtube({ version: "v3", auth });
  const learnedSeeds = [...new Set(
    state.videos
      .filter((video) => video.contentType === "SHORT")
      .sort((left, right) => (right.recentVelocity || 0) - (left.recentVelocity || 0))
      .slice(0, 5)
      .flatMap((video) => [video.topic, video.title.split(" ").slice(0, 4).join(" ")]),
  )];
  const queries = (
    process.env.TREND_SEEDS ||
    [
      "osmanlı padişahları",
      "osmanlı tarihi",
      "osmanlı savaşları",
      "osmanlı sarayı",
      ...learnedSeeds,
    ].join(",")
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 8);
  const publishedAfter = new Date(Date.now() - 45 * DAY_MS).toISOString();
  const queryByVideo = new Map<string, string>();

  for (const query of queries) {
    const response = await youtube.search.list({
      part: ["snippet"],
      q: query,
      type: ["video"],
      order: "viewCount",
      maxResults: 10,
      publishedAfter,
      relevanceLanguage: "tr",
      regionCode: "TR",
    });
    for (const item of response.data.items || []) {
      if (item.id?.videoId) queryByVideo.set(item.id.videoId, query);
    }
  }

  const ids = [...queryByVideo.keys()];
  const trends: TrendVideo[] = [];
  for (const videoIds of chunks(ids, 50)) {
    const response = await youtube.videos.list({
      part: ["snippet", "statistics", "contentDetails"],
      id: videoIds,
    });
    for (const item of response.data.items || []) {
      if (!item.id || item.snippet?.channelId === state.channel.id) continue;
      const duration = parseDuration(item.contentDetails?.duration);
      if (duration > 180 || duration === 0) continue;
      const views = numeric(item.statistics?.viewCount);
      const likes = numeric(item.statistics?.likeCount);
      const comments = numeric(item.statistics?.commentCount);
      const publishedAt = item.snippet?.publishedAt || new Date().toISOString();
      const ageDays = Math.max(0.25, (Date.now() - new Date(publishedAt).getTime()) / DAY_MS);
      const viewsPerDay = views / ageDays;
      const engagement = views > 0 ? (likes + comments * 2) / views : 0;
      const freshness = Math.max(0, 1 - ageDays / 45);
      trends.push({
        id: item.id,
        title: item.snippet?.title || "",
        channelTitle: item.snippet?.channelTitle || "",
        publishedAt,
        thumbnailUrl:
          item.snippet?.thumbnails?.medium?.url ||
          item.snippet?.thumbnails?.default?.url ||
          "",
        views,
        likes,
        comments,
        viewsPerDay,
        trendScore: Math.round((
          Math.log10(viewsPerDay + 1) * 24 +
          Math.min(20, engagement * 320) +
          freshness * 8
        ) * 10) / 10,
        query: queryByVideo.get(item.id) || "",
      });
    }
  }

  trends.sort((left, right) => right.trendScore - left.trendScore);
  const updated: ChannelState = {
    ...state,
    trends: trends.slice(0, 40),
    auth: {
      ...state.auth,
      tokens: { ...(state.auth.tokens || {}), ...(auth.credentials as Record<string, unknown>) },
    },
    sync: {
      ...state.sync,
      lastTrendScan: new Date().toISOString(),
      message: `${Math.min(trends.length, 40)} güncel Shorts trendi tarandı.`,
    },
  };
  await saveState(updated);
  return updated;
}