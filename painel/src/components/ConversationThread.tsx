import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import {
  Conversation,
  ConversationStatus,
  Message,
  STATUS_COLORS,
  STATUS_LABELS,
} from '../lib/types';

const STATUS_OPTIONS: ConversationStatus[] = [
  'novo',
  'em_andamento',
  'aguardando_humano',
  'fechado',
  'perdido',
];

interface Props {
  conversation: Conversation;
  messages: Message[];
  onStatusChange: (status: ConversationStatus) => void;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ConversationThread({ conversation, messages, onStatusChange }: Props) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const contactName =
    conversation.contacts?.name || conversation.contacts?.phone || 'Contato sem nome';

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;

    setSending(true);
    setDraft('');

    // sent=false: o bot do WhatsApp escuta essa tabela e envia de fato pelo
    // WhatsApp, depois marca sent=true.
    const { error } = await supabase.from('messages').insert({
      conversation_id: conversation.id,
      direction: 'saida',
      sender: 'humano',
      content: text,
      sent: false,
    });

    setSending(false);
    if (error) alert('Erro ao enviar mensagem: ' + error.message);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-stone-200 px-5 py-4 flex items-center justify-between gap-4 bg-white">
        <div>
          <h2 className="font-semibold text-stone-900">{contactName}</h2>
          <p className="text-xs text-stone-500">{conversation.contacts?.phone}</p>
        </div>
        <select
          value={conversation.status}
          onChange={(e) => onStatusChange(e.target.value as ConversationStatus)}
          className={`text-xs font-medium rounded-full px-3 py-1.5 border-0 cursor-pointer ${STATUS_COLORS[conversation.status]}`}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 bg-stone-50">
        {messages.map((msg) => {
          const isOutgoing = msg.direction === 'saida';
          const bubbleStyle = isOutgoing
            ? msg.sender === 'humano'
              ? 'bg-brand-500 text-white ml-auto'
              : 'bg-white border border-brand-200 text-stone-900 ml-auto'
            : 'bg-white border border-stone-200 text-stone-900';

          return (
            <div key={msg.id} className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${bubbleStyle}`}>
              <p className="whitespace-pre-wrap">{msg.content}</p>
              <div
                className={`text-[10px] mt-1 flex items-center gap-1 ${
                  isOutgoing && msg.sender === 'humano' ? 'text-white/70' : 'text-stone-400'
                }`}
              >
                <span>{formatDateTime(msg.created_at)}</span>
                {msg.sender === 'ia' && <span>· IA</span>}
                {msg.sender === 'humano' && <span>· Você</span>}
                {isOutgoing && !msg.sent && <span>· enviando...</span>}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="border-t border-stone-200 p-3 bg-white flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Escreva uma resposta manual..."
          className="flex-1 rounded-full border border-stone-300 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
        />
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          className="bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium rounded-full px-5 py-2 transition disabled:opacity-50"
        >
          Enviar
        </button>
      </form>
    </div>
  );
}
