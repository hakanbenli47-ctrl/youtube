import { buildDashboard } from "@/lib/analytics";
import { restoreAuthFromRequest } from "@/lib/auth-cookie";
import { getState, saveState } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let state = await getState();
  const restored = restoreAuthFromRequest(state, request);
  state = restored.state;

  // Dashboard açılışında 30 günlük planı yeniden üretme.
  // Konu motoru artık çok daha geniş ve sıkı tekrar kontrolü yaptığı için bu hesap
  // kullanıcı arayüzünün ilk yüklemesini bekletmemeli. Plan yenileme /api/plan ve
  // günlük cron üzerinden ayrı çalışır; panel mevcut kayıtlı veriyi anında gösterir.
  if (restored.restored) {
    await saveState(state);
  }

  return Response.json(buildDashboard(state), {
    headers: { "Cache-Control": "no-store" },
  });
}
