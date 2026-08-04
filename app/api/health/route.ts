import { getState, persistentStorageReady } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = await getState();
  const healthy = Boolean(
    persistentStorageReady() &&
    process.env.YOUTUBE_CLIENT_ID &&
    process.env.YOUTUBE_CLIENT_SECRET,
  );
  return Response.json({
    healthy,
    persistentStorage: persistentStorageReady(),
    youtubeCredentials: Boolean(
      process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET),
    youtubeConnected: state.auth.connected,
    lastSuccessfulSync: state.sync.lastSuccessfulYouTubeSync || state.sync.lastYouTubeSync,
    dataThroughDate: state.sync.dataThroughDate || null,
    analyticsLagDays: state.sync.analyticsLagDays || 0,
    videos: state.videos.length,
    snapshots: (state.snapshots || []).length,
    warnings: state.sync.warnings || [],
  }, {
    status: healthy ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
