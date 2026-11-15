import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Recordatorio por WhatsApp el día anterior a cada jornada.
// La llama pg_cron todos los días a las 10:00 (Argentina) con el header x-cron-key (guardado en Vault).
// Para cada técnico que tiene una jornada MAÑANA y no respondió "No puedo", manda la plantilla
// recordatorio_logistica con el botón "Ver mi logística" (payload ver:<id>, lo procesa whatsapp-webhook).
//
// Parámetros opcionales (solo para pruebas, también requieren la clave):
//   ?fecha=YYYY-MM-DD  → recordar esa fecha en lugar de mañana
//   ?solo=549...       → mandar solo a ese número
//   ?simular=1         → no manda nada, devuelve la lista

const CRON_KEY_HASH = '2c107b993789bc0884bb7b46242fce6a89a9e3a40e90c950de857c09cb6f6ad3';
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

async function sha256(s: string) {
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// Fecha de mañana en Argentina, YYYY-MM-DD
function mananaAR() {
  const hoy = new Date(Date.now() - 3 * 3600 * 1000); // UTC-3, Argentina no tiene horario de verano
  hoy.setUTCDate(hoy.getUTCDate() + 1);
  return hoy.toISOString().slice(0, 10);
}

const param = (s: string) => String(s || '').replace(/[\n\r\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 200) || '-';

Deno.serve(async (req) => {
  if ((await sha256(req.headers.get('x-cron-key') || '')) !== CRON_KEY_HASH) {
    return new Response('Forbidden', { status: 403 });
  }
  const url = new URL(req.url);
  const fecha = url.searchParams.get('fecha') || mananaAR();
  const solo = url.searchParams.get('solo');
  const simular = url.searchParams.get('simular') === '1';

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let q = db.from('wa_envios')
    .select('id, nombre, titulo, evento, telefono, estado, recordados, created_at')
    .contains('fechas', [fecha])
    .not('estado', 'in', '(no_puede,error,pendiente)')
    .order('created_at', { ascending: false });
  if (solo) q = q.eq('telefono', solo);
  const { data: filas, error } = await q;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Un solo recordatorio por persona y evento (el envío más nuevo), y nunca dos veces la misma fecha
  const vistos = new Set<string>();
  const aMandar = [];
  const yaRecordados = [];
  for (const f of filas || []) {
    const clave = `${f.telefono}|${f.titulo || f.evento}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    if ((f.recordados || []).includes(fecha)) yaRecordados.push(f.id); else aMandar.push(f);
  }

  const d = new Date(fecha + 'T12:00:00Z');
  const diaLabel = `${DIAS[d.getUTCDay()]} ${d.getUTCDate()}`;
  const resultado = { fecha, total: aMandar.length, ya_recordados: yaRecordados.length, enviados: [] as unknown[], errores: [] as unknown[] };
  if (simular) return Response.json({ ...resultado, simulado: aMandar.map((f) => ({ id: f.id, nombre: f.nombre, titulo: f.titulo })) });

  for (const f of aMandar) {
    const res = await fetch(`https://graph.facebook.com/v21.0/${Deno.env.get('WHATSAPP_PHONE_ID')}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${Deno.env.get('WHATSAPP_TOKEN')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to: f.telefono, type: 'template',
        template: {
          name: 'recordatorio_logistica', language: { code: 'es_AR' },
          components: [
            { type: 'body', parameters: [
              { type: 'text', text: param(f.nombre) },
              { type: 'text', text: diaLabel },
              { type: 'text', text: param(f.titulo || f.evento) },
            ] },
            { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: `ver:${f.id}` }] },
          ],
        },
      }),
    });
    const data = await res.json();
    if (res.ok) {
      await db.from('wa_envios').update({ recordados: [...(f.recordados || []), fecha], updated_at: new Date().toISOString() }).eq('id', f.id);
      resultado.enviados.push({ id: f.id, nombre: f.nombre });
    } else {
      resultado.errores.push({ id: f.id, nombre: f.nombre, error: data?.error?.error_data?.details || data?.error?.message });
    }
  }
  console.log('Recordatorios', JSON.stringify(resultado));
  return Response.json(resultado);
});
