import { state } from '../state.js';
import { sb, sbPost, sbInsert, sbPatch, sbDelete, fmtARS, fmtDate, escHtml, calcularTotalConRecargos, today, formatTelefono, onTelefonoInput, formatDni, onDniInput, formatCuit, onCuitInput, badge, fmtInputARS, parseARSInput, toast, openModal, closeModal, LOGO_B64, buildTimeOpts, timeSelect, llenarSelectEventos, initDatePickers, renderHorariosEv, getHorariosEv } from '../helpers.js';
import { SB_URL, SB_KEY, FOLDER_LOGISTICAS, WA_EDGE_URL, EMAIL_EDGE_URL, EMAIL_SEGURO, DRIVE_FOLDER_ID, FOTOS_FOLDER_ID } from '../config.js';

// ── MENSAJES WHATSAPP ─────────────────────────────────────
export async function loadMensajes() {
  try {
    const lista = await sb('whatsapp_mensajes', { order: 'timestamp.desc', limit: 200 });
    const noLeidos = lista.filter(m => !m.leido).length;
    const badge = document.getElementById('nav-mensajes-badge');
    if (noLeidos > 0) { badge.textContent = noLeidos; badge.style.display = 'inline'; }
    else badge.style.display = 'none';

    document.getElementById('mensajes-tbody').innerHTML = lista.length
      ? lista.map(m => {
          const fecha = new Date(m.timestamp).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
          const estilo = m.leido ? 'color:var(--text-3)' : 'font-weight:600';
          return `<tr style="${estilo}">
            <td style="white-space:nowrap;font-size:12px">${fecha}</td>
            <td style="white-space:nowrap">
              <div>${m.nombre || m.de}</div>
              <div style="font-size:11px;color:var(--text-3)">+${m.de}</div>
            </td>
            <td>${m.mensaje}</td>
            <td>${!m.leido ? `<button class="btn btn-ghost btn-sm" onclick="marcarLeido(${m.id})">✓</button>` : ''}</td>
          </tr>`;
        }).join('')
      : '<tr><td colspan="4" style="text-align:center;color:var(--text-3)">Sin mensajes recibidos</td></tr>';
  } catch(e) { toast('Error cargando mensajes: ' + e.message, 'err'); }
}

export async function marcarLeido(id) {
  await sbPatch('whatsapp_mensajes', id, { leido: true });
  loadMensajes();
}

export async function marcarTodosLeidos() {
  const lista = await sb('whatsapp_mensajes', { filters: ['leido=eq.false'], limit: 200 });
  for (const m of lista) await sbPatch('whatsapp_mensajes', m.id, { leido: true });
  toast('✅ Todos marcados como leídos');
  loadMensajes();
}

export async function checkMensajesNuevos() {
  try {
    const lista = await sb('whatsapp_mensajes', { filters: ['leido=eq.false'], limit: 1 });
    const badge = document.getElementById('nav-mensajes-badge');
    if (!badge) return;
    if (lista.length > 0) {
      const total = await sb('whatsapp_mensajes', { filters: ['leido=eq.false'], limit: 99 });
      badge.textContent = total.length;
      badge.style.display = 'inline';
    } else {
      badge.style.display = 'none';
    }
  } catch(e) {}
}


// Window assignments
window.loadMensajes = loadMensajes;
window.marcarLeido = marcarLeido;
window.marcarTodosLeidos = marcarTodosLeidos;
window.checkMensajesNuevos = checkMensajesNuevos;
