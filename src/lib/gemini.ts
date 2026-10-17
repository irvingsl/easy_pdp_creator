import type { DadosConfirmados } from "@/domain/dados-confirmados";

const API = "https://generativelanguage.googleapis.com/v1beta";
/** Preferidos, na ordem; depois completamos com o que a própria chave enxerga. */
const PREFERRED = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"];
const MAX_MODELS = 6;
let lastGood: string | null = null;

type Confianca = "alta" | "media" | "baixa";

export type PartAnalysis = {
  tipo_item: string | null;
  formato_de_venda: "unidade" | "kit" | "par" | "conjunto" | "indefinido";
  componentes_visiveis: string[];
  marca: { valor: string | null; origem: string; confianca: Confianca } | null;
  textos_gravados: { texto: string; foto: number | null; legibilidade: string }[];
  codigos: {
    codigo: string;
    classe: "numero_de_peca" | "equivalente" | "processo" | "desconhecido";
    marca: string | null;
    origem: string;
    confianca: Confianca;
    fonte_url: string | null;
  }[];
  numero_peca_principal: string | null;
  candidatos?: {
    numero_de_peca: string;
    marca: string | null;
    descricao: string;
    aplicacoes: string[];
    combina: string[];
    nao_confirmado: string[];
    como_confirmar: string;
    fontes: string[];
  }[];
  caracteristicas: {
    nome: string;
    valor: string;
    unidade: string | null;
    origem: string;
    como: string | null;
    confianca: Confianca;
  }[];
  aplicacoes: { descricao: string; anos: string | null; origem: string; fonte_url: string | null }[];
  preco: {
    minimo: number | null;
    maximo: number | null;
    formato_de_referencia: string | null;
    condicao: string | null;
    fontes: string[];
    observacao: string | null;
  };
  termos_busca: string[];
  categoria_sugerida_texto: string | null;
  fotos_sugeridas: string[];
  duvidas: string[];
};

export type GeminiResult = {
  analysis: PartAnalysis | null;
  /** análise em texto livre que a IA escreve antes do JSON */
  narrativa: string;
  text: string;
  sources: { title: string; uri: string }[];
  model: string;
  /** false quando a busca na web ficou indisponível (cota) e a IA respondeu só pelas fotos */
  grounded: boolean;
  /** true só se o Gemini realmente pesquisou (ferramenta ligada não garante que ele use) */
  pesquisou: boolean;
  consultas: string[];
  tentativas: { model: string; grounded: boolean; status: number }[];
};

/** Domínio do negócio; trocar aqui (ou por variável de ambiente) quando o app deixar de ser só de autopeças. */
const DEFAULT_CONTEXT = "peças e acessórios automotivos vendidos no Brasil";

const SCHEMA = `{
  "tipo_item": string|null,
  "formato_de_venda": "unidade"|"kit"|"par"|"conjunto"|"indefinido",
  "componentes_visiveis": string[],
  "marca": { "valor": string|null, "origem": "gravado"|"visivel"|"fonte_web"|"suposicao", "confianca": "alta"|"media"|"baixa" },
  "textos_gravados": [{ "texto": string, "foto": number, "legibilidade": "boa"|"parcial"|"ruim" }],
  "codigos": [{ "codigo": string, "classe": "numero_de_peca"|"equivalente"|"processo"|"desconhecido",
                "marca": string|null, "origem": "gravado_no_item"|"inferido_pela_pesquisa"|"confirmado_pelo_vendedor",
                "confianca": "alta"|"media"|"baixa", "fonte_url": string|null }],
  "numero_peca_principal": string|null,
  "candidatos": [{ "numero_de_peca": string, "marca": string|null, "descricao": string, "aplicacoes": string[],
                   "combina": string[], "nao_confirmado": string[], "como_confirmar": string, "fontes": string[] }],
  "caracteristicas": [{ "nome": string, "valor": string, "unidade": string|null,
                        "origem": "contado_na_foto"|"estimado_na_foto"|"fonte_web"|"confirmado_pelo_vendedor", "como": string, "confianca": "alta"|"media"|"baixa" }],
  "aplicacoes": [{ "descricao": string, "anos": string|null, "origem": "fonte_web"|"suposicao", "fonte_url": string|null }],
  "preco": { "minimo": number|null, "maximo": number|null, "formato_de_referencia": string|null,
             "condicao": "novo"|"usado"|null, "fontes": string[], "observacao": string|null },
  "termos_busca": string[],
  "categoria_sugerida_texto": string|null,
  "fotos_sugeridas": string[],
  "duvidas": string[]
}`;

function buildPrompt(grounded: boolean, context = process.env.IDENTIFICACAO_CONTEXTO ?? DEFAULT_CONTEXT) {
  return `Você é um especialista em identificar produtos a partir de fotos e em pesquisar suas especificações.
Contexto do negócio: ${context}.

As fotos abaixo mostram o MESMO item, em ângulos diferentes. Não sei nada sobre ele. Seu trabalho é descobrir
o que é, com a maior precisão que as evidências permitirem, sem inventar.

## Princípios
1. Evidência acima de palpite. Toda informação precisa de uma origem: "gravado/impresso no item",
   "visível na foto", "fonte na web" (com a URL) ou "suposição". Nunca apresente suposição como fato.
2. Não parta de hipóteses. Não assuma tipo de item, marca, formato (peça única, kit, par, conjunto) nem
   veículo/modelo de aplicação antes de observar. Se as fotos mostram mais de um componente, é kit ou
   conjunto: liste os componentes.
3. "Não sei" é uma boa resposta. Use null ou lista vazia e explique em "duvidas" o que falta. Nunca invente
   códigos, medidas, marcas, aplicações nem preços. Isso vale também para o texto da análise: não sugira
   veículos, aplicações ou usos típicos sem uma fonte pesquisada.
4. Medidas e contagens podem vir da foto, desde que você diga como chegou nelas (ex.: "contei N na foto 3")
   e o grau de confiança (alta, média, baixa). Se a imagem não permite medir ou contar com segurança, use null.
5. Número de peça: só vai em "numero_peca_principal" se estiver gravado e legível no item ou confirmado pelo
   vendedor. Um número descoberto na pesquisa a partir de características (medidas, contagens...) é apenas
   CANDIDATO: vários modelos compartilham as mesmas medidas. Liste até 5 candidatos, com o que combina, o que
   não foi confirmado e qual medida ou foto adicional distingue entre eles. Aplicações pertencem a cada
   candidato, não ao item, enquanto o número não estiver confirmado.
6. Leituras parciais ou duvidosas não são evidência: não interprete siglas ou textos parcialmente legíveis
   como se tivessem significado técnico, e não as use como pistas de pesquisa.

## Como proceder
Passo 1 - Observar. Descreva o que vê: tipo de item, formato (unidade, kit, par, conjunto), componentes
visíveis, material, estado (novo, usado, desgastado).
Passo 2 - Ler. Transcreva literalmente todo texto, logotipo, número e código visível. Diga em qual foto está
e se a leitura é boa, parcial ou ruim. Não corrija nem complete o que não estiver legível.
Passo 3 - Classificar os códigos. Para cada código, decida se é: (a) número de peça ou modelo do fabricante,
(b) código equivalente de outra marca, ou (c) código de processo (lote, data de fabricação, turno, material,
inspeção). Códigos de processo costumam ser curtos, ter formato de data ou se repetir em padrões, e ficar em
áreas de marcação industrial; números de peça costumam ser mais longos ou estruturados e ficar junto da marca.
Se não der para decidir, marque "desconhecido". Só um número de peça vai em "numero_peca_principal".
${
  grounded
    ? `Passo 4 - Pesquisar na web. Monte as buscas com o que realmente leu e viu: marca + códigos + tipo de item +
características observadas. Priorize catálogos de fabricantes e distribuidores, depois anúncios de marketplaces.
Confirme número de peça e aplicações em pelo menos duas fontes independentes, quando possível. Se as fontes
divergirem, mostre as duas versões.`
    : `Passo 4 - Sem acesso à web nesta chamada: não afirme nada que dependa de pesquisa (número de peça não
gravado, aplicações, preço). Preencha só o que vem das fotos, gere "termos_busca" para o vendedor pesquisar e
liste em "duvidas" o que precisa ser confirmado.`
}
Passo 5 - Preço. Só informe preço se você realmente o encontrou em uma página pesquisada agora; nunca cite uma URL que você não obteve na pesquisa e nunca estime preço de memória (nesse caso, null). Informe faixa de preço apenas para o item no MESMO formato das fotos (se é kit, preço de kit;
se é unidade, preço de unidade). Se só achar preço em outro formato, diga isso e não misture. Indique a
condição (novo ou usado) e de onde veio cada preço. Sem fonte, use null.
Passo 6 - O que falta. Diga que foto adicional ajudaria (ex.: "close da região X", "o outro lado", "a etiqueta")
em "fotos_sugeridas".

## Formato da resposta
Primeiro escreva uma análise curta (até 15 linhas): o que observou, como decidiu e o que encontrou.
Depois, ao final, o JSON abaixo dentro de um bloco \`\`\`json.
${SCHEMA}`;
}

function splitResponse(text: string): { narrativa: string; analysis: PartAnalysis | null } {
  const fence = text.search(/```/);
  const brace = text.indexOf("{");
  const cut = fence >= 0 ? fence : brace >= 0 ? brace : text.length;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let analysis: PartAnalysis | null = null;
  try {
    analysis = JSON.parse(candidate) as PartAnalysis;
  } catch {
    analysis = null;
  }
  return { narrativa: text.slice(0, cut).trim(), analysis };
}

async function listModels(key: string): Promise<string[]> {
  try {
    const res = await fetch(`${API}/models?pageSize=100`, { headers: { "x-goog-api-key": key } });
    const body = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
    return (body.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""))
      .filter((n) => /^gemini-[\d.]+-flash/.test(n) && !/image|tts|live|audio|embedding|thinking|exp/.test(n));
  } catch {
    return [];
  }
}

/** Todos os modelos de texto que a chave enxerga (para diagnóstico). */
export async function listAllModels(key: string): Promise<string[]> {
  const res = await fetch(`${API}/models?pageSize=200`, { headers: { "x-goog-api-key": key } });
  const body = (await res.json().catch(() => null)) as { models?: { name: string; supportedGenerationMethods?: string[] }[] } | null;
  return (body?.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .filter((n) => n.startsWith("gemini-") && !/image|tts|live|audio|embedding|robotics|computer|deep-research|vision|transcribe|customtools/.test(n))
    .sort();
}

/** Uma pergunta curta que exige busca na web; diz se o modelo respondeu e se usou a busca. */
export async function probeGrounding(model: string) {
  const res = await fetch(`${API}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "Pesquise na web: qual é o número de peça LuK do disco de embreagem do Chevrolet Opala 4 cilindros? Responda em uma frase." }] }],
      tools: [{ google_search: {} }],
    }),
  });
  const body = await res.json().catch(() => null);
  const cand = body?.candidates?.[0];
  return {
    model,
    status: res.status,
    comBusca: !!(cand?.groundingMetadata?.groundingChunks?.length || cand?.groundingMetadata?.webSearchQueries?.length),
    fontes: cand?.groundingMetadata?.groundingChunks?.length ?? 0,
    resposta: ((cand?.content?.parts ?? []) as { text?: string }[]).map((p) => p.text ?? "").join("").slice(0, 200),
    erro: res.ok ? "" : String(body?.error?.message ?? "").slice(0, 200),
  };
}

async function candidateModels(key: string): Promise<string[]> {
  const set = new Set<string>();
  if (process.env.GEMINI_MODEL) set.add(process.env.GEMINI_MODEL);
  if (lastGood) set.add(lastGood);
  PREFERRED.forEach((m) => set.add(m));
  if (set.size < MAX_MODELS) (await listModels(key)).sort().reverse().forEach((m) => set.add(m));
  return [...set].slice(0, MAX_MODELS);
}

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

async function callGemini(model: string, parts: Part[], grounded: boolean, maxOutputTokens = 8192) {
  const key = process.env.GEMINI_API_KEY!;
  const res = await fetch(`${API}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      ...(grounded ? { tools: [{ google_search: {} }] } : {}),
      generationConfig: { temperature: 0.2, maxOutputTokens },
    }),
  });
  const body = await res.json().catch(() => null);
  return { res, body };
}

function generate(model: string, images: { mime: string; data: string }[], notes: string | undefined, grounded: boolean) {
  const text = notes ? `${buildPrompt(grounded)}\n\n${notes}` : buildPrompt(grounded);
  return callGemini(model, [{ text }, ...images.map((i) => ({ inline_data: { mime_type: i.mime, data: i.data } }))], grounded);
}

function readGrounding(body: { candidates?: { content?: { parts?: { text?: string }[] }; groundingMetadata?: Record<string, unknown> }[] } | null, grounded: boolean) {
  const cand = body?.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  const sources = ((cand?.groundingMetadata?.groundingChunks ?? []) as { web?: { uri: string; title: string } }[])
    .filter((c) => c.web)
    .map((c) => ({ title: c.web!.title, uri: c.web!.uri }));
  const consultas = ((cand?.groundingMetadata?.webSearchQueries ?? []) as string[]).slice(0, 10);
  return { text, sources, consultas, pesquisou: grounded && (sources.length > 0 || consultas.length > 0) };
}

/** Pergunta direta (formato que faz o Gemini pesquisar), montada só com fatos sólidos. */
function perguntaDePesquisa(prev: PartAnalysis, conf: DadosConfirmados | null | undefined): string {
  const fmt = (c: { nome: string; valor: string; unidade?: string | null }) => `${c.nome} ${c.valor}${c.unidade ? ` ${c.unidade}` : ""}`;
  const doVendedor = (conf?.caracteristicas ?? []).map(fmt);
  const daFoto = (prev.caracteristicas ?? [])
    .filter((c) => c.confianca !== "baixa" && c.origem !== "estimado_na_foto" && c.origem !== "confirmado_pelo_vendedor")
    .map(fmt);
  const extras = [
    conf?.numero_peca ? `número de peça gravado no item: ${conf.numero_peca}` : "",
    conf?.veiculo ? `veículo/aplicação: ${conf.veiculo}` : "",
  ].filter(Boolean);
  const fatos = [...doVendedor, ...daFoto, ...extras].join("; ");
  const marca = conf?.marca || prev.marca?.valor;
  const item = [
    prev.tipo_item ?? "um item",
    marca ? `da marca ${marca}` : "",
    prev.formato_de_venda && prev.formato_de_venda !== "indefinido" ? `(${prev.formato_de_venda})` : "",
  ].filter(Boolean).join(" ");
  // só leituras boas entram na pergunta; texto parcialmente legível não é pista
  const gravados = (prev.textos_gravados ?? []).filter((t) => t.legibilidade === "boa").map((t) => t.texto).join(", ");
  return `Pesquise na web: quais números de peça do fabricante correspondem a ${item}${fatos ? `, com estas características: ${fatos}` : ""}${gravados ? `. Gravações legíveis no item: ${gravados}` : ""}? Vários modelos podem ter as mesmas medidas, então liste os possíveis; para cada um, informe os códigos equivalentes de outras marcas, as aplicações (veículos e anos) e a faixa de preço do mesmo formato. Responda em no máximo 12 linhas e cite as fontes.`;
}

/** Etapa B (sem busca): transforma a resposta da pesquisa no formato do app. */
function buildFormatPrompt(prev: PartAnalysis, notes: string | undefined, pesquisa: string) {
  return `Um item foi analisado pelas fotos e depois pesquisado na web.

Análise das fotos (JSON): ${JSON.stringify(prev)}
${notes ? `\n${notes}\n` : ""}
Resultado da pesquisa na web:
"""
${pesquisa}
"""

Atualize o JSON da análise com o que a pesquisa trouxe, mantendo o que as fotos já mostravam. Regras: use só o que está no resultado da pesquisa, com a URL de cada informação quando houver; se a pesquisa não encontrou algo, use null; se as fontes divergirem, mostre as duas versões; os fatos confirmados pelo vendedor prevalecem sobre qualquer fonte; diferencie o número de peça do item do número de um kit ou conjunto; nunca invente preço nem URL.
Números vindos da pesquisa são CANDIDATOS: preencha "candidatos" (até 5) com o que combina, o que não foi confirmado e como confirmar (qual medida ou foto distingue). Só preencha "numero_peca_principal" se o número estiver gravado e legível no item ou confirmado pelo vendedor; caso contrário, deixe null. Aplicações ficam dentro de cada candidato.

Responda SOMENTE com o JSON, dentro de um bloco \`\`\`json, neste formato:
${SCHEMA}`;
}

/**
 * Passo 1: tenta todos os modelos COM busca na web (qualquer um com cota serve).
 * Passo 2: só se nenhum tiver, tenta sem a busca, e a IA é instruída a não chutar.
 */
export async function identifyPart(
  images: { mime: string; data: string }[],
  notes?: string,
  modos: boolean[] = [true, false],
): Promise<GeminiResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Defina GEMINI_API_KEY");

  const models = await candidateModels(key);
  const dead = new Set<string>(); // 404/400: modelo indisponível
  const tentativas: GeminiResult["tentativas"] = [];
  let lastError = "";

  for (const grounded of modos) {
    for (const model of models) {
      if (dead.has(model)) continue;
      const { res, body } = await generate(model, images, notes, grounded);
      tentativas.push({ model, grounded, status: res.status });
      if (res.ok) {
        lastGood = model;
        const g = readGrounding(body, grounded);
        const { narrativa, analysis } = splitResponse(g.text);
        const result: GeminiResult = {
          analysis, narrativa, text: g.text, sources: g.sources, model, grounded,
          pesquisou: g.pesquisou, consultas: g.consultas, tentativas,
        };

        return result;
      }
      lastError = `Gemini ${res.status} (${model}): ${JSON.stringify(body?.error ?? body).slice(0, 300)}`;
      if (res.status !== 429) dead.add(model);
    }
  }
  throw new Error(`${lastError} | tentativas: ${tentativas.map((t) => `${t.model}${t.grounded ? "+web" : ""}=${t.status}`).join(", ")}. Veja https://ai.dev/rate-limit`);
}

/**
 * 2ª etapa, em duas chamadas: A) só a pergunta, com busca na web (é o formato que faz o Gemini pesquisar);
 * B) sem busca, organiza a resposta no formato do app.
 */
export async function pesquisaFocada(prev: PartAnalysis, notes: string | undefined, model: string, conf?: DadosConfirmados | null) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Defina GEMINI_API_KEY");
  const pergunta = perguntaDePesquisa(prev, conf);
  const outros = (await candidateModels(key)).filter((m) => m !== model);
  let ultimo: { status: number; erro: string; pergunta: string } = { status: 0, erro: "", pergunta };

  for (const m of [model, ...outros].slice(0, 3)) {
    const a = await callGemini(m, [{ text: pergunta }], true, 2048);
    if (!a.res.ok) {
      ultimo = { status: a.res.status, erro: `${m}: ${JSON.stringify(a.body?.error ?? a.body).slice(0, 200)}`, pergunta };
      continue;
    }
    const ga = readGrounding(a.body, true);
    if (!ga.pesquisou) {
      ultimo = { status: a.res.status, erro: `${m}: respondeu sem pesquisar`, pergunta };
      continue;
    }
    // B: organiza a resposta da pesquisa; se falhar, mantém a análise das fotos e mostra o texto da pesquisa
    let analysis: PartAnalysis | null = null;
    const b = await callGemini(m, [{ text: buildFormatPrompt(prev, notes, ga.text) }], false, 6144);
    if (b.res.ok) analysis = splitResponse(readGrounding(b.body, false).text).analysis;
    return {
      status: a.res.status,
      model: m,
      pergunta,
      analysis,
      narrativa: ga.text.trim(),
      sources: ga.sources,
      consultas: ga.consultas,
      pesquisou: true as const,
    };
  }
  return ultimo;
}
