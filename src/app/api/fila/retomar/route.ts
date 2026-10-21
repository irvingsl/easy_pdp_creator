import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { assinar } from "@/lib/fila-auth";
import { adminClient } from "@/lib/supabase/admin";

export const maxDuration = 30;

/**
 * Chamado a cada minuto pelo vigia do banco (pg_cron) quando há produto parado na fila: religa a corrente.
 * Autenticado por um segredo que só existe no banco (tabela fila_config), sem variável de ambiente nova.
 */
export async function POST(request: NextRequest) {
  const admin = adminClient();
  const { data: cfg } = await admin.from("fila_config").select("valor").eq("chave", "segredo").maybeSingle();
  const recebido = Buffer.from(request.headers.get("x-fila-cron") ?? "");
  const esperado = Buffer.from(cfg?.valor ?? "");
  if (!esperado.length || recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }
  const agora = new Date().toISOString();
  const { data } = await admin
    .from("produtos")
    .select("user_id")
    .in("fila_etapa", ["identificar", "rascunho"])
    .or(`fila_lease.is.null,fila_lease.lt.${agora}`);
  const usuarios = [...new Set((data ?? []).map((p) => p.user_id as string))];
  const origem = request.nextUrl.origin;
  await Promise.all(
    usuarios.map((u) =>
      fetch(`${origem}/api/fila/disparar`, {
        method: "POST",
        headers: { "content-type": "application/json", ...assinar(u) },
        body: JSON.stringify({ cadeias: 2 }),
      }).catch(() => {}),
    ),
  );
  return NextResponse.json({ retomados: usuarios.length });
}
