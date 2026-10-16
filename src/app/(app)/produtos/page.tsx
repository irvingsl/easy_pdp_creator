import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { BUCKET_PROCESSADAS } from "@/domain/types";

export default async function ProdutosPage() {
  const supabase = await createClient();
  const { data: produtos } = await supabase
    .from("produtos")
    .select("id, sku, titulo_base, estoque, produto_fotos(path_processada, ordem)")
    .order("criado_em", { ascending: false })
    .limit(100);

  if (!produtos?.length) {
    return (
      <p className="py-10 text-center text-gray-500">
        Nenhum produto ainda. <Link href="/produtos/novo" className="underline">Criar o primeiro</Link>.
      </p>
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {produtos.map((p) => {
        const foto = [...(p.produto_fotos ?? [])]
          .filter((f) => f.path_processada)
          .sort((a, b) => a.ordem - b.ordem)[0];
        const url = foto
          ? supabase.storage.from(BUCKET_PROCESSADAS).getPublicUrl(foto.path_processada!).data.publicUrl
          : null;
        return (
          <li key={p.id}>
           <Link href={`/produtos/${p.id}`} className="block overflow-hidden rounded-lg border border-gray-200 transition hover:border-indigo-500 hover:shadow dark:border-gray-800">
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt={p.sku} className="aspect-square w-full object-cover" />
            ) : (
              <div className="aspect-square bg-gray-100 dark:bg-gray-900" />
            )}
            <div className="p-2 text-sm">
              <div className="font-mono">{p.sku}</div>
              <div className="text-gray-500">
                {p.produto_fotos?.length ?? 0} foto(s){foto ? "" : " · sem fundo branco"}
              </div>
            </div>
           </Link>
          </li>
        );
      })}
    </ul>
  );
}
