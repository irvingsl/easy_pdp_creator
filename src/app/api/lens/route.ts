import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buscaLens, lensAtivo } from "@/lib/lens";
import { BUCKET_ORIGINAIS } from "@/domain/types";

export const maxDuration = 60;

/** Teste forçado da busca por imagem (SerpApi) numa foto: mostra o resultado cru e o tempo, fora do fluxo de identificação. */
export async function POST(request: NextRequest) {
  const { fotoId } = (await request.json().catch(() => ({}))) as { fotoId?: string };
  if (!fotoId) return NextResponse.json({ error: "fotoId obrigatório" }, { status: 400 });
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  if (!lensAtivo()) return NextResponse.json({ error: "SERPAPI_KEY não está configurada neste deploy (confirme a variável no Vercel e faça um novo deploy)" }, { status: 400 });

  const { data: foto } = await supabase.from("produto_fotos").select("path_original").eq("id", fotoId).maybeSingle();
  if (!foto) return NextResponse.json({ error: "foto não encontrada" }, { status: 404 });
  const { data: url } = await supabase.storage.from(BUCKET_ORIGINAIS).createSignedUrl(foto.path_original, 300);
  if (!url?.signedUrl) return NextResponse.json({ error: "não consegui gerar o endereço da foto" }, { status: 500 });

  const r = await buscaLens(url.signedUrl, 50000);
  return NextResponse.json(r);
}
