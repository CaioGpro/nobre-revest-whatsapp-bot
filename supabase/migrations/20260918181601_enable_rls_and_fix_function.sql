-- Corrige search_path mutável
alter function set_updated_at() set search_path = public;

-- Habilita RLS em todas as tabelas
alter table contacts enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table knowledge_base enable row level security;
alter table settings enable row level security;

-- Políticas: usuários autenticados (painel web) têm acesso total.
-- O backend do WhatsApp usa a service_role key, que ignora RLS automaticamente.
create policy "authenticated_full_access" on contacts
  for all to authenticated using (true) with check (true);

create policy "authenticated_full_access" on conversations
  for all to authenticated using (true) with check (true);

create policy "authenticated_full_access" on messages
  for all to authenticated using (true) with check (true);

create policy "authenticated_full_access" on knowledge_base
  for all to authenticated using (true) with check (true);

create policy "authenticated_full_access" on settings
  for all to authenticated using (true) with check (true);
