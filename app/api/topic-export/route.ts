import { getState } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = await getState();
  const videos = state.videos
    .map((video) => ({
      title: video.title,
      publishedAt: video.publishedAt,
      contentType: video.contentType,
    }))
    .filter((video) => Boolean(video.title))
    .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));

  return Response.json(
    {
      channel: {
        title: state.channel.title,
        handle: state.channel.handle,
        videoCount: state.channel.videoCount,
      },
      exportedCount: videos.length,
      videos,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
