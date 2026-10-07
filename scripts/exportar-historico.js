// Exporta o histórico de conversas com clientes para análise (roteiros e
// dúvidas frequentes). Conecta como um aparelho separado do bot, recebe o
// histórico que o celular envia, grava em exports/ (fora do Git) e se
// desconecta no final, removendo o aparelho do WhatsApp.
//
// Para proteger a privacidade, ficam de fora: grupos, canais e status, os
// contatos marcados como pessoais no banco, a conversa do Caio com ele mesmo e
// conversas sem nenhum assunto de obra. Nomes e telefones viram "Cliente N".
//
// Uso: npm run exportar   (MESES=3 npm run exportar para outro período)

import 'dotenv/config';
import fs from 'node:fs';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  DisconnectReason,
  areJidsSameUser,
  isJidUser,
  isLidUser,
  jidNormalizedUser,
} from '@whiskeysockets/baileys';

import { supabase } from '../src/supabase.js';

const MESES = Number(process.env.MESES ?? 6);
const AUTH_DIR = 'auth_export'; // sessão própria, separada da do bot
const SAIDA = `exports/historico-${new Date().toISOString().slice(0, 10)}.json`;
const ESPERA_SEM_NOVIDADE_MS = 90_000; // sem novos lotes por esse tempo = terminou
const LIMITE_TOTAL_MS = 20 * 60_000;

const desde = Date.now() / 1000 - MESES * 30 * 24 * 60 * 60;

// Uma conversa entra na análise se alguma mensagem falar de obra/serviço.
const ASSUNTO_DE_OBRA =
  /forro|pvc|gesso|drywall|divis[oó]ri|eucatex|or[cç]amento|visita|m²|m2\b|metros?\s+quadrados?|instala[cç]|parede|teto|placa|perfil|sanca|acabamento|obra|empreitada|nobre\s*revest/i;

const mensagensPorConversa = new Map(); // jid normalizado → Map(id → mensagem)
const outroJid = new Map(); // número ↔ @lid, aprendido com os contatos

function textoDa(message) {
  const m = message ?? {};
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage) return `[foto]${m.imageMessage.caption ? ' ' + m.imageMessage.caption : ''}`;
  if (m.videoMessage) return `[vídeo]${m.videoMessage.caption ? ' ' + m.videoMessage.caption : ''}`;
  if (m.audioMessage) return '[áudio]';
  if (m.documentMessage) return `[documento: ${m.documentMessage.fileName ?? 'arquivo'}]`;
  if (m.documentWithCaptionMessage) return textoDa(m.documentWithCaptionMessage.message);
  if (m.locationMessage) return '[localização]';
  if (m.contactMessage || m.contactsArrayMessage) return '[contato compartilhado]';
  if (m.ephemeralMessage) return textoDa(m.ephemeralMessage.message);
  if (m.viewOnceMessage) return textoDa(m.viewOnceMessage.message);
  return null; // figurinhas, reações, mensagens de sistema
}

function anonimizar(texto) {
  return texto
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[telefone]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]');
}

function guardarMensagens(messages) {
  for (const msg of messages) {
    const jid = msg.key?.remoteJid;
    if (!jid || !(isJidUser(jid) || isLidUser(jid))) continue; // só conversas 1:1
    const t = Number(msg.messageTimestamp ?? 0);
    if (t < desde) continue;
    const texto = textoDa(msg.message);
    if (!texto) continue;

    const chave = jidNormalizedUser(jid);
    if (!mensagensPorConversa.has(chave)) mensagensPorConversa.set(chave, new Map());
    mensagensPorConversa.get(chave).set(msg.key.id, {
      t,
      de: msg.key.fromMe ? 'Nobre Revest' : 'Cliente',
      texto,
    });
  }
}

function guardarContatos(contacts) {
  for (const c of contacts ?? []) {
    if (c.id && c.lid) {
      outroJid.set(jidNormalizedUser(c.id), jidNormalizedUser(c.lid));
      outroJid.set(jidNormalizedUser(c.lid), jidNormalizedUser(c.id));
    }
  }
}

async function contatosPessoais() {
  const { data, error } = await supabase
    .from('contacts')
    .select('whatsapp_jid, alt_jid')
    .eq('is_personal', true);
  if (error) throw error;
  return new Set(data.flatMap((c) => [c.whatsapp_jid, c.alt_jid]).filter(Boolean));
}

async function gravar(sock) {
  const pessoais = await contatosPessoais();
  const descartadas = { pessoais: 0, sem_assunto_de_obra: 0, propria: 0 };
  const conversas = [];

  for (const [jid, msgs] of mensagensPorConversa) {
    const jids = [jid, outroJid.get(jid)].filter(Boolean);
    if (jids.some((j) => areJidsSameUser(j, sock.user?.id) || areJidsSameUser(j, sock.user?.lid))) {
      descartadas.propria++;
      continue;
    }
    if (jids.some((j) => pessoais.has(j))) {
      descartadas.pessoais++;
      continue;
    }
    const lista = [...msgs.values()].sort((a, b) => a.t - b.t);
    if (!lista.some((m) => ASSUNTO_DE_OBRA.test(m.texto))) {
      descartadas.sem_assunto_de_obra++;
      continue;
    }
    conversas.push(lista);
  }

  conversas.sort((a, b) => b.length - a.length);
  const saida = {
    gerado_em: new Date().toISOString(),
    meses: MESES,
    descartadas,
    conversas: conversas.map((lista, i) => ({
      cliente: `Cliente ${i + 1}`,
      mensagens: lista.map((m) => ({
        data: new Date(m.t * 1000).toISOString().slice(0, 16).replace('T', ' '),
        de: m.de,
        texto: anonimizar(m.texto),
      })),
    })),
  };

  fs.mkdirSync('exports', { recursive: true });
  fs.writeFileSync(SAIDA, JSON.stringify(saida, null, 2));
  console.log(
    `\n✅ ${conversas.length} conversas com clientes salvas em ${SAIDA}` +
      ` (de fora: ${descartadas.pessoais} pessoais, ${descartadas.sem_assunto_de_obra} sem assunto de obra).`
  );
}

let sock; // conexão atual (é recriada quando o WhatsApp pede reinício)
let terminado = false;
let timerFim;

async function terminar() {
  if (terminado) return;
  terminado = true;
  clearTimeout(timerFim);
  try {
    await gravar(sock);
  } finally {
    // Remove o aparelho de exportação do WhatsApp e apaga a sessão local.
    await sock.logout().catch(() => {});
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    console.log('Aparelho de exportação desconectado.');
    process.exit(0);
  }
}

function terminarEm(ms) {
  clearTimeout(timerFim);
  timerFim = setTimeout(() => terminar().catch(falhar), ms);
}

function falhar(err) {
  console.error('Erro na exportação:', err);
  process.exit(1);
}

async function conectar() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    // O celular só manda o histórico completo para aparelhos "de computador".
    browser: Browsers.macOS('Desktop'),
    syncFullHistory: true,
  });
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messaging-history.set', ({ messages, contacts, progress }) => {
    guardarMensagens(messages);
    guardarContatos(contacts);
    const total = [...mensagensPorConversa.values()].reduce((n, m) => n + m.size, 0);
    console.log(`Recebendo histórico… ${progress ?? '?'}% (${total} mensagens até agora)`);
    // Com 100% o celular terminou; senão, espera mais lotes.
    terminarEm(progress === 100 ? 20_000 : ESPERA_SEM_NOVIDADE_MS);
  });
  sock.ev.on('contacts.upsert', guardarContatos);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\nEscaneie com o WhatsApp (Aparelhos conectados → Conectar um aparelho):\n');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      console.log('Conectado. Aguardando o celular enviar o histórico (pode levar alguns minutos)…');
      terminarEm(3 * 60_000); // tempo para o primeiro lote chegar
    }
    if (connection === 'close' && !terminado) {
      const code = lastDisconnect?.error?.output?.statusCode;
      // Logo após escanear o QR o WhatsApp pede um reinício da conexão.
      if (code === DisconnectReason.restartRequired) {
        conectar().catch(falhar);
      } else {
        falhar(new Error(`conexão encerrada antes de terminar (código ${code})`));
      }
    }
  });
}

setTimeout(() => terminar().catch(falhar), LIMITE_TOTAL_MS);
conectar().catch(falhar);
