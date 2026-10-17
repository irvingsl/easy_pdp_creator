-- Aplicada no projeto Supabase como "uso_ia": registro de cada chamada ao Gemini (tokens e buscas) para acompanhar o gasto.
create table public.uso_ia (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  produto_id uuid references public.produtos(id) on delete set null,
  etapa text,
  modelo text,
  grounded boolean not null default false,
  tokens_entrada integer,
  tokens_saida integer,
  buscas integer not null default 0,
  status integer,
  criado_em timestamptz not null default now()
);
create index uso_ia_user_idx on public.uso_ia (user_id, criado_em desc);
alter table public.uso_ia enable row level security;
create policy uso_ia_own on public.uso_ia for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
