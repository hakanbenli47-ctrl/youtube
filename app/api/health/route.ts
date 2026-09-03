import { persistentAuthConfigured, recoverServerAuth } from "@/lib/auth-vault";
import { getState, persistentStorageReady } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const stored = await getState();
  const recovery = await recoverServerAuth(stored);
  const state = recovery.state;
  const credentialsReady = Boolean(
    process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET,
  );
  const durableAuth = persistentAuthConfigured();
  const healthy = Boolean(
    credentialsReady &&
    state.auth.connected &&
    (persistentStorageReady() || durableAuth),
  );

  return Response.json({
    healthy,
    persistentStorage: persistentStorageReady(),
    persistentAuthVault: durableAuth,
    authSource: recovery.source,
    youtubeCredentials: credentialsReady,
    youtubeConnected: state.auth.connected,
    refreshTokenPresent: Boolean(state.auth.tokens?.refresh_token),
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
