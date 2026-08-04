import { buildDashboard } from "@/lib/analytics";
import { generateMonthlyPlan, planReviewStamp } from "@/lib/planner";
import { buildAdaptiveWeeklySchedule, currentIstanbulWeekKey } from "@/lib/scheduling";
import { getState, saveState } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  let state = await getState();
  const needsWeeklyReview = state.planning?.weekKey !== currentIstanbulWeekKey();
  const needsContentPackages = !state.plan.length || !state.planning?.weeklySchedule || state.plan.some((item) => !item.voiceover || !item.description || !item.hashtags?.length);
  if (needsWeeklyReview || needsContentPackages) {
    const weeklySchedule = buildAdaptiveWeeklySchedule(state);
    state = { ...state, plan: generateMonthlyPlan(state, weeklySchedule), planning: planReviewStamp(weeklySchedule) };
    await saveState(state);
  }
  return Response.json(buildDashboard(state), {
    headers: { "Cache-Control": "no-store" },
  });
}
