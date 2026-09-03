import { buildDashboard } from "@/lib/analytics";
import { generateChannelDrivenPlan } from "@/lib/channel-driven-plan";
import { mergeGeneratedPlanPreservingToday } from "@/lib/plan-refresh";
import { buildAdaptiveWeeklySchedule } from "@/lib/scheduling";
import { getState, saveState } from "@/lib/store";
import type { AudienceActivityDay } from "@/lib/schema";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    subscriberTarget?: number;
    deadline?: string;
    audienceActivity?: AudienceActivityDay[];
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

  const audienceActivity = Array.isArray(body.audienceActivity)
    ? body.audienceActivity
        .filter((day) => Number.isInteger(day.day) && day.day >= 0 && day.day <= 6)
        .map((day) => ({
          day: day.day,
          dayLabel: String(day.dayLabel || ""),
          hours: (Array.isArray(day.hours) ? day.hours : [])
            .map((row) => ({
              hour: Math.round(Number(row.hour)),
              score: Math.round(Number(row.score)),
            }))
            .filter((row) =>
              Number.isFinite(row.hour) && row.hour >= 0 && row.hour <= 23 &&
              Number.isFinite(row.score) && row.score > 0)
            .map((row) => ({ ...row, score: Math.min(100, row.score) }))
            .sort((left, right) => right.score - left.score || left.hour - right.hour),
          updatedAt: new Date().toISOString(),
        }))
    : state.audienceActivity || [];

  const base = {
    ...state,
    goals: { subscriberTarget, deadline },
    audienceActivity,
  };
  const weeklySchedule = buildAdaptiveWeeklySchedule(base);
  const generated = generateChannelDrivenPlan(base, weeklySchedule);
  const updated = mergeGeneratedPlanPreservingToday(base, generated, weeklySchedule);
  await saveState(updated);
  return Response.json(buildDashboard(updated));
}
