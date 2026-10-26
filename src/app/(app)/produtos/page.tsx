import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { BUCKET_PROCESSADAS } from "@/domain/types";
import { COR_BOLINHA, situacaoDoProduto } from "@/domain/situacao";
import { getAccessToken } from "@/marketplaces/mercadolivre/accounts";
import { mlGet } from "@/marketplaces/mercadolivre/oauth";
import { BotaoTentarDeNovo, ESTADO, FilaPainel, rotuloDoEstado, type ItemFila } from "@/components/fila-painel";

export default async function ProdutosPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const { data: produtos } = await supabase
    .from("produtos")
    .select("id, sku, titulo_base, estoque, rascunho, fila_etapa, fila_passo, fila_erro, anuncios(status, external_id), produto_fotos(path_original, path_processada, status_processamento, id, ordem)")
    .order("criado_em", { ascending: false })
    .limit(100);

  if (!produtos?.length) {
    return (
      <p className="py-10 text-center text-gray-500">
        Nenhum produto ainda. <Link href="/produtos/novo" className="underline">Criar o primeiro</Link>.
      </p>
    );
  }

  // O status gravado pode estar velho (o ML cria pausado, depois revisa e ativa): confere o real de todos os publicados de uma vez
  const publicados = produtos.flatMap((p) => (p.anuncios ?? []).filter((a) => a.external_id && a.status !== "deleted" && a.status !== "closed"));
  if (publicados.length) {
    try {
      const token = await getAccessToken(supabase);
      if (token) {
        for (let i = 0; i < publicados.length; i += 20) {
          const lote = publicados.slice(i, i + 20);
          const r = await mlGet(`/items?ids=${lote.map((a) => a.external_id).join(",")}&attributes=id,status,sub_status`, token);
          const lista = (Array.isArray(r.body) ? r.body : []) as { code?: number; body?: { id?: string; status?: string; sub_status?: string[] } }[];
          for (const [k, it] of lista.entries()) {
            const b = it.body;
            const a = lote[k];
            if (!a) continue;
            const removido = it.code === 404 || (it.code === 200 && b?.status === "closed" && b.sub_status?.includes("deleted"));
            const novo = removido ? "deleted" : it.code === 200 ? b?.status : undefined;
            if (novo && novo !== a.status) {
              await supabase.from("anuncios").update({ status: novo, ultimo_sync_em: new Date().toISOString() }).eq("external_id", a.external_id!);
              a.status = novo;
            }
          }
        }
      }
    } catch {
      /* sem conexão com o ML: usa o status gravado */
    }
  }

  const sens = Number(auth.user?.user_metadata?.limiar_fundo);
  const itens: ItemFila[] = produtos.map((p) => ({
    id: p.id,
    sku: p.sku,
    etapa: p.fila_etapa,
    passo: p.fila_passo,
    erro: p.fila_erro,
    pendentes: (p.produto_fotos ?? []).filter((f) => f.status_processamento === "pendente").map((f) => ({ fotoId: f.id, pathOriginal: f.path_original, produtoId: p.id })),
  }));

  return (
    <>
      <FilaPainel itens={itens} userId={auth.user!.id} sensibilidade={Number.isFinite(sens) ? Math.min(100, Math.max(0, sens)) : 50} />
      <p className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-green-500" />publicado</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-amber-400" />precisa de você</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-red-500" />erro ou sem estoque</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-gray-400" />processando</span>
      </p>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {produtos.map((p) => {
          const foto = [...(p.produto_fotos ?? [])]
            .filter((f) => f.path_processada)
            .sort((a, b) => a.ordem - b.ordem)[0];
          const url = foto ? supabase.storage.from(BUCKET_PROCESSADAS).getPublicUrl(foto.path_processada!).data.publicUrl : null;
          const estado = p.fila_etapa && p.fila_etapa !== "revisar" ? ESTADO[p.fila_etapa] : null;
          const rasc = p.rascunho as { titulo?: string; preco?: number | null } | null;
          const sit = situacaoDoProduto({
            fila_etapa: p.fila_etapa,
            fila_erro: p.fila_erro,
            estoque: p.estoque,
            anuncios: p.anuncios ?? [],
            fotos: p.produto_fotos ?? [],
            tem_rascunho: !!rasc?.titulo,
            preco: rasc?.preco ?? null,
          });
          return (
            <li key={p.id}>
              <Link href={`/produtos/${p.id}`} className="relative block overflow-hidden rounded-lg border border-gray-200 transition hover:border-indigo-500 hover:shadow dark:border-gray-800">
                <span title={sit.titulo} aria-label={sit.titulo} className={`absolute right-2 top-2 z-10 h-4 w-4 rounded-full ring-2 ring-white dark:ring-gray-900 ${COR_BOLINHA[sit.cor]}`} />
                {url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt={p.sku} className="aspect-square w-full object-cover" />
                ) : (
                  <div className="aspect-square bg-gray-100 dark:bg-gray-900" />
                )}
                <div className="flex flex-col gap-1 p-2 text-sm">
                  <div className="font-mono">{p.sku}</div>
                  {estado && <span className={`self-start rounded-full px-2 py-0.5 text-xs font-medium ${estado.cor}`}>{rotuloDoEstado(p.fila_etapa, p.fila_passo)}</span>}
                  {p.fila_etapa === "erro" && <BotaoTentarDeNovo produtoId={p.id} passo={p.fila_passo} />}
                  {p.fila_erro && <span className="break-words text-xs text-amber-700 dark:text-amber-400">{p.fila_erro}</span>}
                  <div className="text-gray-500">
                    {p.produto_fotos?.length ?? 0} foto(s){foto ? "" : " · sem fundo branco"}
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
