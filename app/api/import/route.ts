import { buildDashboard } from "@/lib/analytics";
import { generateMonthlyPlan, planReviewStamp } from "@/lib/planner";
import { buildAdaptiveWeeklySchedule } from "@/lib/scheduling";
import { getState, saveState } from "@/lib/store";
import { importStudioZip } from "@/lib/studio-import";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const uploaded = formData.get("file");
    if (!(uploaded instanceof File)) {
      return Response.json({ error: "ZIP dosyası seçilmedi." }, { status: 400 });
    }
    if (!uploaded.name.toLocaleLowerCase("tr-TR").endsWith(".zip")) {
      return Response.json(
        { error: "YouTube Studio dışa aktarımı ZIP olarak yüklenmeli." },
        { status: 400 },
      );
    }
    if (uploaded.size > 15 * 1024 * 1024) {
      return Response.json({ error: "ZIP dosyası 15 MB sınırını aşıyor." }, { status: 413 });
    }
    const current = await getState();
    let updated = importStudioZip(
      Buffer.from(await uploaded.arrayBuffer()),
      current,
    );
    const weeklySchedule = buildAdaptiveWeeklySchedule(updated);
    updated = { ...updated, plan: generateMonthlyPlan(updated, weeklySchedule), planning: planReviewStamp(weeklySchedule) };
    await saveState(updated);
    return Response.json(buildDashboard(updated));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Dosya işlenemedi.";
    return Response.json({ error: message }, { status: 400 });
  }
}
