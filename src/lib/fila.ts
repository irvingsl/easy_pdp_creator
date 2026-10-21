import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assinar } from "@/lib/fila-auth";
import { POST as identificarPOST } from "@/app/api/identificar/route";
import { POST as rascunhoPOST } from "@/app/api/rascunho/route";
import { POST as fichaPOST } from "@/app/api/rascunho/ficha/route";
import { getAccessToken } from "@/marketplaces/mercadolivre/accounts";
import { sugerirCategorias } from "@/marketplaces/mercadolivre/listing";
import type { Rascunho } from "@/domain/rascunho";
import { BUCKET_ORIGINAIS, BUCKET_PROCESSADAS } from "@/domain/types";
import { fundoNoServidorAtivo, removerFundoNoServidor } from "@/lib/fundo-servidor";

/**
 * Fila de processamento: cada produto passa por pequenos passos (cada um cabe nos 60 s de uma função da Vercel):
 *   identificar: fotos -> pesquisa -> organizar -> final
 *   rascunho:    rascunho -> categoria -> ficha -> fundo (uma foto por passo, se houver servidor de fundo)
 * e termina em "revisar" (pronto para o vendedor conferir dados e preço). O passo atual fica no banco.
 */
export type EtapaFila = "identificar" | "rascunho" | "revisar" | "pronto" | "erro";

export const PASSOS_IDENTIFICAR = ["fotos", "pesquisa", "organizar", "final"];
const LEASE_MS = 75_000;
const MAX_TENTATIVAS = 2;

type Handler = (request: NextRequest) => Promise<Response>;

/** Chama uma das rotas da API dentro do próprio servidor, em nome do usuário (sem passar pela rede). */
async function chamar(handler: Handler, userId: string, corpo: Record<string, unknown>) {
  const req = new NextRequest("http://interno/api", {
    method: "POST",
    headers: { "content-type": "application/json", ...assinar(userId) },
    body: JSON.stringify(corpo),
  });
  const res = await handler(req);
  const txt = await res.text();
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(txt);
  } catch {
    throw new Error(`resposta inesperada (HTTP ${res.status})`);
  }
  if (!res.ok) throw new Error(String(j.error ?? `HTTP ${res.status}`));
  return j;
}

type Item = {
  id: string;
  fila_etapa: string;
  fila_passo: string | null;
  fila_parcial: Record<string, unknown> | null;
  fila_tentativas: number;
};

/** Pega o próximo produto da fila que ninguém está processando (reserva por 75 s; a reserva vencida libera produtos travados). */
export async function reivindicar(admin: SupabaseClient, userId: string): Promise<Item | null> {
  const agora = new Date().toISOString();
  const livre = `fila_lease.is.null,fila_lease.lt.${agora}`;
  const { data } = await admin
    .from("produtos")
    .select("id, fila_etapa, fila_passo, fila_parcial, fila_tentativas")
    .eq("user_id", userId)
    .in("fila_etapa", ["identificar", "rascunho"])
    .or(livre)
    .order("fila_atualizado_em", { ascending: true })
    .limit(3);
  for (const p of (data ?? []) as Item[]) {
    const { data: ok } = await admin
      .from("produtos")
      .update({ fila_lease: new Date(Date.now() + LEASE_MS).toISOString() })
      .eq("id", p.id)
      .eq("user_id", userId)
      .or(livre)
      .select("id");
    if (ok?.length) return p;
  }
  return null;
}

/** Executa UM passo do produto e grava o resultado e o próximo passo. Nunca lança: erros ficam no produto. */
export async function executarPasso(admin: SupabaseClient, userId: string, p: Item) {
  const passo = p.fila_passo ?? (p.fila_etapa === "identificar" ? "fotos" : "rascunho");
  const salvar = (campos: Record<string, unknown>) =>
    admin
      .from("produtos")
      .update({ fila_lease: null, fila_atualizado_em: new Date().toISOString(), fila_tentativas: 0, ...campos })
      .eq("id", p.id)
      .eq("user_id", userId);
  const parcial = p.fila_parcial ?? undefined;

  try {
    switch (passo) {
      case "fotos": {
        const out = await chamar(identificarPOST, userId, { produtoId: p.id, etapa: "fotos" });
        await salvar({ fila_etapa: "identificar", fila_passo: "pesquisa", fila_parcial: out, fila_erro: null });
        return;
      }
      case "pesquisa": {
        const out = await chamar(identificarPOST, userId, { produtoId: p.id, etapa: "pesquisa", parcial });
        await salvar({ fila_passo: out.pesquisou && out.textoPesquisa ? "organizar" : "final", fila_parcial: out });
        return;
      }
      case "organizar": {
        const out = await chamar(identificarPOST, userId, { produtoId: p.id, etapa: "organizar", parcial });
        await salvar({ fila_passo: "final", fila_parcial: out });
        return;
      }
      case "final": {
        await chamar(identificarPOST, userId, { produtoId: p.id, etapa: "final", parcial });
        await salvar({ fila_etapa: "rascunho", fila_passo: "rascunho", fila_parcial: null });
        return;
      }
      case "rascunho": {
        await chamar(rascunhoPOST, userId, { produtoId: p.id });
        await salvar({ fila_etapa: "rascunho", fila_passo: "categoria" });
        return;
      }
      case "categoria": {
        const { data } = await admin.from("produtos").select("rascunho").eq("id", p.id).eq("user_id", userId).maybeSingle();
        const r = data?.rascunho as Rascunho | null;
        if (r && !r.categoria_id && r.titulo) {
          const token = await getAccessToken(admin, userId);
          const cats = token ? await sugerirCategorias(token, r.titulo) : [];
          if (cats[0]) await admin.from("produtos").update({ rascunho: { ...r, categoria_id: cats[0].id } }).eq("id", p.id).eq("user_id", userId);
        }
        await salvar({ fila_passo: "ficha" });
        return;
      }
      case "ficha": {
        try {
          await chamar(fichaPOST, userId, { produtoId: p.id });
          await salvar({ fila_etapa: fundoNoServidorAtivo() ? "rascunho" : "revisar", fila_passo: fundoNoServidorAtivo() ? "fundo" : null, fila_erro: null });
        } catch (e) {
          // a ficha é um complemento: o vendedor pode preenchê-la na revisão
          await salvar({ fila_etapa: fundoNoServidorAtivo() ? "rascunho" : "revisar", fila_passo: fundoNoServidorAtivo() ? "fundo" : null, fila_erro: `Ficha técnica não preenchida: ${e instanceof Error ? e.message : "falha"}` });
        }
        return;
      }
      case "fundo": {
        await passoFundo(admin, userId, p.id, salvar);
        return;
      }
      default:
        await salvar({ fila_etapa: "erro", fila_erro: `passo desconhecido: ${passo}` });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "falha";
    if (p.fila_tentativas + 1 < MAX_TENTATIVAS) {
      await admin
        .from("produtos")
        .update({ fila_lease: null, fila_atualizado_em: new Date().toISOString(), fila_tentativas: p.fila_tentativas + 1, fila_erro: `Passo "${passo}" falhou, tentando de novo: ${msg}` })
        .eq("id", p.id)
        .eq("user_id", userId);
    } else if (passo === "pesquisa" || passo === "organizar") {
      // sem pesquisa o resultado sai só com o que as fotos mostraram, mas sai
      await salvar({ fila_passo: "final", fila_erro: `Pesquisa não concluída (${msg}); resultado só com as fotos.` });
    } else if (passo === "categoria") {
      await salvar({ fila_passo: "ficha", fila_erro: `Categoria não escolhida: ${msg}` });
    } else {
      await salvar({ fila_etapa: "erro", fila_passo: passo, fila_erro: `Falhou no passo "${passo}": ${msg}` });
    }
  }
}

/** Remove o fundo de UMA foto pendente do produto no servidor; quando não sobra nenhuma, o produto vai para revisão. */
async function passoFundo(admin: SupabaseClient, userId: string, produtoId: string, salvar: (c: Record<string, unknown>) => unknown) {
  const concluir = (erro: string | null) => salvar({ fila_etapa: "revisar", fila_passo: null, ...(erro ? { fila_erro: erro } : {}) });
  if (!fundoNoServidorAtivo()) return concluir(null);
  const { data: dono } = await admin.from("produtos").select("id").eq("id", produtoId).eq("user_id", userId).maybeSingle();
  if (!dono) return concluir("produto não encontrado");
  const { data: fotos } = await admin
    .from("produto_fotos")
    .select("id, path_original, status_processamento")
    .eq("produto_id", produtoId)
    .eq("status_processamento", "pendente")
    .order("ordem", { ascending: true })
    .limit(1);
  const foto = fotos?.[0];
  if (!foto) return concluir(null);

  const { data: usuario } = await admin.auth.admin.getUserById(userId);
  const sens = Number(usuario.user?.user_metadata?.limiar_fundo);
  try {
    const { data: original, error } = await admin.storage.from(BUCKET_ORIGINAIS).download(foto.path_original);
    if (error || !original) throw new Error(error?.message ?? "original não encontrado");
    const { jpeg, area } = await removerFundoNoServidor(original, Number.isFinite(sens) ? sens : 50);
    const path = `${userId}/${produtoId}/${crypto.randomUUID()}.jpg`;
    const up = await admin.storage.from(BUCKET_PROCESSADAS).upload(path, jpeg, { contentType: "image/jpeg" });
    if (up.error) throw up.error;
    // recorte que sobrou quase vazio costuma ser erro do modelo: marca para o vendedor decidir (manter original)
    await admin.from("produto_fotos").update({ path_processada: path, status_processamento: "ok", manter_original: false }).eq("id", foto.id);
    // espaça os pedidos: contas com pouco crédito no Replicate aceitam 6 por minuto
    await new Promise((ok) => setTimeout(ok, 8000));
    await salvar({ fila_passo: "fundo", fila_erro: area < 0.03 ? "Uma foto ficou quase vazia depois do recorte: confira e, se preciso, use o original." : null });
  } catch (e) {
    // não derruba o produto: a foto fica com erro e o vendedor pode refazer na página dele
    await admin.from("produto_fotos").update({ status_processamento: "erro" }).eq("id", foto.id);
    await salvar({ fila_passo: "fundo", fila_erro: `Fundo de uma foto não removido no servidor: ${e instanceof Error ? e.message : "falha"}` });
  }
}
