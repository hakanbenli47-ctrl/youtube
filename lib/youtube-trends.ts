import "server-only";

import { google } from "googleapis";
import { getState, saveState } from "./store";
import type { ChannelState, TrendVideo } from "./schema";
import { DAY_MS, authenticatedClient, chunks, durationSeconds, numeric } from "./youtube-core";

export async function scanTrends() {
  const state = await getState();
  const auth = await authenticatedClient(state);
  const youtube = google.youtube({ version: "v3", auth });
  const learned = state.videos
    .filter((video) => video.contentType === "SHORT")
    .sort((left, right) => (right.recentVelocity || 0) - (left.recentVelocity || 0))
    .slice(0, 4)
    .map((video) => video.topic);
  const queries = [...new Set([
    "osmanlı padişahları", "osmanlı tarihi", "osmanlı savaşları", "osmanlı sarayı", ...learned,
  ])].slice(0, 8);
  const queryById = new Map<string, string>();
  for (const query of queries) {
    const response = await youtube.search.list({
      part: ["snippet"], q: query, type: ["video"], order: "viewCount",
      maxResults: 10, publishedAfter: new Date(Date.now() - 45 * DAY_MS).toISOString(),
      relevanceLanguage: "tr", regionCode: "TR",
    });
    for (const item of response.data.items || []) if (item.id?.videoId) queryById.set(item.id.videoId, query);
  }
  const trends: TrendVideo[] = [];
  for (const group of chunks([...queryById.keys()], 50)) {
    const response = await youtube.videos.list({ part: ["snippet", "statistics", "contentDetails"], id: group });
    for (const item of response.data.items || []) {
      if (!item.id || item.snippet?.channelId === state.channel.id) continue;
      const seconds = durationSeconds(item.contentDetails?.duration);
      if (!seconds || seconds > 180) continue;
      const views = numeric(item.statistics?.viewCount);
      const likes = numeric(item.statistics?.likeCount);
      const comments = numeric(item.statistics?.commentCount);
      const publishedAt = item.snippet?.publishedAt || new Date().toISOString();
      const age = Math.max(0.25, (Date.now() - new Date(publishedAt).getTime()) / DAY_MS);
      const viewsPerDay = views / age;
      trends.push({
        id: item.id,
        title: item.snippet?.title || "",
        channelTitle: item.snippet?.channelTitle || "",
        publishedAt,
        thumbnailUrl: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || "",
        views, likes, comments, viewsPerDay,
        trendScore: Math.round((Math.log10(viewsPerDay + 1) * 24 + Math.min(20, (likes + comments * 2) / Math.max(views, 1) * 320)) * 10) / 10,
        query: queryById.get(item.id) || "",
      });
    }
  }
  const updated: ChannelState = {
    ...state,
    trends: trends.sort((left, right) => right.trendScore - left.trendScore).slice(0, 40),
    auth: { ...state.auth, tokens: { ...(state.auth.tokens || {}), ...(auth.credentials as Record<string, unknown>) } },
    sync: { ...state.sync, lastTrendScan: new Date().toISOString(), message: `${Math.min(trends.length, 40)} güncel Shorts trendi tarandı.` },
  };
  await saveState(updated);
  return updated;
}
