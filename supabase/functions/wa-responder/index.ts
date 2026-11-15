import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Manda un mensaje saliente de whatsapp_mensajes (estado 'pendiente').
// La llama el trigger wa_despachar_saliente con { id } y el header x-cron-key (clave interna en Vault).
// - plantilla = false → texto libre, solo si la persona escribió en las últimas 24 h.
// - plantilla = true  → plantilla aprobada retomar_conversacion (sirve en cualquier momento).

const KEY_HASH = '2c107b993789bc0884bb7b46242fce6a89a9e3a40e90c950de857c09cb6f6ad3';

async function sha256(s: string) {
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

const param = (s: string) => String(s || '').replace(/[\n\r\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 900) || '-';

Deno.serve(async (req) => {
  if ((await sha256(req.headers.get('x-cron-key') || '')) !== KEY_HASH) return new Response('Forbidden', { status: 403 });

  const { id } = await req.json().catch(() => ({}));
  if (!id) return Response.json({ error: 'id requerido' }, { status: 400 });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  // Tomar el mensaje solo si sigue pendiente (evita mandarlo dos veces)
  const { data: filas } = await db.from('whatsapp_mensajes')
    .update({ estado: 'enviado' }).eq('id', id).eq('direccion', 'saliente').eq('estado', 'pendiente')
    .select('*');
  const m = filas?.[0];
  if (!m) return Response.json({ ok: false, motivo: 'No está pendiente' });

  const marcar = (cambios: Record<string, unknown>) => db.from('whatsapp_mensajes').update(cambios).eq('id', id);

  if (!m.plantilla) {
    const { data: ult } = await db.from('whatsapp_mensajes')
      .select('timestamp').eq('de', m.de).eq('direccion', 'entrante')
      .order('timestamp', { ascending: false }).limit(1);
    const ultimo = ult?.[0]?.timestamp ? new Date(ult[0].timestamp).getTime() : 0;
    if (Date.now() - ultimo > 24 * 3600 * 1000 - 60 * 1000) {
      await marcar({ estado: 'fuera_de_ventana', error: 'Pasaron más de 24 h desde el último mensaje de esta persona. Mandalo como "Retomar conversación".' });
      return Response.json({ ok: false, motivo: 'fuera_de_ventana' });
    }
  }

  const payload = m.plantilla
    ? { type: 'template', template: { name: 'retomar_conversacion', language: { code: 'es_AR' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: param(m.mensaje) }] }] } }
    : { type: 'text', text: { body: m.mensaje, preview_url: true } };

  const res = await fetch(`https://graph.facebook.com/v21.0/${Deno.env.get('WHATSAPP_PHONE_ID')}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('WHATSAPP_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: m.de, ...payload }),
  });
  const data = await res.json();
  if (!res.ok) {
    await marcar({ estado: 'error', error: data?.error?.error_data?.details || data?.error?.message || `Error de Meta (${res.status})` });
    return Response.json({ ok: false, error: data?.error });
  }
  await marcar({ estado: 'enviado', wamid: data?.messages?.[0]?.id, error: null });
  return Response.json({ ok: true, wamid: data?.messages?.[0]?.id });
});
