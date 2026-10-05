create table public.materials (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  file_path text not null unique,
  file_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.materials is 'PDFs (apresentações, tabelas de valores) que a IA pode enviar aos clientes. Os arquivos ficam no bucket "materiais".';
comment on column public.materials.description is 'O que o PDF contém e quando enviar — é o que a IA lê para decidir.';
comment on column public.materials.file_path is 'Caminho do arquivo dentro do bucket "materiais".';
comment on column public.materials.file_name is 'Nome do arquivo que o cliente vê no WhatsApp.';

alter table public.materials enable row level security;
create policy authenticated_full_access on public.materials
  for all to authenticated using (true) with check (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('materiais', 'materiais', false, 52428800, array['application/pdf']);

create policy materiais_authenticated_full_access on storage.objects
  for all to authenticated
  using (bucket_id = 'materiais')
  with check (bucket_id = 'materiais');
