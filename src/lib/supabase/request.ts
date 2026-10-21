import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verificar } from "@/lib/fila-auth";
import { adminClient } from "./admin";
import { createClient } from "./server";

/**
 * Cliente e usuário da requisição. Do navegador: sessão por cookies (com RLS). Chamada interna da fila
 * (assinada com a chave do servidor): cliente de servidor e o usuário dono do produto; as rotas filtram por user_id.
 */
export async function contextoDaRequisicao(request: NextRequest): Promise<{ supabase: SupabaseClient; userId: string | null }> {
  const interno = verificar(request.headers);
  if (interno) return { supabase: adminClient(), userId: interno };
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, userId: data.user?.id ?? null };
}
