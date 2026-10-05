import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { getActiveKnowledgeBase, getConversationHistory } from './db.js';

dotenv.config();

const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

const KNOWLEDGE_CATEGORIES = ['servico', 'preco', 'faq', 'empresa_info'];

// Quando a IA não tem como responder, ela chama esta função em vez de
// responder: o cliente fica esperando e a pergunta vai para o Caio.
const DECISION_TOOL = {
  type: 'function',
  name: 'pedir_decisao_do_caio',
  description:
    'Encaminha ao Caio (dono da Nobre Revest) uma pergunta do cliente que a base de conhecimento não responde. O cliente não recebe nada até o Caio decidir. Use em vez de responder sempre que precisaria inventar ou supor uma informação.',
  parameters: {
    type: 'object',
    properties: {
      pergunta: {
        type: 'string',
        description:
          'O que o cliente quer saber ou pediu, em uma ou duas frases, com o contexto que o Caio precisa para decidir (serviço, medidas, local, prazo).',
      },
    },
    required: ['pergunta'],
  },
};

function buildSystemPrompt(knowledgeBase) {
  const kbText = knowledgeBase.length
    ? knowledgeBase
        .map((item) => `## ${item.title} (${item.category})\n${item.content}`)
        .join('\n\n')
    : '(Nenhuma informação cadastrada ainda.)';

  return `Você é o assistente de atendimento via WhatsApp da Nobre Revest, uma empresa de construção civil em Macaé - RJ, especializada em divisórias Eucatex e forros.

Seu papel:
- Atender clientes de forma simpática, direta e profissional, como um bom vendedor faria.
- Usar as informações abaixo (serviços, preços, condições) para responder dúvidas.
- Quando a resposta não estiver na base de conhecimento (um preço, prazo, região, condição ou situação que não está cadastrada, uma negociação de valores, algo fora do roteiro), não responda e não invente: use a função pedir_decisao_do_caio. O cliente fica sem resposta até o Caio decidir, então não escreva nada para ele nesse caso.
- Se o cliente demonstrar intenção clara de fechar negócio, reclamação séria, ou pedir para falar com uma pessoa, sinalize isso claramente na resposta (ex: "vou te conectar com nosso responsável") e mantenha a resposta curta.
- Responda sempre em português do Brasil, em tom informal-profissional, como mensagens de WhatsApp (frases curtas, sem formalismo excessivo, pode usar 1 emoji ocasional mas sem exagero).
- Nunca mencione que você é uma IA ou modelo de linguagem, a menos que perguntem diretamente.

Base de conhecimento da Nobre Revest:

${kbText}`;
}

// Converte o histórico do banco para os passos de conversa da API do Gemini.
function toSteps(history) {
  return history.map((m) => ({
    type: m.role === 'user' ? 'user_input' : 'model_output',
    content: [{ type: 'text', text: m.content }],
  }));
}

function textOf(interaction) {
  if (interaction.output_text) return interaction.output_text.trim();
  const text = (interaction.steps ?? [])
    .filter((step) => step.type === 'model_output')
    .flatMap((step) => step.content ?? [])
    .filter((content) => content.type === 'text')
    .map((content) => content.text)
    .join('')
    .trim();
  return text || null;
}

function assertNotFailed(interaction) {
  if (interaction.status === 'failed') {
    throw new Error(`Gemini falhou: ${JSON.stringify(interaction.errors ?? [])}`);
  }
}

/**
 * Gera a resposta da IA para uma nova mensagem do cliente, usando o
 * histórico da conversa e a base de conhecimento da empresa como contexto.
 *
 * Retorna { type: 'reply', text } ou, quando a IA não sabe responder,
 * { type: 'decision', question } — a pergunta que deve ir para o Caio.
 *
 * Com `caioAnswer`, a IA responde seguindo a decisão do Caio e não pode
 * pedir outra decisão.
 */
export async function generateReply(conversationId, newMessageText, { caioAnswer } = {}) {
  const [knowledgeBase, history] = await Promise.all([
    getActiveKnowledgeBase(),
    getConversationHistory(conversationId),
  ]);

  let systemPrompt = buildSystemPrompt(knowledgeBase);
  if (caioAnswer) {
    systemPrompt += `\n\nO Caio decidiu como responder a pergunta pendente do cliente: "${caioAnswer}". Responda o cliente agora com base nisso, no seu tom, sem mencionar o Caio.`;
  }

  // O histórico já inclui a mensagem mais recente do cliente (inserida antes
  // de chamar esta função), então usamos ele diretamente.
  const input = history.length ? toSteps(history) : newMessageText;

  const interaction = await genai.interactions.create({
    model: MODEL,
    system_instruction: systemPrompt,
    input,
    ...(caioAnswer ? {} : { tools: [DECISION_TOOL] }),
    generation_config: { thinking_level: 'low' },
    store: false, // as conversas dos clientes não ficam guardadas no Google
  });
  assertNotFailed(interaction);

  const decision = (interaction.steps ?? []).find(
    (step) => step.type === 'function_call' && step.name === DECISION_TOOL.name
  );
  if (decision) {
    return { type: 'decision', question: decision.arguments.pergunta };
  }

  const text = textOf(interaction);
  if (text) return { type: 'reply', text };

  // Sem texto (ex.: resposta bloqueada pelo filtro do Gemini): quem decide é
  // o Caio, para o cliente não ficar sem ninguém saber.
  return caioAnswer ? null : { type: 'decision', question: newMessageText ?? 'Mensagem do cliente sem resposta da IA.' };
}

/**
 * Transforma a resposta do Caio a uma decisão pendente em um item novo da
 * base de conhecimento, para a IA responder sozinha casos parecidos.
 */
export async function learnFromCaio(conversationId, caioAnswer) {
  const history = await getConversationHistory(conversationId);
  const transcript = history
    .map((m) => `${m.role === 'user' ? 'Cliente' : 'Nobre Revest'}: ${m.content}`)
    .join('\n');

  const interaction = await genai.interactions.create({
    model: MODEL,
    input: `Abaixo está uma conversa de WhatsApp da Nobre Revest (divisórias Eucatex e forros, Macaé - RJ) em que o assistente não sabia responder o cliente, e a resposta que o Caio, dono da empresa, deu.

Escreva UM item para a base de conhecimento que permita ao assistente responder sozinho perguntas parecidas no futuro. Generalize: guarde a regra ou a informação, sem nome, telefone ou outros detalhes deste cliente. Escreva o conteúdo em português, direto, como uma orientação para o assistente.

Conversa:
${transcript}

Resposta do Caio: ${caioAnswer}`,
    response_format: {
      type: 'text',
      mime_type: 'application/json',
      schema: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: KNOWLEDGE_CATEGORIES },
          title: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['category', 'title', 'content'],
      },
    },
    generation_config: { thinking_level: 'low' },
    store: false,
  });
  assertNotFailed(interaction);

  const text = textOf(interaction);
  if (!text) throw new Error(`Gemini não devolveu o conhecimento (status=${interaction.status})`);
  return JSON.parse(text);
}
