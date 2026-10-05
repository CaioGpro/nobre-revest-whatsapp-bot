import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabaseClient';
import Login from './pages/Login';
import KnowledgeBase from './pages/KnowledgeBase';
import ConversationList from './components/ConversationList';
import ConversationThread from './components/ConversationThread';
import { Conversation, ConversationStatus, Message } from './lib/types';

type Tab = 'conversas' | 'base';

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('conversas');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);

  // --- Autenticação ---
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => sub.subscription.unsubscribe();
  }, []);

  // --- Carrega conversas + realtime ---
  useEffect(() => {
    if (!session) return;

    async function loadConversations() {
      const { data } = await supabase
        .from('conversations')
        .select('*, contacts(*)')
        .order('last_message_at', { ascending: false, nullsFirst: false });
      setConversations((data as Conversation[]) ?? []);
    }
    loadConversations();

    const channel = supabase
      .channel('conversations-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations' },
        () => loadConversations()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session]);

  // --- Carrega mensagens da conversa selecionada + realtime ---
  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }

    async function loadMessages() {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', selectedId)
        .order('created_at', { ascending: true });
      setMessages(data ?? []);
    }
    loadMessages();

    const channel = supabase
      .channel(`messages-${selectedId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${selectedId}`,
        },
        () => loadMessages()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedId]);

  async function handleStatusChange(status: ConversationStatus) {
    if (!selectedId) return;
    await supabase.from('conversations').update({ status }).eq('id', selectedId);
  }

  if (session === undefined) {
    return <div className="min-h-screen flex items-center justify-center text-stone-400 text-sm">Carregando...</div>;
  }

  if (!session) {
    return <Login />;
  }

  const selectedConversation = conversations.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="h-screen flex flex-col">
      <header className="border-b border-stone-200 bg-white px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <h1 className="font-semibold text-stone-900">Nobre Revest CRM</h1>
          <nav className="flex gap-1 text-sm">
            <button
              onClick={() => setTab('conversas')}
              className={`px-3 py-1.5 rounded-lg transition ${
                tab === 'conversas' ? 'bg-brand-100 text-brand-700 font-medium' : 'text-stone-500 hover:bg-stone-100'
              }`}
            >
              Conversas
            </button>
            <button
              onClick={() => setTab('base')}
              className={`px-3 py-1.5 rounded-lg transition ${
                tab === 'base' ? 'bg-brand-100 text-brand-700 font-medium' : 'text-stone-500 hover:bg-stone-100'
              }`}
            >
              Base de conhecimento
            </button>
          </nav>
        </div>
        <button
          onClick={() => supabase.auth.signOut()}
          className="text-sm text-stone-500 hover:text-stone-800"
        >
          Sair
        </button>
      </header>

      <main className="flex-1 min-h-0">
        {tab === 'base' ? (
          <div className="h-full overflow-y-auto">
            <KnowledgeBase />
          </div>
        ) : (
          <div className="h-full grid grid-cols-[320px_1fr]">
            <aside className="border-r border-stone-200 overflow-y-auto bg-white">
              <ConversationList
                conversations={conversations}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            </aside>
            <section className="min-w-0">
              {selectedConversation ? (
                <ConversationThread
                  conversation={selectedConversation}
                  messages={messages}
                  onStatusChange={handleStatusChange}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-stone-400">
                  Selecione uma conversa para ver as mensagens
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
