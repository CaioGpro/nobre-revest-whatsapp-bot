# Nobre Revest — Painel do CRM

Painel web para acompanhar as conversas do WhatsApp (respondidas pela IA ou
por você), mudar o status de cada atendimento e manter a base de
conhecimento (preços, serviços, FAQ) que a IA usa para responder.

Feito em React + Vite + Tailwind + Supabase — a mesma stack que o Lovable
usa, então dá para rodar aqui ou importar/recriar lá.

## Login

Seu usuário já foi criado no Supabase Auth com o email e senha que você
definiu. Se quiser trocar a senha depois: Supabase Dashboard → Authentication
→ Users → seu usuário → "Send password recovery" ou edite direto por lá.

## Como rodar localmente

```bash
npm install
cp .env.example .env   # já vem preenchido com URL e chave pública do projeto
npm run dev
```

Abra o endereço que aparecer no terminal (geralmente http://localhost:5173).

## Como usar no Lovable

O Lovable funciona melhor importando um repositório do GitHub. Passos:

1. Suba esta pasta para um repositório no GitHub (pode ser privado).
2. No Lovable, crie um novo projeto a partir desse repositório (ou peça para
   o Lovable "clonar"/importar o código).
3. Nas variáveis de ambiente do projeto no Lovable, configure
   `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` com os mesmos valores do
   `.env.example` (são chaves públicas, seguras para expor no frontend).
4. Publique — o painel vai ler e escrever no mesmo banco Supabase que o bot
   do WhatsApp usa, em tempo real.

## O que o painel faz

- **Conversas**: lista todos os contatos que já escreveram no WhatsApp,
  com status (Novo, Em andamento, Aguardando você, Fechado, Perdido) e
  horário da última mensagem. Ao selecionar uma conversa, vê o histórico
  completo e pode:
  - Mudar o status (ex: marcar "Aguardando você" para a IA parar de
    responder automaticamente e você assumir).
  - Enviar uma mensagem manual — ela é enviada de fato pelo WhatsApp do
    cliente através do bot (que precisa estar rodando).
- **Base de conhecimento**: cadastro de serviços, preços, FAQ e informações
  da empresa que a IA usa como contexto para responder. Pode ativar/desativar
  itens sem precisar apagar.

## Importante

Este painel sozinho não conecta ao WhatsApp — quem faz isso é o backend
separado (`whatsapp-bot`). Os dois se conectam pelo mesmo banco Supabase, mas
rodam como processos/projetos independentes.
