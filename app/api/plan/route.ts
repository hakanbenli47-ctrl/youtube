import { buildDashboard } from "@/lib/analytics";
import { generateChannelDrivenPlan } from "@/lib/channel-driven-plan";
import { mergeGeneratedPlanPreservingToday } from "@/lib/plan-refresh";
import { enhancePlanWithOllama } from "@/lib/planner";
import { buildAdaptiveWeeklySchedule } from "@/lib/scheduling";
import { getState, saveState } from "@/lib/store";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { useLocalAi?: boolean };
  let state = await getState();
  const weeklySchedule = buildAdaptiveWeeklySchedule(state);
  let generated = generateChannelDrivenPlan(state, weeklySchedule);

  if (body.useLocalAi) {
    generated = await enhancePlanWithOllama(state, generated);
  }

  // Bugünün hazırlanmış 6 konusu kilitlidir. Manuel hesaplama yalnızca yarın ve
  // sonrasını kanalın güncel video sonuçlarıyla değiştirir.
  state = mergeGeneratedPlanPreservingToday(state, generated, weeklySchedule);
  await saveState(state);
  return Response.json(buildDashboard(state));
}
