-- Aplicada no projeto Supabase como "produtos_rascunho".
alter table public.produtos add column if not exists rascunho jsonb;
