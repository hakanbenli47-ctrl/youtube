import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { ChannelState } from "./schema";

export const AUTH_COOKIE_NAME = "youtube_auth_v1";
export const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 180;

type AuthCookiePayload = {
  version: 1;
  issuedAt: number;
  expiresAt: number;
  tokens: Record<string, unknown>;
};

function secretKey() {
  const secret =
    process.env.AUTH_COOKIE_SECRET?.trim() ||
    process.env.STATE_ENCRYPTION_KEY?.trim() ||
    process.env.YOUTUBE_CLIENT_SECRET?.trim();
  if (!secret) throw new Error("Şifreli YouTube oturumu için sunucu sırrı eksik.");
  return createHash("sha256").update(secret).digest();
}

function cookieValue(request: Request, name: string) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

export function createAuthCookieValue(tokens: Record<string, unknown>) {
  const now = Date.now();
  const payload: AuthCookiePayload = {
    version: 1,
    issuedAt: now,
    expiresAt: now + AUTH_COOKIE_MAX_AGE * 1000,
    tokens,
  };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return [
    "1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

function readAuthCookie(request: Request): AuthCookiePayload | null {
  const value = cookieValue(request, AUTH_COOKIE_NAME);
  if (!value) return null;
  const [version, iv, tag, data, extra] = value.split(".");
  if (version !== "1" || !iv || !tag || !data || extra) return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      secretKey(),
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const decoded = Buffer.concat([
      decipher.update(Buffer.from(data, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const payload = JSON.parse(decoded) as AuthCookiePayload;
    const now = Date.now();
    if (
      payload.version !== 1 ||
      !payload.tokens ||
      typeof payload.tokens !== "object" ||
      !Number.isFinite(payload.issuedAt) ||
      !Number.isFinite(payload.expiresAt) ||
      payload.issuedAt > now + 5 * 60_000 ||
      payload.expiresAt <= now
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function restoreAuthFromRequest(state: ChannelState, request: Request) {
  if (state.auth.connected && state.auth.tokens) {
    return { state, restored: false };
  }
  const payload = readAuthCookie(request);
  if (!payload) return { state, restored: false };
  return {
    restored: true,
    state: {
      ...state,
      auth: {
        connected: true,
        tokens: {
          ...payload.tokens,
          ...(state.auth.tokens || {}),
        },
      },
      sync: {
        ...state.sync,
        status: "ready" as const,
        message: "YouTube bağlantısı güvenli tarayıcı oturumundan geri yüklendi.",
      },
    },
  };
}

export function authCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: AUTH_COOKIE_MAX_AGE,
  };
}
