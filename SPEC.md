# Projeto: Assistente de anúncios para o Mercado Livre (nicho: autopeças)

## Visão

Um app web mobile-first que ajuda vendedores a criar anúncios no Mercado Livre (ML) a partir de fotos do produto. O usuário envia fotos, o app identifica a peça (com ajuda do usuário), padroniza as imagens com fundo branco, sugere o preenchimento do anúncio e publica no ML via API.

Futuro: reaproveitar a mesma estrutura para Shopee, Amazon e outros marketplaces.

## Público e nicho

- Início: o próprio autor e vendedores de **peças de carro**.
- Vantagem do nicho: peças têm **número de identificação (OEM/fabricante)** gravado ou em etiqueta, identificador muito mais confiável que reconhecimento visual.

## Fluxo do MVP

1. **Login com Mercado Livre** (OAuth).
2. **Captura livre de fotos:** câmera ou galeria, quantas quiser. Dica leve na tela: "inclua o número gravado na peça, se tiver" (não obrigatório).
3. **Identificação incremental** (IA de visão):
   - Lê o código da peça nas fotos (OCR), se visível.
   - Busca no catálogo do ML e mostra de 3 a 5 candidatos: "qual se parece mais?".
   - Se nada servir, pergunta palavras-chave.
   - Se ainda falhar, o usuário preenche manualmente.
   - Nem todo produto será reconhecido; o fallback manual é parte do produto.
4. **Fotos sugeridas (opcional, após identificar):** lista fixa por categoria (ex.: farol → traseira com encaixes, etiqueta com código, vista lateral). Sem IA, barato e previsível.
5. **Fundo removido** e imagem padronizada em fundo branco (o ML exige foto principal com fundo branco, sem logos, bordas ou textos).
6. **Rascunho do anúncio** gerado por IA: título, categoria, atributos obrigatórios, descrição, compatibilidade com veículos (se aplicável). Usuário revisa e ajusta.
7. **Publicação** no ML via API.

## Fora do MVP (depois)

- **Preço de mercado** (mínimo, médio, máximo) de anúncios existentes.
- Outros marketplaces (Shopee, Amazon...).
- Edição/gestão de anúncios já publicados.

## Pontos de atenção e riscos

1. **Preços via API do ML:** o endpoint público `GET /sites/MLB/search` vem retornando **403** em muitos casos desde ~2025. O endpoint de catálogo (`/products/search`, com token) identifica produtos, mas pode não trazer distribuição de preços dos anúncios. **Testar cedo.**
2. **Google Shopping para preço:** raspar diretamente viola os termos e quebra com frequência. Se necessário, usar API paga de terceiros (ex.: SerpApi). Fica para depois do MVP.
3. **Publicação via API do ML:** exige app criado no DevCenter, OAuth com escopo de leitura e escrita, categoria e atributos obrigatórios corretos e, em muitos casos, publicação via catálogo. Regras diferem entre pessoa física e jurídica. Consultar: https://developers.mercadolivre.com.br
4. **Compatibilidade de veículos (autopeças):** o ML pode pedir ou valorizar a lista de carros compatíveis (marca, modelo, ano). **Verificar na documentação**; pode ser o passo mais trabalhoso.
5. **Imagens na API:** as URLs das imagens precisam ser publicamente acessíveis pelo ML (erro 403 comum quando o host bloqueia). JPG/PNG funcionam normalmente.
6. **Erros da IA:** a identificação pode errar com confiança. Sempre exigir confirmação do usuário antes de publicar; erros custam reputação no ML.

## Stack sugerida

- **Frontend/backend:** Next.js (PWA mobile-first; a câmera funciona no navegador).
- **Hospedagem:** Vercel.
- **Banco/auth/storage:** Supabase (contas, tokens do ML, rascunhos, imagens).
- **IA:** Claude (visão e texto) para ler o código, sugerir candidatos e gerar título/descrição/atributos.
- **Remoção de fundo:** API de terceiros (ex.: remove.bg, Photoroom) ou modelo open source.
- **Arquitetura:** isolar o marketplace atrás de uma interface (`MarketplaceAdapter`: autenticar, buscar categoria, buscar atributos, publicar), para facilitar Shopee/Amazon depois.

## Concorrência (pesquisa superficial, out/2026)

- Remoção de fundo/imagens: Nuvemshop, Photoroom, WeShop e outros.
- ML tem IA própria: editor de imagens com IA generativa, gerador de títulos/descrições, assistente para vendedores.
- ERPs (ex.: UpSeller) têm IA para título, descrição e atributos.
- Enjoei lançou upload com IA (descrição + sugestão de preço), mas só para o Enjoei.
- Não encontrei um fluxo completo foto → identificação → anúncio publicado no ML, mas vale pesquisar mais.

## Ordem de implementação sugerida

1. Esqueleto do app, upload de fotos e armazenamento.
2. Remoção de fundo e padronização de imagem.
3. Identificação por IA (OCR do código + candidatos + fallback manual).
4. Rascunho do anúncio com IA e tela de revisão.
5. App no DevCenter do ML, OAuth e publicação.
6. Spike separado: testar o que a API de catálogo do ML devolve (produto, categoria, atributos, preços).

## Visão futura: estoque centralizado (mini-ERP)

Ideia: o sistema vira a **fonte da verdade do estoque** de quem vende em vários marketplaces. Se uma peça é vendida no ML, o estoque baixa também na Shopee, Amazon etc.

**Não construir agora**, mas preparar o terreno com custo quase zero:

### Decisões do MVP que já viabilizam isso

- **Separar Produto de Anúncio no modelo de dados:**
  - `Produto`: a peça física (SKU interno, número OEM/fabricante, estoque, fotos, dados base).
  - `Anúncio`: o produto publicado em um canal específico (marketplace, ID externo, preço, status). Um produto tem N anúncios.
- **Gerar e guardar um SKU interno** desde o primeiro anúncio criado.
- **Incluir estoque no `MarketplaceAdapter`**, além de publicar: `getStock(listing)` e `updateStock(listing, qty)`.
- Guardar o **ID externo do anúncio** em cada marketplace e o **usuário/conta** a que pertence (preparar para multi-conta).

### Esboço do modelo de dados

- `produtos(id, user_id, sku, oem_code, titulo_base, descricao_base, estoque, criado_em)`
- `produto_fotos(id, produto_id, url_original, url_processada, ordem)`
- `anuncios(id, produto_id, marketplace, external_id, preco, status, ultimo_sync_em)`
- `contas_marketplace(id, user_id, marketplace, tokens_criptografados, expira_em)`
- `movimentacoes_estoque(id, produto_id, delta, motivo, origem, criado_em)` (histórico: venda, ajuste, devolução)

### Como seria a sincronização (fase futura)

1. Receber vendas via **webhooks/notificações** de cada marketplace.
2. Baixar o estoque central (registrando em `movimentacoes_estoque`).
3. Atualizar a quantidade nos demais canais pela API.
4. Rodar uma **verificação periódica** (webhooks podem falhar ou atrasar) que reconcilia o estoque central com cada canal.

### Riscos conhecidos

- **Venda simultânea da última unidade** em dois canais. Mitigações: estoque de segurança (anunciar 2 quando houver 3), tratamento rápido de cancelamento.
- **Concorrência madura** no Brasil (Bling, Tiny, UpSeller e outros). O diferencial é a criação de anúncio por foto, focada em autopeças. Nota fiscal, etiquetas de envio e financeiro só se houver demanda real.

## Prompt inicial sugerido para o Claude Code

> Leia o SPEC.md. Vamos construir o MVP em etapas. Comece pelas etapas 1 e 2 da ordem de implementação (esqueleto em Next.js + Supabase, upload de fotos e remoção de fundo). Já no modelo de dados, siga a separação Produto/Anúncio descrita em "Visão futura: estoque centralizado". Antes de codar, proponha a estrutura de pastas e o modelo de dados, e me pergunte o que for necessário.
