-- Tokens ficam criptografados (AES-256-GCM, chave so no servidor); o dono acessa a propria linha pela sessao.
create policy contas_own on public.contas_marketplace for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
