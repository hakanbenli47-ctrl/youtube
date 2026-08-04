import "server-only";

import { google } from "googleapis";
import { detectHistoryTopic } from "./history";
import { saveState, updateState } from "./store";
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
    const channelResponse = await youtube.channels.list({
      part: ["snippet", "statistics", "contentDetails"],
      mine: true,
    });
    const channel = channelResponse.data.items?.[0];
    if (!channel) throw new Error("Bağlı hesapta YouTube kanalı bulunamadı.");
    const expected = process.env.YOUTUBE_TARGET_CHANNEL_ID?.trim();
    if (expected && channel.id !== expected) throw new Error("Yanlış YouTube kanalı seçildi.");

    const uploadsId = channel.contentDetails?.relatedPlaylists?.uploads;
    const uploadedIds: string[] = [];
    let pageToken: string | undefined;
    if (uploadsId) {
      do {
        const response = await youtube.playlistItems.list({
          part: ["contentDetails"],
          playlistId: uploadsId,
          maxResults: 50,
          pageToken,
        });
        uploadedIds.push(...(response.data.items || [])
          .map((item) => item.contentDetails?.videoId)
          .filter((id): id is string => Boolean(id)));
        pageToken = response.data.nextPageToken || undefined;
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
    for (const group of chunks(uploadedIds, 50)) {
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
      const age = Math.max(0.25, (Date.now() - new Date(meta?.publishedAt || previous?.publishedAt || Date.now()).getTime()) / DAY_MS);
      const viewsLast7Days = numeric(seven.views);
      return {
        id,
        title: meta?.title || previous?.title || "Başlıksız video",
        publishedAt: meta?.publishedAt || previous?.publishedAt || "",
        durationSeconds: seconds,
        contentType: contentType(all, seconds),
        creatorContentType: String(all.creatorContentType || ""),
        views,
        publicViews,
        analyticsViews,
        engagedViews,
        viewsLast7Days,
        engagedViewsLast7Days: numeric(seven.engagedViews),
        viewsLast28Days: numeric(twentyEight.views),
        engagedViewsLast28Days: numeric(twentyEight.engagedViews),
        engagedViewRate: analyticsViews > 0 ? Math.min(100, engagedViews / analyticsViews * 100) : 0,
        recentVelocity: viewsLast7Days > 0 ? viewsLast7Days / Math.min(7, age) : views / Math.max(1, Math.min(28, age)),
        watchHours: numeric(all.estimatedMinutesWatched) / 60,
        subscribersGained: numeric(all.subscribersGained),
        subscribersLost: numeric(all.subscribersLost),
        impressions: previous?.impressions ?? null,
        ctr: previous?.ctr ?? null,
        avgViewDurationSeconds: numeric(all.averageViewDuration),
        avgViewPercentage: numeric(all.averageViewPercentage),
        likes: Math.max(numeric(all.likes), meta?.likes || 0),
        comments: Math.max(numeric(all.comments), meta?.comments || 0),
        shares: numeric(all.shares),
        thumbnailUrl: meta?.thumbnailUrl,
        topic: detectHistoryTopic(meta?.title || previous?.title || ""),
        dataThroughDate: analyticsEndDate,
      };
    });

    const missing = videos.filter((video) => video.views > 0 && (video.analyticsViews || 0) === 0).length;
    const dataThroughDate = daily.at(-1)?.date || analyticsEndDate;
    const lag = daysBetween(dataThroughDate, today);
    if (lag > 1) warnings.push(`Analytics ${lag} gün geriden geliyor; canlı görüntülenme ayrıca gösteriliyor.`);
    if (missing) warnings.push(`${missing} yeni videonun ayrıntılı Analytics verisi henüz oluşmadı.`);
    const publicViews = numeric(channel.statistics?.viewCount);
    const analyticsViews = sum(videos.map((video) => video.analyticsViews || 0));
    const engagedViews = sum(videos.map((video) => video.engagedViews || 0));
    const netSubscribers = sum(daily.map((day) => day.subscribersGained - day.subscribersLost));

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
        lastYouTubeSync: new Date().toISOString(),
        lastSuccessfulYouTubeSync: new Date().toISOString(),
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
