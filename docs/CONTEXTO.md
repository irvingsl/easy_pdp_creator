# Contexto do projeto (para retomar em uma sessão nova)

Easy PDP Creator: PWA de um vendedor brasileiro de autopeças (único usuário por enquanto: o dono do projeto) que cria anúncios no
Mercado Livre (ML) a partir de fotos. Fluxo: fotos → fundo branco → identificação da peça → rascunho → validar/publicar no ML.
Stack: Next.js 16 (App Router; leia `node_modules/next/dist/docs/` antes de mexer, ver AGENTS.md), Tailwind 4, Supabase
(projeto `npdlvymudqhltaaqmtsm`; Auth, Postgres+RLS, Storage `originais` privado e `processadas` público), Vercel Hobby
(https://easy-pdp-creator.vercel.app, funções de 60 s), Gemini (REST), SerpApi Google Lens, Replicate (fundo).
Idioma da conversa e da interface: português do Brasil. O usuário não gosta de respostas longas, não quer "forçar o app a acertar"
(melhorar o app, não colar a resposta certa) e não cola chaves no chat (segredos só nas variáveis da Vercel).

## Como funciona hoje
- **Fila no servidor** (`src/lib/fila.ts`, `src/app/api/fila/*`, colunas `fila_*` em `produtos`): novo produto entra em `identificar`;
  passos fotos → pesquisa → organizar → final → rascunho → categoria → ficha → fundo → `revisar`. Cada passo é uma função (≤60 s) que
  chama a seguinte (`after()` + fetch assinado HMAC com `SUPABASE_SECRET_KEY`). Vigia no banco (pg_cron + pg_net, a função
  `fila_vigiar`, tabela `fila_config` com segredo e origem do app) religa produtos parados a cada minuto.
- **Fundo**: no servidor via Replicate (`REPLICATE_API_TOKEN`; modelo padrão `851-labs/background-remover`, trocável por
  `REPLICATE_MODELO`, ex. `men1scus/birefnet`). Limite de 6 pedidos/min em conta com pouco crédito: o app espera e repete no 429.
  No navegador só roda sob demanda (botão), porque travava o celular. Sensibilidade 0–10 na tela (guardada ×10 em
  `user_metadata.limiar_fundo`). A pasta `hf-space/` (Hugging Face) foi abandonada: a cota grátis acabou.
- **Identificação**: Gemini lê as fotos; Google Lens (SerpApi) na melhor foto; catálogo do ML; regras de evidência em
  `src/app/api/identificar/route.ts`, `src/lib/gemini.ts`, `src/lib/fatos.ts`. Número confirmado pelo vendedor manda sobre IA/web.
- **Rascunho/ML**: `src/components/rascunho-anuncio.tsx`, `src/marketplaces/mercadolivre/*`. A última ação da tela é "Publicar".
  Estoque vazio/0 no cadastro vira 1. Categoria inválida (não folha) é trocada pela sugerida do ML.
- **Lista de produtos**: bolinha de status (verde = ativo no ML; amarelo = precisa de você/em revisão/pausado; vermelho = erro, sem
  estoque ou pagamento pendente; cinza = processando). Aba "Vários produtos" separa fotos por horário (`src/lib/novo-produto.ts`).
- **Compatibilidade de veículos** (`src/marketplaces/mercadolivre/compat.ts`, `compat-previa.ts`, `src/app/api/anuncios/compatibilidade`):
  domínio `MLB-CARS_AND_VANS`, atributos BRAND/MODEL/VEHICLE_YEAR. Regras do ML (docs de 2026): `creation_source` obrigatório;
  até 10 famílias e 200 produtos por chamada; anúncios `user_product_listing` usam `/user-products/{id}/compatibilities`.
  Enviada automaticamente ao publicar e pelo botão no anúncio. Só entram veículos com origem "confirmado". Desde 15/07/2026 a API não
  gerencia compatibilidades do catálogo (sugeridas); isso é no Gerenciador do ML.
- **Diagnósticos (só leitura, logado)**: `/api/diagnostico/compat?sku=AP-000013` (+ `&teste=Marca|Modelo|ini|fim` escreve),
  `/api/diagnostico/compat-todos[?refazer=1]` envia a compatibilidade de todos os publicados. Resultados na tabela `diagnosticos`.

## Fatos do ML aprendidos (evite redescobrir)
- `/items/validate` devolve 400 só com `warning` = aceito; só `type:"error"` reprova. PACKAGE_* não é editável: usar SELLER_PACKAGE_*.
- Frete: `/users/{id}/shipping_options/free` → `coverage.all_country.list_cost` (valor pago após desconto). R$ 0,00 devolvido é tratado
  como desconhecido na calculadora (o ML mostrava "a pagar R$ 19,05" no AP-000013; investigar).
- Itens são criados pausados até as fotos baixarem; status real é sincronizado ao abrir a lista/o produto.
- O sandbox da Claude não acessa sites do ML; a documentação foi lida por PDFs que o usuário baixou. Existe um MCP de documentação do
  ML (`https://mcp.mercadolibre.com/devsite/v1/mcp`): se o usuário o conectou em claude.ai/customize/connectors, use-o.

## Pendências / próximos passos
1. Conferir no ML se o aviso `incomplete_compatibilities` sumiu dos anúncios com compatibilidade enviada (pode demorar).
2. AP-000010 (Fusca): confirmar os veículos no rascunho e enviar a compatibilidade.
3. Investigar o frete R$ 0,00 da calculadora (ver `/api/diagnostico/compat?sku=AP-000013`, campo `frete_calculadora`).
4. Testar a fila de ponta a ponta com produto novo e com vários produtos; acompanhar fotos/fundo pelo Replicate (comparar com o
   BiRefNet se os parafusos finos sumirem).
5. Decisões adiadas pelo usuário: Vercel Pro (Hobby é não comercial), plano da SerpApi, backup do Supabase (free não tem).
6. Ideias: ativar/pausar anúncio pelo app, custo da peça na calculadora (lucro), estoque central, importar anúncios feitos fora do app,
   título/fotos no botão "Atualizar com o rascunho salvo".
