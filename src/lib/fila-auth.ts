import { createHmac, timingSafeEqual } from "node:crypto";

const segredo = () => process.env.SUPABASE_SECRET_KEY ?? "";
const assinatura = (userId: string, ts: string) => createHmac("sha256", segredo()).update(`${userId}.${ts}`).digest("hex");

/** Cabeçalhos que provam que a chamada interna veio do próprio servidor (a fila), em nome de um usuário. */
export function assinar(userId: string): Record<string, string> {
  const ts = String(Date.now());
  return { "x-fila-user": userId, "x-fila-ts": ts, "x-fila-sig": assinatura(userId, ts) };
}

/** Devolve o usuário se os cabeçalhos forem válidos (assinatura correta e com menos de 10 minutos). */
export function verificar(headers: Headers): string | null {
  const userId = headers.get("x-fila-user");
  const ts = headers.get("x-fila-ts");
  const sig = headers.get("x-fila-sig");
  if (!userId || !ts || !sig || !segredo()) return null;
  if (Math.abs(Date.now() - Number(ts)) > 10 * 60_000) return null;
  const esperado = Buffer.from(assinatura(userId, ts));
  const recebido = Buffer.from(sig);
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido) ? userId : null;
}
