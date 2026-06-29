import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // Meta verifica el webhook con GET
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode      = url.searchParams.get('hub.mode');
    const token     = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    const verifyToken = Deno.env.get('WA_VERIFY_TOKEN');
    if (mode === 'subscribe' && token === verifyToken) {
      return new Response(challenge, { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  }

  // POST: mensaje entrante
  if (req.method === 'POST') {
    try {
      const body = await req.json();
      const entry = body?.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const messages = value?.messages;

      if (!messages?.length) {
        return new Response('ok', { status: 200 });
      }

      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );

      for (const msg of messages) {
        if (msg.type !== 'text') continue;
        const contacto = value?.contacts?.find((c: any) => c.wa_id === msg.from);
        await supabase.from('whatsapp_mensajes').insert({
          de: msg.from,
          nombre: contacto?.profile?.name || msg.from,
          mensaje: msg.text?.body || '',
          timestamp: new Date(Number(msg.timestamp) * 1000).toISOString(),
        });
      }

      return new Response('ok', { status: 200 });
    } catch (e) {
      console.error(e);
      return new Response('error', { status: 200 }); // Meta requiere 200 siempre
    }
  }

  return new Response('Method not allowed', { status: 405 });
});
