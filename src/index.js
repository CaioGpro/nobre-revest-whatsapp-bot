import 'dotenv/config';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';

import {
  getOrCreateContact,
  getOrCreateOpenConversation,
  insertMessage,
  getConversationStatus,
} from './db.js';
import { generateReply } from './ai.js';

const AUTO_RESPOND = (process.env.AUTO_RESPOND ?? 'true') === 'true';
const AUTH_DIR = 'auth_session'; // guarda a sessão do WhatsApp entre reinícios

const logger = pino({ level: 'info' });

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
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
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        await handleIncomingMessage(sock, msg);
      } catch (err) {
        logger.error({ err }, 'Erro ao processar mensagem recebida');
      }
    }
  });
}

async function handleIncomingMessage(sock, msg) {
  // Ignora mensagens enviadas por nós mesmos e mensagens sem conteúdo de texto
  if (msg.key.fromMe) return;

  const jid = msg.key.remoteJid;
  if (!jid || jid.endsWith('@g.us')) return; // ignora grupos, só atende conversas 1:1

  const text =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    null;

  if (!text) return; // ignora áudios, figurinhas, etc. por enquanto

  const pushName = msg.pushName || null;
  const phone = jid.split('@')[0];

  const contact = await getOrCreateContact(jid, pushName, phone);
  const conversation = await getOrCreateOpenConversation(contact.id);

  await insertMessage({
    conversationId: conversation.id,
    direction: 'entrada',
    sender: 'cliente',
    content: text,
    whatsappMessageId: msg.key.id,
  });

  // Se a conversa foi marcada para atendimento humano, a IA não responde —
  // fica só registrado no painel para alguém assumir manualmente.
  const status = await getConversationStatus(conversation.id);
  if (status === 'aguardando_humano') {
    console.log(`[${phone}] aguardando atendimento humano — IA não respondeu.`);
    return;
  }

  const reply = await generateReply(conversation.id, text);
  if (!reply) return;

  await insertMessage({
    conversationId: conversation.id,
    direction: 'saida',
    sender: 'ia',
    content: reply,
  });

  if (AUTO_RESPOND) {
    await sock.sendMessage(jid, { text: reply });
    console.log(`[${phone}] respondido automaticamente pela IA.`);
  } else {
    console.log(`[${phone}] resposta da IA gravada no banco (AUTO_RESPOND=false, não enviada).`);
  }
}

startBot().catch((err) => {
  console.error('Erro fatal ao iniciar o bot:', err);
  process.exit(1);
});
