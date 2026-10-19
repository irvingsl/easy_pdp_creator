"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { GARANTIA_PADRAO, TITULO_MAX, type CampoFicha, type Rascunho } from "@/domain/rascunho";
import { CopyBlock } from "./copy-block";
import { btnPrimary, btnSecondary, inputBase } from "./ui";

const ORIGEM: Record<string, string> = {
  confirmado: "confirmado por você",
  lido_no_item: "lido no item",
  contado_na_foto: "contado na foto",
  web: "da web, sem confirmação",
  sugerido_web: "sugestão da web, confirme",
};

export function RascunhoAnuncio({ produtoId, inicial, estoque, autoStart = false, temIdentificacao = false }: { produtoId: string; inicial: Rascunho | null; estoque: number; autoStart?: boolean; temIdentificacao?: boolean }) {
  const router = useRouter();
  const [r, setR] = useState<Rascunho | null>(inicial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function gerar() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/rascunho", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ produtoId, forcar: true }) });
      const txt = await res.text();
      let j: { rascunho?: Rascunho; error?: string } = {};
      try {
        j = JSON.parse(txt);
      } catch {
        setMsg(res.status === 504 ? "A geração demorou demais, tente de novo." : `Resposta inesperada do servidor (${res.status}).`);
        return;
      }
      if (j.rascunho) {
        setR(j.rascunho);
        setPrecoTxt(j.rascunho.preco != null ? String(j.rascunho.preco).replace(".", ",") : "");
      }
      else setMsg(j.error ?? "Falha ao gerar o rascunho");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Piloto automático: depois da identificação, gera o rascunho, escolhe a categoria sugerida pelo ML e preenche a ficha técnica.
   * O vendedor só precisa decidir preço, embalagem e fotos.
   */
  async function automatico() {
    setBusy(true);
    try {
      const post = async (url: string, corpo: Record<string, unknown>) => (await (await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) })).json().catch(() => ({}))) as Record<string, unknown>;
      setMsg("Gerando o rascunho…");
      const j1 = await post("/api/rascunho", { produtoId });
      if (!j1.rascunho) return setMsg(String(j1.error ?? "Não consegui gerar o rascunho; use o botão acima."));
      let novo = j1.rascunho as Rascunho;
      setR(novo);
      setPrecoTxt("");
      setMsg("Escolhendo a categoria no Mercado Livre…");
      const jc = (await post("/api/anuncios/validar", { produtoId, sugerir: true })) as { categorias?: { id: string }[] };
      const cat = jc.categorias?.[0]?.id;
      if (cat) {
        novo = { ...novo, categoria_id: cat };
        setR(novo);
        await createClient().from("produtos").update({ rascunho: novo }).eq("id", produtoId);
        setMsg("Preenchendo a ficha técnica…");
        const jf = (await post("/api/rascunho/ficha", { produtoId })) as { ficha?: CampoFicha[] };
        if (jf.ficha) {
          novo = { ...novo, ficha: jf.ficha };
          setR(novo);
        }
      }
      setMsg("Pronto: confira as fotos, informe o preço e a embalagem e publique.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const iniciouAuto = useRef(false);
  useEffect(() => {
    if (!autoStart || inicial || iniciouAuto.current) return;
    const disparar = () => {
      if (iniciouAuto.current) return;
      iniciouAuto.current = true;
      automatico();
    };
    if (temIdentificacao) {
      disparar();
      return;
    }
    const falhou = () => setMsg("A identificação não terminou. Corrija os dados e use \"Gerar rascunho\".");
    window.addEventListener("identificacao-concluida", disparar);
    window.addEventListener("identificacao-falhou", falhou);
    return () => {
      window.removeEventListener("identificacao-concluida", disparar);
      window.removeEventListener("identificacao-falhou", falhou);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  type Calc = { preco?: number; comissao?: number | null; detalhes?: { percentage_fee?: number; fixed_fee?: number } | null; freteTabela?: number | null; freteObrigatorio?: boolean | null; fretePago?: number | null; descontoFrete?: { taxa: number; tipo: string | null } | null; reputacao?: { nivel: string | null; status: string | null } | null; candidatosFrete?: { campo: string; valor: number }[]; brutos?: unknown; error?: string };
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
  // texto digitado no preço (aceita vírgula ou ponto e deixa digitar "12," sem apagar o separador)
  const [precoTxt, setPrecoTxt] = useState(inicial?.preco != null ? String(inicial.preco).replace(".", ",") : "");
  const mudarPreco = (txt: string) => {
    const limpo = txt.replace(/[^\d.,]/g, "");
    setPrecoTxt(limpo);
    const n = Number(limpo.replace(",", "."));
    set("preco", limpo && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null);
  };
  async function preencherFicha() {
    if (!r) return;
    setBusy(true);
    setMsg("");
    try {
      const { error } = await createClient().from("produtos").update({ rascunho: r }).eq("id", produtoId);
      if (error) return setMsg(error.message);
      const res = await fetch("/api/rascunho/ficha", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ produtoId }) });
      const txt = await res.text();
      let j: { ficha?: CampoFicha[]; error?: string } = {};
      try {
        j = JSON.parse(txt);
      } catch {
        return setMsg(res.status === 504 ? "Demorou demais, tente de novo." : `Resposta inesperada (${res.status}).`);
      }
      if (j.ficha) setR((p) => (p ? { ...p, ficha: j.ficha } : p));
      else setMsg(j.error ?? "Falha ao preencher a ficha");
    } finally {
      setBusy(false);
    }
  }

  const setCampo = (id: string, valor: string, valorId?: string) =>
    setR((p) => (p ? { ...p, ficha: (p.ficha ?? []).map((f) => (f.id === id ? { ...f, valor, valor_id: valorId, origem: "vendedor" } : f)) } : p));

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

  // Pendências calculadas do estado atual: somem quando o vendedor resolve (não vêm mais da IA)
  const pendencias: string[] = [];
  if (r) {
    if (!r.titulo.trim()) pendencias.push("Escrever o título.");
    if (!r.descricao.trim()) pendencias.push("Escrever a descrição.");
    if (!r.preco) pendencias.push("Informar o preço.");
    if (!(estoque > 0)) pendencias.push("Informar o estoque do produto (no topo da página).");
    if (!r.categoria_id) pendencias.push("Escolher a categoria (Mercado Livre → Sugerir).");
    if (!r.embalagem?.altura || !r.embalagem.largura || !r.embalagem.comprimento || !r.embalagem.peso) pendencias.push("Informar as medidas e o peso da embalagem.");
    const obrig = (r.ficha ?? []).filter((f) => f.obrigatorio && !f.valor.trim());
    if (obrig.length) pendencias.push(`Preencher na ficha técnica: ${obrig.map((f) => f.nome).join(", ")}.`);
    if (!r.ficha) pendencias.push("Preencher a ficha técnica da categoria.");
  }

  const set = <K extends keyof Rascunho>(k: K, v: Rascunho[K]) => setR((p) => (p ? { ...p, [k]: v } : p));

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-gray-500">
        Texto original gerado só com os fatos do produto. Revise tudo: nada é publicado daqui.
      </p>
      <button type="button" onClick={gerar} disabled={busy} className={r ? btnSecondary : btnPrimary}>
        {busy ? "Trabalhando…" : r ? "Gerar de novo" : "Gerar rascunho"}
      </button>
      {msg && <p className="text-sm text-gray-600 dark:text-gray-400">{msg}</p>}

      {r && (
        <>
          {pendencias.length > 0 ? (
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <p className="mb-1 font-medium">Falta para publicar ({pendencias.length})</p>
              <ul className="list-disc pl-5">{pendencias.map((p) => <li key={p}>{p}</li>)}</ul>
            </div>
          ) : (
            <p className="rounded-lg bg-green-50 p-3 text-sm text-green-900 dark:bg-green-950 dark:text-green-200">✓ Nada pendente: valide e publique.</p>
          )}
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
                <span className="flex flex-1 flex-wrap items-center gap-2">
                  <span>{c.veiculo}</span>
                  <input
                    className="w-32 rounded border border-gray-300 bg-transparent px-2 py-1 text-xs dark:border-gray-700"
                    placeholder="anos (ex.: 1973 a 1986)"
                    value={c.anos ?? ""}
                    onChange={(e) => set("compatibilidade", r.compatibilidade.map((x, j) => (j === i ? { ...x, anos: e.target.value || null } : x)))}
                  />
                </span>
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
            <input className={inputBase} inputMode="decimal" value={precoTxt} onChange={(e) => mudarPreco(e.target.value)} />
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
            <p className="text-xs text-gray-500">Garantia: a lei já dá 90 dias para bens duráveis (CDC, art. 26), por isso esse é o padrão. Você pode ampliar.</p>
            <div className="grid grid-cols-2 gap-2">
              <select className={inputBase} value={(r.garantia ?? GARANTIA_PADRAO).tipo} onChange={(e) => set("garantia", { ...(r.garantia ?? GARANTIA_PADRAO), tipo: e.target.value as "vendedor" | "fabrica" | "sem" })}>
                <option value="sem">Garantia: sem garantia</option>
                <option value="vendedor">Garantia do vendedor</option>
                <option value="fabrica">Garantia de fábrica</option>
              </select>
              {(r.garantia ?? GARANTIA_PADRAO).tipo !== "sem" && (
                <input className={inputBase} inputMode="numeric" placeholder="Dias de garantia (ex.: 90)" value={(r.garantia ?? GARANTIA_PADRAO).dias ?? ""} onChange={(e) => set("garantia", { ...(r.garantia ?? GARANTIA_PADRAO), dias: e.target.value.replace(/\D/g, "") })} />
              )}
            </div>
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
            <div className="flex flex-col gap-2 rounded-lg border border-gray-200 p-2 dark:border-gray-800">
              <span className="font-medium">
                Ficha técnica {r.ficha ? `(${r.ficha.filter((f) => f.valor.trim()).length} de ${r.ficha.length} preenchidos)` : ""}
              </span>
              <p className="text-xs text-gray-500">Campos que a categoria pede. A IA só preenche o que você confirmou, o que está gravado no item ou o que foi contado/medido nas fotos; o resto fica para você.</p>
              <button type="button" className={btnSecondary} disabled={busy || !r.categoria_id} onClick={preencherFicha}>
                {r.ficha ? "Preencher de novo os vazios" : "Preencher ficha com os dados do produto"}
              </button>
              {!r.categoria_id && <p className="text-xs text-amber-700 dark:text-amber-300">Escolha a categoria (Sugerir) primeiro.</p>}
              {[...(r.ficha ?? [])]
                .sort((a, b) => Number(!!b.obrigatorio) - Number(!!a.obrigatorio) || Number(!!b.valor.trim()) - Number(!!a.valor.trim()))
                .map((f) => (
                  <label key={f.id} className="flex flex-col gap-1">
                    <span className="text-xs text-gray-600 dark:text-gray-400">
                      {f.nome}
                      {f.obrigatorio ? " · obrigatório" : ""}
                      {f.unidades?.length && f.tipo === "number_unit" ? ` (${f.unidades.slice(0, 4).join(", ")})` : ""}
                      {f.valor.trim() && f.origem && f.origem !== "vendedor" ? ` · ${ORIGEM[f.origem] ?? f.origem.replaceAll("_", " ")}` : ""}
                    </span>
                    {f.tipo === "list" && f.opcoes?.length ? (
                      <select className={inputBase} value={f.valor_id ?? ""} onChange={(e) => setCampo(f.id, f.opcoes!.find((o) => o.id === e.target.value)?.name ?? "", e.target.value || undefined)}>
                        <option value="">(não informar)</option>
                        {f.opcoes.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                    ) : (
                      <input className={inputBase} value={f.valor} onChange={(e) => setCampo(f.id, e.target.value)} />
                    )}
                  </label>
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
              const com = calc.comissao;
              const informado = freteReal.trim() ? Number(freteReal.replace(",", ".")) : NaN;
              // o ML informa o frete que a conta paga (já com o desconto); o campo manual só serve para corrigir
              const pago = Number.isFinite(informado) ? informado : calc.fretePago ?? null;
              const liquido = (frete: number | null | undefined) => (com == null || frete == null ? "?" : reais(preco - com - frete));
              const pct = calc.descontoFrete ? Math.round(calc.descontoFrete.taxa * 100) : 0;
              const obrigatorio = calc.freteObrigatorio === true;
              // com frete grátis o vendedor paga o frete; sem ele, o comprador paga
              const gratis = obrigatorio || r?.frete_gratis === true;
              const linhas: [string, string, boolean?][] = [
                ["Preço de venda", reais(preco)],
                [`Comissão do ML${calc.detalhes?.percentage_fee != null ? ` (${calc.detalhes.percentage_fee}%${calc.detalhes.fixed_fee ? ` + ${reais(calc.detalhes.fixed_fee)} fixos` : ""})` : ""}`, com == null ? "não obtida" : `− ${reais(com)}`],
                ...(!obrigatorio ? ([["Sobra sem frete por sua conta", liquido(0), !gratis]] as [string, string, boolean?][]) : []),
                ...(calc.freteTabela != null && calc.descontoFrete
                  ? ([["Frete de tabela (sem desconto)", reais(calc.freteTabela)]] as [string, string, boolean?][])
                  : []),
                ...(pago != null
                  ? ([
                      [Number.isFinite(informado) ? "Frete que você informou" : `Frete que você pagaria${pct ? ` (com ${pct}% de desconto do ML)` : ""}`, `− ${reais(pago)}`],
                      ["Sobra oferecendo frete grátis", liquido(pago), gratis],
                    ] as [string, string, boolean?][])
                  : []),
              ];
              return (
                <div className="flex flex-col gap-2">
                  <table className="w-full text-left">
                    <tbody>
                      {linhas.map(([k, v, forte]) => (
                        <tr key={k} className={`border-t ${forte ? "border-gray-300 font-medium dark:border-gray-700" : "border-gray-200 dark:border-gray-800"}`}><td className="py-1 pr-2">{k}</td><td className="whitespace-nowrap py-1 text-right">{v}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  {com != null && (gratis ? pago != null && preco - com - pago < 0 : preco - com < 0) && (
                    <p className="rounded-lg bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-200">
                      Com este preço você teria prejuízo de {reais(Math.abs(preco - com - (gratis ? pago ?? 0 : 0)))} por venda (antes do custo da peça). Aumente o preço antes de publicar.
                    </p>
                  )}
                  {com != null && (gratis ? pago != null && preco - com - pago >= 0 : preco - com >= 0) && (
                    <p className="text-xs text-gray-500">Isso é antes do custo da peça e de impostos.</p>
                  )}
                  {!obrigatorio && com != null && pago != null && calc.detalhes?.percentage_fee != null && (() => {
                    // mesma sobra do cenário sem frete: P·(1 − %) − fixa − frete = preço − comissão  →  P = (sobra + fixa + frete) / (1 − %)
                    const taxa = calc.detalhes.percentage_fee / 100;
                    const equivalente = (preco - com + (calc.detalhes.fixed_fee ?? 0) + pago) / (1 - taxa);
                    return (
                      <p className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600 dark:bg-gray-900 dark:text-gray-400">
                        Para ter a mesma sobra de {reais(preco - com)} oferecendo frete grátis, o preço seria cerca de <strong>{reais(Math.ceil(equivalente * 100) / 100)}</strong> (estimativa: comissão e frete mudam um pouco com o preço).
                      </p>
                    );
                  })()}
                  {obrigatorio ? (
                    <p className="text-xs text-gray-500">Neste preço o ML exige frete grátis: o frete é por sua conta.</p>
                  ) : (
                    <>
                    <p className="text-xs text-gray-500">Sem a opção abaixo, o frete não é por sua conta. Mesmo assim o comprador pode ver &quot;frete grátis&quot; se o próprio ML cobrir o envio nessa faixa de preço (você paga só a tarifa fixa da venda).</p>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={r?.frete_gratis === true} onChange={(e) => set("frete_gratis", e.target.checked)} />
                      Oferecer frete grátis (por minha conta)
                    </label>
                    </>
                  )}
                  {calc.freteObrigatorio == null && <p className="text-xs text-gray-500">Não consegui saber se o ML exige frete grátis neste preço; o ML decide ao publicar.</p>}
                  {pago == null && <p className="text-xs text-gray-500">O ML não informou o frete desta conta. Digite o valor que o ML mostra para você:</p>}
                  <label className="flex flex-col gap-1 text-xs text-gray-500">
                    Frete diferente do calculado? Digite o que o ML mostra (R$)
                    <input className={inputBase} inputMode="decimal" placeholder="ex.: 19,05" value={freteReal} onChange={(e) => setFreteReal(e.target.value)} />
                  </label>
                  <p className="text-xs text-gray-500">O frete depende das dimensões e do peso embalado informados. Se o ML calcular outro valor ao publicar, use o campo acima.</p>
                  <CopyBlock text={JSON.stringify(calc.brutos, null, 2)} label="Copiar resposta do ML" />
                </div>
              );
            })()}
          </div>

          <button type="button" onClick={salvar} disabled={busy} className={btnPrimary}>Salvar rascunho</button>
        </>
      )}
    </div>
  );
}
