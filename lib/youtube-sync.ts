import "server-only";

import { google } from "googleapis";
import { detectHistoryTopic } from "./history";
import { getState, saveState, updateState } from "./store";
import type { ChannelState, DailyMetric, ShortsDailyMetric, VideoMetric } from "./schema";
import {
  DAY_MS,
  appendSnapshot,
  authenticatedClient,
  byVideo,
  chunks,
  contentType,
  dateKey,
  daysBetween,
  numeric,
  report,
  rows,
  sum,
  videoReport,
  durationSeconds,
} from "./youtube-core";

function ageDaysForRetention(video: VideoMetric) {
  const published = new Date(video.publishedAt).getTime();
  return Number.isFinite(published) ? Math.max(0, (Date.now() - published) / DAY_MS) : 999;
}

type PublicMetadata = {
  title: string;
  publishedAt: string;
  duration: number;
  thumbnailUrl: string;
  views: number;
  likes: number;
  comments: number;
};

async function assertChannel(
  youtube: ReturnType<typeof google.youtube>,
) {
  const response = await youtube.channels.list({
    part: ["snippet", "statistics", "contentDetails"],
    mine: true,
  });
  const channel = response.data.items?.[0];
  if (!channel) throw new Error("Bağlı hesapta YouTube kanalı bulunamadı.");
  const expected = process.env.YOUTUBE_TARGET_CHANNEL_ID?.trim();
  if (expected && channel.id !== expected) throw new Error("Yanlış YouTube kanalı seçildi.");
  return channel;
}

async function uploadedVideoIds(
  youtube: ReturnType<typeof google.youtube>,
  uploadsId: string | null | undefined,
) {
  const ids: string[] = [];
  let pageToken: string | undefined;
  if (!uploadsId) return ids;
  do {
    const response = await youtube.playlistItems.list({
      part: ["contentDetails"],
      playlistId: uploadsId,
      maxResults: 50,
      pageToken,
    });
    ids.push(...(response.data.items || [])
      .map((item) => item.contentDetails?.videoId)
      .filter((id): id is string => Boolean(id)));
    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);
  return ids;
}

async function publicMetadata(
  youtube: ReturnType<typeof google.youtube>,
  ids: string[],
) {
  const metadata = new Map<string, PublicMetadata>();
  for (const group of chunks(ids, 50)) {
    if (!group.length) continue;
    const response = await youtube.videos.list({
      part: ["snippet", "statistics", "contentDetails"],
      id: group,
    });
    for (const item of response.data.items || []) {
      if (!item.id) continue;
      metadata.set(item.id, {
        title: item.snippet?.title || "Başlıksız video",
        publishedAt: item.snippet?.publishedAt || "",
        duration: durationSeconds(item.contentDetails?.duration),
        thumbnailUrl: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || "",
        views: numeric(item.statistics?.viewCount),
        likes: numeric(item.statistics?.likeCount),
        comments: numeric(item.statistics?.commentCount),
      });
    }
  }
  return metadata;
}


type RetentionSummary = {
  retention10Percent: number;
  retention50Percent: number;
  retention90Percent: number;
  relativeRetention10Percent: number;
};

async function retentionSummary(
  analytics: ReturnType<typeof google.youtubeAnalytics>,
  videoId: string,
  endDate: string,
): Promise<RetentionSummary | null> {
  try {
    const { response } = await report(analytics, {
      ids: "channel==MINE",
      startDate: "2005-01-01",
      endDate,
      dimensions: "elapsedVideoTimeRatio",
      metrics: "audienceWatchRatio,relativeRetentionPerformance",
      filters: `video==${videoId}`,
      sort: "elapsedVideoTimeRatio",
    });
    const points = rows(response.data.columnHeaders, response.data.rows)
      .map((row) => ({
        ratio: numeric(row.elapsedVideoTimeRatio),
        watch: numeric(row.audienceWatchRatio) * 100,
        relative: numeric(row.relativeRetentionPerformance) * 100,
      }))
      .filter((row) => row.ratio > 0 && row.watch > 0);
    if (!points.length) return null;
    const nearest = (target: number) =>
      [...points].sort((left, right) => Math.abs(left.ratio - target) - Math.abs(right.ratio - target))[0];
    const at10 = nearest(0.10);
    const at50 = nearest(0.50);
    const at90 = nearest(0.90);
    return {
      retention10Percent: Math.min(200, at10.watch),
      retention50Percent: Math.min(200, at50.watch),
      retention90Percent: Math.min(200, at90.watch),
      relativeRetention10Percent: Math.min(100, at10.relative),
    };
  } catch {
    // Retention verisi yeni videolarda gecikebilir. Ana senkronu asla düşürme.
    return null;
  }
}

export async function refreshPublicYouTubeStats(existingState?: ChannelState) {
  const state = existingState || await getState();
  const auth = await authenticatedClient(state);
  const youtube = google.youtube({ version: "v3", auth });
  const channel = await assertChannel(youtube);
  const ids = state.videos.map((video) => video.id);
  const metadata = await publicMetadata(youtube, ids);
  const videos = state.videos.map((video) => {
    const current = metadata.get(video.id);
    if (!current) return video;
    return {
      ...video,
      title: current.title || video.title,
      publishedAt: current.publishedAt || video.publishedAt,
      durationSeconds: current.duration || video.durationSeconds,
      views: Math.max(current.views, video.analyticsViews || 0),
      publicViews: current.views,
      likes: Math.max(current.likes, video.likes),
      comments: Math.max(current.comments, video.comments),
      thumbnailUrl: current.thumbnailUrl || video.thumbnailUrl,
      topic: detectHistoryTopic(current.title || video.title),
    };
  });
  const now = new Date().toISOString();
  const updated: ChannelState = {
    ...state,
    channel: {
      id: channel.id || state.channel.id,
      title: channel.snippet?.title?.trim() || state.channel.title,
      handle: channel.snippet?.customUrl || state.channel.handle,
      thumbnailUrl: channel.snippet?.thumbnails?.medium?.url || channel.snippet?.thumbnails?.default?.url || state.channel.thumbnailUrl,
      subscriberCount: numeric(channel.statistics?.subscriberCount),
      videoCount: numeric(channel.statistics?.videoCount),
      viewCount: numeric(channel.statistics?.viewCount),
    },
    totals: {
      ...state.totals,
      views: numeric(channel.statistics?.viewCount),
    },
    videos,
    snapshots: appendSnapshot(state, videos),
    auth: {
      connected: true,
      tokens: { ...(state.auth.tokens || {}), ...(auth.credentials as Record<string, unknown>) },
    },
    sync: {
      ...state.sync,
      lastPublicStatsSync: now,
      status: "ready",
      message: state.sync.dataThroughDate
        ? `Canlı görüntülenmeler güncel; ayrıntılı Analytics ${state.sync.dataThroughDate} tarihine kadar.`
        : "Canlı görüntülenmeler güncellendi; ayrıntılı Analytics senkronu bekleniyor.",
    },
  };
  await saveState(updated);
  return updated;
}

export async function syncYouTube() {
  let state = await updateState((current) => ({
    ...current,
    sync: { ...current.sync, status: "syncing", message: "Canlı görüntülenmeler ve Analytics yenileniyor." },
  }));

  try {
    const auth = await authenticatedClient(state);
    const youtube = google.youtube({ version: "v3", auth });
    const analytics = google.youtubeAnalytics({ version: "v2", auth });
    const warnings: string[] = [];
    const channel = await assertChannel(youtube);
    const uploadedIds = await uploadedVideoIds(
      youtube,
      channel.contentDetails?.relatedPlaylists?.uploads,
    );
    const metadata = await publicMetadata(youtube, uploadedIds);

    const today = dateKey();
    const dailyResult = await report(analytics, {
      ids: "channel==MINE",
      startDate: dateKey(-365),
      endDate: today,
      dimensions: "day,creatorContentType",
      metrics: "engagedViews,views,estimatedMinutesWatched,subscribersGained,subscribersLost,likes,comments,shares",
      sort: "day",
    });
    const analyticsEndDate = dailyResult.endDate;
    const shortsResult = await report(analytics, {
      ids: "channel==MINE",
      startDate: dateKey(-365),
      endDate: analyticsEndDate,
      dimensions: "day,creatorContentType,insightTrafficSourceType",
      metrics: "engagedViews,views,estimatedMinutesWatched",
      sort: "day",
    });
    const [lifetimeRows, recent7Rows, recent28Rows] = await Promise.all([
      videoReport(analytics, uploadedIds, "2005-01-01", analyticsEndDate),
      videoReport(analytics, uploadedIds, dateKey(-6), analyticsEndDate),
      videoReport(analytics, uploadedIds, dateKey(-27), analyticsEndDate),
    ]);

    const dailyMap = new Map<string, DailyMetric>();
    for (const row of rows(dailyResult.response.data.columnHeaders, dailyResult.response.data.rows)) {
      const date = String(row.day);
      const current = dailyMap.get(date) || {
        date, views: 0, engagedViews: 0, watchMinutes: 0,
        subscribersGained: 0, subscribersLost: 0, likes: 0, comments: 0, shares: 0,
      };
      current.views += numeric(row.views);
      current.engagedViews = numeric(current.engagedViews) + numeric(row.engagedViews);
      current.watchMinutes += numeric(row.estimatedMinutesWatched);
      current.subscribersGained += numeric(row.subscribersGained);
      current.subscribersLost += numeric(row.subscribersLost);
      current.likes += numeric(row.likes);
      current.comments += numeric(row.comments);
      current.shares += numeric(row.shares);
      dailyMap.set(date, current);
    }
    const daily = [...dailyMap.values()].sort((left, right) => left.date.localeCompare(right.date));

    const shortsMap = new Map<string, ShortsDailyMetric>();
    for (const row of rows(shortsResult.response.data.columnHeaders, shortsResult.response.data.rows)) {
      if (String(row.creatorContentType).toUpperCase() !== "SHORTS" ||
          String(row.insightTrafficSourceType).toUpperCase() !== "SHORTS") continue;
      const date = String(row.day);
      const current = shortsMap.get(date) || {
        date, contentType: "SHORTS" as const, views: 0, engagedViews: 0, watchMinutes: 0,
        subscribersGained: 0, subscribersLost: 0, likes: 0, comments: 0, shares: 0,
      };
      current.views += numeric(row.views);
      current.engagedViews = numeric(current.engagedViews) + numeric(row.engagedViews);
      current.watchMinutes += numeric(row.estimatedMinutesWatched);
      shortsMap.set(date, current);
    }

    const lifetime = byVideo(lifetimeRows);
    const recent7 = byVideo(recent7Rows);
    const recent28 = byVideo(recent28Rows);
    const existing = new Map<string, VideoMetric>(state.videos.map((video) => [video.id, video]));
    const videos: VideoMetric[] = uploadedIds.map((id) => {
      const meta = metadata.get(id);
      const all = lifetime.get(id) || {};
      const seven = recent7.get(id) || {};
      const twentyEight = recent28.get(id) || {};
      const previous = existing.get(id);
      const seconds = meta?.duration || previous?.durationSeconds || 0;
      const publicViews = meta?.views || 0;
      const analyticsViews = numeric(all.views);
      const views = Math.max(publicViews, analyticsViews);
      const engagedViews = numeric(all.engagedViews);
      const publishedAt = meta?.publishedAt || previous?.publishedAt || "";
      const publishedTime = new Date(publishedAt).getTime();
      const age = Math.max(0.25, Number.isFinite(publishedTime)
        ? (Date.now() - publishedTime) / DAY_MS
        : 1);
      const viewsLast7Days = numeric(seven.views);
      const viewsLast28Days = numeric(twentyEight.views);
      return {
        id,
        title: meta?.title || previous?.title || "Başlıksız video",
        publishedAt,
        durationSeconds: seconds,
        contentType: contentType(all, seconds, previous?.contentType),
        creatorContentType: String(all.creatorContentType || previous?.creatorContentType || ""),
        views,
        publicViews,
        analyticsViews,
        engagedViews,
        viewsLast7Days,
        engagedViewsLast7Days: numeric(seven.engagedViews),
        viewsLast28Days,
        engagedViewsLast28Days: numeric(twentyEight.engagedViews),
        engagedViewRate: analyticsViews > 0 ? Math.min(100, engagedViews / analyticsViews * 100) : 0,
        recentVelocity: viewsLast7Days > 0
          ? viewsLast7Days / Math.max(1, Math.min(7, age))
          : viewsLast28Days > 0
            ? viewsLast28Days / Math.max(1, Math.min(28, age))
            : age <= 28
              ? views / Math.max(1, age)
              : 0,
        watchHours: numeric(all.estimatedMinutesWatched) / 60,
        subscribersGained: numeric(all.subscribersGained),
        subscribersLost: numeric(all.subscribersLost),
        impressions: previous?.impressions ?? null,
        ctr: previous?.ctr ?? null,
        avgViewDurationSeconds: numeric(all.averageViewDuration),
        avgViewPercentage: numeric(all.averageViewPercentage),
        retention10Percent: previous?.retention10Percent,
        retention50Percent: previous?.retention50Percent,
        retention90Percent: previous?.retention90Percent,
        relativeRetention10Percent: previous?.relativeRetention10Percent,
        retentionUpdatedAt: previous?.retentionUpdatedAt,
        likes: Math.max(numeric(all.likes), meta?.likes || 0),
        comments: Math.max(numeric(all.comments), meta?.comments || 0),
        shares: numeric(all.shares),
        thumbnailUrl: meta?.thumbnailUrl,
        topic: detectHistoryTopic(meta?.title || previous?.title || ""),
        dataThroughDate: analyticsEndDate,
      };
    });

    const retentionTargets = videos
      .filter((video) => video.contentType === "SHORT" && video.views >= 100 && ageDaysForRetention(video) <= 45)
      .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
      .slice(0, 4);
    for (const video of retentionTargets) {
      const updatedAt = video.retentionUpdatedAt ? new Date(video.retentionUpdatedAt).getTime() : 0;
      if (updatedAt && Date.now() - updatedAt < 18 * 60 * 60_000) continue;
      const retention = await retentionSummary(analytics, video.id, analyticsEndDate);
      if (!retention) continue;
      Object.assign(video, retention, { retentionUpdatedAt: new Date().toISOString() });
    }

    const missing = videos.filter((video) => video.views > 0 && (video.analyticsViews || 0) === 0).length;
    const dataThroughDate = daily.at(-1)?.date || analyticsEndDate;
    const lag = daysBetween(dataThroughDate, today);
    if (lag > 1) warnings.push(`Analytics ${lag} gün geriden geliyor; canlı görüntülenme ayrıca gösteriliyor.`);
    if (missing) warnings.push(`${missing} yeni videonun ayrıntılı Analytics verisi henüz oluşmadı.`);
    const publicViews = numeric(channel.statistics?.viewCount);
    const analyticsViews = sum(videos.map((video) => video.analyticsViews || 0));
    const engagedViews = sum(videos.map((video) => video.engagedViews || 0));
    const netSubscribers = sum(daily.map((day) => day.subscribersGained - day.subscribersLost));
    const now = new Date().toISOString();

    state = {
      ...state,
      channel: {
        id: channel.id || "",
        title: channel.snippet?.title?.trim() || state.channel.title,
        handle: channel.snippet?.customUrl || state.channel.handle,
        thumbnailUrl: channel.snippet?.thumbnails?.medium?.url || channel.snippet?.thumbnails?.default?.url || "",
        subscriberCount: numeric(channel.statistics?.subscriberCount),
        videoCount: numeric(channel.statistics?.videoCount),
        viewCount: publicViews,
      },
      totals: {
        ...state.totals,
        views: publicViews,
        analyticsViews,
        engagedViews,
        watchHours: sum(daily.map((day) => day.watchMinutes)) / 60,
        netSubscribers,
      },
      videos,
      daily,
      shortsDaily: [...shortsMap.values()].sort((left, right) => left.date.localeCompare(right.date)),
      snapshots: appendSnapshot(state, videos),
      auth: { connected: true, tokens: { ...(state.auth.tokens || {}), ...(auth.credentials as Record<string, unknown>) } },
      sync: {
        ...state.sync,
        lastYouTubeSync: now,
        lastSuccessfulYouTubeSync: now,
        lastPublicStatsSync: now,
        dataThroughDate,
        analyticsLagDays: lag,
        warnings,
        status: "ready",
        message: `${videos.length} video yenilendi; canlı görüntülenme güncel, Analytics ${dataThroughDate} tarihine kadar.`,
      },
    };
    await saveState(state);
    return state;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Senkron hatası";
    await updateState((current) => ({
      ...current,
      sync: { ...current.sync, status: "error", message, warnings: [...(current.sync.warnings || []), message].slice(-8) },
    }));
    throw error;
  }
}
