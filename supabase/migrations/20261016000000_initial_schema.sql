-- Aplicada no projeto Supabase "easy_pdp_creator" (sa-east-1) como "initial_schema".
create table public.produtos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sku text not null,
  oem_code text,
  titulo_base text,
  descricao_base text,
  estoque integer not null default 0 check (estoque >= 0),
  status text not null default 'rascunho' check (status in ('rascunho','ativo','arquivado')),
  criado_em timestamptz not null default now(),
  unique (user_id, sku)
);
create index produtos_user_idx on public.produtos (user_id, criado_em desc);

create table public.produto_fotos (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references public.produtos(id) on delete cascade,
  path_original text not null,
  path_processada text,
  status_processamento text not null default 'pendente' check (status_processamento in ('pendente','ok','erro')),
  ordem integer not null default 0,
  criado_em timestamptz not null default now()
);
create index produto_fotos_produto_idx on public.produto_fotos (produto_id, ordem);

create table public.contas_marketplace (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  marketplace text not null,
  external_user_id text,
  tokens_criptografados text,
  expira_em timestamptz,
  criado_em timestamptz not null default now(),
  unique (user_id, marketplace, external_user_id)
);

create table public.anuncios (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references public.produtos(id) on delete cascade,
  conta_id uuid references public.contas_marketplace(id) on delete set null,
  marketplace text not null,
  external_id text,
  preco numeric(12,2),
  status text not null default 'rascunho',
  ultimo_sync_em timestamptz,
  criado_em timestamptz not null default now()
);
create index anuncios_produto_idx on public.anuncios (produto_id);
create unique index anuncios_external_uidx on public.anuncios (marketplace, external_id) where external_id is not null;

create table public.movimentacoes_estoque (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references public.produtos(id) on delete cascade,
  delta integer not null,
  motivo text not null,
  origem text not null default 'manual',
  criado_em timestamptz not null default now()
);
create index movimentacoes_produto_idx on public.movimentacoes_estoque (produto_id, criado_em desc);

-- SKU sequencial por usuario (AP-000001)
create table public.sku_counters (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ultimo integer not null default 0
);

create function public.set_sku() returns trigger
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if new.sku is null or new.sku = '' then
    insert into public.sku_counters (user_id, ultimo) values (new.user_id, 1)
    on conflict (user_id) do update set ultimo = public.sku_counters.ultimo + 1
    returning ultimo into n;
    new.sku := 'AP-' || lpad(n::text, 6, '0');
  end if;
  return new;
end $$;

alter table public.produtos alter column sku drop not null;
create trigger produtos_set_sku before insert on public.produtos
  for each row execute function public.set_sku();
alter table public.produtos add constraint produtos_sku_not_null check (sku is not null) not valid;

-- estoque derivado das movimentacoes
create function public.apply_movimentacao() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.produtos set estoque = estoque + new.delta where id = new.produto_id;
  return new;
end $$;
create trigger movimentacoes_apply after insert on public.movimentacoes_estoque
  for each row execute function public.apply_movimentacao();

-- RLS
alter table public.produtos enable row level security;
alter table public.produto_fotos enable row level security;
alter table public.anuncios enable row level security;
alter table public.contas_marketplace enable row level security;
alter table public.movimentacoes_estoque enable row level security;
alter table public.sku_counters enable row level security;

create policy produtos_own on public.produtos for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy fotos_own on public.produto_fotos for all to authenticated
  using (exists (select 1 from public.produtos p where p.id = produto_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.produtos p where p.id = produto_id and p.user_id = auth.uid()));

create policy anuncios_own on public.anuncios for all to authenticated
  using (exists (select 1 from public.produtos p where p.id = produto_id and p.user_id = auth.uid()))
  with check (exists (select 1 from public.produtos p where p.id = produto_id and p.user_id = auth.uid()));

create policy movimentacoes_own on public.movimentacoes_estoque for select to authenticated
  using (exists (select 1 from public.produtos p where p.id = produto_id and p.user_id = auth.uid()));
create policy movimentacoes_insert on public.movimentacoes_estoque for insert to authenticated
  with check (exists (select 1 from public.produtos p where p.id = produto_id and p.user_id = auth.uid()));

-- contas_marketplace e sku_counters: sem policy => so service role acessa

-- Storage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('originais', 'originais', false, 10485760, array['image/jpeg','image/png','image/webp']),
  ('processadas', 'processadas', true, 10485760, array['image/jpeg','image/png','image/webp']);

create policy originais_own on storage.objects for all to authenticated
  using (bucket_id = 'originais' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'originais' and (storage.foldername(name))[1] = auth.uid()::text);

create policy processadas_own on storage.objects for all to authenticated
  using (bucket_id = 'processadas' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'processadas' and (storage.foldername(name))[1] = auth.uid()::text);
