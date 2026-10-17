"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { PartAnalysis } from "@/lib/gemini";
import type { CatalogHit } from "@/marketplaces/mercadolivre/catalog";
import { CopyBlock } from "./copy-block";
import { btnPrimary } from "./ui";

export type Identificacao = {
  analysis: PartAnalysis;
  narrativa?: string;
  sources: { title: string; uri: string }[];
  catalog: CatalogHit[];
  certeza: { level: "alta" | "média" | "baixa"; reasons: string[] };
  model: string;
  buscaWeb?: boolean;
  tentativas?: { model: string; grounded: boolean; status: number }[];
  geradoEm: string;
};

const BADGE = {
  alta: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  média: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  baixa: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
} as const;

const CLASSE: Record<string, string> = {
  numero_de_peca: "número de peça",
  equivalente: "equivalente",
  processo: "código de processo",
  desconhecido: "desconhecido",
};
const ORIGEM: Record<string, string> = {
  contado_na_foto: "contado na foto",
  estimado_na_foto: "estimado na foto",
  fonte_web: "fonte na web",
};

const money = (n: number | null) => (n == null ? "?" : `R$ ${n.toLocaleString("pt-BR")}`);

export function IdentificarIA({ produtoId, inicial }: { produtoId: string; inicial: Identificacao | null }) {
  const router = useRouter();
  const [res, setRes] = useState<Identificacao | null>(inicial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function identificar() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/identificar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ produtoId }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setRes(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro inesperado");
    } finally {
      setBusy(false);
    }
  }

  async function usarComoOem(code: string) {
    await createClient().from("produtos").update({ oem_code: code }).eq("id", produtoId);
    router.refresh();
  }

  const a = res?.analysis;
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Identificação com IA</h2>
        <button onClick={identificar} disabled={busy} className={btnPrimary}>
          {busy ? "Analisando (pode levar até 1 min)..." : res ? "Identificar de novo" : "Identificar com IA"}
        </button>
      </div>
      <p className="text-xs text-gray-500">As fotos originais (até 4) são enviadas ao Google (Gemini), que também pesquisa na web. No plano gratuito cada identificação usa 1 das 20 consultas diárias (5 por minuto).</p>
      {error && <p className="break-words text-sm text-red-600">{error}</p>}

      {res && a && !("tipo_item" in a) && (
        <p className="text-sm text-gray-500">Este resultado foi gerado por uma versão antiga. Clique em &ldquo;Identificar de novo&rdquo;.</p>
      )}

      {res && a && "tipo_item" in a && (
        <div className="flex flex-col gap-4 text-sm">
          {res.buscaWeb === false && (
            <p className="rounded-lg bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              A busca na web ficou indisponível (cota do Gemini). Esta resposta veio só das fotos, sem fontes. Trate tudo como suposição até confirmar.
            </p>
          )}
          <div className="flex flex-col gap-1">
            <span className={`self-start rounded-full px-3 py-1 text-xs font-medium ${BADGE[res.certeza.level]}`}>
              Certeza {res.certeza.level}
            </span>
            <ul className="list-disc pl-5 text-gray-600 dark:text-gray-400">
              {res.certeza.reasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
            <span className="text-xs text-gray-500">Estimativa baseada em evidências, não uma garantia. Confirme com o item na mão.</span>
          </div>

          <div>
            <div className="text-base font-medium">
              {a.tipo_item ?? "Item não identificado"}
              {a.marca?.valor ? ` · ${a.marca.valor}` : ""}
              {a.formato_de_venda && a.formato_de_venda !== "indefinido" ? ` · ${a.formato_de_venda}` : ""}
            </div>
            {a.marca?.valor && (
              <div className="text-xs text-gray-500">Marca: origem {a.marca.origem}, confiança {a.marca.confianca}</div>
            )}
            {a.componentes_visiveis?.length > 0 && (
              <div className="text-gray-500">Componentes: {a.componentes_visiveis.join(", ")}</div>
            )}
            {a.numero_peca_principal && (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span>Número de peça: <strong className="font-mono">{a.numero_peca_principal}</strong></span>
                <button onClick={() => usarComoOem(a.numero_peca_principal!)} className="rounded-md border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                  Usar como código OEM
                </button>
              </div>
            )}
          </div>

          {res.narrativa && (
            <details open>
              <summary className="cursor-pointer font-medium">Raciocínio da IA</summary>
              <p className="mt-1 whitespace-pre-wrap text-gray-700 dark:text-gray-300">{res.narrativa}</p>
            </details>
          )}

          {a.textos_gravados?.length > 0 && (
            <div>
              <h3 className="font-medium">Lido no item</h3>
              <ul className="list-disc pl-5">
                {a.textos_gravados.map((t, i) => (
                  <li key={i}>
                    <span className="font-mono">{t.texto}</span>{" "}
                    <span className="text-gray-500">(foto {t.foto ?? "?"}, leitura {t.legibilidade})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {a.codigos?.length > 0 && (
            <div>
              <h3 className="font-medium">Códigos</h3>
              <ul className="list-disc pl-5">
                {a.codigos.map((c, i) => (
                  <li key={i}>
                    <span className="font-mono">{c.codigo}</span> · {CLASSE[c.classe] ?? c.classe}
                    {c.marca ? ` · ${c.marca}` : ""} · confiança {c.confianca}
                    {c.fonte_url && <> · <a href={c.fonte_url} target="_blank" rel="noreferrer" className="underline">fonte</a></>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {a.caracteristicas?.length > 0 && (
            <div>
              <h3 className="font-medium">Características</h3>
              <ul className="list-disc pl-5">
                {a.caracteristicas.map((c, i) => (
                  <li key={i}>
                    {c.nome}: <strong>{c.valor}{c.unidade ? ` ${c.unidade}` : ""}</strong>{" "}
                    <span className="text-gray-500">({ORIGEM[c.origem] ?? c.origem}{c.como ? `: ${c.como}` : ""}; confiança {c.confianca})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {a.aplicacoes?.length > 0 && (
            <div>
              <h3 className="font-medium">Aplicações</h3>
              <ul className="list-disc pl-5">
                {a.aplicacoes.map((p, i) => (
                  <li key={i}>
                    {p.descricao}{p.anos ? ` · ${p.anos}` : ""}{" "}
                    <span className={p.origem === "fonte_web" ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400"}>
                      ({p.origem === "fonte_web" ? "confirmado por fonte" : "suposição"})
                    </span>
                    {p.fonte_url && <> · <a href={p.fonte_url} target="_blank" rel="noreferrer" className="underline">fonte</a></>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {res.catalog.length > 0 && (
            <div>
              <h3 className="font-medium">Conferência no catálogo do Mercado Livre</h3>
              <ul className="flex flex-col gap-1">
                {res.catalog.map((c) => (
                  <li key={c.code}>
                    <span className="font-mono">{c.code}</span>{" "}
                    {c.ignorado
                      ? <span className="text-gray-500">→ {c.ignorado}</span>
                      : c.exact
                      ? <>→ <strong>reconhecido</strong>: {c.products.map((p) => `${p.name} (${p.brand}${p.diameter ? `, ${p.diameter}` : ""}, ${p.status})`).join("; ")}</>
                      : <span className="text-gray-500">→ não reconhecido como número de peça</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(a.preco?.minimo != null || a.preco?.maximo != null) && (
            <p>
              <span className="font-medium">Preço estimado{a.preco.formato_de_referencia ? ` (${a.preco.formato_de_referencia})` : ""}: </span>
              {money(a.preco.minimo)} a {money(a.preco.maximo)}
              {a.preco.condicao ? ` · ${a.preco.condicao}` : ""}
              {a.preco.observacao ? <span className="text-gray-500"> — {a.preco.observacao}</span> : null}
              {a.preco.fontes?.length > 0 && <span className="text-gray-500"> · fontes: {a.preco.fontes.join(", ")}</span>}
            </p>
          )}

          {a.fotos_sugeridas?.length > 0 && (
            <div>
              <h3 className="font-medium">Fotos que ajudariam</h3>
              <ul className="list-disc pl-5 text-gray-600 dark:text-gray-400">{a.fotos_sugeridas.map((f) => <li key={f}>{f}</li>)}</ul>
            </div>
          )}
          {a.termos_busca?.length > 0 && <p className="text-gray-500">Termos de busca: {a.termos_busca.join(" · ")}</p>}
          {a.categoria_sugerida_texto && <p className="text-gray-500">Categoria sugerida: {a.categoria_sugerida_texto}</p>}
          {a.duvidas?.length > 0 && (
            <div>
              <h3 className="font-medium">Dúvidas da IA</h3>
              <ul className="list-disc pl-5 text-gray-600 dark:text-gray-400">{a.duvidas.map((d) => <li key={d}>{d}</li>)}</ul>
            </div>
          )}

          {res.sources.length > 0 && (
            <div>
              <h3 className="font-medium">Fontes consultadas</h3>
              <ul className="list-disc pl-5">
                {res.sources.map((s) => (
                  <li key={s.uri}><a href={s.uri} target="_blank" rel="noreferrer" className="underline">{s.title}</a></li>
                ))}
              </ul>
            </div>
          )}

          <details className="text-xs text-gray-500">
            <summary>Dados brutos ({res.model})</summary>
            <CopyBlock text={JSON.stringify(res, null, 2)} label="Copiar JSON" />
          </details>
        </div>
      )}
    </section>
  );
}
