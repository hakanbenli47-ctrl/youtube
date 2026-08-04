import "server-only";

import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { ChannelState } from "./schema";

const DATA_DIR = path.join(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");
let writeQueue = Promise.resolve();

function isoDateAfter(days: number) {
  const value = new Date();
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

export function createEmptyState(): ChannelState {
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
      message: "Yeni tarih kanalı bağlantısı bekleniyor",
    },
  };
}

export async function getState(): Promise<ChannelState> {
  try {
    const stored = JSON.parse(await readFile(STATE_FILE, "utf8")) as ChannelState;
    return {
      ...stored,
      shortsDaily: stored.shortsDaily || [],
    };
  } catch {
    const initial = createEmptyState();
    await saveState(initial);
    return initial;
  }
}

export async function saveState(state: ChannelState) {
  writeQueue = writeQueue.then(async () => {
    await mkdir(DATA_DIR, { recursive: true });
    const temporary = path.join(DATA_DIR, `state.${process.pid}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(state, null, 2), "utf8");
      await copyFile(temporary, STATE_FILE);
    } finally {
      await rm(temporary, { force: true });
    }
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
