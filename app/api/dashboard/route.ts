import { buildDashboard } from "@/lib/analytics";
import {
  AUTH_COOKIE_NAME,
  authCookieOptions,
  createAuthCookieValue,
  restoreAuthFromRequest,
} from "@/lib/auth-cookie";
import { persistServerAuth, recoverServerAuth } from "@/lib/auth-vault";
import { getState, saveState } from "@/lib/store";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let state = await getState();

  // Önce sunucu tarafındaki küçük OAuth kasasını dene. Büyük Analytics state'i
  // Vercel instance değişiminde kaybolsa bile refresh token buradan geri gelir.
  const serverRecovery = await recoverServerAuth(state);
  state = serverRecovery.state;

  // Son savunma katmanı: aynı tarayıcıdaki şifreli HttpOnly cookie.
  const browserRecovery = restoreAuthFromRequest(state, request);
  state = browserRecovery.state;

  if (state.auth.tokens) {
    await persistServerAuth(state.auth.tokens);
  }

  // Dashboard açılışında 30 günlük planı yeniden üretme.
  // Konu motoru kullanıcı arayüzünün ilk yüklemesini bekletmemeli.
  if (serverRecovery.recovered || browserRecovery.restored) {
    await saveState(state);
  }

  const response = NextResponse.json(buildDashboard(state), {
    headers: { "Cache-Control": "no-store" },
  });

  // Kullanıcı paneli kullandıkça kurtarma cookie'sinin ömrünü yenile ve
  // Google'ın olası yeni token değerlerini tarayıcı kurtarma katmanına taşı.
  if (state.auth.connected && state.auth.tokens) {
    response.cookies.set(
      AUTH_COOKIE_NAME,
      createAuthCookieValue(state.auth.tokens),
      authCookieOptions(),
    );
  }

  return response;
}
