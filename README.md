# Easy PDP Creator

Assistente de anúncios para o Mercado Livre (nicho: autopeças) a partir de fotos. Veja [SPEC.md](SPEC.md).

## Estado
Etapas 1 e 2 do SPEC: login por link mágico, upload de fotos e remoção de fundo (gratuita, no navegador) com padronização em fundo branco 1200×1200.

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
