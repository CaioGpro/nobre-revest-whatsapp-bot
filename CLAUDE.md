# Nobre Revest — bot de WhatsApp + painel do CRM

Bot de atendimento no WhatsApp com IA (Claude) e painel web do CRM, os dois
ligados ao mesmo banco Supabase.

## Regra mais importante

Ao terminar cada tarefa, faça commit e push. Trabalho que fica só no codespace
se perde se ele for apagado — foi o que aconteceu em 05/10/2026, com ~10 dias
de trabalho.

## Estrutura

- `src/` — bot (Node, Baileys + Anthropic SDK). `npm start` na raiz.
- `whatsapp-bot/` — cópia duplicada do mesmo código do bot (pendente de
  remoção).
- `painel/` — painel do CRM (React + Vite + Tailwind). `npm run dev` dentro de
  `painel/`.
- `.mcp.json` — MCP do Supabase em modo somente leitura; o token vem do secret
  `SUPABASE_ACCESS_TOKEN` do Codespaces.

## Supabase

- Projeto `nobre-revest-crm`, ref `uhnwabudxvxialmjxwmd`.
- Toda mudança no banco vira um arquivo em `supabase/migrations/`, commitado.
- O bot usa a service_role (só no servidor); o painel usa a chave anon + login
  do Supabase Auth, então as tabelas dependem de RLS.

## Execução

- Hoje o bot roda dentro do codespace: se o codespace parar, o bot cai e a
  sessão do WhatsApp fica em `auth_session/` (fora do Git).
- Para testar sem responder clientes de verdade, use `AUTO_RESPOND=false`.

## Segredos

- Nunca commitar `.env` nem `auth_session/`.
- `SUPABASE_SERVICE_ROLE_KEY` e `ANTHROPIC_API_KEY` ficam como secrets do
  Codespaces (github.com/settings/codespaces).
