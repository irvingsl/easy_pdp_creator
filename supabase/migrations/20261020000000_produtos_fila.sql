alter table public.produtos
  add column if not exists fila_etapa text check (fila_etapa in ('fundo','identificar','rascunho','revisar','pronto','erro')),
  add column if not exists fila_erro text,
  add column if not exists fila_atualizado_em timestamptz not null default now();
create index if not exists produtos_fila_idx on public.produtos (fila_etapa, fila_atualizado_em) where fila_etapa in ('fundo','identificar','rascunho');
