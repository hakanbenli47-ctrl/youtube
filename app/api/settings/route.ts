import { buildDashboard } from "@/lib/analytics";
import { generateMonthlyPlan, planReviewStamp } from "@/lib/planner";
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
  const weeklySchedule = buildAdaptiveWeeklySchedule(state);
  const updated = {
    ...state,
    goals: { subscriberTarget, deadline },
    planning: planReviewStamp(weeklySchedule),
  };
  updated.plan = generateMonthlyPlan(updated, weeklySchedule);
  await saveState(updated);
  return Response.json(buildDashboard(updated));
}
