import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BUCKET_ORIGINAIS, BUCKET_PROCESSADAS } from "@/domain/types";
import { DeleteProdutoButton } from "@/components/delete-produto-button";
import { ProdutoFotos, type FotoView } from "@/components/produto-fotos";
import { IdentificarIA, type Identificacao } from "@/components/identificar-ia";
import { DadosConfirmadosForm } from "@/components/dados-confirmados";
import type { DadosConfirmados } from "@/domain/dados-confirmados";

export default async function ProdutoPage(props: PageProps<"/produtos/[id]">) {
  const { id } = await props.params;
  const supabase = await createClient();

  const { data: produto } = await supabase
    .from("produtos")
    .select("id, user_id, sku, identificacao, dados_confirmados, oem_code, titulo_base, estoque, status, criado_em, produto_fotos(id, path_original, path_processada, status_processamento, ordem)")
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

      <DadosConfirmadosForm produtoId={produto.id} oemCode={produto.oem_code} inicial={(produto.dados_confirmados as DadosConfirmados) ?? {}} />

      <IdentificarIA produtoId={produto.id} inicial={(produto.identificacao as Identificacao | null) ?? null} />

      <ProdutoFotos
        produtoId={produto.id}
        userId={produto.user_id}
        fotos={fotos.map((f) => ({
          id: f.id,
          ordem: f.ordem,
          status: f.status_processamento as FotoView["status"],
          pathOriginal: f.path_original,
          pathProcessada: f.path_processada,
          originalUrl: originalUrl.get(f.path_original) ?? null,
          processadaUrl: f.path_processada
            ? supabase.storage.from(BUCKET_PROCESSADAS).getPublicUrl(f.path_processada).data.publicUrl
            : null,
        }))}
      />

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
