import { state } from '../state';
import { sb, sbPost, sbInsert, sbPatch, sbDelete, fmtARS, fmtDate, escHtml, calcularTotalConRecargos, today, formatTelefono, onTelefonoInput, formatDni, onDniInput, formatCuit, onCuitInput, badge, fmtInputARS, parseARSInput, toast, openModal, closeModal, LOGO_B64, buildTimeOpts, timeSelect, llenarSelectEventos, initDatePickers, renderHorariosEv, getHorariosEv } from '../helpers';
import { SB_URL, SB_KEY, FOLDER_LOGISTICAS, WA_EDGE_URL, EMAIL_EDGE_URL, EMAIL_SEGURO, DRIVE_FOLDER_ID, FOTOS_FOLDER_ID } from '../config';
import { sbCached, invalidateCache } from '../query-cache';

// ── PERSONAL ──────────────────────────────────────────────
let personalBusqueda = '';

export async function loadPersonal() {
  document.getElementById('pers-tbody').innerHTML = '<tr><td colspan="9" class="loading"><div class="spinner"></div></td></tr>';
  try {
    window._personalLista = await sbCached('personal', { order: 'nombre' });
    renderPersonal();
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

export function buscarPersonal(valor) {
  personalBusqueda = valor;
  renderPersonal();
}

export function renderPersonal() {
  let lista = window._personalLista || [];
  if (personalBusqueda.trim()) {
    const q = personalBusqueda.trim().toLowerCase();
    lista = lista.filter(p => (p.apellido || '').toLowerCase().includes(q) || (p.nombre || '').toLowerCase().includes(q));
  }
  lista = applySort('pers', lista);
  document.getElementById('pers-tbody').innerHTML = lista.length
    ? lista.map(p => `<tr>
        <td><b>${p.apellido || '—'}</b></td>
        <td>${p.nombre || '—'}</td>
        <td style="color:var(--text-2);font-size:12px">${p.dni || '—'}</td>
        <td><span style="color:${p.tipo==='Fijo'?'var(--green)':p.tipo==='Chofer'?'var(--orange)':'var(--blue)'};font-size:12px">${p.tipo}</span></td>
        <td>${fmtARS(p.tarifa_deposito)}</td>
        <td>${fmtARS(p.tarifa_armado)}</td>
        <td>${fmtARS(p.tarifa_operador)}</td>
        <td>${p.tipo === 'Fijo' ? fmtARS(p.sueldo_fijo) : '<span style="color:var(--text-3)">—</span>'}</td>
        <td style="color:var(--text-2)">${p.telefono || '—'}</td>
        <td style="display:flex;gap:4px">
          <button class="btn btn-ghost btn-sm" onclick="editarPersonal(${p.id})">✏️</button>
          <button class="btn btn-danger btn-sm" onclick="togglePersonal(${p.id},${p.activo})">
            ${p.activo ? 'Baja' : 'Activar'}
          </button>
        </td>
      </tr>`).join('')
    : `<tr><td colspan="10"><div class="empty"><div class="empty-icon">👥</div>Sin personal cargado</div></td></tr>`;
}

export function onPersTipoChange() {
  const tipo = document.getElementById('pers-tipo').value;
  const esFijo = tipo === 'Fijo';
  document.getElementById('pers-field-sueldo').style.display = esFijo ? '' : 'none';
}

export function abrirModalPersonal() {
  document.getElementById('pers-id').value       = '';
  document.getElementById('pers-modal-title').textContent = 'Agregar personal';
  document.getElementById('pers-apellido').value = '';
  document.getElementById('pers-nombre').value   = '';
  document.getElementById('pers-dni').value      = '';
  document.getElementById('pers-tipo').value     = 'Fijo';
  document.getElementById('pers-sueldo').value    = '';
  document.getElementById('pers-dep').value       = '';
  document.getElementById('pers-arm').value       = '';
  document.getElementById('pers-op').value        = '';
  document.getElementById('pers-tel').value       = '';
  document.getElementById('pers-cuit').value      = '';
  document.getElementById('pers-nacimiento')._flatpickr?.clear();
  document.getElementById('pers-notas').value     = '';
  onPersTipoChange();
  openModal('modal-personal');
}

export function editarPersonal(id) {
  sbCached('personal', { filters: [`id=eq.${id}`] }).then(rows => {
    const p = rows[0]; if (!p) return;
    document.getElementById('pers-id').value       = p.id;
    document.getElementById('pers-modal-title').textContent = 'Editar personal';
    document.getElementById('pers-apellido').value = p.apellido || '';
    document.getElementById('pers-nombre').value   = p.nombre || '';
    document.getElementById('pers-dni').value      = p.dni || '';
    document.getElementById('pers-tipo').value     = p.tipo || 'Fijo';
    const fmtP = v => v > 0 ? Number(v).toLocaleString('es-AR', { maximumFractionDigits: 0 }) : '';
    document.getElementById('pers-sueldo').value    = fmtP(p.sueldo_fijo);
    document.getElementById('pers-dep').value       = fmtP(p.tarifa_deposito);
    document.getElementById('pers-arm').value       = fmtP(p.tarifa_armado);
    document.getElementById('pers-op').value        = fmtP(p.tarifa_operador);
    document.getElementById('pers-tel').value       = p.telefono || '';
    document.getElementById('pers-cuit').value      = p.cuit || '';
    if (p.fecha_nacimiento) document.getElementById('pers-nacimiento')._flatpickr?.setDate(p.fecha_nacimiento);
    else document.getElementById('pers-nacimiento')._flatpickr?.clear();
    document.getElementById('pers-notas').value     = p.notas || '';
    onPersTipoChange();
    openModal('modal-personal');
  });
}

export async function guardarPersonal() {
  const apellido = document.getElementById('pers-apellido').value.trim();
  const nombre   = document.getElementById('pers-nombre').value.trim();
  if (!apellido || !nombre) { toast('Apellido y nombre son obligatorios', 'err'); return; }
  const id   = document.getElementById('pers-id').value;
  const tipo = document.getElementById('pers-tipo').value;
  const data = {
    apellido,
    nombre,
    dni:             formatDni(document.getElementById('pers-dni').value) || null,
    tipo,
    sueldo_fijo:     tipo === 'Fijo' ? (parseARSInput(document.getElementById('pers-sueldo')) || null) : null,
    tarifa_deposito: parseARSInput(document.getElementById('pers-dep')) || 0,
    tarifa_armado:   parseARSInput(document.getElementById('pers-arm')) || 0,
    tarifa_operador: parseARSInput(document.getElementById('pers-op')) || 0,
    telefono:         formatTelefono(document.getElementById('pers-tel').value) || null,
    cuit:             formatCuit(document.getElementById('pers-cuit').value) || null,
    fecha_nacimiento: document.getElementById('pers-nacimiento').value || null,
    notas:            document.getElementById('pers-notas').value || null,
  };
  try {
    if (id) {
      await sbPatch('personal', parseInt(id), data);
      invalidateCache('personal');
      toast('Personal actualizado');
    } else {
      const count = await sb('personal', { select: 'id' });
      data.codigo = 'P' + String(count.length + 1).padStart(3, '0');
      await sbPost('personal', data);
      invalidateCache('personal');
      toast('Personal agregado');
    }
    closeModal('modal-personal');
    state.persCache = (await sb('personal', { filters:['activo=eq.true'], order:'nombre' }));
    loadPersonal();
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

export async function togglePersonal(id, activo) {
  await sbPatch('personal', id, { activo: !activo });
  invalidateCache('personal');
  toast(activo ? 'Personal dado de baja' : 'Personal reactivado');
  loadPersonal();
}


// Window assignments
window.loadPersonal = loadPersonal;
window.buscarPersonal = buscarPersonal;
window.renderPersonal = renderPersonal;
window.onPersTipoChange = onPersTipoChange;
window.abrirModalPersonal = abrirModalPersonal;
window.editarPersonal = editarPersonal;
window.guardarPersonal = guardarPersonal;
window.togglePersonal = togglePersonal;
