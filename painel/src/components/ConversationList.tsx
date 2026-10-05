import { Conversation, STATUS_COLORS, STATUS_LABELS } from '../lib/types';

function formatTime(iso: string | null) {
  if (!iso) return '';
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

interface Props {
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function ConversationList({ conversations, selectedId, onSelect }: Props) {
  if (conversations.length === 0) {
    return (
      <div className="p-6 text-sm text-stone-400 text-center">
        Nenhuma conversa ainda. Assim que um cliente escrever no WhatsApp, ela aparece aqui.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-stone-100">
      {conversations.map((conv) => {
        const isSelected = conv.id === selectedId;
        const name = conv.contacts?.name || conv.contacts?.phone || 'Contato sem nome';
        return (
          <li key={conv.id}>
            <button
              onClick={() => onSelect(conv.id)}
              className={`w-full text-left px-4 py-3 flex flex-col gap-1 transition ${
                isSelected ? 'bg-brand-50' : 'hover:bg-stone-50'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm text-stone-900 truncate">{name}</span>
                <span className="text-xs text-stone-400 shrink-0">
                  {formatTime(conv.last_message_at)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-stone-500 truncate">{conv.contacts?.phone}</span>
                <span
                  className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${STATUS_COLORS[conv.status]}`}
                >
                  {STATUS_LABELS[conv.status]}
                </span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
