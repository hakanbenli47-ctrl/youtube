import { buildDashboard } from "@/lib/analytics";
import { generateChannelDrivenPlan } from "@/lib/channel-driven-plan";
import { mergeGeneratedPlanPreservingToday } from "@/lib/plan-refresh";
import { buildAdaptiveWeeklySchedule } from "@/lib/scheduling";
import { getState, saveState } from "@/lib/store";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    subscriberTarget?: number;
    deadline?: string;
  };
  const state = await getState();
  const subscriberTarget = Math.max(
    state.channel.subscriberCount,
    Math.min(10_000_000, Math.round(Number(body.subscriberTarget) || 1000)),
  );
  const deadline =
    typeof body.deadline === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.deadline)
      ? body.deadline
      : state.goals.deadline;

  const base = {
    ...state,
    goals: { subscriberTarget, deadline },
  };
  const weeklySchedule = buildAdaptiveWeeklySchedule(base);
  const generated = generateChannelDrivenPlan(base, weeklySchedule);
  const updated = mergeGeneratedPlanPreservingToday(base, generated, weeklySchedule);
  await saveState(updated);
  return Response.json(buildDashboard(updated));
}
