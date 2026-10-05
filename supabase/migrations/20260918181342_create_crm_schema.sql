-- Tipos enumerados
create type conversation_status as enum (
  'novo',
  'em_andamento',
  'aguardando_humano',
  'fechado',
  'perdido'
);

create type message_direction as enum ('entrada', 'saida');
create type message_sender as enum ('cliente', 'ia', 'humano');

-- Contatos (clientes que já mandaram mensagem pelo WhatsApp)
create table contacts (
  id uuid primary key default gen_random_uuid(),
  whatsapp_jid text unique not null, -- ex: 5522999999999@s.whatsapp.net
  phone text,
  name text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Conversas (uma por contato; pode ser reaberta trocando status)
create table conversations (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  status conversation_status not null default 'novo',
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_conversations_contact on conversations(contact_id);
create index idx_conversations_status on conversations(status);

-- Mensagens de cada conversa
create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  direction message_direction not null,
  sender message_sender not null,
  content text not null,
  whatsapp_message_id text,
  created_at timestamptz not null default now()
);

create index idx_messages_conversation on messages(conversation_id, created_at);

-- Base de conhecimento da Nobre Revest para a IA usar como contexto
create table knowledge_base (
  id uuid primary key default gen_random_uuid(),
  category text not null, -- ex: 'servico', 'preco', 'faq', 'empresa_info'
  title text not null,
  content text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Configurações gerais da IA/atendimento (chave/valor simples)
create table settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- Trigger genérica para manter updated_at em dia
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_contacts_updated_at
  before update on contacts
  for each row execute function set_updated_at();

create trigger trg_conversations_updated_at
  before update on conversations
  for each row execute function set_updated_at();

create trigger trg_knowledge_base_updated_at
  before update on knowledge_base
  for each row execute function set_updated_at();
