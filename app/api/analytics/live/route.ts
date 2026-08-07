import { buildLiveAnalytics } from "@/lib/live-analytics";
import { getState } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = await getState();
  return Response.json(buildLiveAnalytics(state), {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
