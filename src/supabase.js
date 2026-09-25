import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error(
    'Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no arquivo .env'
  );
}

// Usamos a service_role key aqui de propósito: este processo roda em um
// servidor confiável (não em um navegador), e precisa ignorar as políticas
// de RLS para ler/gravar mensagens de qualquer contato.
export const supabase = createClient(url, key, {
  auth: { persistSession: false },
});
