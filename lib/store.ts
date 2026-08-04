import "server-only";

import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { ChannelState } from "./schema";

const IS_VERCEL = Boolean(process.env.VERCEL);
const DATA_DIR = IS_VERCEL
  ? path.join("/tmp", "youtube-growth-dashboard")
  : path.join(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const STATE_KEY = process.env.YOUTUBE_STATE_KEY || "youtube:growth-dashboard:state:v1";
const REDIS_URL =
  process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const REDIS_TOKEN =
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
let writeQueue = Promise.resolve();

type RedisResponse<T> = {
  result?: T;
  error?: string;
};

function isoDateAfter(days: number) {
  const value = new Date();
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

export function persistentStorageReady() {
  return Boolean(REDIS_URL && REDIS_TOKEN) || !IS_VERCEL;
}

export function createEmptyState(): ChannelState {
  const storageWarning =
    IS_VERCEL && !persistentStorageReady()
      ? "Panel açıldı; kalıcı veri için Vercel Storage üzerinden Upstash Redis bağlanmalı."
      : "Yeni tarih kanalı bağlantısı bekleniyor";

  return {
    channel: {
      id: process.env.YOUTUBE_TARGET_CHANNEL_ID || "",
      title: process.env.YOUTUBE_TARGET_TITLE || "Tarih kanalı bekleniyor",
      handle: process.env.YOUTUBE_TARGET_HANDLE || "@kanal-baglanmadi",
      thumbnailUrl: "",
      subscriberCount: 0,
      videoCount: 0,
      viewCount: 0,
    },
    goals: {
      subscriberTarget: Number(process.env.MONTHLY_SUBSCRIBER_TARGET || 1000),
      deadline: isoDateAfter(30),
    },
    totals: {
      views: 0,
      watchHours: 0,
      netSubscribers: 0,
      impressions: 0,
      ctr: 0,
    },
    videos: [],
    daily: [],
    shortsDaily: [],
    trends: [],
    plan: [],
    recommendations: [],
    auth: { connected: false },
    sync: {
      lastStudioImport: null,
      lastYouTubeSync: null,
      lastTrendScan: null,
      status: "ready",
      message: storageWarning,
    },
  };
}

function normalizeState(stored: ChannelState): ChannelState {
  const empty = createEmptyState();
  return {
    ...empty,
    ...stored,
    channel: { ...empty.channel, ...(stored.channel || {}) },
    goals: { ...empty.goals, ...(stored.goals || {}) },
    totals: { ...empty.totals, ...(stored.totals || {}) },
    videos: stored.videos || [],
    daily: stored.daily || [],
    shortsDaily: stored.shortsDaily || [],
    trends: stored.trends || [],
    plan: stored.plan || [],
    recommendations: stored.recommendations || [],
    auth: { ...empty.auth, ...(stored.auth || {}) },
    sync: { ...empty.sync, ...(stored.sync || {}) },
  };
}

async function redisCommand<T>(command: Array<string | number>): Promise<T | null> {
  if (!REDIS_URL || !REDIS_TOKEN) return null;

  const response = await fetch(REDIS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = (await response.json().catch(() => ({}))) as RedisResponse<T>;
  if (!response.ok || payload.error) {
    throw new Error(payload.error || `Redis isteği başarısız: ${response.status}`);
  }
  return payload.result ?? null;
}

async function readRemoteState() {
  const stored = await redisCommand<string>(["GET", STATE_KEY]);
  if (!stored) return null;
  return normalizeState(JSON.parse(stored) as ChannelState);
}

async function writeRemoteState(state: ChannelState) {
  await redisCommand<string>(["SET", STATE_KEY, JSON.stringify(state)]);
}

async function readLocalState() {
  try {
    const stored = JSON.parse(await readFile(STATE_FILE, "utf8")) as ChannelState;
    return normalizeState(stored);
  } catch {
    return null;
  }
}

async function writeLocalState(state: ChannelState) {
  await mkdir(DATA_DIR, { recursive: true });
  const temporary = path.join(
    DATA_DIR,
    `state.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
    await copyFile(temporary, STATE_FILE);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function getState(): Promise<ChannelState> {
  if (REDIS_URL && REDIS_TOKEN) {
    try {
      const remote = await readRemoteState();
      if (remote) return remote;
    } catch (error) {
      console.error("Kalıcı kanal verisi okunamadı, geçici depoya dönülüyor.", error);
    }
  }

  const local = await readLocalState();
  if (local) return local;

  const initial = createEmptyState();
  await saveState(initial);
  return initial;
}

export async function saveState(state: ChannelState) {
  writeQueue = writeQueue.then(async () => {
    if (REDIS_URL && REDIS_TOKEN) {
      try {
        await writeRemoteState(state);
        return;
      } catch (error) {
        console.error("Kalıcı kanal verisi yazılamadı, geçici depoya yazılıyor.", error);
      }
    }
    await writeLocalState(state);
  });
  await writeQueue;
}

export async function updateState(
  updater: (current: ChannelState) => ChannelState | Promise<ChannelState>,
) {
  const current = await getState();
  const updated = await updater(current);
  await saveState(updated);
  return updated;
}

export function publicState(state: ChannelState) {
  const { auth, ...rest } = state;
  return { ...rest, auth: { connected: auth.connected } };
}
