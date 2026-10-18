import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccessToken } from "@/marketplaces/mercadolivre/accounts";
import { mlGet } from "@/marketplaces/mercadolivre/oauth";
import { BUCKET_ORIGINAIS, BUCKET_PROCESSADAS } from "@/domain/types";
import { DeleteProdutoButton } from "@/components/delete-produto-button";
import { ProdutoFotos, type FotoView } from "@/components/produto-fotos";
import { IdentificarIA, type Identificacao } from "@/components/identificar-ia";
import { EstoqueProduto } from "@/components/estoque-produto";
import { Etapa } from "@/components/etapa";
import { AnuncioAtualizar } from "@/components/anuncio-atualizar";
import { AnuncioCompat } from "@/components/anuncio-compat";
import { AnuncioQualidade } from "@/components/anuncio-qualidade";
import { DadosConfirmadosForm } from "@/components/dados-confirmados";
import { RascunhoAnuncio } from "@/components/rascunho-anuncio";
import type { Rascunho } from "@/domain/rascunho";
import type { DadosConfirmados } from "@/domain/dados-confirmados";

export default async function ProdutoPage(props: PageProps<"/produtos/[id]">) {
  const { id } = await props.params;
  const supabase = await createClient();

  const { data: produto } = await supabase
    .from("produtos")
    .select("id, user_id, sku, identificacao, rascunho, dados_confirmados, oem_code, titulo_base, estoque, status, criado_em, produto_fotos(id, path_original, path_processada, status_processamento, ordem, manter_original)")
    .eq("id", id)
    .maybeSingle();
  if (!produto) notFound();

  const { data: anuncios } = await supabase
    .from("anuncios")
    .select("id, external_id, status, preco, criado_em, permalink:resposta_criacao->>permalink")
    .eq("produto_id", id)
    .neq("status", "deleted")
    .order("criado_em", { ascending: false });

  // O status gravado é o do momento da criação (o ML cria pausado enquanto baixa as fotos): busca o real no ML
  const subStatus = new Map<string, string[]>();
  if (anuncios?.length) {
    try {
      const token = await getAccessToken(supabase);
      const ids = anuncios.map((a) => a.external_id).filter((x): x is string => !!x);
      if (token && ids.length) {
        const r = await mlGet(`/items?ids=${ids.join(",")}&attributes=id,status,sub_status`, token);
        const lista = (Array.isArray(r.body) ? r.body : []) as { code?: number; body?: { id?: string; status?: string; sub_status?: string[] } }[];
        for (const [i, it] of lista.entries()) {
          const b = it.body;
          // anúncio excluído no ML: some da lista (404, ou encerrado com sub_status "deleted")
          const removido = it.code === 404 || (it.code === 200 && b?.status === "closed" && b.sub_status?.includes("deleted"));
          if (removido) {
            // a resposta de um item inexistente não traz o ID: o multiget mantém a ordem dos IDs pedidos
            const a = anuncios.find((x) => x.external_id === ids[i]);
            if (a) {
              await supabase.from("anuncios").update({ status: "deleted", ultimo_sync_em: new Date().toISOString() }).eq("id", a.id);
              anuncios.splice(anuncios.indexOf(a), 1);
            }
            continue;
          }
          if (it.code !== 200 || !b?.id || !b.status) continue;
          subStatus.set(b.id, b.sub_status ?? []);
          const a = anuncios.find((x) => x.external_id === b.id);
          if (a && a.status !== b.status) {
            await supabase.from("anuncios").update({ status: b.status, ultimo_sync_em: new Date().toISOString() }).eq("id", a.id);
            a.status = b.status;
          }
        }
      }
    } catch {
      /* sem conexão com o ML: mostra o que está gravado */
    }
  }

  const rascunho = (produto.rascunho as Rascunho | null) ?? null;
  const dc = (produto.dados_confirmados as DadosConfirmados | null) ?? {};
  const temDados = !!(dc.marca || dc.numero_peca || dc.veiculo || dc.caracteristicas?.length || produto.oem_code);
  // abre a primeira etapa que ainda está pendente
  const proxima = !temDados ? "dados" : !produto.identificacao ? "identificacao" : !rascunho ? "rascunho" : null;

  const fotos = [...produto.produto_fotos].sort((a, b) => a.ordem - b.ordem);
  const { data: signed } = await supabase.storage
    .from(BUCKET_ORIGINAIS)
    .createSignedUrls(fotos.map((f) => f.path_original), 3600);
  const originalUrl = new Map(signed?.map((s) => [s.path, s.signedUrl]));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/produtos" className="text-sm text-gray-500 hover:underline">← Produtos</Link>
        <h1 className="mt-1 font-mono text-xl font-semibold">{produto.sku}</h1>
        <p className="text-sm text-gray-500">
          {produto.oem_code ? `OEM: ${produto.oem_code}` : ""}
        </p>
        <div className="mt-2"><EstoqueProduto key={produto.estoque} produtoId={produto.id} estoque={produto.estoque} /></div>
      </div>

      <Etapa titulo="Fotos" resumo={`${fotos.length} foto(s)`} aberto>
        <ProdutoFotos
          produtoId={produto.id}
          userId={produto.user_id}
          fotos={fotos.map((f) => ({
            id: f.id,
            ordem: f.ordem,
            status: f.status_processamento as FotoView["status"],
            pathOriginal: f.path_original,
            pathProcessada: f.path_processada,
            manterOriginal: f.manter_original,
            originalUrl: originalUrl.get(f.path_original) ?? null,
            processadaUrl: f.path_processada
              ? supabase.storage.from(BUCKET_PROCESSADAS).getPublicUrl(f.path_processada).data.publicUrl
              : null,
          }))}
        />
      </Etapa>

      <Etapa n={1} titulo="Dados confirmados por você" resumo={temDados ? "preenchido" : "pendente: o que você conferiu com o item na mão"} aberto={proxima === "dados"}>
        <DadosConfirmadosForm produtoId={produto.id} oemCode={produto.oem_code} inicial={(produto.dados_confirmados as DadosConfirmados) ?? {}} />
      </Etapa>

      <Etapa n={2} titulo="Identificação com IA" resumo={produto.identificacao ? "feita" : "pendente"} aberto={proxima === "identificacao"}>
        <IdentificarIA produtoId={produto.id} inicial={(produto.identificacao as Identificacao | null) ?? null} />
      </Etapa>

      <Etapa n={3} titulo="Rascunho do anúncio" resumo={rascunho?.titulo || "pendente"} aberto={proxima === "rascunho"}>
        <RascunhoAnuncio produtoId={produto.id} inicial={rascunho} estoque={produto.estoque} />
      </Etapa>

      {!!anuncios?.length && (
        <Etapa n={4} titulo="Anúncios publicados" resumo={`${anuncios.length} anúncio(s)`}>
          <ul className="flex flex-col gap-3 text-sm">
            {anuncios.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono">{a.external_id}</span>
                <span className="text-gray-500">
                  {{ paused: "pausado", active: "ativo", closed: "encerrado", under_review: "em revisão", payment_required: "pagamento pendente" }[a.status as string] ?? a.status}
                  {a.external_id && subStatus.get(a.external_id)?.length ? ` (${subStatus.get(a.external_id)!.map((x) => ({ picture_download_pending: "baixando fotos", paused_by_seller: "pausado por você" } as Record<string, string>)[x] ?? x).join(", ")})` : ""}
                </span>
                <span>{a.preco != null ? Number(a.preco).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : ""}</span>
                <span className="text-xs text-gray-500">{new Date(a.criado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</span>
                {a.permalink && <a className="text-indigo-600 underline" href={String(a.permalink)} target="_blank" rel="noreferrer">Abrir no ML</a>}
                {a.external_id && <AnuncioQualidade itemId={a.external_id} />}
                {a.external_id && <AnuncioCompat itemId={a.external_id} />}
                {a.external_id && <AnuncioAtualizar produtoId={produto.id} itemId={a.external_id} />}
              </li>
            ))}
          </ul>
        </Etapa>
      )}

      <DeleteProdutoButton
        produtoId={produto.id}
        paths={fotos.flatMap((f) => [
          { bucket: BUCKET_ORIGINAIS, path: f.path_original },
          ...(f.path_processada ? [{ bucket: BUCKET_PROCESSADAS, path: f.path_processada }] : []),
        ])}
      />
    </div>
  );
}
