import { createClient } from "@/lib/supabase/server";
import { getAccessToken, getAccount } from "@/marketplaces/mercadolivre/accounts";
import { BUCKET_PROCESSADAS } from "@/domain/types";
import { btnSecondary, inputBase } from "@/components/ui";
import { CopyBlock } from "@/components/copy-block";

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
  const altura = field(sp.altura, "6");
  const largura = field(sp.largura, "25");
  const comprimento = field(sp.comprimento, "25");
  const peso = field(sp.peso, "1000");
  const modo = field(sp.modo, "me2");

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
    // Modelo "User Products": o ML monta o título; enviamos só o family_name
    const payload = {
      family_name: titulo,
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
        { id: "PACKAGE_HEIGHT", value_name: `${altura} cm` },
        { id: "PACKAGE_WIDTH", value_name: `${largura} cm` },
        { id: "PACKAGE_LENGTH", value_name: `${comprimento} cm` },
        { id: "PACKAGE_WEIGHT", value_name: `${peso} g` },
      ],
      shipping: { mode: modo, local_pick_up: false, free_shipping: true },
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

  // Quais modos de envio a conta tem habilitados (ajuda a entender avisos de frete)
  let envio: { status: number; body: unknown } | null = null;
  const conta = await getAccount(supabase);
  const tk = conta ? await getAccessToken(supabase) : null;
  if (conta && tk) {
    const r = await fetch(`${API}/users/${conta.external_user_id}/shipping_preferences`, {
      headers: { authorization: `Bearer ${tk}` },
      cache: "no-store",
    });
    envio = { status: r.status, body: await r.json().catch(() => null) };
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
        <input name="titulo" defaultValue={titulo} placeholder="Nome da família / family_name (ex.: Disco De Embreagem Luk 230mm)" className={inputBase} />
        <input name="preco" defaultValue={preco || ""} placeholder="Preço (R$)" inputMode="decimal" className={inputBase} />
        <input name="marca" defaultValue={marca} placeholder="Marca (ex.: LuK)" className={inputBase} />
        <input name="numero" defaultValue={numero} placeholder="Número de peça (ex.: 323 0162 10)" className={inputBase} />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <input name="altura" defaultValue={altura} placeholder="Altura (cm)" inputMode="decimal" className={inputBase} />
          <input name="largura" defaultValue={largura} placeholder="Largura (cm)" inputMode="decimal" className={inputBase} />
          <input name="comprimento" defaultValue={comprimento} placeholder="Comprimento (cm)" inputMode="decimal" className={inputBase} />
          <input name="peso" defaultValue={peso} placeholder="Peso (g)" inputMode="decimal" className={inputBase} />
        </div>
        <select name="modo" defaultValue={modo} className={inputBase}>
          <option value="me2">Envio: Mercado Envios (me2)</option>
          <option value="not_specified">Envio: não especificado</option>
          <option value="custom">Envio: a combinar (custom)</option>
        </select>
        <button className={`${btnSecondary} self-start`}>Validar</button>
      </form>
      {envio && (
        <details className="text-xs text-gray-500">
          <summary>Preferências de envio da conta (HTTP {envio.status})</summary>
          <CopyBlock text={JSON.stringify(envio.body, null, 2) ?? ""} label="Copiar preferências" />
        </details>
      )}
      {resultado && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-gray-500">/items/validate → <strong>HTTP {resultado.status}</strong></p>
          <CopyBlock text={`/items/validate → HTTP ${resultado.status}\n${JSON.stringify(resultado.body, null, 2)}`} label="Copiar resposta" />
          <details className="text-xs text-gray-500">
            <summary>Dados enviados</summary>
            <CopyBlock text={JSON.stringify(resultado.payload, null, 2)} label="Copiar dados" />
          </details>
        </div>
      )}
    </div>
  );
}
