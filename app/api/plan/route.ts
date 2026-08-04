import { buildDashboard } from "@/lib/analytics";
import { enhancePlanWithOllama, generateMonthlyPlan, planReviewStamp } from "@/lib/planner";
import { buildAdaptiveWeeklySchedule } from "@/lib/scheduling";
import { getState, saveState } from "@/lib/store";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { useLocalAi?: boolean };
  let state = await getState();
  const weeklySchedule = buildAdaptiveWeeklySchedule(state);
  let plan = generateMonthlyPlan(state, weeklySchedule);
  if (body.useLocalAi) {
    plan = await enhancePlanWithOllama(state, plan);
  }
  state = { ...state, plan, planning: planReviewStamp(weeklySchedule) };
  await saveState(state);
  return Response.json(buildDashboard(state));
}
