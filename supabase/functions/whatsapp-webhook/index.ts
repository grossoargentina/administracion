import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Número y token activos: desde la base (wa_config + Vault) o, si no hay, los secretos de siempre
const CRED = { phoneId: '', token: '' };
async function cargarCred(db: any) {
  const { data } = await db.rpc('wa_credenciales', { p_nuevo: false });
  const c = data?.[0] || {};
  CRED.phoneId = c.phone_id || Deno.env.get('WHATSAPP_PHONE_ID') || '';
  CRED.token = c.token || Deno.env.get('WHATSAPP_TOKEN') || '';
}


// Webhook de WhatsApp (Meta Cloud API).
// - Guarda todo mensaje entrante en whatsapp_mensajes.
// - Actualiza el estado de los avisos de logística (wa_envios) con los "statuses" de Meta.
// - Botón "Ver mi logística" (payload ver:<id>) → manda la logística completa + botones Confirmo / No puedo.
// - Botones conf:<id> / nop:<id> → registra la respuesta.

const GRAPH = 'https://graph.facebook.com/v21.0';

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

async function enviarWA(payload: Record<string, unknown>) {
  const phoneId = CRED.phoneId;
  const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CRED.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Error de Meta (${res.status})`);
  return data?.messages?.[0]?.id as string | undefined;
}

// Deja registrado en la conversación un mensaje que mandó el sistema solo
async function registrarSaliente(db: any, to: string, mensaje: string, wamid?: string) {
  await db.from('whatsapp_mensajes').insert({
    de: to, mensaje, direccion: 'saliente', estado: 'enviado', wamid, enviado_por: 'automatico', leido: true,
  });
}

// Orden de avance: un estado nunca vuelve atrás (Meta puede mandar "delivered" después de "read").
const RANGO: Record<string, number> = {
  pendiente: 0, error: 0, enviado: 1, entregado: 2, leido: 3, vio_logistica: 4, confirmo: 5, no_puede: 5,
};

function textoLegible(msg: any): string {
  switch (msg.type) {
    case 'text': return msg.text?.body || '';
    case 'button': return `[Botón] ${msg.button?.text || ''}`;
    case 'interactive':
      return `[Botón] ${msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || ''}`;
    case 'image': case 'video': case 'audio': case 'document': case 'sticker':
      return `[${msg.type}]${msg[msg.type]?.caption ? ' ' + msg[msg.type].caption : ''}`;
    case 'location': return `[ubicación] ${msg.location?.latitude},${msg.location?.longitude}`;
    default: return `[${msg.type}]`;
  }
}

serve(async (req) => {
  // Meta verifica el webhook con GET
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode      = url.searchParams.get('hub.mode');
    const token     = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && token && token === Deno.env.get('WA_VERIFY_TOKEN')) {
      return new Response(challenge, { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  }

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const raw = await req.text();
  if (!(await firmaValida(raw, req.headers.get('X-Hub-Signature-256')))) {
    console.warn('Webhook rechazado: firma de Meta inválida o WHATSAPP_APP_SECRET sin configurar');
    return new Response('Forbidden', { status: 403 });
  }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  await cargarCred(db);

  try {
    const body = JSON.parse(raw);
    for (const entry of body?.entry || []) {
      for (const change of entry?.changes || []) {
        const value = change?.value || {};

        // 1) Estados de mensajes enviados (sent / delivered / read / failed)
        for (const st of value.statuses || []) {
          // Estado del mensaje en la conversación (sección Mensajes)
          const { data: msj } = await db.from('whatsapp_mensajes').select('id, estado').eq('wamid', st.id).maybeSingle();
          if (msj) {
            const RM: Record<string, number> = { enviado: 1, entregado: 2, leido: 3 };
            if (st.status === 'failed') {
              const e = st.errors?.[0];
              await db.from('whatsapp_mensajes').update({ estado: 'error', error: `${e?.code ?? ''} ${e?.title ?? ''} ${e?.error_data?.details ?? ''}`.trim() }).eq('id', msj.id);
            } else {
              const nuevo = st.status === 'delivered' ? 'entregado' : st.status === 'read' ? 'leido' : null;
              if (nuevo && RM[nuevo] > (RM[msj.estado] || 0)) await db.from('whatsapp_mensajes').update({ estado: nuevo }).eq('id', msj.id);
            }
          }

          const cols = 'id, estado, wamid_aviso, wamid_logistica';
          let { data: envio } = await db.from('wa_envios').select(cols).eq('wamid_aviso', st.id).maybeSingle();
          if (!envio) ({ data: envio } = await db.from('wa_envios').select(cols).eq('wamid_logistica', st.id).maybeSingle());
          if (!envio) continue;
          const esAviso = envio.wamid_aviso === st.id;
          const err = st.errors?.[0];
          let cambios: Record<string, unknown> | null = null;
          if (st.status === 'failed') {
            const detalle = `${err?.code ?? ''} ${err?.title ?? ''} ${err?.error_data?.details ?? ''}`.trim();
            cambios = esAviso
              ? { estado: 'error', error: detalle || 'Falló el envío' }
              : { error: `No se pudo mandar la logística completa: ${detalle}` };
          } else if (esAviso) {
            const nuevo = st.status === 'delivered' ? 'entregado' : st.status === 'read' ? 'leido' : st.status === 'sent' ? 'enviado' : null;
            if (nuevo && RANGO[nuevo] > RANGO[envio.estado]) cambios = { estado: nuevo };
          }
          if (cambios) await db.from('wa_envios').update({ ...cambios, updated_at: new Date().toISOString() }).eq('id', envio.id);
        }

        // Coexistencia: lo que se manda desde la app WhatsApp Business del celular ("echoes")
        for (const echo of value.message_echoes || []) {
          const { data: ya } = await db.from('whatsapp_mensajes').select('id').eq('wamid', echo.id).maybeSingle();
          if (ya) continue;
          await db.from('whatsapp_mensajes').insert({
            de: echo.to, mensaje: textoLegible(echo), direccion: 'saliente', estado: 'enviado',
            wamid: echo.id, enviado_por: 'celular', leido: true,
            timestamp: new Date(Number(echo.timestamp) * 1000).toISOString(),
          });
        }

        // Coexistencia: historial de chats (solo llega si se pidió al dar de alta el número)
        for (const h of value.history || []) {
          for (const th of h.threads || []) {
            for (const hm of th.messages || []) {
              const { data: ya } = await db.from('whatsapp_mensajes').select('id').eq('wamid', hm.id).maybeSingle();
              if (ya) continue;
              const entrante = hm.from === th.id;
              await db.from('whatsapp_mensajes').insert({
                de: th.id, mensaje: textoLegible(hm), direccion: entrante ? 'entrante' : 'saliente',
                estado: entrante ? null : 'enviado', wamid: hm.id, enviado_por: entrante ? null : 'celular', leido: true,
                timestamp: new Date(Number(hm.timestamp) * 1000).toISOString(),
              });
            }
          }
        }

        // 2) Mensajes entrantes
        for (const msg of value.messages || []) {
          const contacto = value.contacts?.find((c: any) => c.wa_id === msg.from);
          await db.from('whatsapp_mensajes').insert({
            de: msg.from,
            nombre: contacto?.profile?.name || msg.from,
            mensaje: textoLegible(msg),
            timestamp: new Date(Number(msg.timestamp) * 1000).toISOString(),
          });

          // Botón "Ver mi logística" de la plantilla
          if (msg.type === 'button') {
            const m = /^ver:(\d+)$/.exec(msg.button?.payload || '');
            let q = db.from('wa_envios').select('*').eq('telefono', msg.from);
            q = m ? q.eq('id', Number(m[1])) : q.order('created_at', { ascending: false }).limit(1);
            const { data: filas } = await q;
            const envio = filas?.[0];
            if (!envio) continue;
            try {
              const wamid = await enviarWA({ to: msg.from, type: 'text', text: { body: envio.texto, preview_url: true } });
              await registrarSaliente(db, msg.from, envio.texto, wamid);
              const wamidPregunta = await enviarWA({
                to: msg.from, type: 'interactive',
                interactive: {
                  type: 'button',
                  body: { text: '¿Confirmás tu asistencia?' },
                  action: { buttons: [
                    { type: 'reply', reply: { id: `conf:${envio.id}`, title: 'Confirmo' } },
                    { type: 'reply', reply: { id: `nop:${envio.id}`, title: 'No puedo' } },
                  ] },
                },
              });
              await registrarSaliente(db, msg.from, '¿Confirmás tu asistencia? [Confirmo] [No puedo]', wamidPregunta);
              const cambios: Record<string, unknown> = { wamid_logistica: wamid, updated_at: new Date().toISOString() };
              if (RANGO.vio_logistica > RANGO[envio.estado]) cambios.estado = 'vio_logistica';
              await db.from('wa_envios').update(cambios).eq('id', envio.id);
            } catch (e) {
              await db.from('wa_envios').update({ error: `No se pudo mandar la logística completa: ${e}`, updated_at: new Date().toISOString() }).eq('id', envio.id);
            }
          }

          // Botones Confirmo / No puedo
          if (msg.type === 'interactive' && msg.interactive?.type === 'button_reply') {
            const m = /^(conf|nop):(\d+)$/.exec(msg.interactive.button_reply?.id || '');
            if (!m) continue;
            const estado = m[1] === 'conf' ? 'confirmo' : 'no_puede';
            const { data: upd } = await db.from('wa_envios')
              .update({ estado, updated_at: new Date().toISOString() })
              .eq('id', Number(m[2])).eq('telefono', msg.from).select('id');
            if (upd?.length) {
              const gracias = estado === 'confirmo'
                ? '¡Gracias! Quedó registrada tu confirmación. 👍'
                : 'Gracias por avisar. Ya le llega a administración.';
              try {
                const w = await enviarWA({ to: msg.from, type: 'text', text: { body: gracias } });
                await registrarSaliente(db, msg.from, gracias, w);
              } catch (_) { /* no bloquear el webhook */ }
            }
          }
        }
      }
    }
  } catch (e) {
    console.error('Error procesando webhook:', e);
  }
  return new Response('ok', { status: 200 }); // Meta requiere 200 siempre
});
