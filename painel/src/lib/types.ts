export type ConversationStatus =
  | 'novo'
  | 'em_andamento'
  | 'aguardando_humano'
  | 'fechado'
  | 'perdido';

export type MessageDirection = 'entrada' | 'saida';
export type MessageSender = 'cliente' | 'ia' | 'humano';

export interface Contact {
  id: string;
  whatsapp_jid: string;
  phone: string | null;
  name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  contact_id: string;
  status: ConversationStatus;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
  contacts?: Contact;
}

export interface Message {
  id: string;
  conversation_id: string;
  direction: MessageDirection;
  sender: MessageSender;
  content: string;
  whatsapp_message_id: string | null;
  sent: boolean;
  created_at: string;
}

export interface KnowledgeBaseItem {
  id: string;
  category: string;
  title: string;
  content: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export const STATUS_LABELS: Record<ConversationStatus, string> = {
  novo: 'Novo',
  em_andamento: 'Em andamento',
  aguardando_humano: 'Aguardando você',
  fechado: 'Fechado',
  perdido: 'Perdido',
};

export const STATUS_COLORS: Record<ConversationStatus, string> = {
  novo: 'bg-blue-100 text-blue-700',
  em_andamento: 'bg-amber-100 text-amber-700',
  aguardando_humano: 'bg-red-100 text-red-700',
  fechado: 'bg-emerald-100 text-emerald-700',
  perdido: 'bg-stone-200 text-stone-600',
};
