import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";

export type UsoChamada = { modelo: string; grounded: boolean; tokens_entrada: number | null; tokens_saida: number | null; buscas: number; status: number };

/** Junta o consumo das chamadas ao Gemini feitas durante um pedido, para gravar no fim dele. */
export const usoStore = new AsyncLocalStorage<UsoChamada[]>();

export const registrarChamada = (c: UsoChamada) => usoStore.getStore()?.push(c);

export async function gravarUso(supabase: SupabaseClient, produtoId: string, etapa: string, userId?: string) {
  const lista = usoStore.getStore();
  if (!lista?.length) return;
  const itens = lista.splice(0).map((c) => ({ ...c, produto_id: produtoId, etapa, ...(userId ? { user_id: userId } : {}) }));
  await supabase.from("uso_ia").insert(itens);
}
