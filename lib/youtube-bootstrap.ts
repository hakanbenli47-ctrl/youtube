import "server-only";

import { google } from "googleapis";
import { detectHistoryTopic } from "./history";
import { getState, saveState } from "./store";
import type { ChannelState, VideoMetric } from "./schema";
import {
  appendSnapshot,
  authenticatedClient,
  chunks,
  durationSeconds,
  numeric,
} from "./youtube-core";

/**
 * Vercel /tmp boşaldığında ağır YouTube Analytics raporlarını beklemeden kanalın
 * temel canlı verisini yeniden kurar. Böylece panel deploy sonrası 0 veriyle kalmaz.
 * Ayrıntılı tutma/abone/engaged view metrikleri sonraki tam syncYouTube çağrısında
 * mevcut public verinin üzerine eklenir.
 */
export async function bootstrapPublicYouTubeState(existingState?: ChannelState) {
  const state = existingState || await getState();
  const auth = await authenticatedClient(state);
  const youtube = google.youtube({ version: "v3", auth });

  const channelResponse = await youtube.channels.list({
    part: ["snippet", "statistics", "contentDetails"],
    mine: true,
  });
  const channel = channelResponse.data.items?.[0];
  if (!channel) throw new Error("Bağlı hesapta YouTube kanalı bulunamadı.");

  const expected = process.env.YOUTUBE_TARGET_CHANNEL_ID?.trim();
  if (expected && channel.id !== expected) throw new Error("Yanlış YouTube kanalı seçildi.");

  const uploadsId = channel.contentDetails?.relatedPlaylists?.uploads;
  const ids: string[] = [];
  let pageToken: string | undefined;
  if (uploadsId) {
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
  }

  const existing = new Map(state.videos.map((video) => [video.id, video]));
  const videosById = new Map<string, VideoMetric>();

  for (const group of chunks(ids, 50)) {
    if (!group.length) continue;
    const response = await youtube.videos.list({
      part: ["snippet", "statistics", "contentDetails"],
      id: group,
    });

    for (const item of response.data.items || []) {
      if (!item.id) continue;
      const previous = existing.get(item.id);
      const seconds = durationSeconds(item.contentDetails?.duration);
      const publicViews = numeric(item.statistics?.viewCount);
      const likes = numeric(item.statistics?.likeCount);
      const comments = numeric(item.statistics?.commentCount);
      const title = item.snippet?.title || previous?.title || "Başlıksız video";
      const publishedAt = item.snippet?.publishedAt || previous?.publishedAt || "";
      const bootstrapType = previous?.contentType && previous.contentType !== "UNKNOWN"
        ? previous.contentType
        : seconds > 180
          ? "LONG"
          : "SHORT";

      videosById.set(item.id, {
        id: item.id,
        title,
        publishedAt,
        durationSeconds: seconds || previous?.durationSeconds || 0,
        contentType: bootstrapType,
        creatorContentType: previous?.creatorContentType || "",
        views: Math.max(publicViews, previous?.analyticsViews || 0),
        publicViews,
        analyticsViews: previous?.analyticsViews || 0,
        engagedViews: previous?.engagedViews || 0,
        viewsLast7Days: previous?.viewsLast7Days || 0,
        engagedViewsLast7Days: previous?.engagedViewsLast7Days || 0,
        viewsLast28Days: previous?.viewsLast28Days || 0,
        engagedViewsLast28Days: previous?.engagedViewsLast28Days || 0,
        shortsFeedViews: previous?.shortsFeedViews || 0,
        shortsFeedEngagedViews: previous?.shortsFeedEngagedViews || 0,
        engagedViewRate: previous?.engagedViewRate || 0,
        recentVelocity: previous?.recentVelocity || 0,
        watchHours: previous?.watchHours || 0,
        subscribersGained: previous?.subscribersGained || 0,
        subscribersLost: previous?.subscribersLost || 0,
        impressions: previous?.impressions ?? null,
        ctr: previous?.ctr ?? null,
        avgViewDurationSeconds: previous?.avgViewDurationSeconds || 0,
        avgViewPercentage: previous?.avgViewPercentage || 0,
        likes: Math.max(likes, previous?.likes || 0),
        comments: Math.max(comments, previous?.comments || 0),
        shares: previous?.shares || 0,
        thumbnailUrl:
          item.snippet?.thumbnails?.medium?.url ||
          item.snippet?.thumbnails?.default?.url ||
          previous?.thumbnailUrl ||
          "",
        topic: detectHistoryTopic(title),
        dataThroughDate: previous?.dataThroughDate,
      });
    }
  }

  const videos = ids.map((id) => videosById.get(id) || existing.get(id)).filter((video): video is VideoMetric => Boolean(video));
  const now = new Date().toISOString();
  const publicViews = numeric(channel.statistics?.viewCount);
  const updated: ChannelState = {
    ...state,
    channel: {
      id: channel.id || state.channel.id,
      title: channel.snippet?.title?.trim() || state.channel.title,
      handle: channel.snippet?.customUrl || state.channel.handle,
      thumbnailUrl:
        channel.snippet?.thumbnails?.medium?.url ||
        channel.snippet?.thumbnails?.default?.url ||
        state.channel.thumbnailUrl,
      subscriberCount: numeric(channel.statistics?.subscriberCount),
      videoCount: numeric(channel.statistics?.videoCount),
      viewCount: publicViews,
    },
    totals: {
      ...state.totals,
      views: publicViews,
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
      message: `${videos.length} video hızlıca geri yüklendi; ayrıntılı Analytics arka planda tamamlanabilir.`,
    },
  };

  await saveState(updated);
  return updated;
}
