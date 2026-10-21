/** Remoção de fundo no servidor (Hugging Face Space, pasta hf-space/). Devolve o JPEG já com fundo branco. */
export const fundoNoServidorAtivo = () => !!process.env.FUNDO_URL;

export async function removerFundoNoServidor(original: Blob, sensibilidade: number, timeoutMs = 50000): Promise<{ jpeg: Blob; area: number }> {
  const base = process.env.FUNDO_URL!.replace(/\/$/, "");
  const form = new FormData();
  form.append("imagem", original, "foto.jpg");
  form.append("sensibilidade", String(Math.round(sensibilidade)));
  const r = await fetch(`${base}/remover`, {
    method: "POST",
    headers: { "x-token": process.env.FUNDO_TOKEN ?? "" },
    body: form,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`servidor de fundo: HTTP ${r.status}`);
  return { jpeg: new Blob([await r.arrayBuffer()], { type: "image/jpeg" }), area: Number(r.headers.get("x-area-recorte") ?? "1") };
}
