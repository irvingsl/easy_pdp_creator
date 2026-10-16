import { createClient } from "@/lib/supabase/server";
import { getAccessToken, getAccount } from "@/marketplaces/mercadolivre/accounts";
import { mlGet } from "@/marketplaces/mercadolivre/oauth";
import { btnPrimary, btnSecondary, inputBase } from "@/components/ui";

type Resp = Awaited<ReturnType<typeof mlGet>>;
type Attr = { id: string; value_name?: string };
type Prod = {
  id: string; name: string; status: string; domain_id: string; category_id: string;
  attributes?: Attr[]; pictures?: unknown[];
};
type Listing = { id: string; title: string; price: number; currency_id?: string; permalink?: string; catalog_product_id?: string | null };

const attr = (p: Prod, id: string) => p.attributes?.find((a) => a.id === id)?.value_name ?? "";
const raw = (b: unknown, n = 3000) => JSON.stringify(b, null, 2)?.slice(0, n);

function Status({ label, r }: { label: string; r: Resp }) {
  return <p className="text-sm text-gray-500">{label} → <strong>HTTP {r.status}</strong></p>;
}
function Raw({ body }: { body: unknown }) {
  return <pre className="max-h-64 overflow-auto rounded-lg bg-gray-100 p-3 text-xs dark:bg-gray-900">{raw(body)}</pre>;
}

export default async function ContaPage(props: PageProps<"/conta">) {
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const erro = typeof sp.erro === "string" ? sp.erro : "";

  const supabase = await createClient();
  const conta = await getAccount(supabase);

  let me: Resp | null = null;
  let produtos: Resp | null = null;
  let anuncios: Resp | null = null;
  let itensDoProduto: { id: string; r: Resp } | null = null;
  if (conta) {
    const token = await getAccessToken(supabase);
    if (token) {
      me = await mlGet("/users/me", token);
      if (q) {
        const enc = encodeURIComponent(q);
        [produtos, anuncios] = await Promise.all([
          mlGet(`/products/search?status=active&site_id=MLB&q=${enc}&limit=10`, token),
          mlGet(`/sites/MLB/search?q=${enc}&limit=10`, token),
        ]);
        const lista = (produtos.body as { results?: Prod[] } | null)?.results ?? [];
        const primeiro = lista.find((p) => p.status === "active") ?? lista[0];
        if (primeiro) itensDoProduto = { id: primeiro.id, r: await mlGet(`/products/${primeiro.id}/items`, token) };
      }
    }
  }

  const prods = (produtos?.body as { results?: Prod[] } | null)?.results ?? [];
  const lst = (anuncios?.body as { results?: Listing[] } | null)?.results ?? [];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Conta Mercado Livre</h1>
      {erro && <p className="break-words text-sm text-red-600">Erro: {erro}</p>}

      {conta ? (
        <p>
          Conectado{me?.ok ? <> como <strong>{(me.body as { nickname?: string })?.nickname}</strong></> : ""} (ID {conta.external_user_id}).{" "}
          <a href="/api/mercadolivre/connect" className="underline">Reconectar</a>
        </p>
      ) : (
        <a href="/api/mercadolivre/connect" className={`${btnPrimary} self-start`}>Conectar Mercado Livre</a>
      )}

      {conta && (
        <section className="flex flex-col gap-4">
          <h2 className="font-medium">Teste da API (spike)</h2>
          <form className="flex gap-2">
            <input name="q" defaultValue={q} placeholder="código OEM ou palavras-chave" className={inputBase} />
            <button className={btnSecondary}>Buscar</button>
          </form>

          {produtos && (
            <div className="flex flex-col gap-2">
              <h3 className="font-medium">1. Catálogo — /products/search</h3>
              <Status label="/products/search" r={produtos} />
              {prods.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead><tr className="text-gray-500"><th className="pr-2">Nome</th><th className="pr-2">Marca</th><th className="pr-2">Nº peça</th><th className="pr-2">Categoria</th><th className="pr-2">Status</th><th>Fotos</th></tr></thead>
                    <tbody>
                      {prods.map((p) => (
                        <tr key={p.id} className="border-t border-gray-200 align-top dark:border-gray-800">
                          <td className="py-1 pr-2">{p.name}<div className="font-mono text-gray-500">{p.id}</div></td>
                          <td className="pr-2">{attr(p, "BRAND")}</td>
                          <td className="pr-2">{attr(p, "PART_NUMBER")}</td>
                          <td className="pr-2">{p.domain_id}<div className="font-mono text-gray-500">{p.category_id}</div></td>
                          <td className="pr-2">{p.status}</td>
                          <td>{p.pictures?.length ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <Raw body={produtos.body} />}
            </div>
          )}

          {anuncios && (
            <div className="flex flex-col gap-2">
              <h3 className="font-medium">2. Anúncios (títulos e preços) — /sites/MLB/search</h3>
              <Status label="/sites/MLB/search" r={anuncios} />
              {lst.length ? (
                <ul className="flex flex-col gap-1 text-sm">
                  {lst.map((l) => (
                    <li key={l.id} className="flex justify-between gap-3 border-t border-gray-200 py-1 dark:border-gray-800">
                      <span>{l.title}{l.catalog_product_id ? <span className="ml-1 font-mono text-xs text-gray-500">{l.catalog_product_id}</span> : null}</span>
                      <span className="whitespace-nowrap font-medium">R$ {l.price}</span>
                    </li>
                  ))}
                </ul>
              ) : <Raw body={anuncios.body} />}
            </div>
          )}

          {itensDoProduto && (
            <div className="flex flex-col gap-2">
              <h3 className="font-medium">3. Anúncios de um produto de catálogo — /products/{itensDoProduto.id}/items</h3>
              <Status label={`/products/${itensDoProduto.id}/items`} r={itensDoProduto.r} />
              <Raw body={itensDoProduto.r.body} />
            </div>
          )}
        </section>
      )}
    </div>
  );
}
