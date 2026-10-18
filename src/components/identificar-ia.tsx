"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { PartAnalysis } from "@/lib/gemini";
import type { CatalogHit } from "@/marketplaces/mercadolivre/catalog";
import { CopyBlock } from "./copy-block";
import type { VisaoResult } from "@/lib/vision";
import { btnPrimary } from "./ui";

export type Identificacao = {
  analysis: PartAnalysis;
  narrativa?: string;
  sources: { title: string; uri: string }[];
  catalog: CatalogHit[];
  certeza: { level: "alta" | "média" | "baixa"; reasons: string[] };
  model: string;
  buscaWeb?: boolean;
  consultas?: string[];
  visao?: VisaoResult | null;
  cego?: boolean;
  perguntaPesquisa?: string;
  erroPesquisa?: string;
  emAndamento?: boolean;
  etapas?: string[];
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
  confirmado_pelo_vendedor: "confirmado por você",
};

const money = (n: number | null) => (n == null ? "?" : `R$ ${n.toLocaleString("pt-BR")}`);

export function IdentificarIA({ produtoId, inicial, autoStart = false }: { produtoId: string; inicial: Identificacao | null; autoStart?: boolean }) {
  const router = useRouter();
  const [res, setRes] = useState<Identificacao | null>(inicial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cego, setCego] = useState(false);
  const [fase, setFase] = useState("");

  /** Chama uma etapa; a resposta pode não ser JSON (ex.: página de erro da Vercel por tempo esgotado). */
  async function etapa(nome: string, body: object) {
    const r = await fetch("/api/identificar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const txt = await r.text();
    let data: { error?: string } & Record<string, unknown>;
    try {
      data = JSON.parse(txt);
    } catch {
      const timeout = r.status === 504 || /timeout|FUNCTION_INVOCATION|An error o/i.test(txt);
      throw new Error(
        timeout
          ? `Tempo esgotado na etapa "${nome}" (HTTP ${r.status}). Tente de novo; se repetir, me avise.`
          : `Resposta inesperada na etapa "${nome}" (HTTP ${r.status}): ${txt.slice(0, 160)}`,
      );
    }
    if (!r.ok) throw new Error(`Etapa "${nome}": ${data.error ?? `HTTP ${r.status}`}`);
    return data;
  }

  async function identificar() {
    setBusy(true);
    setError("");
    try {
      setFase("1/4 Lendo as fotos...");
      let parcial = await etapa("fotos", { produtoId, cego, etapa: "fotos" });
      // mostra já o que as fotos revelaram, enquanto a pesquisa segue
      setRes({ ...(parcial as object), catalog: [], certeza: { level: "baixa", reasons: ["Em andamento: pesquisa na web e catálogo ainda por vir"] }, emAndamento: true } as unknown as Identificacao);
      setFase("2/4 Pesquisando na web...");
      parcial = await etapa("pesquisa", { produtoId, cego, etapa: "pesquisa", parcial });
      if (parcial.pesquisou) {
        setFase("3/4 Organizando os resultados...");
        parcial = await etapa("organizar", { produtoId, cego, etapa: "organizar", parcial });
      }
      setFase("4/4 Conferindo no catálogo do Mercado Livre...");
      const final = await etapa("final", { produtoId, cego, etapa: "final", parcial });
      setRes(final as unknown as Identificacao);
      window.dispatchEvent(new CustomEvent("identificacao-concluida", { detail: { produtoId } }));
    } catch (e) {
      window.dispatchEvent(new CustomEvent("identificacao-falhou", { detail: { produtoId } }));
      setError(e instanceof Error ? e.message : "Erro inesperado");
      // se uma etapa falhar, o resultado parcial deixa de dizer "em andamento"
      setRes((r) => (r ? { ...r, emAndamento: false } : r));
    } finally {
      setBusy(false);
      setFase("");
    }
  }

  async function confirmarCaracteristica(c: { nome: string; valor: string; unidade: string | null }) {
    const supabase = createClient();
    const { data } = await supabase.from("produtos").select("dados_confirmados").eq("id", produtoId).single();
    const atual = (data?.dados_confirmados ?? {}) as { caracteristicas?: { nome: string; valor: string; unidade?: string }[] };
    const outras = (atual.caracteristicas ?? []).filter((x) => x.nome.toLowerCase() !== c.nome.toLowerCase());
    await supabase
      .from("produtos")
      .update({ dados_confirmados: { ...atual, caracteristicas: [...outras, { nome: c.nome, valor: c.valor, unidade: c.unidade ?? undefined }] } })
      .eq("id", produtoId);
    router.refresh();
  }

  async function usarComoOem(code: string) {
    await createClient().from("produtos").update({ oem_code: code }).eq("id", produtoId);
    router.refresh();
  }

  // Logo após criar o produto, a identificação começa sozinha (usa as fotos originais, enquanto o fundo é removido no navegador)
  const iniciou = useRef(false);
  useEffect(() => {
    if (autoStart && !inicial && !iniciou.current) {
      iniciou.current = true;
      identificar();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const a = res?.analysis;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button onClick={identificar} disabled={busy} className={btnPrimary}>
          {busy ? fase || "Analisando..." : res ? "Identificar de novo" : "Identificar com IA"}
        </button>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={cego} onChange={(e) => setCego(e.target.checked)} />
        Teste às cegas: ignorar os dados confirmados nesta identificação
      </label>
      <p className="text-xs text-gray-500">As fotos originais (até 4) são enviadas ao Google (Gemini), que também pesquisa na web.</p>
      {error && <p className="break-words text-sm text-red-600">{error}</p>}

      {res && a && !("tipo_item" in a) && (
        <p className="text-sm text-gray-500">Este resultado foi gerado por uma versão antiga. Clique em &ldquo;Identificar de novo&rdquo;.</p>
      )}

      {res && a && "tipo_item" in a && (
        <div className="flex flex-col gap-4 text-sm">
          {res.emAndamento && (
            <p className="rounded-lg bg-blue-50 p-3 text-blue-900 dark:bg-blue-950 dark:text-blue-200">
              Resultado parcial (só das fotos). A pesquisa na web e a conferência no catálogo ainda estão rodando.
            </p>
          )}
          {!res.emAndamento && res.buscaWeb === false && (
            <p className="rounded-lg bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              Nenhuma pesquisa na web foi feita nesta resposta (cota indisponível ou a IA decidiu não pesquisar). Ela veio só das fotos, sem fontes: trate preço e aplicações como suposição.
              {res.erroPesquisa && <span className="mt-1 block break-words text-xs">Motivo: {res.erroPesquisa}</span>}
              {res.tentativas && res.tentativas.length > 0 && (
                <span className="mt-1 block font-mono text-xs">Tentativas: {res.tentativas.map((t) => `${t.model}${t.grounded ? "+web" : ""}=${t.status}`).join(", ")}</span>
              )}
            </p>
          )}
          {res.buscaWeb && res.consultas && res.consultas.length > 0 && (
            <p className="text-xs text-gray-500">Pesquisas feitas: {res.consultas.join(" · ")}</p>
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

          {res.cego && <p className="text-xs text-gray-500">Identificação feita às cegas (sem os dados confirmados).</p>}

          {res.visao && (
            <details>
              <summary className="cursor-pointer font-medium">
                Busca por imagem do Google ({res.visao.erro ? "erro" : `${res.visao.paginas.length} páginas`})
              </summary>
              {res.visao.erro && <p className="mt-1 break-words text-red-600">{res.visao.erro}</p>}
              {res.visao.palpites.length > 0 && <p className="mt-1">Melhor palpite: {res.visao.palpites.join("; ")}</p>}
              {res.visao.entidades.length > 0 && <p className="text-gray-500">Entidades: {res.visao.entidades.map((e) => e.descricao).join(" · ")}</p>}
              <ul className="mt-1 list-disc pl-5">
                {res.visao.paginas.map((p) => (
                  <li key={p.url}>
                    <a href={p.url} target="_blank" rel="noreferrer" className="underline">{p.titulo || p.url}</a>
                    {p.fotos > 1 ? <span className="text-gray-500"> (casou com {p.fotos} fotos)</span> : null}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {res.perguntaPesquisa && (
            <details>
              <summary className="cursor-pointer font-medium">Pergunta enviada à pesquisa</summary>
              <p className="mt-1 whitespace-pre-wrap text-gray-700 dark:text-gray-300">{res.perguntaPesquisa}</p>
            </details>
          )}

          {res.narrativa && (
            <details open>
              <summary className="cursor-pointer font-medium">Raciocínio da IA</summary>
              <p className="mt-1 whitespace-pre-wrap text-gray-700 dark:text-gray-300">{res.narrativa}</p>
            </details>
          )}

          {a.candidatos && a.candidatos.length > 0 && (
            <div>
              <h3 className="font-medium">Candidatos a número de peça</h3>
              <p className="text-xs text-gray-500">Inferidos pela pesquisa; mais de um modelo pode ter as mesmas medidas. Confirme com o item na mão.</p>
              <ul className="mt-2 flex flex-col gap-3">
                {a.candidatos.map((c) => {
                  const noCatalogo = res.catalog.find((k) => k.relevante && k.code.replace(/[^0-9a-z]/gi, "").toLowerCase() === c.numero_de_peca.replace(/[^0-9a-z]/gi, "").toLowerCase());
                  return (
                    <li key={c.numero_de_peca} className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-medium">{c.numero_de_peca}</span>
                        {c.marca && <span className="text-gray-500">· {c.marca}</span>}
                        {noCatalogo && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800 dark:bg-blue-950 dark:text-blue-300">existe no catálogo do ML</span>}
                        <button onClick={() => usarComoOem(c.numero_de_peca)} className="ml-auto rounded-md border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                          É este
                        </button>
                      </div>
                      <p className="text-gray-700 dark:text-gray-300">{c.descricao}</p>
                      {c.aplicacoes?.length > 0 && <p className="text-gray-500">Aplicações: {c.aplicacoes.join("; ")}</p>}
                      {c.combina?.length > 0 && <p className="text-green-700 dark:text-green-400">Combina: {c.combina.join("; ")}</p>}
                      {c.nao_confirmado?.length > 0 && <p className="text-amber-700 dark:text-amber-400">Não confirmado: {c.nao_confirmado.join("; ")}</p>}
                      {c.como_confirmar && <p className="text-gray-600 dark:text-gray-400">Para confirmar: {c.como_confirmar}</p>}
                    </li>
                  );
                })}
              </ul>
            </div>
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
                    <span className="text-gray-500">({ORIGEM[c.origem] ?? c.origem}{c.como ? `: ${c.como}` : ""}; confiança {c.confianca})</span>{" "}
                    <button onClick={() => confirmarCaracteristica(c)} className="rounded-md border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                      Confirmar/editar
                    </button>
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
    </div>
  );
}
