import { state } from '../state';
import { sb, sbPost, escHtml, toast, authHeaders } from '../helpers';
import { SB_URL } from '../config';

// ── MENSAJES WHATSAPP (conversaciones) ────────────────────
// Responder = insertar un mensaje saliente 'pendiente'; el trigger de la base llama a la
// función wa-responder, que lo manda y actualiza el estado (se ve en vivo por realtime).
// Si la persona no escribió en las últimas 24 h, WhatsApp solo permite plantillas:
// el mensaje sale como "retomar_conversacion" ("Hola, te escribimos de Grosso Argentina: …").

let conversaciones = [];
let telActual = null;   // número de la conversación abierta
let contactoNuevo = null; // contacto elegido con "Nuevo mensaje" que todavía no tiene mensajes

const ESTADO_ICONO = {
  pendiente: ['⏳', 'Enviando'],
  enviado: ['✓', 'Enviado'],
  entregado: ['✓✓', 'Entregado'],
  leido: ['✓✓', 'Leído'],
  error: ['❌', 'Error'],
  fuera_de_ventana: ['⚠️', 'No enviado'],
};
const ORIGEN = { claude: 'Claude', automatico: 'Automático', celular: 'Desde el celular', plataforma: '' };

const fmtHora = ts => {
  const d = new Date(ts);
  const hoy = new Date();
  return d.toDateString() === hoy.toDateString()
    ? d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

function actualizarBadge(n) {
  const badge = document.getElementById('nav-mensajes-badge');
  if (!badge) return;
  if (n > 0) { badge.textContent = n; badge.style.display = 'inline'; }
  else badge.style.display = 'none';
}

export async function loadMensajes() {
  try {
    conversaciones = await sb('wa_contactos', { order: 'ultimo_at.desc', limit: 300 });
    actualizarBadge(conversaciones.reduce((s, c) => s + (c.no_leidos || 0), 0));
    renderConversaciones();
    suscribirMensajes();
    if (telActual) await abrirConversacionWA(telActual, { silencioso: true });
  } catch (e) { toast('Error cargando mensajes: ' + e.message, 'err'); }
}

function renderConversaciones() {
  const filtro = (document.getElementById('wa-buscar')?.value || '').toLowerCase().trim();
  const lista = conversaciones.filter(c => !filtro || `${c.nombre} ${c.telefono}`.toLowerCase().includes(filtro));
  document.getElementById('wa-conversaciones').innerHTML = lista.length
    ? lista.map(c => `
      <div class="wa-conv ${c.telefono === telActual ? 'activa' : ''}" onclick="abrirConversacionWA('${escHtml(c.telefono)}')">
        <div class="wa-conv-main">
          <div class="wa-conv-top">
            <span class="wa-conv-nombre" style="${c.no_leidos ? '' : 'font-weight:500'}">${escHtml(c.nombre)}</span>
            <span class="wa-conv-hora">${fmtHora(c.ultimo_at)}</span>
          </div>
          <div class="wa-conv-ultimo">${c.ultima_direccion === 'saliente' ? '↪ ' : ''}${escHtml(c.ultimo_mensaje || '')}</div>
        </div>
        ${c.no_leidos ? `<span class="wa-badge">${c.no_leidos}</span>` : ''}
      </div>`).join('')
    : `<div class="wa-vacio">${filtro ? 'Sin resultados' : 'Todavía no hay conversaciones'}</div>`;
}

export function filtrarConversacionesWA() { renderConversaciones(); }

export async function abrirConversacionWA(tel, { silencioso = false } = {}) {
  if (tel !== telActual) contactoNuevo = null;
  telActual = tel;
  document.getElementById('wa-chat').classList.add('con-hilo');
  renderConversaciones();
  try {
    const msjs = await sb('whatsapp_mensajes', { filters: [`de=eq.${encodeURIComponent(tel)}`], order: 'timestamp.asc', limit: 500 });
    const conv = conversaciones.find(c => c.telefono === tel)
      || { telefono: tel, nombre: contactoNuevo?.nombre || tel, tipo: contactoNuevo ? 'Personal' : null, ventana_abierta: false };
    renderHilo(conv, msjs, silencioso);

    // Marcar como leídos los entrantes de esta conversación
    if (msjs.some(m => m.direccion === 'entrante' && !m.leido)) {
      await fetch(`${SB_URL}/rest/v1/whatsapp_mensajes?de=eq.${encodeURIComponent(tel)}&direccion=eq.entrante&leido=eq.false`, {
        method: 'PATCH', headers: await authHeaders(true), body: JSON.stringify({ leido: true }),
      });
      const c = conversaciones.find(x => x.telefono === tel);
      if (c) c.no_leidos = 0;
      actualizarBadge(conversaciones.reduce((s, x) => s + (x.no_leidos || 0), 0));
      renderConversaciones();
    }
  } catch (e) { toast('Error abriendo la conversación: ' + e.message, 'err'); }
}

function renderHilo(conv, msjs, conservarBorrador) {
  const taPrevio = document.getElementById('wa-texto') as HTMLTextAreaElement | null;
  const borrador = conservarBorrador ? (taPrevio?.value || '') : '';
  const teniaFoco = conservarBorrador && document.activeElement === taPrevio;
  const ventana = !!conv.ventana_abierta;
  const burbujas = msjs.map(m => {
    const [icono, label] = ESTADO_ICONO[m.estado] || ['', ''];
    const origen = m.direccion === 'saliente' && ORIGEN[m.enviado_por] ? `${ORIGEN[m.enviado_por]} · ` : '';
    const plantilla = m.plantilla ? 'Plantilla · ' : '';
    const estado = m.direccion === 'saliente' && icono
      ? ` <span title="${label}" style="${m.estado === 'leido' ? 'color:var(--blue)' : ''}">${icono}</span>` : '';
    return `<div class="wa-burbuja ${m.direccion}">${escHtml(m.mensaje || '')}
      <div class="wa-meta">${origen}${plantilla}${fmtHora(m.timestamp)}${estado}${m.error ? `<span class="err">${escHtml(m.error)}</span>` : ''}</div></div>`;
  }).join('');

  document.getElementById('wa-hilo').innerHTML = `
    <div class="wa-hilo-head">
      <button class="btn btn-ghost btn-sm wa-volver" onclick="cerrarConversacionWA()">←</button>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600">${escHtml(conv.nombre)}${conv.tipo ? ` <span style="font-size:11px;color:var(--text-3);font-weight:400">· ${escHtml(conv.tipo)}</span>` : ''}</div>
        <div style="font-size:11px;color:var(--text-3)">+${escHtml(conv.telefono)}${conv.nombre_whatsapp && conv.nombre_whatsapp !== conv.nombre ? ` · WhatsApp: ${escHtml(conv.nombre_whatsapp)}` : ''}</div>
      </div>
      <span style="font-size:11px;color:${ventana ? 'var(--green)' : 'var(--orange)'}">${ventana ? '● Puede responder libre' : '● Fuera de las 24 h'}</span>
    </div>
    <div class="wa-burbujas" id="wa-burbujas">${burbujas || '<div class="wa-vacio">Sin mensajes todavía</div>'}</div>
    ${ventana ? '' : `<div class="wa-aviso">Pasaron más de 24 h desde su último mensaje (o nunca escribió). WhatsApp solo deja mandar plantillas, así que tu texto va a salir así: <i>"Hola, te escribimos de Grosso Argentina: <b>tu mensaje</b>. Respondé este mensaje para seguir la conversación."</i> Cuando responda, ya podés escribir libre.</div>`}
    <div class="wa-composer">
      <textarea class="inp" id="wa-texto" rows="1" placeholder="${ventana ? 'Escribí tu respuesta…' : 'Escribí el motivo (una sola línea)…'}"
        onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();enviarRespuestaWA()}"
        oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,140)+'px'"></textarea>
      <button class="btn btn-primary" id="wa-btn-enviar" onclick="enviarRespuestaWA()">Enviar</button>
    </div>`;
  const ta = document.getElementById('wa-texto');
  ta.value = borrador;
  ta.dataset.ventana = ventana ? '1' : '0';
  ta.dataset.nombre = conv.nombre || '';
  const cont = document.getElementById('wa-burbujas');
  cont.scrollTop = cont.scrollHeight;
  if (teniaFoco) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}

export function cerrarConversacionWA() {
  telActual = null;
  contactoNuevo = null;
  document.getElementById('wa-chat').classList.remove('con-hilo');
  document.getElementById('wa-hilo').innerHTML = '<div class="wa-vacio">Elegí una conversación</div>';
  renderConversaciones();
}

export async function enviarRespuestaWA() {
  const ta = document.getElementById('wa-texto');
  const texto = ta?.value.trim();
  if (!texto || !telActual) return;
  const ventana = ta.dataset.ventana === '1';
  const btn = document.getElementById('wa-btn-enviar');
  btn.disabled = true;
  try {
    await sbPost('whatsapp_mensajes', {
      de: telActual,
      nombre: ta.dataset.nombre || null,
      mensaje: ventana ? texto : texto.replace(/\s*\n+\s*/g, ' '),
      direccion: 'saliente',
      estado: 'pendiente',
      plantilla: !ventana,
      enviado_por: 'plataforma',
      leido: true,
    });
    ta.value = '';
    await loadMensajes();
  } catch (e) {
    toast('No se pudo enviar: ' + e.message, 'err');
  } finally {
    btn.disabled = false;
  }
}

// Empezar una conversación con alguien del personal (sale con plantilla)
export async function nuevoMensajeWA() {
  const personas = (state.persCache?.length ? state.persCache : await sb('personal', { filters: ['activo=eq.true'], order: 'nombre' }))
    .filter(p => p.telefono);
  document.getElementById('wa-chat').classList.add('con-hilo');
  document.getElementById('wa-hilo').innerHTML = `
    <div class="wa-hilo-head">
      <button class="btn btn-ghost btn-sm wa-volver" onclick="cerrarConversacionWA()">←</button>
      <div style="font-weight:600">Nuevo mensaje</div>
    </div>
    <div style="padding:16px;display:flex;flex-direction:column;gap:10px;max-width:420px">
      <label style="font-size:12px;color:var(--text-2)">¿A quién le escribís?</label>
      <select class="inp" id="wa-nuevo-dest">
        <option value="">Elegí una persona…</option>
        ${personas.map(p => `<option value="${escHtml(p.telefono)}">${escHtml(`${p.apellido || ''} ${p.nombre || ''}`.trim())}</option>`).join('')}
      </select>
      <label style="font-size:12px;color:var(--text-2)">…o escribí un número</label>
      <input class="inp" id="wa-nuevo-num" placeholder="+54 9 11 1234-5678">
      <button class="btn btn-primary" onclick="confirmarNuevoMensajeWA()">Abrir conversación</button>
    </div>`;
}

export function confirmarNuevoMensajeWA() {
  const sel = document.getElementById('wa-nuevo-dest');
  const raw = document.getElementById('wa-nuevo-num').value.trim() || sel.value;
  let n = raw.replace(/\D/g, '');
  if (n.startsWith('00')) n = n.slice(2);
  if (n.startsWith('0')) n = '54' + n.slice(1);
  if (n.length === 10) n = '54' + n;
  if (n.length === 12 && n.startsWith('54')) n = '549' + n.slice(2);
  if (n.length < 12) { toast('Número inválido', 'err'); return; }
  const nombre = document.getElementById('wa-nuevo-num').value.trim() ? n : sel.options[sel.selectedIndex].text;
  contactoNuevo = { nombre };
  telActual = n; // así abrirConversacionWA no descarta contactoNuevo
  abrirConversacionWA(n);
}

export async function marcarTodosLeidos() {
  try {
    await fetch(`${SB_URL}/rest/v1/whatsapp_mensajes?direccion=eq.entrante&leido=eq.false`, {
      method: 'PATCH', headers: await authHeaders(true), body: JSON.stringify({ leido: true }),
    });
    toast('✅ Todos marcados como leídos');
    loadMensajes();
  } catch (e) { toast('Error: ' + e.message, 'err'); }
}

export async function checkMensajesNuevos() {
  try {
    const lista = await sb('whatsapp_mensajes', { select: 'id', filters: ['direccion=eq.entrante', 'leido=eq.false'], limit: 99 });
    actualizarBadge(lista.length);
  } catch (e) {}
}

// En vivo: mensajes nuevos y cambios de estado (enviado → entregado → leído)
let recargaTimer = null;
function suscribirMensajes() {
  const client = state.supabaseClient;
  if (client.getChannels().some(c => c.topic === 'realtime:wa-mensajes')) return;
  client.channel('wa-mensajes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_mensajes' }, () => {
      clearTimeout(recargaTimer);
      recargaTimer = setTimeout(() => {
        if (state.currentPage === 'mensajes') loadMensajes(); else checkMensajesNuevos();
      }, 400);
    })
    .subscribe();
}

// ── NÚMERO DE WHATSAPP: alta con coexistencia y cambio de número ──────────
// Embedded Signup de Meta: se conecta un número que ya usa la app WhatsApp Business del
// celular; la app sigue funcionando y la plataforma manda/recibe por el mismo número.
const META_APP_ID = '1706628640583124';
const WA_ALTA_URL = `${SB_URL}/functions/v1/wa-alta`;

async function waAlta(body) {
  const res = await fetch(WA_ALTA_URL, { method: 'POST', headers: await authHeaders(true), body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function tarjetaNumero(titulo, n) {
  if (!n) return '';
  const pls = (n.plantillas || []).map(p =>
    `<li>${escHtml(p.nombre)}: <b style="color:${p.estado === 'APPROVED' ? 'var(--green)' : p.estado === 'REJECTED' ? 'var(--red)' : 'var(--orange)'}">${escHtml(p.estado)}</b></li>`).join('');
  return `<div style="background:var(--surface2);border-radius:8px;padding:12px">
    <div style="font-size:11px;color:var(--text-3);text-transform:uppercase">${titulo}</div>
    <div style="font-weight:600;margin-top:2px">${escHtml(n.numero || n.phone_id)} ${n.nombre ? `· ${escHtml(n.nombre)}` : ''}</div>
    <div style="font-size:12px;color:var(--text-2)">${escHtml(n.estado || n.error || '')}</div>
    <ul style="font-size:12px;margin:8px 0 0 16px;padding:0">${pls || '<li>Sin plantillas todavía</li>'}</ul>
  </div>`;
}

export async function abrirNumeroWA() {
  telActual = null;
  document.getElementById('wa-chat').classList.add('con-hilo');
  const hilo = document.getElementById('wa-hilo');
  hilo.innerHTML = '<div class="wa-vacio">Cargando…</div>';
  let est = { actual: null, nuevo: null };
  let configId = '';
  try {
    [est] = await Promise.all([waAlta({ accion: 'estado' })]);
    const cfg = await sb('wa_config', { filters: ['clave=eq.es_config_id'] });
    configId = cfg[0]?.valor || '';
  } catch (e) { toast('Error: ' + e.message, 'err'); }

  const nuevo = est.nuevo;
  const todasAprobadas = nuevo && ['aviso_logistica', 'recordatorio_logistica', 'retomar_conversacion']
    .every(n => (nuevo.plantillas || []).some(p => p.nombre === n && p.estado === 'APPROVED'));
  const mismoNumero = nuevo && est.actual && nuevo.phone_id === est.actual.phone_id;

  hilo.innerHTML = `
    <div class="wa-hilo-head">
      <button class="btn btn-ghost btn-sm wa-volver" onclick="cerrarConversacionWA()">←</button>
      <div style="font-weight:600">Número de WhatsApp</div>
    </div>
    <div style="padding:16px;overflow-y:auto;display:flex;flex-direction:column;gap:14px;max-width:560px">
      ${tarjetaNumero('Número en uso', est.actual)}
      ${nuevo && !mismoNumero ? tarjetaNumero('Número nuevo (todavía no se usa)', nuevo) + `
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" onclick="copiarPlantillasWA()">Copiar plantillas a la cuenta nueva</button>
          <button class="btn btn-primary btn-sm" ${todasAprobadas ? '' : 'disabled title="Primero tienen que estar aprobadas las 3 plantillas"'} onclick="activarNumeroWA()">Usar el número nuevo</button>
        </div>` : ''}

      <div style="border-top:1px solid var(--border);padding-top:14px">
        <div style="font-weight:600;margin-bottom:6px">Conectar un número nuevo (coexistencia)</div>
        <div style="font-size:12px;color:var(--text-2);line-height:1.5">
          El número tiene que estar en la app <b>WhatsApp Business</b> (versión 2.24.17 o más nueva) en el celular.
          La app sigue funcionando: lo que respondas desde el celular también aparece acá.
          Se desactivan en la app: listas de difusión, mensajes automáticos, respuestas rápidas, etiquetas, catálogo, llamadas por ese número y WhatsApp en la PC.
        </div>
        <label style="display:flex;gap:8px;align-items:flex-start;font-size:12px;margin:10px 0">
          <input type="checkbox" id="wa-alta-historial">
          <span>Traer también el historial de chats (hasta 6 meses).<br><span style="color:var(--orange)">Si el chip era personal, tus chats personales van a quedar guardados en la plataforma.</span></span>
        </label>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input class="inp" id="wa-es-config" style="max-width:220px" placeholder="ID de configuración de Meta" value="${escHtml(configId)}">
          <button class="btn btn-primary" onclick="conectarNumeroWA()">Conectar número</button>
        </div>
        <div style="font-size:11px;color:var(--text-3);margin-top:6px">El ID de configuración sale de Meta → Facebook Login for Business → Configuraciones.</div>
      </div>
    </div>`;
}

function cargarSdkFacebook(): Promise<void> {
  if (window.FB) return Promise.resolve();
  return new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB.init({ appId: META_APP_ID, autoLogAppEvents: true, xfbml: false, version: 'v25.0' });
      resolve();
    };
    const s = document.createElement('script');
    s.src = 'https://connect.facebook.net/es_LA/sdk.js';
    s.async = true; s.defer = true; s.crossOrigin = 'anonymous';
    s.onerror = () => reject(new Error('No se pudo cargar el SDK de Facebook'));
    document.body.appendChild(s);
  });
}

export async function conectarNumeroWA() {
  const configId = (document.getElementById('wa-es-config') as HTMLInputElement).value.trim();
  const historial = (document.getElementById('wa-alta-historial') as HTMLInputElement).checked;
  if (!/^\d{6,}$/.test(configId)) { toast('Pegá el ID de configuración de Meta (son solo números)', 'err'); return; }
  try {
    await sbPost('wa_config', { clave: 'es_config_id', valor: configId }).catch(async () => {
      await fetch(`${SB_URL}/rest/v1/wa_config?clave=eq.es_config_id`, { method: 'PATCH', headers: await authHeaders(true), body: JSON.stringify({ valor: configId }) });
    });
    await cargarSdkFacebook();
  } catch (e) { toast(e.message, 'err'); return; }

  // Meta manda los ids (waba_id, phone_number_id) por postMessage y el código por el callback de FB.login
  let sesion = null;
  const recibirSesion = (event) => {
    if (!String(event.origin).endsWith('facebook.com')) return;
    try {
      const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
      if (String(data.event).startsWith('FINISH')) sesion = data.data;
      else if (data.event === 'CANCEL') toast('Alta cancelada' + (data.data?.current_step ? ` (en: ${data.data.current_step})` : ''), 'err');
      else if (data.event === 'ERROR') toast('Meta informó un error: ' + (data.data?.error_message || ''), 'err');
    } catch (_) { /* otros mensajes */ }
  };
  window.addEventListener('message', recibirSesion);

  window.FB.login(async (response) => {
    const code = response?.authResponse?.code;
    if (!code) { window.removeEventListener('message', recibirSesion); toast('No se completó el alta en Meta', 'err'); return; }
    // El postMessage puede llegar un instante después del callback
    for (let i = 0; i < 20 && !sesion; i++) await new Promise(r => setTimeout(r, 250));
    window.removeEventListener('message', recibirSesion);
    if (!sesion?.waba_id || !sesion?.phone_number_id) { toast('Meta no devolvió el número conectado. Probá de nuevo.', 'err'); return; }
    try {
      toast('Conectando el número…');
      const r = await waAlta({ accion: 'alta', code, waba_id: sesion.waba_id, phone_number_id: sesion.phone_number_id, historial });
      toast(`✅ Número ${r.numero || ''} conectado${r.webhook_suscripto ? '' : ' (ojo: no se pudo suscribir el webhook)'}`);
      abrirNumeroWA();
    } catch (e) { toast('Error conectando el número: ' + e.message, 'err'); }
  }, {
    config_id: configId,
    response_type: 'code',
    override_default_response_type: true,
    extras: { setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' },
  });
}

export async function copiarPlantillasWA() {
  try {
    const r = await waAlta({ accion: 'plantillas' });
    toast('Plantillas: ' + r.plantillas.map(p => `${p.nombre} ${p.estado}${p.error ? ` (${p.error})` : ''}`).join(' · '));
    abrirNumeroWA();
  } catch (e) { toast('Error: ' + e.message, 'err'); }
}

export async function activarNumeroWA() {
  if (!confirm('Desde ahora la plataforma va a mandar y recibir por el número nuevo (avisos, recordatorios y respuestas). ¿Seguimos?')) return;
  try {
    await waAlta({ accion: 'activar' });
    toast('✅ Ahora se usa el número nuevo');
    abrirNumeroWA();
  } catch (e) { toast('Error: ' + e.message, 'err'); }
}

// Window assignments
window.abrirNumeroWA = abrirNumeroWA;
window.conectarNumeroWA = conectarNumeroWA;
window.copiarPlantillasWA = copiarPlantillasWA;
window.activarNumeroWA = activarNumeroWA;
window.loadMensajes = loadMensajes;
window.marcarTodosLeidos = marcarTodosLeidos;
window.checkMensajesNuevos = checkMensajesNuevos;
window.abrirConversacionWA = abrirConversacionWA;
window.cerrarConversacionWA = cerrarConversacionWA;
window.enviarRespuestaWA = enviarRespuestaWA;
window.filtrarConversacionesWA = filtrarConversacionesWA;
window.nuevoMensajeWA = nuevoMensajeWA;
window.confirmarNuevoMensajeWA = confirmarNuevoMensajeWA;
