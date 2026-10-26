type Familia = { marca: string; modelo: string; ano: number };

async function chamar(produtoId: string, corpo: Record<string, unknown>) {
  const res = await fetch("/api/anuncios/compatibilidade", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ produtoId, ...corpo }) });
  const t = await res.text();
  try {
    return JSON.parse(t) as Record<string, unknown>;
  } catch {
    return { error: res.status === 504 ? "Demorou demais, tente de novo." : `Resposta inesperada (${res.status})` };
  }
}

/**
 * Monta a compatibilidade a partir dos veículos CONFIRMADOS do rascunho, confere no catálogo do ML e envia ao anúncio.
 * Devolve um resumo em texto (o que foi enviado e o que ficou de fora e por quê).
 */
export async function enviarCompatibilidade(produtoId: string, itemId: string): Promise<{ ok: boolean; resumo: string; resposta?: unknown }> {
  const p = await chamar(produtoId, { acao: "previa" });
  if (p.error) return { ok: false, resumo: String(p.error) };
  const existentes = (p.existentes as Familia[]) ?? [];
  const avisos: string[] = [];
  if ((p.semAno as string[] | undefined)?.length) avisos.push(`sem ano (ficaram de fora): ${(p.semAno as string[]).join(", ")}`);
  if ((p.modelosNaoEncontrados as string[] | undefined)?.length) avisos.push(`modelos que não achei no catálogo: ${(p.modelosNaoEncontrados as string[]).join(", ")}`);
  if ((p.ausentes as Familia[] | undefined)?.length) avisos.push(`${(p.ausentes as Familia[]).length} combinação(ões) marca/modelo/ano não existem no catálogo`);
  if (!existentes.length) return { ok: false, resumo: `Nada para enviar${avisos.length ? ": " + avisos.join("; ") : ""}.` };
  const e = await chamar(produtoId, { acao: "enviar", itemId, familias: existentes });
  const ok = e.ok === true;
  const grandes = (e.grandesDemais as Familia[] | undefined) ?? [];
  if (grandes.length) avisos.push(`${grandes.length} combinação(ões) com mais de 200 versões no catálogo (precisam de filtro por versão/motor no Gerenciador de Compatibilidades do ML): ${[...new Set(grandes.map((g) => `${g.marca} ${g.modelo}`))].join(", ")}`);
  const noML = e.noML as { entradas?: number } | null | undefined;
  return {
    ok,
    resposta: e.resposta ?? e,
    resumo: ok
      ? `✓ O ML criou ${e.enviadas} compatibilidades${noML ? ` (agora o anúncio mostra ${noML.entradas} entrada(s) de compatibilidade)` : ""}.${avisos.length ? " Ficou de fora: " + avisos.join("; ") + "." : ""}`
      : `O ML recusou a compatibilidade (HTTP ${e.status ?? "?"}): ${JSON.stringify(e.resposta).slice(0, 300)}`,
  };
}
