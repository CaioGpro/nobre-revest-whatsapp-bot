import { supabase } from './supabase.js';

/**
 * Busca um contato pelo JID do WhatsApp, criando um novo se não existir.
 */
export async function getOrCreateContact(jid, name, phone) {
  const { data: existing, error: findError } = await supabase
    .from('contacts')
    .select('*')
    .eq('whatsapp_jid', jid)
    .maybeSingle();

  if (findError) throw findError;
  if (existing) return existing;

  const { data: created, error: insertError } = await supabase
    .from('contacts')
    .insert({ whatsapp_jid: jid, name, phone })
    .select('*')
    .single();

  if (insertError) throw insertError;
  return created;
}

/**
 * Busca a conversa mais recente e ainda aberta do contato, ou cria uma nova
 * caso não exista nenhuma (ou a última esteja fechada/perdida).
 */
export async function getOrCreateOpenConversation(contactId) {
  const { data: existing, error: findError } = await supabase
    .from('conversations')
    .select('*')
    .eq('contact_id', contactId)
    .in('status', ['novo', 'em_andamento', 'aguardando_humano'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (findError) throw findError;
  if (existing) return existing;

  const { data: created, error: insertError } = await supabase
    .from('conversations')
    .insert({ contact_id: contactId, status: 'novo' })
    .select('*')
    .single();

  if (insertError) throw insertError;
  return created;
}

export async function insertMessage({
  conversationId,
  direction,
  sender,
  content,
  whatsappMessageId,
}) {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      direction,
      sender,
      content,
      whatsapp_message_id: whatsappMessageId,
    })
    .select('*')
    .single();

  if (error) throw error;

  await supabase
    .from('conversations')
    .update({
      last_message_at: new Date().toISOString(),
      status: sender === 'cliente' ? 'em_andamento' : undefined,
    })
    .eq('id', conversationId);

  return data;
}

/**
 * Retorna as últimas N mensagens da conversa, em ordem cronológica, no
 * formato esperado pela API da Anthropic (role: 'user' | 'assistant').
 */
export async function getConversationHistory(conversationId, limit = 20) {
  const { data, error } = await supabase
    .from('messages')
    .select('direction, sender, content, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  return data
    .reverse()
    .map((m) => ({
      role: m.direction === 'entrada' ? 'user' : 'assistant',
      content: m.content,
    }));
}

/**
 * Retorna a base de conhecimento ativa (preços, serviços, FAQ) para montar
 * o contexto que a IA usa para responder.
 */
export async function getActiveKnowledgeBase() {
  const { data, error } = await supabase
    .from('knowledge_base')
    .select('category, title, content')
    .eq('active', true);

  if (error) throw error;
  return data;
}

export async function getConversationStatus(conversationId) {
  const { data, error } = await supabase
    .from('conversations')
    .select('status')
    .eq('id', conversationId)
    .single();

  if (error) throw error;
  return data.status;
}
