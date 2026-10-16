import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { saveAccount } from "@/marketplaces/mercadolivre/accounts";
import { APP_URL, exchangeCode } from "@/marketplaces/mercadolivre/oauth";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expected = request.cookies.get("ml_oauth_state")?.value;
  const back = (q: string) => NextResponse.redirect(`${APP_URL}/conta?${q}`);

  if (!code || !state || state !== expected) return back("erro=estado_invalido");

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.redirect(`${APP_URL}/login`);

  try {
    await saveAccount(supabase, data.user.id, await exchangeCode(code));
  } catch (e) {
    return back(`erro=${encodeURIComponent(e instanceof Error ? e.message : "falha")}`);
  }
  const res = back("conectado=1");
  res.cookies.delete("ml_oauth_state");
  return res;
}
