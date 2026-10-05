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

## Como funcionava (respostas do Caio, 05/10)

- **Contatos pessoais:** ao conectar o WhatsApp, o bot analisou 3 meses de
  conversas e marcou como pessoais os contatos pelo assunto das conversas.
- **Assumir a conversa:** o Caio respondia pelo celular. Além disso, ele
  controlava o bot de várias formas pela conversa com o próprio número.
- **Follow-up:** as regras vão ser configuradas no painel por etapa (ex.:
  orçamento enviado → mensagem em X dias; visita técnica feita → em Y dias).
  Essa tela ainda não existia.
- **Decisões pendentes e aprendizado contínuo:** quando o bot não sabe
  responder, ele deixa o cliente sem resposta e espera a decisão do Caio. Cada
  parada vira conhecimento novo, para o bot aprender com cada conversa até
  conseguir responder tudo sozinho — o roteiro configurado nunca cobre todas
  as formas de começar uma conversa.
- **Painel:** ainda tinha pouca coisa nova; o que ele precisa ter vai ser
  definido depois.

## Roteiro de reconstrução

Cada item é um commit, com push.

**Fase 1 — bot seguro para religar** (antes de escanear o QR de novo)
1. Número e `@lid` como o mesmo contato; preencher `alt_jid` e `saved_name`
   com o que o WhatsApp informa.
2. Contatos pessoais: não grava nem responde.
3. Mensagem do Caio pelo celular: fica registrada e pausa o bot na conversa
   (`bot_paused_until`, duração em `settings`).
4. Conversa iniciada pelo Caio: o bot nunca responde (`started_by_caio`).
5. Mensagens manuais do painel: o bot envia e marca `sent=true`.
6. Não responder duas vezes à mesma mensagem; histórico de 40 mensagens.

**Fase 2 — aprendizado contínuo**
7. Quando não sabe responder: não responde o cliente, marca
   `pending_decision_at` e pergunta ao Caio na conversa dele.
8. A resposta do Caio vai para o cliente e vira item da base de conhecimento.
9. Lembrete quando a decisão fica pendente.
10. Comandos na conversa do Caio (pausar, retomar, marcar pessoal etc.).

**Fase 3 — vendas**
11. Ficha do lead (`lead`, com etapa).
12. A IA envia PDFs da tabela `materials`.
13. Mídias recebidas no bucket `midias` (fotos para a IA ver).
14. Classificar contatos pessoais pelo histórico ao conectar.

**Depois:** follow-ups configuráveis no painel e as telas do painel.

## Pendências encontradas

- **Auth:** proteção contra senhas vazadas desligada —
  https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
- **Bucket `midias`:** sem política para usuários logados, então o painel não
  consegue abrir as mídias (só o bot, com a service_role).
- **Tabela `settings`:** existe desde o início, mas está vazia.
