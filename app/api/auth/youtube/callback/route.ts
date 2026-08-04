import { exchangeYouTubeCode } from "@/lib/youtube";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const code = request.nextUrl.searchParams.get("code");
    if (!code) throw new Error("Google yetkilendirme kodu gelmedi.");
    await exchangeYouTubeCode(
      code,
      request.nextUrl.searchParams.get("state"),
    );
    return NextResponse.redirect(new URL("/?connected=1", request.url));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google bağlantısı tamamlanamadı.";
    return NextResponse.redirect(
      new URL(`/?connectionError=${encodeURIComponent(message)}`, request.url),
    );
  }
}
