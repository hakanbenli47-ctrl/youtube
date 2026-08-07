import { buildDashboard } from "@/lib/analytics";
import { mergeGeneratedPlanPreservingToday } from "@/lib/plan-refresh";
import { enhancePlanWithOllama, generateMonthlyPlan } from "@/lib/planner";
import { buildAdaptiveWeeklySchedule } from "@/lib/scheduling";
import { getState, saveState } from "@/lib/store";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { useLocalAi?: boolean };
  let state = await getState();
  const weeklySchedule = buildAdaptiveWeeklySchedule(state);
  let generated = generateMonthlyPlan(state, weeklySchedule);
  if (body.useLocalAi) {
    generated = await enhancePlanWithOllama(state, generated);
  }

  // Kullanıcı planı elle yeniden hesapladığında bile bugünün hazırlanmış içerikleri
  // sabit kalır; yalnızca yarın ve sonrası güncel veriye göre yenilenir.
  state = mergeGeneratedPlanPreservingToday(state, generated, weeklySchedule);
  await saveState(state);
  return Response.json(buildDashboard(state));
}
