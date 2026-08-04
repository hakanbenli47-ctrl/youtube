import { createYouTubeAuthUrl } from "@/lib/youtube";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    return NextResponse.redirect(await createYouTubeAuthUrl());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google bağlantısı başlatılamadı.";
    return NextResponse.redirect(
      new URL(`/?connectionError=${encodeURIComponent(message)}`, request.url),
    );
  }
}
