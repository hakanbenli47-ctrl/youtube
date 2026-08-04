import { buildDashboard } from "@/lib/analytics";
import { scanTrends } from "@/lib/youtube";

export async function POST() {
  try {
    const state = await scanTrends();
    return Response.json(buildDashboard(state));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Trend taraması başarısız.";
    return Response.json({ error: message }, { status: 500 });
  }
}
