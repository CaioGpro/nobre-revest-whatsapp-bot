# Recuperação — codespace apagado em 05/10/2026

O codespace onde o bot rodava foi apagado com o trabalho de 25/09 a 05/10 que
nunca foi enviado ao GitHub. Não havia cópia em servidor, Edge Functions nem
SQL salvo no SQL Editor. O que sobrou está no Supabase.

## O que voltou

- **Banco inteiro, como código:** as 5 migrations aplicadas, com o SQL exato,
  em `supabase/migrations/`. O banco atual bate 100% com elas — nada foi feito
  à mão no Dashboard.
- **Dados, intactos no Supabase:** base de conhecimento (9 itens, revisados em
  02/10 e 05/10), 1 material (catálogo de divisórias Eucatex em PDF, no bucket
  `materiais`), 57 contatos (54 marcados como pessoais), 3 conversas e o
  usuário de login do painel.
- **Código-base:** bot de 25/09 (`src/`) e painel de 21/09 (`painel/`).

## O que se perdeu

- O código do bot escrito entre 25/09 e 05/10.
- As mudanças no painel feitas no codespace.
- O script de teste que simulava conversas (ids `TEST…`) e apagava tudo no
  final, e o script que subiu o PDF e cadastrou o material.

## O que o bot perdido fazia

Reconstruído a partir das migrations, dos comentários nas colunas e dos logs
da API de 05/10 (único dia com logs guardados).

| # | Função | Evidência |
|---|---|---|
| 1 | Enviar pelo WhatsApp as mensagens manuais do painel (`sender='humano'`, `sent=false`) e marcar `sent=true` | migration `add_sent_flag_to_messages` (Realtime em `messages`); painel |
| 2 | Contatos pessoais (família, amigos): o bot ignora e não grava mensagens | `contacts.is_personal`; consulta `select=id,is_personal,name` antes de gravar; 54 contatos marcados em 02/10 |
| 3 | Mesmo contato com dois ids do WhatsApp (número e `@lid`) | `contacts.alt_jid`; busca `or=(whatsapp_jid.in.(…),alt_jid.in.(…))` |
| 4 | Nome com que o Caio salvou o contato na agenda | `contacts.saved_name` |
| 5 | Pausar o bot numa conversa quando o Caio assume | `conversations.bot_paused_until` |
| 6 | Nunca responder conversas que o Caio iniciou | `conversations.started_by_caio` |
| 7 | Ficha do lead montada pela IA (nome, serviços, medidas, etapa, avisos) | `conversations.lead` |
| 8 | Follow-up automático com clientes que pararam de responder | `follow_up_count`, `last_follow_up_at`; varredura de conversas abertas com `started_by_caio=false` |
| 9 | Lembrar o Caio de decisões pendentes | `conversations.pending_decision_at` |
| 10 | Guardar mídias recebidas (fotos, áudios, PDFs) | bucket `midias`; `messages.media_path`, `media_type` |
| 11 | A IA escolhe e envia PDFs da tabela `materials`, sem repetir | consulta aos materiais ativos; checagem de `[Arquivo enviado: …]` no histórico |
| 12 | Histórico maior para a IA (40 mensagens, antes 20) e não responder duas vezes à mesma mensagem | consultas `limit=40` e por `whatsapp_message_id` + `sender=ia` |
| 13 | Tom de "atendimento humanizado" no prompt | nome da migration de 02/10; detalhes desconhecidos |

## O que precisa da sua memória

- Como o bot decidia que um contato é pessoal (as 54 marcações de 02/10).
- Quando o bot pausava e por quanto tempo; como o Caio "assumia" a conversa.
- Regras do follow-up: depois de quanto tempo, quantas vezes, que texto.
- Como o Caio era avisado das decisões pendentes (mensagem no próprio
  WhatsApp?).
- Etapas da ficha do lead e o que era "aviso".
- O que mudou no painel (telas de leads, materiais, mídias?).

## Pendências encontradas

- **Auth:** proteção contra senhas vazadas desligada —
  https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
- **Bucket `midias`:** sem política para usuários logados, então o painel não
  consegue abrir as mídias (só o bot, com a service_role).
- **Tabela `settings`:** existe desde o início, mas está vazia.
