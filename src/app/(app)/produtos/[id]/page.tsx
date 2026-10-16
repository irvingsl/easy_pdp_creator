import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BUCKET_ORIGINAIS, BUCKET_PROCESSADAS } from "@/domain/types";
import { DeleteProdutoButton } from "@/components/delete-produto-button";

const STATUS_LABEL = { pendente: "Processando", ok: "Fundo branco pronto", erro: "Falhou" } as const;

export default async function ProdutoPage(props: PageProps<"/produtos/[id]">) {
  const { id } = await props.params;
  const supabase = await createClient();

  const { data: produto } = await supabase
    .from("produtos")
    .select("id, sku, oem_code, titulo_base, estoque, status, criado_em, produto_fotos(id, path_original, path_processada, status_processamento, ordem)")
    .eq("id", id)
    .maybeSingle();
  if (!produto) notFound();

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
          {produto.oem_code ? `OEM: ${produto.oem_code} · ` : ""}Estoque: {produto.estoque}
        </p>
      </div>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {fotos.map((f, i) => {
          const processada = f.path_processada
            ? supabase.storage.from(BUCKET_PROCESSADAS).getPublicUrl(f.path_processada).data.publicUrl
            : null;
          const original = originalUrl.get(f.path_original);
          return (
            <li key={f.id} className="flex flex-col gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
              <div className="text-sm font-medium">
                Foto {i + 1} · <span className="font-normal text-gray-500">{STATUS_LABEL[f.status_processamento as keyof typeof STATUS_LABEL]}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[["Original", original], ["Fundo branco", processada]].map(([label, src]) => (
                  <figure key={label} className="flex flex-col gap-1">
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={src} alt={`${label} ${i + 1}`} className="aspect-square w-full rounded border border-gray-100 object-cover dark:border-gray-800" />
                    ) : (
                      <div className="aspect-square w-full rounded bg-gray-100 dark:bg-gray-900" />
                    )}
                    <figcaption className="text-xs text-gray-500">{label}</figcaption>
                  </figure>
                ))}
              </div>
            </li>
          );
        })}
      </ul>

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
