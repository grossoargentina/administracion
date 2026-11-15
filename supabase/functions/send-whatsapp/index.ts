import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// Solo usuarios logueados en la plataforma y autorizados pueden usar esta función.
const ADMIN_EMAILS = (Deno.env.get('ADMIN_EMAILS') || 'administracion@grossoarg.com')
  .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

async function requireAdmin(req: Request): Promise<Response | null> {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'No autorizado' }, 401);
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
    headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '', Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) return json({ error: 'Sesión inválida o vencida' }, 401);
  const user = await res.json();
  if (!ADMIN_EMAILS.includes(String(user?.email || '').toLowerCase())) return json({ error: 'Usuario no autorizado' }, 401);
  return null;
}

// Número argentino → formato internacional que usa WhatsApp (549 + área + número)
function normalizarAR(to: string) {
  let n = String(to).replace(/\D/g, '');
  if (n.startsWith('00')) n = n.slice(2);
  if (n.startsWith('0')) n = '54' + n.slice(1);
  if (n.length === 10) n = '54' + n;
  if (n.length === 12 && n.startsWith('54')) n = '549' + n.slice(2);
  return n;
}

// Los parámetros de plantilla no admiten saltos de línea, tabs ni más de 4 espacios seguidos
const param = (s: string) => String(s || '').replace(/[\n\r\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 200) || '-';

async function enviarWA(payload: Record<string, unknown>) {
  const phoneId = Deno.env.get('WHATSAPP_PHONE_ID') || '482676874937376';
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('WHATSAPP_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const denied = await requireAdmin(req);
  if (denied) return denied;

  if (!Deno.env.get('WHATSAPP_TOKEN')) return json({ error: 'Token no configurado' }, 500);

  try {
    const body = await req.json();
    if (!body?.to) return json({ error: 'to es requerido' }, 400);
    const to = normalizarAR(body.to);

    // ── Logística: aviso con plantilla aprobada + botón "Ver mi logística" ──
    if (body.tipo === 'logistica') {
      if (!body.texto) return json({ error: 'texto es requerido' }, 400);
      const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const { data: envio, error: insErr } = await db.from('wa_envios').insert({
        personal_id: body.personal_id ?? null,
        nombre: body.nombre ?? null,
        evento: body.evento ?? null,
        telefono: to,
        texto: body.texto,
      }).select('id').single();
      if (insErr) return json({ error: 'No se pudo registrar el envío: ' + insErr.message }, 500);

      const r = await enviarWA({
        to, type: 'template',
        template: {
          name: Deno.env.get('WA_TEMPLATE_LOGISTICA') || 'aviso_logistica',
          language: { code: 'es_AR' },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: param(body.nombre) }, { type: 'text', text: param(body.evento) }] },
            { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: `ver:${envio.id}` }] },
          ],
        },
      });

      if (!r.ok) {
        const msg = r.data?.error?.error_data?.details || r.data?.error?.message || 'Error de Meta';
        await db.from('wa_envios').update({ estado: 'error', error: msg, updated_at: new Date().toISOString() }).eq('id', envio.id);
        return json({ error: msg, envio_id: envio.id, details: r.data }, r.status);
      }
      await db.from('wa_envios').update({
        estado: 'enviado',
        wamid_aviso: r.data?.messages?.[0]?.id,
        telefono: r.data?.contacts?.[0]?.wa_id || to,
        updated_at: new Date().toISOString(),
      }).eq('id', envio.id);
      return json({ ok: true, envio_id: envio.id, message_id: r.data?.messages?.[0]?.id });
    }

    // ── Texto libre: SOLO llega si la persona escribió en las últimas 24 h ──
    if (!body.message) return json({ error: 'message es requerido' }, 400);
    const r = await enviarWA({ to, type: 'text', text: { body: body.message, preview_url: false } });
    if (!r.ok) return json({ error: r.data?.error?.message || 'Error de Meta', details: r.data }, r.status);
    return json({ ok: true, message_id: r.data?.messages?.[0]?.id });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
