import { createClient } from "@/lib/supabase/server";
import { getAccessToken, getAccount } from "@/marketplaces/mercadolivre/accounts";
import { mlGet } from "@/marketplaces/mercadolivre/oauth";
import { btnPrimary, btnSecondary, inputBase } from "@/components/ui";

export default async function ContaPage(props: PageProps<"/conta">) {
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const erro = typeof sp.erro === "string" ? sp.erro : "";

  const supabase = await createClient();
  const conta = await getAccount(supabase);

  let me: Awaited<ReturnType<typeof mlGet>> | null = null;
  let busca: Awaited<ReturnType<typeof mlGet>> | null = null;
  if (conta) {
    const token = await getAccessToken(supabase);
    if (token) {
      me = await mlGet("/users/me", token);
      if (q) busca = await mlGet(`/products/search?status=active&site_id=MLB&q=${encodeURIComponent(q)}`, token);
    }
  }

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
        <section className="flex flex-col gap-3">
          <h2 className="font-medium">Teste do catálogo (spike)</h2>
          <form className="flex gap-2">
            <input name="q" defaultValue={q} placeholder="código OEM ou palavras-chave" className={inputBase} />
            <button className={btnSecondary}>Buscar</button>
          </form>
          {busca && (
            <>
              <p className="text-sm text-gray-500">/products/search → HTTP {busca.status}</p>
              <pre className="max-h-[60vh] overflow-auto rounded-lg bg-gray-100 p-3 text-xs dark:bg-gray-900">
                {JSON.stringify(busca.body, null, 2).slice(0, 8000)}
              </pre>
            </>
          )}
        </section>
      )}
    </div>
  );
}
