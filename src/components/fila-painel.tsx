"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { processPending } from "@/lib/photos";

export type ItemFila = {
  id: string;
  sku: string;
  etapa: string | null;
  passo: string | null;
  erro: string | null;
  pendentes: { fotoId: string; pathOriginal: string; produtoId: string }[];
};

/** Rótulo e cor do estado de um produto na fila. */
export const ESTADO: Record<string, { rotulo: string; cor: string }> = {
  identificar: { rotulo: "Identificando…", cor: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300" },
  rascunho: { rotulo: "Montando o rascunho…", cor: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300" },
  revisar: { rotulo: "Pronto para revisar", cor: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300" },
  pronto: { rotulo: "Pronto para publicar", cor: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300" },
  erro: { rotulo: "Falhou", cor: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
};

/** Dispara (ou retoma) o processamento no servidor. */
export const dispararFila = (cadeias = 2) =>
  fetch("/api/fila/disparar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cadeias }) }).catch(() => {});

/**
 * Acompanha a fila: atualiza a lista enquanto o servidor trabalha, retoma o que travou e remove o fundo das
 * fotos pendentes (isso roda aqui no navegador, uma foto por vez, enquanto a página estiver aberta).
 */
export function FilaPainel({ itens, userId, sensibilidade }: { itens: ItemFila[]; userId: string; sensibilidade: number }) {
  const router = useRouter();
  const [fundo, setFundo] = useState("");
  const [erroFundo, setErroFundo] = useState("");
  const trabalhando = itens.filter((i) => i.etapa === "identificar" || i.etapa === "rascunho").length;
  const pendentes = itens.flatMap((i) => i.pendentes);
  const pendentesKey = pendentes.map((p) => p.fotoId).join(",");

  // retoma a fila ao abrir a lista (corrente quebrada ou produtos criados em outra sessão)
  const retomou = useRef(false);
  useEffect(() => {
    if (retomou.current || !trabalhando) return;
    retomou.current = true;
    dispararFila();
  }, [trabalhando]);

  // enquanto o servidor trabalha, atualiza a lista; se ficar parado, tenta empurrar de novo
  useEffect(() => {
    if (!trabalhando) return;
    let n = 0;
    const t = setInterval(() => {
      router.refresh();
      if (++n % 6 === 0) dispararFila(1);
    }, 6000);
    return () => clearInterval(t);
  }, [trabalhando, router]);

  // fundo das fotos pendentes, uma de cada vez
  const processando = useRef(false);
  useEffect(() => {
    if (!pendentesKey || processando.current) return;
    processando.current = true;
    (async () => {
      const supabase = createClient();
      const erros: string[] = [];
      try {
        for (const [i, p] of pendentes.entries()) {
          setFundo(`Removendo o fundo: foto ${i + 1} de ${pendentes.length}…`);
          const r = await processPending(supabase, { userId, produtoId: p.produtoId, fotoId: p.fotoId, pathOriginal: p.pathOriginal, sensibilidade });
          if (r.erro) erros.push(r.erro);
          router.refresh();
        }
      } finally {
        processando.current = false;
        setFundo("");
        setErroFundo(erros.length ? `Não consegui remover o fundo de ${erros.length} foto(s): ${erros[0]}` : "");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendentesKey]);

  if (!trabalhando && !fundo && !erroFundo) return null;
  return (
    <div className="mb-4 flex flex-col gap-1 rounded-lg bg-blue-50 p-3 text-sm text-blue-900 dark:bg-blue-950 dark:text-blue-200">
      {trabalhando > 0 && <p>O servidor está processando {trabalhando} produto(s). Você pode sair desta tela: o trabalho continua.</p>}
      {fundo && <p>{fundo} (isso roda neste aparelho; deixe a tela aberta.)</p>}
      {erroFundo && <p className="text-red-700 dark:text-red-300">{erroFundo}</p>}
    </div>
  );
}

/** Botão para tentar de novo um produto que falhou na fila. */
export function BotaoTentarDeNovo({ produtoId, passo }: { produtoId: string; passo: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async (e) => {
        e.preventDefault();
        setBusy(true);
        const etapa = passo && ["rascunho", "categoria", "ficha"].includes(passo) ? "rascunho" : "identificar";
        await createClient()
          .from("produtos")
          .update({ fila_etapa: etapa, fila_erro: null, fila_tentativas: 0, fila_lease: null, fila_atualizado_em: new Date().toISOString() })
          .eq("id", produtoId);
        await dispararFila(1);
        router.refresh();
        setBusy(false);
      }}
      className="rounded-md border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
    >
      Tentar de novo
    </button>
  );
}

/** Faixa na página do produto enquanto o servidor ainda trabalha nele: atualiza sozinha. */
export function FilaStatus({ etapa, passo, erro, produtoId }: { etapa: string | null; passo: string | null; erro: string | null; produtoId: string }) {
  const router = useRouter();
  const ativo = etapa === "identificar" || etapa === "rascunho";
  useEffect(() => {
    if (!ativo) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [ativo, router]);
  if (!etapa) return null;
  const e = ESTADO[etapa];
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-800">
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${e?.cor ?? ""}`}>{e?.rotulo ?? etapa}</span>
      {ativo && <span className="text-gray-500">O servidor está trabalhando neste produto; esta página atualiza sozinha.</span>}
      {etapa === "erro" && <BotaoTentarDeNovo produtoId={produtoId} passo={passo} />}
      {erro && <span className="break-words text-xs text-amber-700 dark:text-amber-400">{erro}</span>}
    </div>
  );
}
