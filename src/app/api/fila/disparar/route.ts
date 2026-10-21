import { after, NextResponse, type NextRequest } from "next/server";
import { assinar } from "@/lib/fila-auth";
import { executarPasso, reivindicar } from "@/lib/fila";
import { adminClient } from "@/lib/supabase/admin";
import { contextoDaRequisicao } from "@/lib/supabase/request";

export const maxDuration = 60;

/**
 * Põe a fila para andar. Responde na hora (202) e processa UM passo do próximo produto depois da resposta
 * (cabe nos 60 s da função); ao terminar, chama a si mesma para o passo seguinte. Sem trabalho, a corrente acaba.
 * `cadeias` = quantos produtos processar ao mesmo tempo.
 */
export async function POST(request: NextRequest) {
  const { userId } = await contextoDaRequisicao(request);
  if (!userId) return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  if (!process.env.SUPABASE_SECRET_KEY) return NextResponse.json({ error: "falta SUPABASE_SECRET_KEY no servidor" }, { status: 500 });
  const { cadeias = 1 } = (await request.json().catch(() => ({}))) as { cadeias?: number };
  const origem = request.nextUrl.origin;
  // o vigia do banco precisa saber o endereço do app: guarda o último usado
  await adminClient().from("fila_config").upsert({ chave: "origem", valor: origem }).then(() => {}, () => {});

  const proxima = () =>
    fetch(`${origem}/api/fila/disparar`, {
      method: "POST",
      headers: { "content-type": "application/json", ...assinar(userId) },
      body: "{}",
    }).catch(() => {});

  after(async () => {
    for (let i = 1; i < Math.min(Math.max(cadeias, 1), 3); i++) await proxima();
    const admin = adminClient();
    const item = await reivindicar(admin, userId);
    if (!item) return;
    await executarPasso(admin, userId, item);
    await proxima();
  });
  return NextResponse.json({ ok: true }, { status: 202 });
}
