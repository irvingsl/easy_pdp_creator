"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { TITULO_MAX, type Rascunho } from "@/domain/rascunho";
import { CopyBlock } from "./copy-block";
import { btnPrimary, btnSecondary, inputBase } from "./ui";

const ORIGEM: Record<string, string> = {
  confirmado: "confirmado por você",
  lido_no_item: "lido no item",
  contado_na_foto: "contado na foto",
  web: "da web, sem confirmação",
  sugerido_web: "sugestão da web, confirme",
};

export function RascunhoAnuncio({ produtoId, inicial }: { produtoId: string; inicial: Rascunho | null }) {
  const router = useRouter();
  const [r, setR] = useState<Rascunho | null>(inicial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function gerar() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/rascunho", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ produtoId }) });
      const txt = await res.text();
      let j: { rascunho?: Rascunho; error?: string } = {};
      try {
        j = JSON.parse(txt);
      } catch {
        setMsg(res.status === 504 ? "A geração demorou demais, tente de novo." : `Resposta inesperada do servidor (${res.status}).`);
        return;
      }
      if (j.rascunho) setR(j.rascunho);
      else setMsg(j.error ?? "Falha ao gerar o rascunho");
    } finally {
      setBusy(false);
    }
  }

  async function salvar() {
    if (!r) return;
    setBusy(true);
    const { error } = await createClient().from("produtos").update({ rascunho: r, titulo_base: r.titulo, descricao_base: r.descricao }).eq("id", produtoId);
    setBusy(false);
    setMsg(error ? error.message : "Salvo ✓");
    if (!error) router.refresh();
  }

  const [ml, setMl] = useState<{ categorias?: { id: string; nome: string; caminho: string }[]; status?: number; resposta?: unknown; aceito?: boolean; erros?: string[]; avisos?: string[]; fotoPrincipalOk?: boolean; obrigatorios?: { id: string; nome: string; enviado: boolean }[]; payload?: unknown; error?: string } | null>(null);

  async function chamarML(sugerir: boolean) {
    if (!r) return;
    setBusy(true);
    setMl(null);
    try {
      // o servidor lê o rascunho salvo: salva antes de validar
      const { error } = await createClient().from("produtos").update({ rascunho: r, titulo_base: r.titulo, descricao_base: r.descricao }).eq("id", produtoId);
      if (error) return setMl({ error: error.message });
      const res = await fetch("/api/anuncios/validar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ produtoId, sugerir }) });
      const txt = await res.text();
      try {
        setMl(JSON.parse(txt));
      } catch {
        setMl({ error: res.status === 504 ? "O Mercado Livre demorou demais, tente de novo." : `Resposta inesperada (${res.status})` });
      }
    } finally {
      setBusy(false);
    }
  }

  type Calc = { preco?: number; comissao?: number | null; detalhes?: { percentage_fee?: number; fixed_fee?: number } | null; freteTabela?: number | null; brutos?: unknown; error?: string };
  const [calc, setCalc] = useState<Calc | null>(null);
  const [freteReal, setFreteReal] = useState("");

  async function calcular() {
    if (!r) return;
    setBusy(true);
    setCalc(null);
    try {
      const { error } = await createClient().from("produtos").update({ rascunho: r }).eq("id", produtoId);
      if (error) return setCalc({ error: error.message });
      const res = await fetch("/api/anuncios/calcular", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ produtoId }) });
      const txt = await res.text();
      try {
        setCalc(JSON.parse(txt));
      } catch {
        setCalc({ error: `Resposta inesperada (${res.status})` });
      }
    } finally {
      setBusy(false);
    }
  }

  const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const [pausado, setPausado] = useState(true);
  const [pub, setPub] = useState<{ ok?: boolean; id?: string; link?: string | null; status?: string; error?: string; resposta?: unknown; avisoDescricao?: unknown; respostaCriacao?: unknown; fotosEnviadas?: number; fotosNoML?: number | null } | null>(null);

  async function publicar() {
    if (!r) return;
    const quando = pausado ? "PAUSADO (não aparece para compradores até você ativar)" : "ATIVO (visível para compradores agora)";
    if (!window.confirm(`Publicar "${r.titulo}" por R$ ${r.preco ?? "?"} no Mercado Livre, ${quando}?`)) return;
    setBusy(true);
    setPub(null);
    try {
      const { error } = await createClient().from("produtos").update({ rascunho: r, titulo_base: r.titulo, descricao_base: r.descricao }).eq("id", produtoId);
      if (error) return setPub({ error: error.message });
      const res = await fetch("/api/anuncios/publicar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ produtoId, confirmar: true, pausado }) });
      const txt = await res.text();
      try {
        setPub(JSON.parse(txt));
      } catch {
        setPub({ error: res.status === 504 ? "Demorou demais: confira no Mercado Livre se o anúncio foi criado antes de tentar de novo." : `Resposta inesperada (${res.status})` });
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const set = <K extends keyof Rascunho>(k: K, v: Rascunho[K]) => setR((p) => (p ? { ...p, [k]: v } : p));

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-gray-200 p-4 dark:border-gray-800">
      <h2 className="font-medium">Rascunho do anúncio</h2>
      <p className="text-xs text-gray-500">
        Texto original gerado só com os fatos do produto. Revise tudo: nada é publicado daqui.
      </p>
      <button type="button" onClick={gerar} disabled={busy} className={r ? btnSecondary : btnPrimary}>
        {busy ? "Trabalhando…" : r ? "Gerar de novo" : "Gerar rascunho"}
      </button>
      {msg && <p className="text-sm text-gray-600 dark:text-gray-400">{msg}</p>}

      {r && (
        <>
          <label className="flex flex-col gap-1 text-sm">
            <span>
              Título <span className={r.titulo.length > TITULO_MAX ? "text-red-600" : "text-gray-500"}>({r.titulo.length}/{TITULO_MAX})</span>
            </span>
            <input className={inputBase} value={r.titulo} maxLength={TITULO_MAX} onChange={(e) => set("titulo", e.target.value)} />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Descrição
            <textarea className={inputBase} rows={12} value={r.descricao} onChange={(e) => set("descricao", e.target.value)} />
          </label>

          <div className="flex flex-col gap-2 text-sm">
            <span className="font-medium">Atributos</span>
            {r.atributos.map((a, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-2/5 text-gray-600 dark:text-gray-400">{a.nome}</span>
                <input
                  className={inputBase}
                  value={a.valor}
                  onChange={(e) => set("atributos", r.atributos.map((x, j) => (j === i ? { ...x, valor: e.target.value, origem: "confirmado" } : x)))}
                />
                <span className="w-24 shrink-0 text-xs text-gray-500">{ORIGEM[a.origem] ?? a.origem}</span>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2 text-sm">
            <span className="font-medium">Compatibilidade ({r.compatibilidade.length})</span>
            {r.compatibilidade.some((c) => c.origem !== "confirmado") && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                <span>{r.compatibilidade.filter((c) => c.origem !== "confirmado").length} item(ns) sugerido(s) pela web, sem confirmação (a publicação fica bloqueada).</span>
                <button type="button" className="underline" onClick={() => set("compatibilidade", r.compatibilidade.map((c) => ({ ...c, origem: "confirmado" })))}>
                  Confirmar todas
                </button>
                <button type="button" className="underline" onClick={() => set("compatibilidade", r.compatibilidade.filter((c) => c.origem === "confirmado"))}>
                  Remover as não confirmadas
                </button>
              </div>
            )}
            {r.compatibilidade.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="flex-1">{c.veiculo}{c.anos ? ` ${c.anos}` : ""}</span>
                <span className="text-xs text-gray-500">{ORIGEM[c.origem] ?? c.origem}</span>
                {c.origem !== "confirmado" && (
                  <button type="button" className="text-xs text-indigo-600 underline" onClick={() => set("compatibilidade", r.compatibilidade.map((x, j) => (j === i ? { ...x, origem: "confirmado" } : x)))}>
                    confirmar
                  </button>
                )}
                <button type="button" className="text-xs text-red-600 underline" onClick={() => set("compatibilidade", r.compatibilidade.filter((_, j) => j !== i))}>
                  remover
                </button>
              </div>
            ))}
          </div>

          <label className="flex flex-col gap-1 text-sm">
            Preço (R$){r.preco_faixa && <span className="text-xs text-gray-500">faixa vista na web: {r.preco_faixa.minimo} a {r.preco_faixa.maximo}</span>}
            <input className={inputBase} inputMode="decimal" value={r.preco ?? ""} onChange={(e) => set("preco", e.target.value ? Number(e.target.value.replace(",", ".")) || null : null)} />
          </label>

          <div className="flex flex-col gap-2 rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-800">
            <span className="font-medium">Mercado Livre</span>
            <div className="flex gap-2">
              <input className={inputBase} placeholder="Categoria (ex.: MLB194761)" value={r.categoria_id ?? ""} onChange={(e) => set("categoria_id", e.target.value.trim() || undefined)} />
              <button type="button" className={btnSecondary} disabled={busy} onClick={() => chamarML(true)}>Sugerir</button>
            </div>
            {ml?.categorias?.map((c) => (
              <button key={c.id} type="button" className="text-left text-xs text-indigo-600 underline" onClick={() => { set("categoria_id", c.id); setMl(null); }}>
                {c.id} · {c.caminho}
              </button>
            ))}
            <select className={inputBase} value={r.condicao ?? "new"} onChange={(e) => set("condicao", e.target.value as "new" | "used")}>
              <option value="new">Condição: novo</option>
              <option value="used">Condição: usado</option>
            </select>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(["altura", "largura", "comprimento", "peso"] as const).map((k) => (
                <input
                  key={k}
                  className={inputBase}
                  inputMode="decimal"
                  placeholder={k === "peso" ? "Peso embalado (g)" : `${k[0].toUpperCase()}${k.slice(1)} (cm)`}
                  value={r.embalagem?.[k] ?? ""}
                  onChange={(e) => set("embalagem", { altura: "", largura: "", comprimento: "", peso: "", ...r.embalagem, [k]: e.target.value })}
                />
              ))}
            </div>
            <button type="button" className={btnSecondary} disabled={busy} onClick={() => chamarML(false)}>Validar no Mercado Livre (não publica)</button>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={pausado} onChange={(e) => setPausado(e.target.checked)} />
              Publicar pausado (recomendado no primeiro teste)
            </label>
            <button type="button" className={btnPrimary} disabled={busy} onClick={publicar}>Publicar no Mercado Livre</button>
            {pub?.ok && (
              <p className="rounded-lg bg-green-50 p-3 text-green-900 dark:bg-green-950 dark:text-green-200">
                ✓ Criado: {pub.id} ({pub.status === "paused" ? "pausado" : pub.status}).{" "}
                {pub.link && <a className="underline" href={pub.link} target="_blank" rel="noreferrer">Abrir no ML</a>}
                {pub.fotosNoML === 0 ? " Atenção: o ML não registrou nenhuma foto." : ""}
                {pub.avisoDescricao ? " Atenção: a descrição não foi enviada, edite no ML." : ""}
              </p>
            )}
            {pub?.ok && pub.respostaCriacao !== undefined && <CopyBlock text={JSON.stringify(pub.respostaCriacao, null, 2)} label="Copiar resposta da criação (ML)" />}
            {pub?.error && (
              <div className="flex flex-col gap-2">
                <p className="text-red-600">{pub.error}</p>
                {pub.resposta !== undefined && <CopyBlock text={JSON.stringify(pub.resposta, null, 2)} label="Copiar resposta do ML" />}
              </div>
            )}
            {ml?.error && <p className="text-red-600">{ml.error}</p>}
            {ml?.status !== undefined && (
              <div className="flex flex-col gap-2">
                <p className={ml.aceito ? "text-green-700 dark:text-green-400" : "text-red-600"}>
                  {ml.aceito ? (ml.avisos?.length ? "✓ O ML aceitou o anúncio, com avisos" : "✓ O ML aceitou o anúncio") : "✗ O ML reprovou o anúncio"}
                </p>
                {!!ml.erros?.length && <ul className="list-disc pl-5 text-red-600">{ml.erros.map((m, i) => <li key={i}>{m}</li>)}</ul>}
                {!!ml.avisos?.length && <ul className="list-disc pl-5 text-xs text-amber-700 dark:text-amber-300">{ml.avisos.map((m, i) => <li key={i}>{m}</li>)}</ul>}
                {ml.fotoPrincipalOk === false && <p className="text-xs text-amber-700 dark:text-amber-300">A foto principal não tem fundo branco: defina outra como principal nas fotos.</p>}
                {ml.obrigatorios?.some((o) => !o.enviado) && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">Obrigatórios ainda não preenchidos: {ml.obrigatorios.filter((o) => !o.enviado).map((o) => o.nome).join(", ")}</p>
                )}
                <CopyBlock text={`HTTP ${ml.status}\n${JSON.stringify(ml.resposta, null, 2)}\n\nDados enviados:\n${JSON.stringify(ml.payload, null, 2)}`} label="Copiar resposta e dados" />
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-800">
            <span className="font-medium">Quanto sobra para você</span>
            <button type="button" className={btnSecondary} disabled={busy || !r.preco || !r.categoria_id} onClick={calcular}>Calcular (comissão e frete)</button>
            {calc?.error && <p className="text-red-600">{calc.error}</p>}
            {calc?.preco !== undefined && (() => {
              const preco = calc.preco;
              const com = calc.comissao ?? 0;
              const tabela = calc.freteTabela;
              const informado = freteReal.trim() ? Number(freteReal.replace(",", ".")) : NaN;
              const frete = Number.isFinite(informado) ? informado : tabela;
              const linhas: [string, string][] = [
                ["Preço de venda", reais(preco)],
                [`Comissão do ML${calc.detalhes?.percentage_fee != null ? ` (${calc.detalhes.percentage_fee}%${calc.detalhes.fixed_fee ? ` + ${reais(calc.detalhes.fixed_fee)} fixos` : ""})` : ""}`, calc.comissao == null ? "não obtida" : `− ${reais(com)}`],
                ["Sobra sem contar o frete", calc.comissao == null ? "?" : reais(preco - com)],
                [Number.isFinite(informado) ? "Frete (valor que você informou)" : "Frete grátis (custo de tabela do ML)", frete == null ? "não obtido" : `− ${reais(frete)}`],
              ];
              return (
                <div className="flex flex-col gap-2">
                  <table className="w-full text-left">
                    <tbody>
                      {linhas.map(([k, v]) => (
                        <tr key={k} className="border-t border-gray-200 dark:border-gray-800"><td className="py-1 pr-2">{k}</td><td className="py-1 text-right">{v}</td></tr>
                      ))}
                      {frete != null && calc.comissao != null && (
                        <tr className="border-t border-gray-300 font-medium dark:border-gray-700"><td className="py-1">Sobra com frete</td><td className="py-1 text-right">{reais(preco - com - frete)}</td></tr>
                      )}
                    </tbody>
                  </table>
                  <label className="flex flex-col gap-1 text-xs text-gray-500">
                    O frete real depende da sua reputação (o ML dá desconto). Se você vê outro valor no ML, digite aqui:
                    <input className={inputBase} inputMode="decimal" placeholder="Frete que o ML mostra para você (R$)" value={freteReal} onChange={(e) => setFreteReal(e.target.value)} />
                  </label>
                  <CopyBlock text={JSON.stringify(calc.brutos, null, 2)} label="Copiar resposta do ML" />
                </div>
              );
            })()}
          </div>

          {r.avisos.length > 0 && (
            <ul className="list-disc rounded-lg bg-amber-50 p-3 pl-7 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              {r.avisos.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          )}

          <button type="button" onClick={salvar} disabled={busy} className={btnPrimary}>Salvar rascunho</button>
        </>
      )}
    </section>
  );
}
