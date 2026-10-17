import { createClient } from "@/lib/supabase/server";
import { getAccessToken, getAccount } from "@/marketplaces/mercadolivre/accounts";
import { mlGet } from "@/marketplaces/mercadolivre/oauth";
import { btnPrimary, btnSecondary, inputBase } from "@/components/ui";
import { CopyBlock } from "@/components/copy-block";

type Resp = Awaited<ReturnType<typeof mlGet>>;
type Attr = { id: string; value_name?: string };
type Prod = { id: string; name: string; status: string; domain_id: string; category_id: string; attributes?: Attr[] };
type Domain = { domain_id: string; domain_name: string; category_id: string; category_name: string };
type CatAttr = { id: string; name: string; value_type?: string; tags?: Record<string, boolean> };

const attr = (p: Prod, id: string) => p.attributes?.find((a) => a.id === id)?.value_name ?? "";
const raw = (b: unknown, n = 20000) => JSON.stringify(b, null, 2)?.slice(0, n) ?? "";

/** Variações comuns de escrita de cada número de peça que aparecer na busca. */
function variants(q: string): string[] {
  const set = new Set<string>();
  const tokens = q.split(/\s+/).filter((t) => t.replace(/\D/g, "").length >= 6);
  if (!tokens.length) return [q];
  for (const t of tokens) {
    const d = t.replace(/[^0-9a-z]/gi, "");
    set.add(d);
    if (/^\d{9}$/.test(d)) {
      set.add(`${d.slice(0, 3)} ${d.slice(3, 7)} ${d.slice(7)}`);
      set.add(`${d}0`);
    }
    if (/^\d{10}$/.test(d)) set.add(`${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`);
  }
  return [...set];
}

function Status({ label, r }: { label: string; r: Resp }) {
  return <p className="text-sm text-gray-500">{label} → <strong>HTTP {r.status}</strong></p>;
}
function Raw({ body }: { body: unknown }) {
  return <CopyBlock text={raw(body)} />;
}

export default async function ContaPage(props: PageProps<"/conta">) {
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const item = typeof sp.item === "string" ? sp.item.trim() : "";
  const erro = typeof sp.erro === "string" ? sp.erro : "";

  const supabase = await createClient();
  const conta = await getAccount(supabase);

  let me: Resp | null = null;
  let porVariante: { v: string; r: Resp }[] = [];
  let dominios: Resp | null = null;
  let catalogo: { cat: string; r: Resp } | null = null;
  let caminhos: Record<string, string> = {};
  let anuncio: Resp | null = null;

  if (conta) {
    const token = await getAccessToken(supabase);
    if (token) {
      me = await mlGet("/users/me", token);
      if (q) {
        porVariante = await Promise.all(
          variants(q).map(async (v) => ({
            v,
            r: await mlGet(`/products/search?status=active&site_id=MLB&q=${encodeURIComponent(v)}&limit=10`, token),
          })),
        );
        dominios = await mlGet(`/sites/MLB/domain_discovery/search?limit=5&q=${encodeURIComponent(q)}`, token);
        const lista = Array.isArray(dominios.body) ? (dominios.body as Domain[]) : [];
        const detalhes = await Promise.all(lista.map((d) => mlGet(`/categories/${d.category_id}`, token)));
        caminhos = Object.fromEntries(
          lista.map((d, i) => [
            d.category_id,
            ((detalhes[i].body as { path_from_root?: { name: string }[] } | null)?.path_from_root ?? []).map((c) => c.name).join(" › "),
          ]),
        );
        const top = (dominios.body as Domain[] | null)?.[0];
        if (top) catalogo = { cat: top.category_id, r: await mlGet(`/categories/${top.category_id}/attributes`, token) };
      }
      if (item) anuncio = await mlGet(`/items/${encodeURIComponent(item)}`, token);
    }
  }

  const doms = Array.isArray(dominios?.body) ? (dominios!.body as Domain[]) : [];
  const catAttrs = Array.isArray(catalogo?.r.body) ? (catalogo!.r.body as CatAttr[]) : [];
  const it = anuncio?.ok ? (anuncio.body as { title?: string; price?: number; status?: string; category_id?: string; catalog_product_id?: string | null }) : null;

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
        <section className="flex flex-col gap-5">
          <h2 className="font-medium">Teste da API (spike)</h2>
          <a href="/conta/validar" className="text-sm underline">Validar um anúncio de teste (sem publicar) →</a>
          <a href="/conta/gemini" className="text-sm underline">Gemini: testar busca na web por modelo →</a>
          <form className="flex flex-col gap-2">
            <div className="flex gap-2">
              <input name="q" defaultValue={q} placeholder="código OEM ou palavras-chave" className={inputBase} />
              <button className={btnSecondary}>Buscar</button>
            </div>
            <input name="item" defaultValue={item} placeholder="(opcional) ID de anúncio, ex.: MLB1234567890" className={inputBase} />
          </form>

          {porVariante.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="font-medium">1. Catálogo, com variações do código</h3>
              <table className="w-full text-left text-sm">
                <thead><tr className="text-gray-500"><th>Busca</th><th>HTTP</th><th>Tipo</th><th>Total</th><th>Primeiros</th></tr></thead>
                <tbody>
                  {porVariante.map(({ v, r }) => {
                    const b = r.body as { query_type?: string; paging?: { total?: number }; results?: Prod[] } | null;
                    return (
                      <tr key={v} className="border-t border-gray-200 align-top dark:border-gray-800">
                        <td className="py-1 pr-2 font-mono">{v}</td>
                        <td className="pr-2">{r.status}</td>
                        <td className="pr-2">{b?.query_type}</td>
                        <td className="pr-2">{b?.paging?.total}</td>
                        <td className="text-xs">
                          {b?.results?.slice(0, 3).map((p) => (
                            <div key={p.id}>{p.name} · {attr(p, "BRAND")} · {attr(p, "PART_NUMBER")} · {p.status}</div>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {dominios && (
            <div className="flex flex-col gap-2">
              <h3 className="font-medium">2. Categoria sugerida pelo ML — /domain_discovery</h3>
              <Status label="domain_discovery" r={dominios} />
              {doms.length ? (
                <ul className="text-sm">
                  {doms.map((d) => (
                    <li key={d.category_id} className="border-t border-gray-200 py-1 dark:border-gray-800">
                      {d.category_name} <span className="font-mono text-xs text-gray-500">{d.category_id} · {d.domain_id}</span>
                      {caminhos[d.category_id] && <div className="text-xs text-gray-500">{caminhos[d.category_id]}</div>}
                    </li>
                  ))}
                </ul>
              ) : <Raw body={dominios.body} />}
            </div>
          )}

          {catalogo && (
            <div className="flex flex-col gap-2">
              <h3 className="font-medium">3. Atributos da categoria {catalogo.cat}</h3>
              <Status label="categories/attributes" r={catalogo.r} />
              {catAttrs.length ? (
                <table className="w-full text-left text-xs">
                  <thead><tr className="text-gray-500"><th>Atributo</th><th>ID</th><th>Obrigatório</th><th>Tipo</th></tr></thead>
                  <tbody>
                    {catAttrs.map((a) => (
                      <tr key={a.id} className="border-t border-gray-200 dark:border-gray-800">
                        <td className="py-1 pr-2">{a.name}</td>
                        <td className="pr-2 font-mono">{a.id}</td>
                        <td className="pr-2">{a.tags?.required || a.tags?.catalog_required ? "sim" : ""}</td>
                        <td>{a.value_type}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <Raw body={catalogo.r.body} />}
            </div>
          )}

          {anuncio && (
            <div className="flex flex-col gap-2">
              <h3 className="font-medium">4. Anúncio por ID — /items/{item}</h3>
              <Status label="items" r={anuncio} />
              {it ? (
                <p className="text-sm">{it.title} · <strong>R$ {it.price}</strong> · {it.status} · categoria {it.category_id}{it.catalog_product_id ? ` · catálogo ${it.catalog_product_id}` : ""}</p>
              ) : <Raw body={anuncio.body} />}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
