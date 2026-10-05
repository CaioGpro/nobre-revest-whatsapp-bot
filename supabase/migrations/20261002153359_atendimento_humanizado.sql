alter table public.contacts
  add column if not exists is_personal boolean not null default false,
  add column if not exists saved_name text,
  add column if not exists alt_jid text;

comment on column public.contacts.is_personal is 'Família, amigos ou outro contato pessoal do Caio: o bot ignora e não grava mensagens.';
comment on column public.contacts.saved_name is 'Nome com que o Caio salvou o número na agenda do celular.';
comment on column public.contacts.alt_jid is 'O outro identificador do WhatsApp do mesmo contato (@lid ou número).';

create index if not exists contacts_alt_jid_idx on public.contacts (alt_jid);

alter table public.conversations
  add column if not exists lead jsonb not null default '{}'::jsonb,
  add column if not exists bot_paused_until timestamptz,
  add column if not exists started_by_caio boolean not null default false,
  add column if not exists follow_up_count integer not null default 0,
  add column if not exists last_follow_up_at timestamptz,
  add column if not exists pending_decision_at timestamptz;

comment on column public.conversations.lead is 'Ficha do lead montada pela IA (nome, serviços, medidas, etapa, avisos).';
comment on column public.conversations.bot_paused_until is 'O bot não responde nesta conversa até essa hora (o Caio assumiu).';
comment on column public.conversations.started_by_caio is 'Conversa iniciada pelo Caio: o bot nunca responde.';
comment on column public.conversations.pending_decision_at is 'Desde quando há uma decisão do Caio pendente (para lembrete).';

alter table public.messages
  add column if not exists media_path text,
  add column if not exists media_type text;

comment on column public.messages.media_path is 'Caminho do arquivo recebido no bucket "midias".';

create index if not exists messages_whatsapp_message_id_idx on public.messages (whatsapp_message_id);

insert into storage.buckets (id, name, public)
values ('midias', 'midias', false)
on conflict (id) do nothing;
