# Nobre Revest — Bot de Atendimento WhatsApp com IA

Conecta ao WhatsApp (via Baileys, não-oficial) e responde clientes
automaticamente usando IA (Claude), com base numa base de conhecimento
guardada no Supabase. Todo o histórico fica salvo no mesmo banco que o
painel de conversas (CRM) usa.

## Por que isso não roda no Lovable/serverless

O Baileys mantém uma conexão permanente (WebSocket) com os servidores do
WhatsApp. Funções serverless (como as do Lovable Cloud) ligam e desligam a
cada chamada, então a sessão do WhatsApp cairia constantemente. Por isso
este backend precisa rodar como um **processo contínuo** — no seu
computador, numa VPS, ou em um serviço como Railway/Render.

## Pré-requisitos

- Node.js 18 ou superior
- Uma chave de API da Anthropic (Claude) — console.anthropic.com/settings/keys
- A `service_role key` do projeto Supabase `nobre-revest-crm`
  (Supabase Dashboard → Project Settings → API → service_role, **não** a
  publishable/anon key)

## Como rodar

```bash
npm install
cp .env.example .env
# edite o .env e preencha SUPABASE_SERVICE_ROLE_KEY e ANTHROPIC_API_KEY
npm start
```

Na primeira execução vai aparecer um **QR code no terminal**. Abra o
WhatsApp no celular → Aparelhos conectados → Conectar um aparelho → escaneie.

A sessão fica salva na pasta `auth_session/` — não é preciso escanear de
novo nos próximos inícios, a menos que você delete essa pasta ou desconecte
o aparelho pelo próprio WhatsApp.

## Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `SUPABASE_URL` | URL do projeto Supabase (já preenchido no .env.example) |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave secreta do Supabase (nunca exponha publicamente) |
| `ANTHROPIC_API_KEY` | Chave da API da Anthropic para gerar as respostas |
| `CLAUDE_MODEL` | Modelo do Claude a usar (padrão: `claude-sonnet-5`) |
| `AUTO_RESPOND` | `true` para responder automaticamente, `false` para só gravar a sugestão no banco sem enviar |

## Como a IA responde

A cada mensagem recebida:
1. Salva o contato (se novo) e a mensagem na tabela `messages`.
2. Se a conversa estiver marcada como `aguardando_humano` no painel, a IA
   **não responde** — fica esperando alguém assumir manualmente.
3. Caso contrário, monta o contexto com a base de conhecimento
   (`knowledge_base`) + histórico da conversa, chama o Claude, salva a
   resposta gerada e (se `AUTO_RESPOND=true`) envia pelo WhatsApp.

## Alimentando a base de conhecimento

A tabela `knowledge_base` no Supabase é o que a IA usa para saber preços,
serviços e políticas da Nobre Revest. Pode ser editada direto no Supabase
Table Editor, ou futuramente por uma tela no painel do CRM. Cada linha tem:
`category` (ex: `preco`, `servico`, `faq`, `empresa_info`), `title` e
`content`.

## Hospedagem contínua (produção)

Quando quiser deixar isso rodando 24/7 sem depender do seu computador,
serviços como Railway, Render ou uma VPS simples (ex: um droplet da
DigitalOcean) funcionam bem — é só rodar `npm install && npm start` lá,
mantendo o `.env` configurado e persistindo a pasta `auth_session/` entre
deploys (senão precisa escanear o QR de novo a cada deploy).
