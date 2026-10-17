-- Aplicada no projeto Supabase como "anuncios_resposta_criacao": resposta crua do ML na criacao, para diagnostico.
alter table public.anuncios add column if not exists resposta_criacao jsonb;
