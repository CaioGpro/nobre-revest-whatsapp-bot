import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { KnowledgeBaseItem } from '../lib/types';

const CATEGORIES = ['servico', 'preco', 'faq', 'empresa_info'];
const CATEGORY_LABELS: Record<string, string> = {
  servico: 'Serviço',
  preco: 'Preço',
  faq: 'FAQ',
  empresa_info: 'Info da empresa',
};

const emptyForm = { category: 'servico', title: '', content: '' };

export default function KnowledgeBase() {
  const [items, setItems] = useState<KnowledgeBaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('knowledge_base')
      .select('*')
      .order('created_at', { ascending: false });
    setItems(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.content.trim()) return;

    if (editingId) {
      await supabase
        .from('knowledge_base')
        .update({ category: form.category, title: form.title, content: form.content })
        .eq('id', editingId);
    } else {
      await supabase.from('knowledge_base').insert(form);
    }

    setForm(emptyForm);
    setEditingId(null);
    load();
  }

  function startEdit(item: KnowledgeBaseItem) {
    setEditingId(item.id);
    setForm({ category: item.category, title: item.title, content: item.content });
  }

  async function toggleActive(item: KnowledgeBaseItem) {
    await supabase.from('knowledge_base').update({ active: !item.active }).eq('id', item.id);
    load();
  }

  async function remove(id: string) {
    if (!confirm('Remover este item da base de conhecimento?')) return;
    await supabase.from('knowledge_base').delete().eq('id', id);
    load();
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-stone-900">Base de conhecimento da IA</h1>
        <p className="text-sm text-stone-500 mt-1">
          Serviços, preços e informações que a IA usa para responder os clientes no WhatsApp.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-xl border border-stone-200 p-5 space-y-4"
      >
        <div className="flex gap-3">
          <select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Título (ex: Divisória Eucatex - m²)"
            className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm"
          />
        </div>
        <textarea
          value={form.content}
          onChange={(e) => setForm({ ...form, content: e.target.value })}
          placeholder="Detalhes que a IA deve saber (preço, condições, prazo, etc.)"
          rows={3}
          className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
        />
        <div className="flex gap-2">
          <button
            type="submit"
            className="bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium rounded-lg px-4 py-2 transition"
          >
            {editingId ? 'Salvar alterações' : 'Adicionar'}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setForm(emptyForm);
              }}
              className="text-sm text-stone-500 px-4 py-2"
            >
              Cancelar
            </button>
          )}
        </div>
      </form>

      <div className="space-y-3">
        {loading && <p className="text-sm text-stone-400">Carregando...</p>}
        {!loading && items.length === 0 && (
          <p className="text-sm text-stone-400">Nenhum item cadastrado ainda.</p>
        )}
        {items.map((item) => (
          <div
            key={item.id}
            className={`bg-white rounded-xl border p-4 flex items-start justify-between gap-4 ${
              item.active ? 'border-stone-200' : 'border-stone-100 opacity-50'
            }`}
          >
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-stone-100 text-stone-600">
                  {CATEGORY_LABELS[item.category] ?? item.category}
                </span>
                <h3 className="font-medium text-sm text-stone-900">{item.title}</h3>
              </div>
              <p className="text-sm text-stone-600 whitespace-pre-wrap">{item.content}</p>
            </div>
            <div className="flex flex-col gap-2 text-xs shrink-0">
              <button onClick={() => startEdit(item)} className="text-brand-600 hover:underline">
                Editar
              </button>
              <button onClick={() => toggleActive(item)} className="text-stone-500 hover:underline">
                {item.active ? 'Desativar' : 'Ativar'}
              </button>
              <button onClick={() => remove(item.id)} className="text-red-500 hover:underline">
                Remover
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
