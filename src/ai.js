import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import { getActiveKnowledgeBase, getConversationHistory } from './db.js';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';

function buildSystemPrompt(knowledgeBase) {
  const kbText = knowledgeBase.length
    ? knowledgeBase
        .map((item) => `## ${item.title} (${item.category})\n${item.content}`)
        .join('\n\n')
    : '(Nenhuma informação cadastrada ainda — responda de forma genérica e educada, e diga que um responsável vai confirmar detalhes específicos.)';

  return `Você é o assistente de atendimento via WhatsApp da Nobre Revest, uma empresa de construção civil em Macaé - RJ, especializada em divisórias Eucatex e forros.

Seu papel:
- Atender clientes de forma simpática, direta e profissional, como um bom vendedor faria.
- Usar as informações abaixo (serviços, preços, condições) para responder dúvidas.
- Quando não souber uma informação específica (ex: prazo exato de uma obra, negociação de valores), seja honesto e diga que um responsável vai confirmar em breve — NUNCA invente preços ou prazos que não estejam na base de conhecimento.
- Se o cliente demonstrar intenção clara de fechar negócio, reclamação séria, ou pedir para falar com uma pessoa, sinalize isso claramente na resposta (ex: "vou te conectar com nosso responsável") e mantenha a resposta curta.
- Responda sempre em português do Brasil, em tom informal-profissional, como mensagens de WhatsApp (frases curtas, sem formalismo excessivo, pode usar 1 emoji ocasional mas sem exagero).
- Nunca mencione que você é uma IA ou modelo de linguagem, a menos que perguntem diretamente.

Base de conhecimento da Nobre Revest:

${kbText}`;
}

/**
 * Gera a resposta da IA para uma nova mensagem do cliente, usando o
 * histórico da conversa e a base de conhecimento da empresa como contexto.
 */
export async function generateReply(conversationId, newMessageText) {
  const [knowledgeBase, history] = await Promise.all([
    getActiveKnowledgeBase(),
    getConversationHistory(conversationId),
  ]);

  const systemPrompt = buildSystemPrompt(knowledgeBase);

  // O histórico já inclui a mensagem mais recente do cliente (inserida antes
  // de chamar esta função), então usamos ele diretamente.
  const messages = history.length
    ? history
    : [{ role: 'user', content: newMessageText }];

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 500,
    system: systemPrompt,
    messages,
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  return textBlock ? textBlock.text.trim() : null;
}
