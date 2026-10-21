import { createClient } from "@supabase/supabase-js";

/**
 * Cliente com a chave secreta (ignora o RLS): só para código de servidor.
 * Como não há RLS, toda consulta feita com ele precisa filtrar pelo user_id do dono.
 */
export const adminClient = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
