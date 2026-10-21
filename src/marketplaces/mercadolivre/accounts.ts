import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt, encrypt } from "@/lib/crypto";
import { refreshTokens, type MlTokens } from "./oauth";

const MARKETPLACE = "mercadolivre";

function pack(t: MlTokens) {
  return {
    tokens_criptografados: encrypt(JSON.stringify({ access_token: t.access_token, refresh_token: t.refresh_token })),
    expira_em: new Date(Date.now() + t.expires_in * 1000).toISOString(),
  };
}

export async function saveAccount(supabase: SupabaseClient, userId: string, t: MlTokens) {
  const { error } = await supabase
    .from("contas_marketplace")
    .upsert(
      { user_id: userId, marketplace: MARKETPLACE, external_user_id: String(t.user_id), ...pack(t) },
      { onConflict: "user_id,marketplace,external_user_id" },
    );
  if (error) throw error;
}

export async function getAccount(supabase: SupabaseClient) {
  const { data } = await supabase
    .from("contas_marketplace")
    .select("id, external_user_id, expira_em")
    .eq("marketplace", MARKETPLACE)
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

/** Devolve um access token válido, renovando com o refresh token se estiver perto de expirar. */
export async function getAccessToken(supabase: SupabaseClient, userId?: string): Promise<string | null> {
  let q = supabase
    .from("contas_marketplace")
    .select("id, tokens_criptografados, expira_em")
    .eq("marketplace", MARKETPLACE);
  if (userId) q = q.eq("user_id", userId); // com a chave de servidor não há RLS: filtra pelo dono
  const { data: row } = await q
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!row?.tokens_criptografados) return null;

  const tokens = JSON.parse(decrypt(row.tokens_criptografados)) as { access_token: string; refresh_token: string };
  const expiresSoon = !row.expira_em || new Date(row.expira_em).getTime() - Date.now() < 60_000;
  if (!expiresSoon) return tokens.access_token;

  const fresh = await refreshTokens(tokens.refresh_token);
  await supabase.from("contas_marketplace").update(pack(fresh)).eq("id", row.id);
  return fresh.access_token;
}
