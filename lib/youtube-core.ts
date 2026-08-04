import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { google } from "googleapis";
import type { Credentials } from "google-auth-library";
import type { youtubeAnalytics_v2 } from "googleapis";
import { getState, saveState } from "./store";
import type { ChannelState, MetricSnapshot, VideoMetric } from "./schema";

export const DAY_MS = 86_400_000;
export const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];
const OAUTH_STATE_TTL_MS = 20 * 60_000;
type ReportParams = youtubeAnalytics_v2.Params$Resource$Reports$Query;
type Row = Record<string, unknown>;

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} ayarı eksik.`);
  return value;
}

function redirectUri() {
  if (process.env.YOUTUBE_REDIRECT_URI?.trim()) return process.env.YOUTUBE_REDIRECT_URI.trim();
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  return host
    ? `https://${host.replace(/^https?:\/\//, "")}/api/auth/youtube/callback`
    : "http://localhost:3000/api/auth/youtube/callback";
}

function oauthStateSecret() {
  return process.env.OAUTH_STATE_SECRET?.trim() || requiredEnv("YOUTUBE_CLIENT_SECRET");
}

function signState(payload: string) {
  return createHmac("sha256", oauthStateSecret()).update(payload).digest("base64url");
}

function createSignedState() {
  const payload = Buffer.from(JSON.stringify({
    nonce: crypto.randomUUID(),
    issuedAt: Date.now(),
  })).toString("base64url");
  return `${payload}.${signState(payload)}`;
}

function verifySignedState(value: string | null) {
  if (!value) return false;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra) return false;
  const expected = Buffer.from(signState(payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      issuedAt?: number;
      nonce?: string;
    };
    return Boolean(
      decoded.nonce &&
      Number.isFinite(decoded.issuedAt) &&
      Date.now() - Number(decoded.issuedAt) >= 0 &&
      Date.now() - Number(decoded.issuedAt) <= OAUTH_STATE_TTL_MS,
    );
  } catch {
    return false;
  }
}

export function oauthClient() {
  return new google.auth.OAuth2(
    requiredEnv("YOUTUBE_CLIENT_ID"),
    requiredEnv("YOUTUBE_CLIENT_SECRET"),
    redirectUri(),
  );
}

export async function createYouTubeAuthUrl() {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: SCOPES,
    state: createSignedState(),
  });
}

export async function exchangeYouTubeCode(code: string, returnedState: string | null) {
  if (!verifySignedState(returnedState)) {
    throw new Error("Google bağlantı doğrulaması geçersiz veya süresi dolmuş. Yeniden bağlan.");
  }
  const state = await getState();
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  const mergedTokens = { ...(state.auth.tokens || {}), ...(tokens as Record<string, unknown>) };
  if (!mergedTokens.refresh_token) {
    throw new Error("Google yenileme anahtarı vermedi. Google erişimini kaldırıp yeniden bağlan.");
  }
  await saveState({
    ...state,
    auth: { connected: true, tokens: mergedTokens },
    sync: { ...state.sync, status: "ready", message: "YouTube bağlandı; kapsamlı senkron hazır." },
  });
}

export async function authenticatedClient(state: ChannelState) {
  if (!state.auth.connected || !state.auth.tokens) throw new Error("YouTube hesabı henüz bağlı değil.");
  const client = oauthClient();
  client.setCredentials(state.auth.tokens as Credentials);
  return client;
}

export function numeric(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function durationSeconds(value?: string | null) {
  const match = value?.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  return match
    ? Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0)
    : 0;
}

export function dateKey(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * DAY_MS);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function daysBetween(from: string, to: string) {
  const start = new Date(`${from}T12:00:00Z`).getTime();
  const end = new Date(`${to}T12:00:00Z`).getTime();
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.round((end - start) / DAY_MS)) : 0;
}

export function rows(headers: Array<{ name?: string | null }> | undefined, values: unknown[][] | null | undefined): Row[] {
  const names = (headers || []).map((header) => header.name || "");
  return (values || []).map((row) => Object.fromEntries(names.map((name, index) => [name, row[index]])));
}

export function chunks<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, index * size + size));
}

export async function report(
  analytics: ReturnType<typeof google.youtubeAnalytics>,
  params: ReportParams,
) {
  try {
    const response = await analytics.reports.query(params);
    return { response, endDate: params.endDate || dateKey() };
  } catch (error) {
    if (params.endDate !== dateKey()) throw error;
    const endDate = dateKey(-1);
    const response = await analytics.reports.query({ ...params, endDate });
    return { response, endDate };
  }
}

export async function videoReport(
  analytics: ReturnType<typeof google.youtubeAnalytics>,
  ids: string[],
  startDate: string,
  endDate: string,
) {
  const result: Row[] = [];
  for (const group of chunks(ids, 200)) {
    if (!group.length) continue;
    const { response } = await report(analytics, {
      ids: "channel==MINE",
      startDate,
      endDate,
      dimensions: "video,creatorContentType",
      metrics: "engagedViews,views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,likes,comments,shares",
      filters: `video==${group.join(",")}`,
      sort: "-views",
      maxResults: 200,
    });
    result.push(...rows(response.data.columnHeaders, response.data.rows));
  }
  return result;
}

export function byVideo(values: Row[]) {
  return new Map(values.map((row) => [String(row.video), row]));
}

export function contentType(
  row: Row,
  seconds: number,
  previous: VideoMetric["contentType"] = "UNKNOWN",
): VideoMetric["contentType"] {
  const type = String(row.creatorContentType || "").toUpperCase();
  if (type === "SHORTS") return "SHORT";
  if (type === "VIDEO_ON_DEMAND" || type === "LIVE_STREAM") return "LONG";
  if (previous !== "UNKNOWN") return previous;
  if (seconds > 180) return "LONG";
  if (seconds > 0 && seconds <= 60) return "SHORT";
  return "UNKNOWN";
}

export function appendSnapshot(state: ChannelState, videos: VideoMetric[]): MetricSnapshot[] {
  const snapshot: MetricSnapshot = {
    capturedAt: new Date().toISOString(),
    videos: Object.fromEntries(videos.map((video) => [video.id, {
      views: video.views,
      engagedViews: video.engagedViews || 0,
      likes: video.likes,
      comments: video.comments,
      subscribersGained: video.subscribersGained,
      subscribersLost: video.subscribersLost,
    }])),
  };
  const snapshots = [...(state.snapshots || [])]
    .filter((item) => Date.now() - new Date(item.capturedAt).getTime() <= 120 * DAY_MS)
    .sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));
  if (snapshots.at(-1) && Date.now() - new Date(snapshots.at(-1)!.capturedAt).getTime() < 10 * 60_000) {
    snapshots[snapshots.length - 1] = snapshot;
  } else {
    snapshots.push(snapshot);
  }
  return snapshots.slice(-360);
}
