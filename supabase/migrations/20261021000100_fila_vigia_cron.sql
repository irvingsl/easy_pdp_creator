-- Aplicada no projeto Supabase como "fila_vigia_cron": vigia que retoma a fila a cada minuto se algum produto ficar parado.
create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.fila_config (
  chave text primary key,
  valor text not null
);
alter table public.fila_config enable row level security;
revoke all on public.fila_config from anon, authenticated;
insert into public.fila_config (chave, valor)
  values ('segredo', encode(gen_random_bytes(24), 'hex'))
  on conflict (chave) do nothing;

create or replace function public.fila_vigiar() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  origem text;
  segredo text;
begin
  select valor into origem from fila_config where chave = 'origem';
  select valor into segredo from fila_config where chave = 'segredo';
  if origem is null or segredo is null then return; end if;
  if exists (
    select 1 from produtos
    where fila_etapa in ('identificar','rascunho')
      and (fila_lease is null or fila_lease < now())
      and fila_atualizado_em < now() - interval '20 seconds'
  ) then
    perform net.http_post(
      url := origem || '/api/fila/retomar',
      headers := jsonb_build_object('content-type', 'application/json', 'x-fila-cron', segredo),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    );
  end if;
end $$;
revoke all on function public.fila_vigiar() from public, anon, authenticated;

select cron.schedule('fila-vigia', '* * * * *', 'select public.fila_vigiar()');
