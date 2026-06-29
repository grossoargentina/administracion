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
    const phoneId = phone_number_id || Deno.env.get('WHATSAPP_PHONE_ID') || '482676874937376';

    // Limpiar el número: solo dígitos, sin + ni espacios
    let toClean = to.replace(/\D/g, '');
    // Si empieza con 0 (ej: 011...), reemplazar por 54
    if (toClean.startsWith('0')) toClean = '54' + toClean.slice(1);
    // Si tiene 10 dígitos (AR sin código de país), agregar 54
    if (toClean.length === 10) toClean = '54' + toClean;
    // Argentina: números de 12 dígitos empezando con 54 necesitan el 9 (ej: 5411... → 54911...)
    if (toClean.length === 12 && toClean.startsWith('54')) {
      toClean = '549' + toClean.slice(2);
    }

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
