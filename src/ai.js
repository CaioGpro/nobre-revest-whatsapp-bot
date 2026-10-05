import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import { getActiveKnowledgeBase, getConversationHistory } from './db.js';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';

const KNOWLEDGE_CATEGORIES = ['servico', 'preco', 'faq', 'empresa_info'];

// Quando a IA não tem como responder, ela chama esta ferramenta em vez de
// responder: o cliente fica esperando e a pergunta vai para o Caio.
const DECISION_TOOL = {
  name: 'pedir_decisao_do_caio',
  description:
    'Encaminha ao Caio (dono da Nobre Revest) uma pergunta do cliente que a base de conhecimento não responde. O cliente não recebe nada até o Caio decidir. Use em vez de responder sempre que precisaria inventar ou supor uma informação.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      pergunta: {
        type: 'string',
        description:
          'O que o cliente quer saber ou pediu, em uma ou duas frases, com o contexto que o Caio precisa para decidir (serviço, medidas, local, prazo).',
      },
    },
    required: ['pergunta'],
    additionalProperties: false,
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
- Quando a resposta não estiver na base de conhecimento (um preço, prazo, região, condição ou situação que não está cadastrada, uma negociação de valores, algo fora do roteiro), não responda e não invente: use a ferramenta pedir_decisao_do_caio. O cliente fica sem resposta até o Caio decidir, então não escreva nada para ele nesse caso.
- Se o cliente demonstrar intenção clara de fechar negócio, reclamação séria, ou pedir para falar com uma pessoa, sinalize isso claramente na resposta (ex: "vou te conectar com nosso responsável") e mantenha a resposta curta.
- Responda sempre em português do Brasil, em tom informal-profissional, como mensagens de WhatsApp (frases curtas, sem formalismo excessivo, pode usar 1 emoji ocasional mas sem exagero).
- Nunca mencione que você é uma IA ou modelo de linguagem, a menos que perguntem diretamente.

Base de conhecimento da Nobre Revest:

${kbText}`;
}

function textOf(response) {
  const textBlock = response.content.find((block) => block.type === 'text');
  return textBlock ? textBlock.text.trim() : null;
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
  const messages = history.length
    ? history
    : [{ role: 'user', content: newMessageText }];

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: systemPrompt,
    messages,
    ...(caioAnswer ? {} : { tools: [DECISION_TOOL] }),
  });

  // Se a IA recusar, quem decide é o Caio.
  if (response.stop_reason === 'refusal') {
    return { type: 'decision', question: newMessageText ?? 'Mensagem do cliente sem resposta da IA.' };
  }

  const decision = response.content.find(
    (block) => block.type === 'tool_use' && block.name === DECISION_TOOL.name
  );
  if (decision) {
    return { type: 'decision', question: decision.input.pergunta };
  }

  const text = textOf(response);
  return text ? { type: 'reply', text } : null;
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

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 16000,
    messages: [
      {
        role: 'user',
        content: `Abaixo está uma conversa de WhatsApp da Nobre Revest (divisórias Eucatex e forros, Macaé - RJ) em que o assistente não sabia responder o cliente, e a resposta que o Caio, dono da empresa, deu.

Escreva UM item para a base de conhecimento que permita ao assistente responder sozinho perguntas parecidas no futuro. Generalize: guarde a regra ou a informação, sem nome, telefone ou outros detalhes deste cliente. Escreva o conteúdo em português, direto, como uma orientação para o assistente.

Conversa:
${transcript}

Resposta do Caio: ${caioAnswer}`,
      },
    ],
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            category: { type: 'string', enum: KNOWLEDGE_CATEGORIES },
            title: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['category', 'title', 'content'],
          additionalProperties: false,
        },
      },
    },
  });

  const text = textOf(response);
  if (response.stop_reason !== 'end_turn' || !text) {
    throw new Error(`Não foi possível extrair o conhecimento (stop_reason=${response.stop_reason})`);
  }
  return JSON.parse(text);
}
