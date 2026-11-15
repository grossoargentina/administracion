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
const ORIGEN = { claude: 'Claude', automatico: 'Automático', plataforma: '' };

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

// Window assignments
window.loadMensajes = loadMensajes;
window.marcarTodosLeidos = marcarTodosLeidos;
window.checkMensajesNuevos = checkMensajesNuevos;
window.abrirConversacionWA = abrirConversacionWA;
window.cerrarConversacionWA = cerrarConversacionWA;
window.enviarRespuestaWA = enviarRespuestaWA;
window.filtrarConversacionesWA = filtrarConversacionesWA;
window.nuevoMensajeWA = nuevoMensajeWA;
window.confirmarNuevoMensajeWA = confirmarNuevoMensajeWA;
