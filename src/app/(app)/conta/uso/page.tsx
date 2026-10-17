import { createClient } from "@/lib/supabase/server";

type Linha = { dia: string; modelo: string; grounded: boolean; chamadas: number; entrada: number; saida: number; buscas: number };

export default async function UsoPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("uso_ia")
    .select("modelo, grounded, tokens_entrada, tokens_saida, buscas, criado_em")
    .order("criado_em", { ascending: false })
    .limit(5000);

  // dia no fuso do Brasil
  const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const mapa = new Map<string, Linha>();
  for (const u of data ?? []) {
    const k = `${dia(u.criado_em)}|${u.modelo}|${u.grounded}`;
    const l = mapa.get(k) ?? { dia: dia(u.criado_em), modelo: u.modelo ?? "?", grounded: u.grounded, chamadas: 0, entrada: 0, saida: 0, buscas: 0 };
    l.chamadas += 1;
    l.entrada += u.tokens_entrada ?? 0;
    l.saida += u.tokens_saida ?? 0;
    l.buscas += u.buscas;
    mapa.set(k, l);
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Uso da IA (últimos registros)</h1>
      <p className="text-sm text-gray-500">
        Consumo registrado pelo app a cada chamada ao Gemini. Para converter em reais, multiplique pelos preços da sua conta
        (tokens de entrada e saída por modelo, e as buscas com Google Search). O valor cobrado de verdade fica no faturamento do Google.
      </p>
      {mapa.size === 0 ? (
        <p className="text-sm text-gray-500">Ainda sem registros: eles começam a partir da última atualização do app.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-gray-500">
              <tr><th className="p-2">Dia</th><th className="p-2">Modelo</th><th className="p-2">Com busca</th><th className="p-2">Chamadas</th><th className="p-2">Tokens entrada</th><th className="p-2">Tokens saída</th><th className="p-2">Buscas Google</th></tr>
            </thead>
            <tbody>
              {[...mapa.values()].map((l) => (
                <tr key={`${l.dia}${l.modelo}${l.grounded}`} className="border-t border-gray-200 dark:border-gray-800">
                  <td className="p-2">{l.dia}</td><td className="p-2 font-mono text-xs">{l.modelo}</td><td className="p-2">{l.grounded ? "sim" : "não"}</td>
                  <td className="p-2">{l.chamadas}</td><td className="p-2">{l.entrada.toLocaleString("pt-BR")}</td><td className="p-2">{l.saida.toLocaleString("pt-BR")}</td><td className="p-2">{l.buscas}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
