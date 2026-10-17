import { createClient } from "@/lib/supabase/server";
import { getAccessToken } from "@/marketplaces/mercadolivre/accounts";
import { BUCKET_PROCESSADAS } from "@/domain/types";
import { btnSecondary, inputBase } from "@/components/ui";

const API = "https://api.mercadolibre.com";
const field = (v: string | string[] | undefined, d = "") => (typeof v === "string" ? v.trim() : d);

export default async function ValidarPage(props: PageProps<"/conta/validar">) {
  const sp = await props.searchParams;
  const produtoId = field(sp.produto);
  const categoria = field(sp.categoria, "MLB238215");
  const titulo = field(sp.titulo);
  const preco = Number(field(sp.preco, "0"));
  const marca = field(sp.marca);
  const numero = field(sp.numero);

  const supabase = await createClient();
  const { data: produtos } = await supabase
    .from("produtos")
    .select("id, sku, produto_fotos(path_processada, ordem)")
    .order("criado_em", { ascending: false });

  let resultado: { status: number; body: unknown; payload: unknown } | null = null;
  if (produtoId && titulo && preco > 0) {
    const foto = produtos
      ?.find((p) => p.id === produtoId)
      ?.produto_fotos.filter((f) => f.path_processada)
      .sort((a, b) => a.ordem - b.ordem);
    const pictures = (foto ?? []).map((f) => ({
      source: supabase.storage.from(BUCKET_PROCESSADAS).getPublicUrl(f.path_processada!).data.publicUrl,
    }));
    const payload = {
      title: titulo,
      category_id: categoria,
      price: preco,
      currency_id: "BRL",
      available_quantity: 1,
      buying_mode: "buy_it_now",
      condition: "new",
      listing_type_id: "gold_special",
      pictures,
      attributes: [
        { id: "BRAND", value_name: marca },
        { id: "PART_NUMBER", value_name: numero },
        { id: "VEHICLE_TYPE", value_id: "11377043" },
      ],
    };
    const token = await getAccessToken(supabase);
    if (token) {
      // /items/validate só valida o payload: não cria nem publica nada
      const res = await fetch(`${API}/items/validate`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
      });
      const text = await res.text();
      let body: unknown = text;
      try { body = text ? JSON.parse(text) : "(sem corpo: validação passou)"; } catch { /* mantém texto */ }
      resultado = { status: res.status, body, payload };
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-semibold">Validar anúncio (não publica)</h1>
      <p className="text-sm text-gray-500">
        Envia o rascunho para <code>/items/validate</code> do ML, que só aponta erros. Nada é criado na sua conta.
      </p>
      <form className="flex flex-col gap-2">
        <select name="produto" defaultValue={produtoId} className={inputBase}>
          <option value="">Escolha um produto (usa as fotos com fundo branco)</option>
          {produtos?.map((p) => <option key={p.id} value={p.id}>{p.sku}</option>)}
        </select>
        <input name="categoria" defaultValue={categoria} placeholder="Categoria (ex.: MLB238215)" className={inputBase} />
        <input name="titulo" defaultValue={titulo} placeholder="Título (até 60 caracteres)" className={inputBase} />
        <input name="preco" defaultValue={preco || ""} placeholder="Preço (R$)" inputMode="decimal" className={inputBase} />
        <input name="marca" defaultValue={marca} placeholder="Marca (ex.: LuK)" className={inputBase} />
        <input name="numero" defaultValue={numero} placeholder="Número de peça (ex.: 323 0162 10)" className={inputBase} />
        <button className={`${btnSecondary} self-start`}>Validar</button>
      </form>
      {resultado && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-gray-500">/items/validate → <strong>HTTP {resultado.status}</strong></p>
          <pre className="max-h-96 overflow-auto rounded-lg bg-gray-100 p-3 text-xs dark:bg-gray-900">{JSON.stringify(resultado.body, null, 2)?.slice(0, 5000)}</pre>
          <details className="text-xs text-gray-500">
            <summary>Dados enviados</summary>
            <pre className="overflow-auto rounded-lg bg-gray-100 p-3 dark:bg-gray-900">{JSON.stringify(resultado.payload, null, 2)}</pre>
          </details>
        </div>
      )}
    </div>
  );
}
