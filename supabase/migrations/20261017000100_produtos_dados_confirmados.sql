alter table public.produtos
  add column dados_confirmados jsonb not null default '{}'::jsonb;
