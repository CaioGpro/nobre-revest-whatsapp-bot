import 'dotenv/config';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  areJidsSameUser,
  isJidUser,
  isLidUser,
  jidNormalizedUser,
} from '@whiskeysockets/baileys';

import { supabase } from './supabase.js';
import {
  getOrCreateContact,
  syncContactIdentities,
  getOrCreateOpenConversation,
  insertMessage,
  messageExists,
  pauseConversation,
  getSetting,
  setPendingDecision,
  clearPendingDecision,
  getPendingDecisionConversations,
  getLastClientMessage,
  insertKnowledge,
  getPendingManualMessages,
  claimManualMessage,
  releaseManualMessage,
  setWhatsappMessageId,
  getConversationJid,
} from './db.js';
import { generateReply, learnFromCaio } from './ai.js';

const AUTO_RESPOND = (process.env.AUTO_RESPOND ?? 'true') === 'true';
const AUTH_DIR = 'auth_session'; // guarda a sessão do WhatsApp entre reinícios
const LEMBRETE_HORAS_PADRAO = 2;

const logger = pino({ level: 'info' });

let sock; // conexão atual com o WhatsApp (é recriada a cada reconexão)
const sentByBot = new Set(); // ids das mensagens que o próprio bot enviou
const lastNotified = new Map(); // conversa → quando o Caio foi avisado da decisão pendente

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }), // silencia logs internos verbosos do Baileys
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\nEscaneie o QR code abaixo com o WhatsApp (Aparelhos conectados):\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      logger.warn(
        { statusCode },
        `Conexão encerrada. Reconectar? ${shouldReconnect}`
      );
      if (shouldReconnect) {
        startBot();
      } else {
        logger.error(
          'Sessão desconectada (logout). Apague a pasta auth_session e escaneie o QR novamente.'
        );
      }
    } else if (connection === 'open') {
      logger.info('✅ Conectado ao WhatsApp com sucesso.');
      sendPendingManualMessages().catch((err) =>
        logger.error({ err }, 'Erro ao enviar mensagens manuais pendentes')
      );
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        await handleMessage(msg);
      } catch (err) {
        logger.error({ err }, 'Erro ao processar mensagem');
      }
    }
  });

  // O WhatsApp informa o número e o @lid de cada contato (e o nome salvo na
  // agenda); usamos isso para completar os contatos já cadastrados.
  const onContacts = (contacts) => {
    const useful = contacts.filter((c) => c.lid || c.name);
    if (!useful.length) return;
    syncContactIdentities(useful).catch((err) =>
      logger.error({ err }, 'Erro ao atualizar identificadores dos contatos')
    );
  };
  sock.ev.on('contacts.upsert', onContacts);
  sock.ev.on('contacts.update', onContacts);
  sock.ev.on('chats.phoneNumberShare', ({ lid, jid }) => onContacts([{ id: jid, lid }]));
}

function extractText(msg) {
  return (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    null
  );
}

function isOwnChat(jid) {
  return areJidsSameUser(jid, sock.user?.id) || areJidsSameUser(jid, sock.user?.lid);
}

async function sendText(jid, text) {
  const sent = await sock.sendMessage(jid, { text });
  sentByBot.add(sent.key.id);
  return sent;
}

async function handleMessage(msg) {
  const jid = msg.key.remoteJid;
  // Só conversas 1:1: ignora grupos, status, listas de transmissão e canais.
  if (!jid || !(isJidUser(jid) || isLidUser(jid))) return;

  const text = extractText(msg);
  if (!text) return; // ignora áudios, figurinhas, etc. por enquanto

  // A conversa do Caio com o próprio número é o canal dele com o bot.
  if (isOwnChat(jid)) {
    if (msg.key.fromMe && !sentByBot.has(msg.key.id)) await handleCaioChat(msg, text);
    return;
  }

  if (msg.key.fromMe) {
    await handleOwnMessage(msg, jid, text);
  } else {
    // Nas mensagens recebidas vem também o outro identificador do contato
    // (o número, se a conversa está pelo @lid, e vice-versa).
    const altJid = isLidUser(jid) ? msg.key.senderPn : msg.key.senderLid;
    await handleClientMessage(msg, [jid, altJid].filter(Boolean), text);
  }
}

/**
 * Mensagem que o Caio mandou pelo próprio celular: fica registrada no painel
 * e o bot para de responder nessa conversa por um tempo, já que ele assumiu.
 */
async function handleOwnMessage(msg, jid, text) {
  if (sentByBot.has(msg.key.id) || (await messageExists(msg.key.id))) return;

  const contact = await getOrCreateContact([jid], null);
  if (contact.is_personal) return;

  // Se ainda não havia conversa aberta, foi o Caio quem começou: o bot nunca
  // responde nela.
  const conversation = await getOrCreateOpenConversation(contact.id, { startedByCaio: true });

  await insertMessage({
    conversationId: conversation.id,
    direction: 'saida',
    sender: 'humano',
    content: text,
    whatsappMessageId: msg.key.id,
  });

  // Se a conversa esperava uma decisão, a resposta do Caio ao cliente também
  // vira conhecimento para a IA.
  if (conversation.pending_decision_at) await learnAndClear(conversation, text);

  const until = await pauseConversation(conversation.id);
  console.log(`[${contactLabel(contact)}] Caio respondeu pelo celular — bot pausado até ${until.toLocaleString('pt-BR')}.`);
}

async function handleClientMessage(msg, jids, text) {
  if (await messageExists(msg.key.id)) return; // já processada

  const contact = await getOrCreateContact(jids, msg.pushName || null);
  if (contact.is_personal) return; // família/amigos: não grava nem responde

  const conversation = await getOrCreateOpenConversation(contact.id);

  await insertMessage({
    conversationId: conversation.id,
    direction: 'entrada',
    sender: 'cliente',
    content: text,
    whatsappMessageId: msg.key.id,
  });

  const quietReason = whyBotIsQuiet(conversation);
  if (quietReason) {
    console.log(`[${contactLabel(contact)}] ${quietReason} — IA não respondeu.`);
    return;
  }

  const result = await generateReply(conversation.id, text);
  if (!result) return;

  // A IA não sabe responder: o cliente fica esperando e a pergunta vai para o
  // Caio na conversa dele.
  if (result.type === 'decision') {
    await setPendingDecision(conversation.id);
    await notifyCaio(conversation, contact, result.question);
    console.log(`[${contactLabel(contact)}] pergunta enviada ao Caio — cliente aguardando decisão.`);
    return;
  }

  await deliverReply(conversation, contact, msg.key.remoteJid, result.text);
}

/**
 * Envia a resposta da IA ao cliente e grava no histórico. Com
 * AUTO_RESPOND=false, só grava como sugestão não enviada.
 */
async function deliverReply(conversation, contact, jid, text) {
  if (!AUTO_RESPOND) {
    await insertMessage({
      conversationId: conversation.id,
      direction: 'saida',
      sender: 'ia',
      content: text,
      sent: false,
    });
    console.log(`[${contactLabel(contact)}] resposta da IA gravada no banco (AUTO_RESPOND=false, não enviada).`);
    return;
  }

  const sent = await sendText(jid, text);
  await insertMessage({
    conversationId: conversation.id,
    direction: 'saida',
    sender: 'ia',
    content: text,
    whatsappMessageId: sent.key.id,
  });
  console.log(`[${contactLabel(contact)}] respondido automaticamente pela IA.`);
}

function whyBotIsQuiet(conversation) {
  if (conversation.started_by_caio) return 'conversa iniciada pelo Caio';
  if (conversation.status === 'aguardando_humano') return 'aguardando atendimento humano';
  if (conversation.pending_decision_at) return 'esperando decisão do Caio';
  if (conversation.bot_paused_until && new Date(conversation.bot_paused_until) > new Date()) {
    return 'bot pausado (o Caio assumiu)';
  }
  return null;
}

function contactLabel(contact) {
  return contact.saved_name || contact.name || contact.phone || contact.whatsapp_jid;
}

async function sendToCaio(text) {
  return sendText(jidNormalizedUser(sock.user.id), text);
}

/**
 * Pergunta ao Caio, na conversa com o próprio número, como responder. O
 * "ref" no fim identifica a conversa quando ele responde citando a mensagem.
 */
async function notifyCaio(conversation, contact, question, { reminder = false } = {}) {
  const label = contactLabel(contact);
  const who = contact.phone && label !== contact.phone ? `${label} (${contact.phone})` : label;
  const header = reminder ? '⏰ *Ainda espero sua decisão*' : '❓ *Preciso da sua decisão*';

  await sendToCaio(
    `${header} — ${who}\n${question}\n\n` +
      'Responda *citando esta mensagem* com o que devo dizer. Eu envio ao cliente e guardo para as próximas vezes.\n' +
      `ref ${conversation.id.slice(0, 8)}`
  );
  lastNotified.set(conversation.id, Date.now());
}

function quotedText(msg) {
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  return quoted?.conversation || quoted?.extendedTextMessage?.text || null;
}

/**
 * Mensagem do Caio na conversa com o próprio número. Por enquanto só conta a
 * resposta a uma decisão pendente, feita citando a pergunta do bot; o resto
 * são anotações dele e é ignorado.
 */
async function handleCaioChat(msg, text) {
  const ref = quotedText(msg)?.match(/ref ([0-9a-f]{8})/);
  if (!ref) return;

  const pending = await getPendingDecisionConversations();
  const conversation = pending.find((c) => c.id.startsWith(ref[1]));
  if (!conversation) {
    await sendToCaio('Essa decisão já foi resolvida.');
    return;
  }

  const { contact } = conversation;
  const learned = await learnAndClear(conversation, text);

  const result = await generateReply(conversation.id, null, { caioAnswer: text });
  if (result?.type === 'reply') {
    await deliverReply(conversation, contact, contact.whatsapp_jid, result.text);
  }

  const sentNote = result?.type === 'reply'
    ? (AUTO_RESPOND ? 'Respondi o cliente' : 'Resposta gravada no painel (AUTO_RESPOND=false)')
    : 'Não consegui montar a resposta ao cliente';
  const learnedNote = learned ? `e aprendi: "${learned.title}"` : 'mas não consegui guardar o aprendizado';
  await sendToCaio(`✅ ${contactLabel(contact)}: ${sentNote} ${learnedNote}.`);
}

/**
 * Tira a conversa da espera e transforma a resposta do Caio em um item da
 * base de conhecimento. Uma falha ao aprender não impede o resto.
 */
async function learnAndClear(conversation, answer) {
  await clearPendingDecision(conversation.id);
  lastNotified.delete(conversation.id);

  try {
    const item = await learnFromCaio(conversation.id, answer);
    await insertKnowledge(item);
    console.log(`Aprendido com o Caio: "${item.title}" (${item.category}).`);
    return item;
  } catch (err) {
    logger.error({ err }, 'Erro ao aprender com a resposta do Caio');
    return null;
  }
}

/**
 * Lembra o Caio das decisões paradas a cada "lembrete_decisao_horas" horas
 * (tabela settings, padrão 2).
 */
async function remindPendingDecisions() {
  if (!sock?.user) return;

  const hours = Number(await getSetting('lembrete_decisao_horas', LEMBRETE_HORAS_PADRAO));
  const interval = hours * 60 * 60 * 1000;

  for (const conversation of await getPendingDecisionConversations()) {
    const last = lastNotified.get(conversation.id) ?? new Date(conversation.pending_decision_at).getTime();
    if (Date.now() - last < interval) continue;

    const lastMessage = await getLastClientMessage(conversation.id);
    await notifyCaio(
      conversation,
      conversation.contact,
      `Última mensagem do cliente: "${lastMessage ?? '(sem texto)'}"`,
      { reminder: true }
    );
  }
}

/**
 * Mensagens escritas no painel nascem com sent=false; o bot envia pelo
 * WhatsApp, marca como enviadas e pausa a IA nessa conversa.
 */
async function sendManualMessage(message) {
  if (message.sender !== 'humano' || message.sent) return;
  if (!sock?.user) return; // desconectado: é enviada quando reconectar
  if (!(await claimManualMessage(message.id))) return; // já está sendo enviada

  try {
    const jid = await getConversationJid(message.conversation_id);
    const sent = await sendText(jid, message.content);
    await setWhatsappMessageId(message.id, sent.key.id);
    await pauseConversation(message.conversation_id);
    console.log(`[painel] mensagem manual enviada para ${jid}.`);
  } catch (err) {
    await releaseManualMessage(message.id);
    throw err;
  }
}

async function sendPendingManualMessages() {
  for (const message of await getPendingManualMessages()) {
    await sendManualMessage(message);
  }
}

function listenForManualMessages() {
  supabase
    .channel('mensagens-manuais')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: 'sent=eq.false' },
      ({ new: message }) =>
        sendManualMessage(message).catch((err) =>
          logger.error({ err }, 'Erro ao enviar mensagem manual do painel')
        )
    )
    .subscribe();
}

listenForManualMessages();
setInterval(
  () => remindPendingDecisions().catch((err) => logger.error({ err }, 'Erro ao lembrar decisões pendentes')),
  10 * 60 * 1000
);
startBot().catch((err) => {
  console.error('Erro fatal ao iniciar o bot:', err);
  process.exit(1);
});
