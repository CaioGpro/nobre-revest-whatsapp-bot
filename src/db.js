import { supabase } from './supabase.js';

const PAUSA_HORAS_PADRAO = 24;

function phoneFromJids(jids) {
  const pn = jids.find((j) => j.endsWith('@s.whatsapp.net'));
  return pn ? pn.split('@')[0] : null;
}

/**
 * Busca o contato por qualquer um dos identificadores do WhatsApp. O mesmo
 * contato pode aparecer pelo número (@s.whatsapp.net) ou pelo @lid, então
 * procuramos nas duas colunas.
 */
export async function findContactByJids(jids) {
  const list = jids.map((j) => `"${j}"`).join(',');
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .or(`whatsapp_jid.in.(${list}),alt_jid.in.(${list})`)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Guarda no contato o identificador que ainda faltava (número ou @lid) e o
 * telefone, se ainda não estiverem salvos.
 */
async function fillMissingIdentity(contact, jids) {
  const known = [contact.whatsapp_jid, contact.alt_jid];
  const missingJid = jids.find((j) => !known.includes(j));
  const phone = phoneFromJids(jids);

  const changes = {};
  if (missingJid && !contact.alt_jid) changes.alt_jid = missingJid;
  if (phone && !contact.phone) changes.phone = phone;
  if (!Object.keys(changes).length) return contact;

  const { data, error } = await supabase
    .from('contacts')
    .update(changes)
    .eq('id', contact.id)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

/**
 * Busca o contato por qualquer um dos identificadores, criando um novo se
 * não existir. O primeiro identificador da lista é o principal.
 */
export async function getOrCreateContact(jids, name) {
  const existing = await findContactByJids(jids);
  if (existing) return fillMissingIdentity(existing, jids);

  const { data: created, error } = await supabase
    .from('contacts')
    .insert({
      whatsapp_jid: jids[0],
      alt_jid: jids[1] ?? null,
      name,
      phone: phoneFromJids(jids),
    })
    .select('*')
    .single();

  if (error) throw error;
  return created;
}

/**
 * Atualiza os contatos já cadastrados com o que o WhatsApp informa: o outro
 * identificador (número ou @lid) e o nome salvo na agenda do celular do Caio.
 * Contatos que ainda não estão no banco são ignorados.
 */
export async function syncContactIdentities(waContacts) {
  const { data: contacts, error } = await supabase
    .from('contacts')
    .select('id, whatsapp_jid, alt_jid, saved_name, phone');

  if (error) throw error;

  for (const contact of contacts) {
    const known = [contact.whatsapp_jid, contact.alt_jid].filter(Boolean);
    const match = waContacts.find(
      (c) => known.includes(c.id) || (c.lid && known.includes(c.lid))
    );
    if (!match) continue;

    const jids = [match.id, match.lid].filter(Boolean);
    const missingJid = jids.find((j) => !known.includes(j));
    const phone = phoneFromJids(jids);

    const changes = {};
    if (missingJid && !contact.alt_jid) changes.alt_jid = missingJid;
    if (phone && !contact.phone) changes.phone = phone;
    if (match.name && match.name !== contact.saved_name) changes.saved_name = match.name;
    if (!Object.keys(changes).length) continue;

    const { error: updateError } = await supabase
      .from('contacts')
      .update(changes)
      .eq('id', contact.id);

    if (updateError) throw updateError;
  }
}

/**
 * Busca a conversa mais recente e ainda aberta do contato, ou cria uma nova
 * caso não exista nenhuma (ou a última esteja fechada/perdida).
 */
export async function getOrCreateOpenConversation(contactId, { startedByCaio = false } = {}) {
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
    .insert({ contact_id: contactId, status: 'novo', started_by_caio: startedByCaio })
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
  sent = true,
}) {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      direction,
      sender,
      content,
      whatsapp_message_id: whatsappMessageId,
      sent,
    })
    .select('*')
    .single();

  if (error) throw error;

  await supabase
    .from('conversations')
    .update({ last_message_at: new Date().toISOString() })
    .eq('id', conversationId);

  // Só tira do status "novo"; não sobrescreve "aguardando_humano", que é o
  // que faz a IA parar de responder.
  if (sender === 'cliente') {
    await supabase
      .from('conversations')
      .update({ status: 'em_andamento' })
      .eq('id', conversationId)
      .eq('status', 'novo');
  }

  return data;
}

/**
 * Indica se a mensagem do WhatsApp já foi gravada (evita processar ou
 * responder duas vezes a mesma mensagem).
 */
export async function messageExists(whatsappMessageId) {
  const { data, error } = await supabase
    .from('messages')
    .select('id')
    .eq('whatsapp_message_id', whatsappMessageId)
    .limit(1);

  if (error) throw error;
  return data.length > 0;
}

/**
 * Retorna as últimas N mensagens da conversa, em ordem cronológica, no
 * formato esperado pela API da Anthropic (role: 'user' | 'assistant').
 */
export async function getConversationHistory(conversationId, limit = 40) {
  // Só o que o cliente de fato viu: sugestões da IA não enviadas
  // (AUTO_RESPOND=false) e mensagens do painel ainda pendentes ficam de fora.
  const { data, error } = await supabase
    .from('messages')
    .select('direction, sender, content, created_at')
    .eq('conversation_id', conversationId)
    .eq('sent', true)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  const history = data
    .reverse()
    .map((m) => ({
      role: m.direction === 'entrada' ? 'user' : 'assistant',
      content: m.content,
    }));

  // A API da Anthropic espera que a conversa comece por uma mensagem do
  // cliente; o corte em N mensagens pode começar no meio de uma resposta nossa.
  const firstUser = history.findIndex((m) => m.role === 'user');
  return firstUser === -1 ? [] : history.slice(firstUser);
}

/**
 * Retorna a base de conhecimento ativa (preços, serviços, FAQ) para montar
 * o contexto que a IA usa para responder.
 */
export async function getActiveKnowledgeBase() {
  const { data, error } = await supabase
    .from('knowledge_base')
    .select('category, title, content')
    .eq('active', true)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data;
}

/**
 * Lê uma configuração da tabela settings, com valor padrão se não existir.
 */
export async function getSetting(key, fallback) {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();

  if (error) throw error;
  return data?.value ?? fallback;
}

/**
 * O Caio assumiu a conversa: o bot fica sem responder nela por algumas horas
 * (configuração "pausa_horas", padrão 24).
 */
export async function pauseConversation(conversationId) {
  const hours = Number(await getSetting('pausa_horas', PAUSA_HORAS_PADRAO));
  const until = new Date(Date.now() + hours * 60 * 60 * 1000);

  const { error } = await supabase
    .from('conversations')
    .update({ bot_paused_until: until.toISOString() })
    .eq('id', conversationId);

  if (error) throw error;
  return until;
}

/**
 * Marca que a conversa espera uma decisão do Caio (mantém o horário da
 * primeira vez, que é o que conta para o lembrete).
 */
export async function setPendingDecision(conversationId) {
  const { error } = await supabase
    .from('conversations')
    .update({ pending_decision_at: new Date().toISOString() })
    .eq('id', conversationId)
    .is('pending_decision_at', null);

  if (error) throw error;
}

export async function clearPendingDecision(conversationId) {
  const { error } = await supabase
    .from('conversations')
    .update({ pending_decision_at: null })
    .eq('id', conversationId);

  if (error) throw error;
}

/**
 * Conversas esperando decisão do Caio, com o contato junto.
 */
export async function getPendingDecisionConversations() {
  const { data, error } = await supabase
    .from('conversations')
    .select('*, contact:contacts(*)')
    .not('pending_decision_at', 'is', null)
    .order('pending_decision_at', { ascending: true });

  if (error) throw error;
  return data;
}

export async function getLastClientMessage(conversationId) {
  const { data, error } = await supabase
    .from('messages')
    .select('content')
    .eq('conversation_id', conversationId)
    .eq('sender', 'cliente')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.content ?? null;
}

/**
 * Grava um item novo na base de conhecimento (o que a IA aprendeu com uma
 * decisão do Caio).
 */
export async function insertKnowledge({ category, title, content }) {
  const { data, error } = await supabase
    .from('knowledge_base')
    .insert({ category, title, content })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

/**
 * Mensagens manuais escritas no painel que ainda não foram enviadas.
 */
export async function getPendingManualMessages() {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('sender', 'humano')
    .eq('sent', false)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data;
}

/**
 * Marca a mensagem manual como enviada antes de enviar, para que dois avisos
 * da mesma mensagem não a enviem duas vezes. Retorna false se outro processo
 * já pegou essa mensagem.
 */
export async function claimManualMessage(messageId) {
  const { data, error } = await supabase
    .from('messages')
    .update({ sent: true })
    .eq('id', messageId)
    .eq('sent', false)
    .select('id');

  if (error) throw error;
  return data.length > 0;
}

export async function releaseManualMessage(messageId) {
  const { error } = await supabase
    .from('messages')
    .update({ sent: false })
    .eq('id', messageId);

  if (error) throw error;
}

export async function setWhatsappMessageId(messageId, whatsappMessageId) {
  const { error } = await supabase
    .from('messages')
    .update({ whatsapp_message_id: whatsappMessageId })
    .eq('id', messageId);

  if (error) throw error;
}

/**
 * Identificador do WhatsApp para onde enviar mensagens da conversa.
 */
export async function getConversationJid(conversationId) {
  const { data, error } = await supabase
    .from('conversations')
    .select('contacts(whatsapp_jid)')
    .eq('id', conversationId)
    .single();

  if (error) throw error;
  return data.contacts.whatsapp_jid;
}
