import {
  AUTH_COOKIE_NAME,
  authCookieOptions,
  createAuthCookieValue,
} from "@/lib/auth-cookie";
import { getState } from "@/lib/store";
import { exchangeYouTubeCode } from "@/lib/youtube-v2";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const code = request.nextUrl.searchParams.get("code");
    if (!code) throw new Error("Google yetkilendirme kodu gelmedi.");
    await exchangeYouTubeCode(
      code,
      request.nextUrl.searchParams.get("state"),
    );
    const state = await getState();
    if (!state.auth.tokens) {
      throw new Error("Google bağlantı anahtarı kaydedilemedi.");
    }
    const response = NextResponse.redirect(new URL("/?connected=1", request.url));
    response.cookies.set(
      AUTH_COOKIE_NAME,
      createAuthCookieValue(state.auth.tokens),
      authCookieOptions(),
    );
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google bağlantısı tamamlanamadı.";
    return NextResponse.redirect(
      new URL(`/?connectionError=${encodeURIComponent(message)}`, request.url),
    );
  }
}
