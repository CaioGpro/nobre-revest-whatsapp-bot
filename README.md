# Nobre Revest — Bot de Atendimento WhatsApp com IA

Conecta ao WhatsApp (via Baileys, não-oficial) e responde clientes
automaticamente usando IA (Gemini, do Google), com base numa base de conhecimento
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
- Uma chave de API do Gemini — aistudio.google.com/apikey. No plano grátis o
  Google pode usar o conteúdo das conversas para melhorar os produtos dele e
  há um limite diário de chamadas (veja em aistudio.google.com/rate-limit);
  no plano pago, não.
- A `service_role key` do projeto Supabase `nobre-revest-crm`
  (Supabase Dashboard → Project Settings → API → service_role, **não** a
  publishable/anon key)

## Como rodar

```bash
npm install
cp .env.example .env
# edite o .env e preencha SUPABASE_SERVICE_ROLE_KEY e GEMINI_API_KEY
# (ou guarde as duas como secrets do Codespaces)
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
| `GEMINI_API_KEY` | Chave da API do Gemini para gerar as respostas |
| `GEMINI_MODEL` | Modelo do Gemini a usar (padrão: `gemini-3.8-flash`) |
| `AUTO_RESPOND` | `true` para responder automaticamente, `false` para só gravar a sugestão no banco sem enviar |

## Como a IA responde

A cada mensagem recebida:
1. Identifica o contato pelo número ou pelo `@lid` (o WhatsApp usa os dois
   para a mesma pessoa). Contatos marcados como pessoais (`is_personal`) são
   ignorados: nada é gravado nem respondido.
2. Salva o contato (se novo) e a mensagem na tabela `messages`.
3. A IA **não responde** se a conversa estiver como `aguardando_humano`, se
   foi iniciada pelo Caio (`started_by_caio`) ou se o bot estiver pausado nela
   (`bot_paused_until`).
4. Caso contrário, monta o contexto com a base de conhecimento
   (`knowledge_base`) + as últimas 40 mensagens, chama o Gemini, salva a
   resposta gerada e (se `AUTO_RESPOND=true`) envia pelo WhatsApp.

Quando o Caio responde um cliente pelo próprio celular, a mensagem fica
registrada no painel e o bot pausa naquela conversa por `pausa_horas` horas
(tabela `settings`; padrão 24). Mensagens escritas no painel são enviadas
pelo bot assim que gravadas e também pausam a conversa.

## Decisões do Caio e aprendizado contínuo

Quando a base de conhecimento não responde o que o cliente pediu, a IA **não
responde o cliente**: o bot manda a pergunta na conversa do Caio com o próprio
número, com um `ref` no fim. O Caio responde **citando essa mensagem**; o bot
envia a resposta ao cliente no tom dele e grava um item novo na
`knowledge_base`, para responder sozinho da próxima vez. Se o Caio preferir
responder direto ao cliente pelo celular, o bot também aprende com essa
resposta.

Enquanto a decisão está pendente (`pending_decision_at`), o bot não responde
naquela conversa e lembra o Caio a cada `lembrete_decisao_horas` horas.

## Configurações (tabela `settings`)

| Chave | Padrão | O que faz |
|---|---|---|
| `pausa_horas` | 24 | Quanto tempo o bot fica sem responder numa conversa depois que o Caio responde por conta própria |
| `lembrete_decisao_horas` | 2 | De quanto em quanto tempo o bot lembra o Caio de uma decisão pendente |

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
