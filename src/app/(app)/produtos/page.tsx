import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { BUCKET_PROCESSADAS } from "@/domain/types";
import { BotaoTentarDeNovo, ESTADO, FilaPainel, rotuloDoEstado, type ItemFila } from "@/components/fila-painel";

export default async function ProdutosPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const { data: produtos } = await supabase
    .from("produtos")
    .select("id, sku, titulo_base, estoque, fila_etapa, fila_passo, fila_erro, produto_fotos(path_original, path_processada, status_processamento, id, ordem)")
    .order("criado_em", { ascending: false })
    .limit(100);

  if (!produtos?.length) {
    return (
      <p className="py-10 text-center text-gray-500">
        Nenhum produto ainda. <Link href="/produtos/novo" className="underline">Criar o primeiro</Link>.
      </p>
    );
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
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {produtos.map((p) => {
          const foto = [...(p.produto_fotos ?? [])]
            .filter((f) => f.path_processada)
            .sort((a, b) => a.ordem - b.ordem)[0];
          const url = foto ? supabase.storage.from(BUCKET_PROCESSADAS).getPublicUrl(foto.path_processada!).data.publicUrl : null;
          const estado = p.fila_etapa ? ESTADO[p.fila_etapa] : null;
          return (
            <li key={p.id}>
              <Link href={`/produtos/${p.id}`} className="block overflow-hidden rounded-lg border border-gray-200 transition hover:border-indigo-500 hover:shadow dark:border-gray-800">
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
