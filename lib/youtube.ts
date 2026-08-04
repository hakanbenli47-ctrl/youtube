import "server-only";

import { google } from "googleapis";
import type { Credentials } from "google-auth-library";
import { detectHistoryTopic } from "./history";
import { getState, saveState, updateState } from "./store";
import type { ChannelState, DailyMetric, ShortsDailyMetric, TrendVideo, VideoMetric } from "./schema";

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} ayarı eksik.`);
  return value;
}

export function oauthClient() {
  return new google.auth.OAuth2(
    requiredEnv("YOUTUBE_CLIENT_ID"),
    requiredEnv("YOUTUBE_CLIENT_SECRET"),
    process.env.YOUTUBE_REDIRECT_URI ||
      "http://localhost:3000/api/auth/youtube/callback",
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
    scope: SCOPES,
    state: stateValue,
  });
}

export async function exchangeYouTubeCode(code: string, stateValue: string | null) {
  const state = await getState();
  if (!stateValue || stateValue !== state.auth.oauthState) {
    throw new Error("Google bağlantı doğrulaması geçersiz.");
  }
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  await saveState({
    ...state,
    auth: {
      connected: true,
      tokens: tokens as Record<string, unknown>,
    },
    sync: {
      ...state.sync,
      message: "YouTube bağlandı; ilk senkron başlatılabilir",
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
) {
  const names = (headers || []).map((header) => header.name || "");
  return (rows || []).map((row) =>
    Object.fromEntries(names.map((name, index) => [name, row[index]])),
  );
}

function numeric(value: unknown) {
  return Number(value || 0);
}

function dateDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

export async function syncYouTube() {
  let state = await updateState((current) => ({
    ...current,
    sync: { ...current.sync, status: "syncing", message: "YouTube verileri yenileniyor" },
  }));

  try {
    const auth = await authenticatedClient(state);
    const youtube = google.youtube({ version: "v3", auth });
    const analytics = google.youtubeAnalytics({ version: "v2", auth });
    const channelResponse = await youtube.channels.list({
      part: ["snippet", "statistics", "contentDetails"],
      mine: true,
    });
    const channel = channelResponse.data.items?.[0];
    if (!channel) throw new Error("Bağlı hesapta YouTube kanalı bulunamadı.");
    const expectedChannelId = process.env.YOUTUBE_TARGET_CHANNEL_ID;
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
    for (let index = 0; index < uploadedIds.length; index += 50) {
      const response = await youtube.videos.list({
        part: ["snippet", "statistics", "contentDetails"],
        id: uploadedIds.slice(index, index + 50),
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

    const endDate = dateDaysAgo(1);
    const startDate = dateDaysAgo(365);
    const dailyResponse = await analytics.reports.query({
      ids: "channel==MINE",
      startDate,
      endDate,
      dimensions: "day,creatorContentType",
      metrics:
        "engagedViews,views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost,likes,comments,shares",
      sort: "day",
    });
    const shortsFeedResponse = await analytics.reports.query({
      ids: "channel==MINE",
      startDate,
      endDate,
      dimensions: "day,creatorContentType,insightTrafficSourceType",
      metrics: "engagedViews,views,estimatedMinutesWatched",
      sort: "day",
    });
    const videoResponse = await analytics.reports.query({
      ids: "channel==MINE",
      startDate,
      endDate,
      dimensions: "video",
      metrics:
        "engagedViews,views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,likes,comments,shares",
      sort: "-views",
      maxResults: 200,
    });

    const dailyRows = rowsToObjects(
      dailyResponse.data.columnHeaders,
      dailyResponse.data.rows,
    );
    const dailyByDate = new Map<string, DailyMetric>();
    for (const row of dailyRows) {
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
      };
      current.views += numeric(row.views);
      current.engagedViews = numeric(current.engagedViews) + numeric(row.engagedViews);
      current.watchMinutes += numeric(row.estimatedMinutesWatched);
      current.subscribersGained += numeric(row.subscribersGained);
      current.subscribersLost += numeric(row.subscribersLost);
      current.likes += numeric(row.likes);
      current.comments += numeric(row.comments);
      current.shares += numeric(row.shares);
      dailyByDate.set(date, current);
    }
    const daily = [...dailyByDate.values()].sort((left, right) => left.date.localeCompare(right.date));
    const shortsDaily: ShortsDailyMetric[] = rowsToObjects(
      shortsFeedResponse.data.columnHeaders,
      shortsFeedResponse.data.rows,
    )
      .filter((row) =>
        String(row.creatorContentType).toLocaleUpperCase("tr-TR") === "SHORTS"
        && String(row.insightTrafficSourceType).toLocaleUpperCase("tr-TR") === "SHORTS")
      .map((row) => ({
        date: String(row.day),
        contentType: "SHORTS" as const,
        views: numeric(row.views),
        engagedViews: numeric(row.engagedViews),
        watchMinutes: numeric(row.estimatedMinutesWatched),
        subscribersGained: 0,
        subscribersLost: 0,
        likes: 0,
        comments: 0,
        shares: 0,
      }));

    const existingById = new Map(state.videos.map((video) => [video.id, video]));
    const analyticsById = new Map(
      rowsToObjects(videoResponse.data.columnHeaders, videoResponse.data.rows).map(
        (row) => [String(row.video), row],
      ),
    );
    const videos: VideoMetric[] = uploadedIds.map((id) => {
      const item = metadata.get(id);
      const metrics = analyticsById.get(id) || {};
      const existing = existingById.get(id);
      const title = item?.title || existing?.title || "Başlıksız video";
      const durationSeconds = item?.duration || existing?.durationSeconds || 0;
      const contentType =
        existing?.contentType ||
        (durationSeconds <= 180 ? "SHORT" : "LONG");
      const views = numeric(metrics.views) || item?.views || 0;
      const watchHours = numeric(metrics.estimatedMinutesWatched) / 60;
      return {
        id,
        title,
        publishedAt: item?.publishedAt || existing?.publishedAt || "",
        durationSeconds,
        contentType,
        views,
        engagedViews: numeric(metrics.engagedViews),
        watchHours,
        subscribersGained: numeric(metrics.subscribersGained),
        subscribersLost: numeric(metrics.subscribersLost),
        impressions: existing?.impressions ?? null,
        ctr: existing?.ctr ?? null,
        avgViewDurationSeconds: numeric(metrics.averageViewDuration),
        avgViewPercentage: numeric(metrics.averageViewPercentage),
        likes: numeric(metrics.likes) || item?.likes || 0,
        comments: numeric(metrics.comments) || item?.comments || 0,
        thumbnailUrl: item?.thumbnailUrl,
        topic: detectHistoryTopic(title),
      };
    });

    const publicViews = numeric(channel.statistics?.viewCount);
    const netSubscribers = videos.reduce(
      (total, video) =>
        total + video.subscribersGained - video.subscribersLost,
      0,
    );
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
        watchHours: videos.reduce((total, video) => total + video.watchHours, 0),
        netSubscribers,
      },
      videos,
      daily,
      shortsDaily,
      auth: {
        connected: true,
        tokens: auth.credentials as Record<string, unknown>,
      },
      sync: {
        ...state.sync,
        lastYouTubeSync: new Date().toISOString(),
        status: "ready",
        message: `${videos.length} video canlı verilerle yenilendi`,
      },
    };
    await saveState(state);
    return state;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Senkron hatası";
    await updateState((current) => ({
      ...current,
      sync: { ...current.sync, status: "error", message },
    }));
    throw error;
  }
}

export async function scanTrends() {
  const state = await getState();
  const auth = await authenticatedClient(state);
  const youtube = google.youtube({ version: "v3", auth });
  const queries = (
    process.env.TREND_SEEDS ||
    "osmanlı padişahları,osmanlı tarihi,osmanlı savaşları,osmanlı sarayı,osmanlı shorts,padişahların hayatı"
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 8);
  const publishedAfter = new Date(Date.now() - 30 * 86_400_000).toISOString();
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
  for (let index = 0; index < ids.length; index += 50) {
    const response = await youtube.videos.list({
      part: ["snippet", "statistics"],
      id: ids.slice(index, index + 50),
    });
    for (const item of response.data.items || []) {
      if (!item.id) continue;
      const views = numeric(item.statistics?.viewCount);
      const likes = numeric(item.statistics?.likeCount);
      const comments = numeric(item.statistics?.commentCount);
      const publishedAt = item.snippet?.publishedAt || new Date().toISOString();
      const ageDays = Math.max(
        1,
        (Date.now() - new Date(publishedAt).getTime()) / 86_400_000,
      );
      const viewsPerDay = views / ageDays;
      const engagement = views > 0 ? (likes + comments * 2) / views : 0;
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
        trendScore: Math.round((Math.log10(viewsPerDay + 1) * 22 + engagement * 300) * 10) / 10,
        query: queryByVideo.get(item.id) || "",
      });
    }
  }

  trends.sort((a, b) => b.trendScore - a.trendScore);
  const updated = {
    ...state,
    trends: trends.slice(0, 40),
    auth: { ...state.auth, tokens: auth.credentials as Record<string, unknown> },
    sync: {
      ...state.sync,
      lastTrendScan: new Date().toISOString(),
      message: `${Math.min(trends.length, 40)} trend video tarandı`,
    },
  };
  await saveState(updated);
  return updated;
}
