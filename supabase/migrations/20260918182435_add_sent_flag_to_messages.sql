-- Marca se uma mensagem de saída já foi efetivamente enviada pelo WhatsApp.
-- Mensagens da IA/automáticas já nascem enviadas (sent=true, definido pelo bot).
-- Mensagens manuais criadas no painel nascem com sent=false; o bot escuta
-- essa tabela via Realtime e envia pelo WhatsApp, marcando sent=true depois.
alter table messages add column sent boolean not null default true;

-- Habilita Realtime na tabela de mensagens (necessário para o bot escutar
-- respostas manuais criadas no painel, e para o painel atualizar ao vivo)
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table conversations;
