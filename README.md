# Easy PDP Creator

Assistente de anúncios para o Mercado Livre (nicho: autopeças) a partir de fotos. Veja [SPEC.md](SPEC.md).

## Estado (17/out/2026)
**Pronto e em produção:** login (e-mail/senha), produtos com várias fotos, remoção de fundo gratuita no navegador com recorte e fundo branco 1200×1200, ampliar/excluir/adicionar/refazer foto, conexão OAuth com o Mercado Livre (tokens criptografados) e página de testes da API (`/conta`).

**Descobertas do spike do ML:**
- `/products/search` (catálogo) responde 200 e reconhece número de peça, mas **não tem toda peça** (ex.: LuK 323 0162 10 não foi achado). Peça antiga tende a ser anúncio livre.
- `/sites/MLB/search` (busca de anúncios) dá **403** mesmo com token: sem preços/anúncios parecidos em massa pela API.
- Compatibilidade de veículos: edição de compatibilidades do catálogo é só leitura pela API desde 15/07/2026; as do próprio vendedor são editáveis.

**Próximos passos:** identificação por IA (Gemini com busca na web) com certeza baseada em evidência, categoria/atributos via ML, rascunho do anúncio, publicação.

## Stack
Next.js (PWA) · Supabase (auth, Postgres, storage) · Vercel.

## Rodando localmente
```bash
cp .env.example .env.local   # preencha URL e chave publishable do Supabase
npm install
npm run dev
```

## Estrutura
- `supabase/migrations/` — schema, RLS e buckets (Produto/Anúncio separados, estoque via movimentações)
- `src/app/` — telas e rotas
- `src/lib/images/` — compressão, remoção de fundo (`BackgroundRemover`) e fundo branco
- `src/domain/` — tipos puros, sem dependência de React/Next (facilita Capacitor/React Native depois)
- `src/marketplaces/` — interface `MarketplaceAdapter` (implementação do ML na etapa 5)

## Decisões
- Fotos vão direto do navegador ao Supabase Storage (evita o limite de ~4,5 MB do corpo de função da Vercel) e são reduzidas antes do upload.
- `originais` é bucket privado; `processadas` é público (o ML precisa baixar as URLs).
- Vercel Hobby é só para uso não comercial; uso comercial exige Pro.
