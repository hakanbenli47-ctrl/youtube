import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { ChannelState } from "./schema";

const STATE_KEY = process.env.YOUTUBE_STATE_KEY || "youtube:growth-dashboard:state:v2";
const AUTH_VAULT_KEY = `${STATE_KEY}:oauth:v1`;
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
const RETRY_DELAYS = [0, 150, 500];

let memoryTokens: Record<string, unknown> | null = null;

type VaultEnvelope = {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  tag: string;
  data: string;
};

type VaultPayload = {
  version: 1;
  updatedAt: string;
  tokens: Record<string, unknown>;
};

type RedisResponse<T> = {
  result?: T;
  error?: string;
};

function delay(ms: number) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function secretKey() {
  const secret =
    process.env.STATE_ENCRYPTION_KEY?.trim() ||
    process.env.AUTH_COOKIE_SECRET?.trim() ||
    process.env.YOUTUBE_CLIENT_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim();
  if (!secret) throw new Error("OAuth kurtarma kasası için sunucu sırrı eksik.");
  return createHash("sha256").update(secret).digest();
}

function encode(tokens: Record<string, unknown>) {
  const payload: VaultPayload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    tokens,
  };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const envelope: VaultEnvelope = {
    version: 1,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    data: encrypted.toString("base64url"),
  };
  return JSON.stringify(envelope);
}

function decode(value: string) {
  const envelope = JSON.parse(value) as VaultEnvelope;
  if (envelope.version !== 1 || envelope.algorithm !== "aes-256-gcm") {
    throw new Error("OAuth kurtarma kasası biçimi geçersiz.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    secretKey(),
    Buffer.from(envelope.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  const payload = JSON.parse(plain) as VaultPayload;
  if (payload.version !== 1 || !payload.tokens || typeof payload.tokens !== "object") {
    throw new Error("OAuth kurtarma kasası içeriği geçersiz.");
  }
  return payload.tokens;
}

async function redisCommand<T>(command: Array<string | number>) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  let lastError: unknown;
  for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt += 1) {
    await delay(RETRY_DELAYS[attempt]);
    try {
      const response = await fetch(REDIS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${REDIS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(command),
        cache: "no-store",
        signal: AbortSignal.timeout(6_000),
      });
      const payload = (await response.json().catch(() => ({}))) as RedisResponse<T>;
      if (!response.ok || payload.error) {
        throw new Error(payload.error || `OAuth kasası Redis isteği başarısız: ${response.status}`);
      }
      return payload.result ?? null;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("OAuth kasasına erişilemedi.");
}

function hasRefreshToken(tokens: Record<string, unknown> | undefined | null) {
  return Boolean(tokens && typeof tokens.refresh_token === "string" && tokens.refresh_token.trim());
}

export function persistentAuthConfigured() {
  return Boolean(REDIS_URL && REDIS_TOKEN);
}

export async function persistServerAuth(tokens: Record<string, unknown>) {
  if (!hasRefreshToken(tokens)) return false;
  memoryTokens = { ...tokens };
  if (!persistentAuthConfigured()) return false;
  try {
    await redisCommand<string>(["SET", AUTH_VAULT_KEY, encode(tokens)]);
    return true;
  } catch (error) {
    console.error("OAuth kurtarma kasasına yazılamadı; tarayıcı oturumu korunuyor.", error);
    return false;
  }
}

async function readServerAuth() {
  if (memoryTokens && hasRefreshToken(memoryTokens)) return { tokens: memoryTokens, source: "memory" as const };
  if (!persistentAuthConfigured()) return null;
  try {
    const stored = await redisCommand<string>(["GET", AUTH_VAULT_KEY]);
    if (!stored) return null;
    const tokens = decode(stored);
    if (!hasRefreshToken(tokens)) return null;
    memoryTokens = { ...tokens };
    return { tokens, source: "redis" as const };
  } catch (error) {
    console.error("OAuth kurtarma kasası okunamadı.", error);
    return null;
  }
}

export async function recoverServerAuth(state: ChannelState) {
  if (state.auth.connected && state.auth.tokens && hasRefreshToken(state.auth.tokens)) {
    await persistServerAuth(state.auth.tokens);
    return { state, recovered: false, source: "state" as const };
  }

  const recovered = await readServerAuth();
  if (!recovered) return { state, recovered: false, source: "none" as const };

  return {
    recovered: true,
    source: recovered.source,
    state: {
      ...state,
      auth: {
        connected: true,
        tokens: {
          ...(state.auth.tokens || {}),
          ...recovered.tokens,
        },
      },
      sync: {
        ...state.sync,
        status: "ready" as const,
        message: "YouTube bağlantısı kalıcı OAuth kasasından geri yüklendi.",
        warnings: (state.sync.warnings || []).filter((warning) =>
          !warning.startsWith("OAuth bağlantısı:")),
      },
    },
  };
}
