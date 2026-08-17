import { state } from '../state';
import { sb, sbPost, sbDelete, fmtDate, escHtml, toast, openModal } from '../helpers';
import { FOLDER_SEGUROS } from '../config';
import { sbCached } from '../query-cache';

// ── SEGUROS ───────────────────────────────────────────────
let _segBusqueda = '';

export async function loadSeguros() {
  const tbody = document.getElementById('seguros-tbody');
  tbody.innerHTML = '<tr><td colspan="5" class="loading"><div class="spinner"></div></td></tr>';
  try {
    const eventos = await sbCached('v_eventos', { filters: ['estado=neq.Dado de baja'], order: 'fecha_evento.desc', limit: 300 });
    const q = _segBusqueda.trim().toLowerCase();
    const filtrados = q
      ? eventos.filter(e => (e.cliente_nombre || '').toLowerCase().includes(q) || (e.venue || '').toLowerCase().includes(q))
      : eventos;

    tbody.innerHTML = filtrados.length
      ? filtrados.map(e => {
          const clienteEsc = (e.cliente_nombre || '').replace(/'/g, "\\'");
          const venueEsc = (e.venue || '').replace(/'/g, "\\'");
          return `<tr>
            <td><b>${escHtml(e.cliente_nombre || '')}</b></td>
            <td>${escHtml(e.venue || '—')}</td>
            <td>${fmtDate(e.fecha_evento)}</td>
            <td>${escHtml(e.estado || '')}</td>
            <td>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                <button class="btn btn-ghost btn-sm" onclick="abrirArchivosSeguros(${e.id},'${clienteEsc}','${venueEsc}','${e.fecha_evento || ''}')">📎 Archivos</button>
                <button class="btn btn-ghost btn-sm" onclick="verSegurosEvento(${e.id})">🛡️ Ver cláusulas</button>
                ${e.seguro_enviado
                  ? `<button class="btn btn-ghost btn-sm" style="opacity:.4;cursor:not-allowed" disabled>✅ Enviado</button>`
                  : `<button class="btn btn-ghost btn-sm" onclick="enviarMailSeguroEvento(${e.id},'${venueEsc || e.codigo || ''}')">📧 Enviar seguro</button>`}
              </div>
            </td>
          </tr>`;
        }).join('')
      : `<tr><td colspan="5"><div class="empty"><div class="empty-icon">🛡️</div>Sin eventos</div></td></tr>`;
  } catch(e) { tbody.innerHTML = `<tr><td colspan="5"><div class="empty">Error: ${(e as any).message}</div></td></tr>`; }
}

export function buscarSeguros(v: string) {
  _segBusqueda = v;
  loadSeguros();
}

// ── ARCHIVOS DE SEGURO POR EVENTO ────────────────────────
let _segCtx: { eventoId: number; cliente: string; venue: string; fecha: string } | null = null;

async function getDriveTokenSeguros() {
  const { data: { session } } = await state.supabaseClient.auth.getSession();
  let token = session?.provider_token || localStorage.getItem('drive_token');
  if (!token) {
    const refresh = session?.provider_refresh_token || localStorage.getItem('drive_refresh_token');
    if (refresh) {
      try {
        const r = await fetch('https://mitosihorpjmrosdxqbt.supabase.co/functions/v1/refresh-drive-token', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refresh }),
        });
        if (r.ok) { const { access_token } = await r.json(); token = access_token; localStorage.setItem('drive_token', token); }
      } catch(e) {}
    }
  }
  return token;
}

function slugifySeg(s: string) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export async function abrirArchivosSeguros(eventoId: number, cliente: string, venue: string, fecha: string) {
  _segCtx = { eventoId, cliente, venue, fecha };
  document.getElementById('archivos-seguros-titulo').textContent = `🛡️ Archivos de seguro — ${cliente}`;
  await renderArchivosSeguros();
  openModal('modal-archivos-seguros');
}

async function renderArchivosSeguros() {
  const body = document.getElementById('archivos-seguros-body');
  body.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  const archivos = await sb('archivos_seguros', { filters: [`evento_id=eq.${_segCtx.eventoId}`], order: 'created_at' });
  const tipos = [
    { key: 'clausulas',   label: 'Cláusulas',   icon: '📄' },
    { key: 'certificado', label: 'Certificado', icon: '✅' },
  ];
  body.innerHTML = tipos.map(t => {
    const lista = archivos.filter(a => a.tipo === t.key);
    const items = lista.length
      ? lista.map(a => `
          <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
            <span style="flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              ${a.drive_url ? `<a href="${a.drive_url}" target="_blank" style="color:var(--blue)">${escHtml(a.nombre)}</a>` : escHtml(a.nombre)}
            </span>
            <button class="btn btn-danger btn-sm" onclick="eliminarArchivoSeguro(${a.id})">✕</button>
          </div>`).join('')
      : `<div style="color:var(--text-3);font-size:12px;font-style:italic;padding:4px 0">Sin archivos</div>`;
    return `<div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text-2)">${t.icon} ${t.label}</div>
        <label class="btn btn-ghost btn-sm" style="cursor:pointer">
          + Subir
          <input type="file" style="display:none" multiple onchange="subirArchivosSeguros(this,'${t.key}')">
        </label>
      </div>
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px 12px">${items}</div>
    </div>`;
  }).join('');
}

export async function subirArchivosSeguros(input: HTMLInputElement, tipo: string) {
  if (!_segCtx || !input.files?.length) return;
  const token = await getDriveTokenSeguros();
  if (!token) { toast('Sin acceso a Drive. Volvé a iniciar sesión.', 'err'); return; }

  const { eventoId, cliente, venue, fecha } = _segCtx;
  const fechaSlug = fecha ? fecha.replace(/-/g, '') : 'sfecha';
  const salonSlug = slugifySeg(venue || 'ssalon');
  const clienteSlug = slugifySeg(cliente || 'scliente');

  const existentes = await sb('archivos_seguros', { filters: [`evento_id=eq.${eventoId}`, `tipo=eq.${tipo}`], select: 'id' });
  let num = existentes.length + 1;

  for (const file of Array.from(input.files)) {
    const ext = file.name.includes('.') ? '.' + file.name.split('.').pop() : '';
    const nombre = `${fechaSlug}-${salonSlug}-${clienteSlug}-${tipo}-${num}${ext}`;

    toast(`Subiendo ${nombre}...`);
    try {
      const metadata = { name: nombre, parents: [FOLDER_SEGUROS] };
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', file, nombre);

      const res = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
        { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }
      );

      let drive_url = null, drive_id = null;
      if (res.ok) {
        const data = await res.json();
        drive_id = data.id; drive_url = data.webViewLink;
        await fetch(`https://www.googleapis.com/drive/v3/files/${drive_id}/permissions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'reader', type: 'anyone' }),
        });
      } else if (res.status === 401) {
        localStorage.removeItem('drive_token');
        toast('Token de Drive expirado. Volvé a iniciar sesión.', 'err');
        return;
      }

      await sbPost('archivos_seguros', { evento_id: eventoId, tipo, nombre, drive_url, drive_id });
      num++;
    } catch(e) { toast('Error al subir: ' + (e as any).message, 'err'); }
  }

  toast('Archivos subidos');
  await renderArchivosSeguros();
  input.value = '';
}

export async function eliminarArchivoSeguro(id: number) {
  if (!confirm('¿Eliminar este archivo?')) return;
  await sbDelete('archivos_seguros', id);
  await renderArchivosSeguros();
}

window.loadSeguros = loadSeguros;
window.buscarSeguros = buscarSeguros;
window.abrirArchivosSeguros = abrirArchivosSeguros;
window.subirArchivosSeguros = subirArchivosSeguros;
window.eliminarArchivoSeguro = eliminarArchivoSeguro;
