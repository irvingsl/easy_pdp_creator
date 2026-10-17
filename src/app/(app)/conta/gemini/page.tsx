import { listAllModels, probeGrounding } from "@/lib/gemini";
import { CopyBlock } from "@/components/copy-block";
import { btnSecondary } from "@/components/ui";

export default async function GeminiTestPage(props: PageProps<"/conta/gemini">) {
  const sp = await props.searchParams;
  const testar = sp.testar === "1";
  const key = process.env.GEMINI_API_KEY;

  let modelos: string[] = [];
  let resultados: Awaited<ReturnType<typeof probeGrounding>>[] = [];
  if (key) {
    modelos = await listAllModels(key);
    if (testar) resultados = await Promise.all(modelos.slice(0, 20).map((m) => probeGrounding(m)));
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Gemini: quais modelos têm busca na web?</h1>
      {!key && <p className="text-red-600">GEMINI_API_KEY não está definida.</p>}
      <p className="text-sm text-gray-500">
        {modelos.length} modelo(s) visíveis para a sua chave. O teste faz 1 pergunta curta por modelo e gasta 1 da cota diária de cada um.
      </p>
      <a href="?testar=1" className={`${btnSecondary} self-start`}>Testar busca na web em cada modelo</a>

      {!testar && modelos.length > 0 && <CopyBlock text={modelos.join("\n")} label="Copiar lista" />}

      {resultados.length > 0 && (
        <>
          <table className="w-full text-left text-xs">
            <thead><tr className="text-gray-500"><th>Modelo</th><th>HTTP</th><th>Busca na web</th><th>Fontes</th><th>Erro / resposta</th></tr></thead>
            <tbody>
              {resultados.map((r) => (
                <tr key={r.model} className="border-t border-gray-200 align-top dark:border-gray-800">
                  <td className="py-1 pr-2 font-mono">{r.model}</td>
                  <td className="pr-2">{r.status}</td>
                  <td className="pr-2">{r.status === 200 ? (r.comBusca ? "SIM" : "não usou") : "—"}</td>
                  <td className="pr-2">{r.fontes}</td>
                  <td>{r.erro || r.resposta}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <CopyBlock text={JSON.stringify(resultados, null, 2)} label="Copiar resultado" />
        </>
      )}
    </div>
  );
}
