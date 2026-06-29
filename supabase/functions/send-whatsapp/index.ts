import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { to, message, phone_number_id } = await req.json();
    if (!to || !message) {
      return new Response(JSON.stringify({ error: 'to y message son requeridos' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    const token = Deno.env.get('WHATSAPP_TOKEN');
    if (!token) {
      return new Response(JSON.stringify({ error: 'Token no configurado' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // Número real de Grosso Argentina por defecto
    const phoneId = phone_number_id || '482676874937376';

    // Limpiar el número: solo dígitos, sin + ni espacios
    const toClean = to.replace(/\D/g, '');

    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: toClean,
        type: 'text',
        text: { body: message, preview_url: false },
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      return new Response(JSON.stringify({ error: data.error?.message || 'Error de Meta', details: data }), {
        status: res.status,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true, message_id: data.messages?.[0]?.id }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
