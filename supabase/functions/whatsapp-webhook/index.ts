import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Meta firma cada POST con HMAC-SHA256 del cuerpo usando el "App Secret" de la app.
async function firmaValida(raw: string, header: string | null): Promise<boolean> {
  const secret = Deno.env.get('WHATSAPP_APP_SECRET');
  if (!secret || !header?.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)));
  const esperado = 'sha256=' + [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (esperado.length !== header.length) return false;
  let diff = 0;
  for (let i = 0; i < esperado.length; i++) diff |= esperado.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}

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
      const raw = await req.text();
      if (!(await firmaValida(raw, req.headers.get('X-Hub-Signature-256')))) {
        console.warn('Webhook rechazado: firma de Meta inválida o WHATSAPP_APP_SECRET sin configurar');
        return new Response('Forbidden', { status: 403 });
      }
      const body = JSON.parse(raw);
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
