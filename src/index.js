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
} from '@whiskeysockets/baileys';

import { supabase } from './supabase.js';
import {
  getOrCreateContact,
  syncContactIdentities,
  getOrCreateOpenConversation,
  insertMessage,
  messageExists,
  pauseConversation,
  getPendingManualMessages,
  claimManualMessage,
  releaseManualMessage,
  setWhatsappMessageId,
  getConversationJid,
} from './db.js';
import { generateReply } from './ai.js';

const AUTO_RESPOND = (process.env.AUTO_RESPOND ?? 'true') === 'true';
const AUTH_DIR = 'auth_session'; // guarda a sessão do WhatsApp entre reinícios

const logger = pino({ level: 'info' });

let sock; // conexão atual com o WhatsApp (é recriada a cada reconexão)
const sentByBot = new Set(); // ids das mensagens que o próprio bot enviou

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
  // A conversa do Caio com o próprio número fica reservada para comandos.
  if (isOwnChat(jid)) return;

  const text = extractText(msg);
  if (!text) return; // ignora áudios, figurinhas, etc. por enquanto

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

  const reply = await generateReply(conversation.id, text);
  if (!reply) return;

  if (!AUTO_RESPOND) {
    await insertMessage({
      conversationId: conversation.id,
      direction: 'saida',
      sender: 'ia',
      content: reply,
      sent: false,
    });
    console.log(`[${contactLabel(contact)}] resposta da IA gravada no banco (AUTO_RESPOND=false, não enviada).`);
    return;
  }

  const sent = await sendText(msg.key.remoteJid, reply);
  await insertMessage({
    conversationId: conversation.id,
    direction: 'saida',
    sender: 'ia',
    content: reply,
    whatsappMessageId: sent.key.id,
  });
  console.log(`[${contactLabel(contact)}] respondido automaticamente pela IA.`);
}

function whyBotIsQuiet(conversation) {
  if (conversation.started_by_caio) return 'conversa iniciada pelo Caio';
  if (conversation.status === 'aguardando_humano') return 'aguardando atendimento humano';
  if (conversation.bot_paused_until && new Date(conversation.bot_paused_until) > new Date()) {
    return 'bot pausado (o Caio assumiu)';
  }
  return null;
}

function contactLabel(contact) {
  return contact.saved_name || contact.name || contact.phone || contact.whatsapp_jid;
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
startBot().catch((err) => {
  console.error('Erro fatal ao iniciar o bot:', err);
  process.exit(1);
});
