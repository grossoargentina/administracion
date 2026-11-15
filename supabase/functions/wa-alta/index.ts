import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Alta de un número nuevo de WhatsApp con coexistencia (Embedded Signup) y cambio de número activo.
// Solo para el admin logueado. Acciones (body.accion):
//   estado      → número activo, número nuevo (si hay) y estado de sus plantillas
//   alta        → { code, waba_id, phone_number_id, historial } canjea el código de Embedded Signup,
//                 guarda el token en Vault como "nuevo", suscribe la app a la cuenta y (opcional) pide el historial
//   plantillas  → crea en la cuenta nueva las plantillas que usa la plataforma (si faltan)
//   activar     → pasa a usar el número nuevo para todo

const GRAPH = 'https://graph.facebook.com/v21.0';
const APP_ID = '1706628640583124';
const WABA_ACTUAL_DEFAULT = '993253533489565';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

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

// Las plantillas que usa la plataforma (mismo texto que las aprobadas en la cuenta original)
const PLANTILLAS = [
  {
    name: 'aviso_logistica', language: 'es_AR', category: 'UTILITY',
    components: [
      { type: 'BODY', text: 'Hola {{1}}, ya está tu logística de Grosso Argentina para {{2}}. Tocá el botón para verla completa.',
        example: { body_text: [['Juan', 'sábado 21/11 - Salón Dorado']] } },
      { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Ver mi logística' }] },
    ],
  },
  {
    name: 'recordatorio_logistica', language: 'es_AR', category: 'UTILITY',
    components: [
      { type: 'BODY', text: 'Hola {{1}}, te recordamos que mañana {{2}} trabajás en {{3}} con Grosso Argentina. Tocá el botón para ver tu logística con horarios y dirección.',
        example: { body_text: [['Juan', 'sábado 21', 'Salón Dorado']] } },
      { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Ver mi logística' }] },
    ],
  },
  {
    name: 'retomar_conversacion', language: 'es_AR', category: 'UTILITY',
    components: [
      { type: 'BODY', text: 'Hola, te escribimos de Grosso Argentina: {{1}}. Respondé este mensaje para seguir la conversación.',
        example: { body_text: [['necesitamos confirmar tu horario de llegada del sábado']] } },
    ],
  },
];

async function graph(path: string, token: string, init: RequestInit = {}) {
  const res = await fetch(`${GRAPH}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const setConfig = (clave: string, valor: string | null) =>
    db.from('wa_config').upsert({ clave, valor, updated_at: new Date().toISOString() });
  const cred = async (nuevo: boolean) => {
    const { data } = await db.rpc('wa_credenciales', { p_nuevo: nuevo });
    const c = data?.[0] || {};
    return nuevo
      ? { phoneId: c.phone_id, wabaId: c.waba_id, token: c.token }
      : { phoneId: c.phone_id || Deno.env.get('WHATSAPP_PHONE_ID'), wabaId: c.waba_id || WABA_ACTUAL_DEFAULT, token: c.token || Deno.env.get('WHATSAPP_TOKEN') };
  };

  try {
    const body = await req.json().catch(() => ({}));
    const accion = body.accion;

    if (accion === 'estado') {
      const actual = await cred(false);
      const nuevo = await cred(true);
      const info = async (c: { phoneId?: string; wabaId?: string; token?: string }) => {
        if (!c.phoneId || !c.token) return null;
        const tel = await graph(`${c.phoneId}?fields=display_phone_number,verified_name,status,platform_type,quality_rating`, c.token);
        const pls = c.wabaId ? await graph(`${c.wabaId}/message_templates?fields=name,status,language,category&limit=50`, c.token) : null;
        return {
          phone_id: c.phoneId, waba_id: c.wabaId,
          numero: tel.data?.display_phone_number, nombre: tel.data?.verified_name, estado: tel.data?.status, error: tel.data?.error?.message,
          plantillas: (pls?.data?.data || []).filter((p: any) => PLANTILLAS.some((x) => x.name === p.name))
            .map((p: any) => ({ nombre: p.name, estado: p.status, categoria: p.category })),
        };
      };
      return json({ actual: await info(actual), nuevo: await info(nuevo) });
    }

    if (accion === 'alta') {
      const { code, waba_id, phone_number_id, historial } = body;
      if (!code || !waba_id || !phone_number_id) return json({ error: 'Faltan datos del alta (code, waba_id, phone_number_id)' }, 400);

      // 1) Canjear el código (vale 30 segundos) por el token del negocio
      const tk = await fetch(`${GRAPH}/oauth/access_token?client_id=${APP_ID}&client_secret=${encodeURIComponent(Deno.env.get('WHATSAPP_APP_SECRET') || '')}&code=${encodeURIComponent(code)}`);
      const tkData = await tk.json();
      if (!tk.ok || !tkData.access_token) return json({ error: 'No se pudo canjear el código de Meta: ' + (tkData?.error?.message || tk.status) }, 400);
      const token = tkData.access_token as string;

      // 2) Guardar como "número nuevo" (todavía no se usa para mandar)
      const { error: vErr } = await db.rpc('wa_guardar_token', { p_nombre: 'wa_token_nuevo', p_valor: token });
      if (vErr) return json({ error: 'No se pudo guardar el token: ' + vErr.message }, 500);
      await setConfig('phone_id_nuevo', String(phone_number_id));
      await setConfig('waba_id_nuevo', String(waba_id));

      // 3) Que el webhook de la plataforma reciba los mensajes de esta cuenta
      const sub = await graph(`${waba_id}/subscribed_apps`, token, { method: 'POST' });

      // 4) Historial de chats (opcional, solo si se eligió; hay 24 h para pedirlo)
      let hist = null;
      if (historial) {
        hist = await graph(`${phone_number_id}/smb_app_data`, token, {
          method: 'POST', body: JSON.stringify({ messaging_product: 'whatsapp', sync_type: 'history' }),
        });
      }

      const tel = await graph(`${phone_number_id}?fields=display_phone_number,verified_name,status,platform_type`, token);
      return json({
        ok: true,
        numero: tel.data?.display_phone_number, nombre: tel.data?.verified_name, estado: tel.data?.status,
        webhook_suscripto: sub.ok, webhook_error: sub.ok ? null : sub.data?.error?.message,
        historial: hist ? (hist.ok ? 'pedido' : hist.data?.error?.message) : 'no pedido',
      });
    }

    if (accion === 'plantillas') {
      const nuevo = await cred(true);
      if (!nuevo.wabaId || !nuevo.token) return json({ error: 'Todavía no hay un número nuevo dado de alta' }, 400);
      const existentes = await graph(`${nuevo.wabaId}/message_templates?fields=name,status&limit=100`, nuevo.token);
      const nombres = new Set((existentes.data?.data || []).map((p: any) => p.name));
      const resultado = [];
      for (const p of PLANTILLAS) {
        if (nombres.has(p.name)) { resultado.push({ nombre: p.name, estado: 'ya existía' }); continue; }
        const r = await graph(`${nuevo.wabaId}/message_templates`, nuevo.token, { method: 'POST', body: JSON.stringify(p) });
        resultado.push({ nombre: p.name, estado: r.ok ? (r.data?.status || 'creada') : 'error', error: r.ok ? null : r.data?.error?.error_user_msg || r.data?.error?.message });
      }
      return json({ ok: true, plantillas: resultado });
    }

    if (accion === 'activar') {
      const nuevo = await cred(true);
      if (!nuevo.phoneId || !nuevo.token) return json({ error: 'Todavía no hay un número nuevo dado de alta' }, 400);
      const actual = await cred(false);
      // Guardar el anterior por si hay que volver atrás
      await setConfig('phone_id_anterior', actual.phoneId || null);
      await setConfig('waba_id_anterior', actual.wabaId || null);
      const { error: vErr } = await db.rpc('wa_guardar_token', { p_nombre: 'wa_token', p_valor: nuevo.token });
      if (vErr) return json({ error: 'No se pudo guardar el token: ' + vErr.message }, 500);
      await setConfig('phone_id', nuevo.phoneId);
      await setConfig('waba_id', nuevo.wabaId);
      return json({ ok: true, activo: nuevo.phoneId });
    }

    return json({ error: 'Acción desconocida' }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
