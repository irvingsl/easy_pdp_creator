alter table public.produtos
  add column identificacao jsonb,
  add column identificado_em timestamptz;
