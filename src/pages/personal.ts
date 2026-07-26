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
          <button class="btn btn-ghost btn-sm" onclick="abrirHistorialTarifas(${p.id},'${escHtml(p.nombre)} ${escHtml(p.apellido)}')">📈</button>
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
      const numId = parseInt(id);
      // Verificar si tarifas cambiaron respecto al último registro del historial
      const ultimo = await sb('personal_tarifas_historial', { filters: [`personal_id=eq.${numId}`], order: 'fecha.desc', limit: 1 });
      const tChanged = !ultimo.length
        || Number(ultimo[0].tarifa_deposito) !== data.tarifa_deposito
        || Number(ultimo[0].tarifa_armado)   !== data.tarifa_armado
        || Number(ultimo[0].tarifa_operador) !== data.tarifa_operador;
      await sbPatch('personal', numId, data);
      if (tChanged) {
        await sbPost('personal_tarifas_historial', {
          personal_id: numId, fecha: today(),
          tarifa_deposito: data.tarifa_deposito,
          tarifa_armado:   data.tarifa_armado,
          tarifa_operador: data.tarifa_operador,
        });
      }
      invalidateCache('personal');
      toast('Personal actualizado');
    } else {
      const todos = await sb('personal', { select: 'codigo' });
      const maxNum = todos.reduce((max, p) => {
        const n = parseInt((p.codigo || '').replace(/\D/g, '')) || 0;
        return n > max ? n : max;
      }, 0);
      data.codigo = 'P' + String(maxNum + 1).padStart(3, '0');
      const row = await sbPost('personal', data);
      const newId = Array.isArray(row) ? row[0]?.id : row?.id;
      if (newId) {
        await sbPost('personal_tarifas_historial', {
          personal_id: newId, fecha: today(),
          tarifa_deposito: data.tarifa_deposito,
          tarifa_armado:   data.tarifa_armado,
          tarifa_operador: data.tarifa_operador,
        });
      }
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


// ── HISTORIAL DE TARIFAS ─────────────────────────────────────
let _historialCtxId: number | null = null;

export async function abrirHistorialTarifas(personalId: number, nombre: string) {
  _historialCtxId = personalId;
  document.getElementById('historial-tarifas-titulo').textContent = `📈 Evolución de tarifas — ${nombre}`;
  document.getElementById('historial-form-nuevo').style.display = 'none';
  await renderHistorialTarifas();
  openModal('modal-historial-tarifas');
}

async function renderHistorialTarifas() {
  const body = document.getElementById('historial-tarifas-body');
  const chartArea = document.getElementById('historial-chart-area');
  body.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  chartArea.innerHTML = '';

  const registros = await sb('personal_tarifas_historial', {
    filters: [`personal_id=eq.${_historialCtxId}`],
    order: 'fecha.asc', limit: 200,
  });

  // Tabla de registros
  if (!registros.length) {
    body.innerHTML = `<div style="color:var(--text-3);font-size:13px;font-style:italic;text-align:center;padding:12px">Sin registros aún. Al guardar cambios de tarifas se registran automáticamente.</div>`;
    return;
  }

  body.innerHTML = `<table class="table" style="font-size:12px">
    <thead><tr>
      <th>Fecha</th><th>Depósito</th><th>Armado</th><th>Operador</th><th></th>
    </tr></thead>
    <tbody>
      ${registros.map(r => `<tr>
        <td>${new Date(r.fecha + 'T12:00:00').toLocaleDateString('es-AR')}</td>
        <td>${fmtARS(r.tarifa_deposito)}</td>
        <td>${fmtARS(r.tarifa_armado)}</td>
        <td>${fmtARS(r.tarifa_operador)}</td>
        <td><button class="btn btn-danger btn-sm" onclick="eliminarEntradaHistorial(${r.id})">✕</button></td>
      </tr>`).join('')}
    </tbody>
  </table>`;

  // Gráfico
  await renderGraficoHistorial(registros, chartArea);
}

async function renderGraficoHistorial(registros: any[], container: HTMLElement) {
  if (registros.length < 2) {
    container.innerHTML = `<div style="color:var(--text-3);font-size:12px;text-align:center;padding:8px">Se necesitan al menos 2 registros para mostrar el gráfico.</div>`;
    return;
  }

  container.innerHTML = `<div style="color:var(--text-3);font-size:12px;text-align:center;padding:8px">Cargando inflación INDEC...</div>`;

  // Obtener inflación mensual de INDEC (IPC Nacional)
  let ipcData: [string, number][] = [];
  try {
    const desde = registros[0].fecha.slice(0, 7); // yyyy-mm
    const r = await fetch(`https://apis.datos.gob.ar/series/api/series/?ids=148.3_INPN_2016_M_26&limit=300&sort=asc&start_date=${desde}-01&format=json`);
    if (r.ok) {
      const json = await r.json();
      ipcData = (json.data || []).map(([d, v]) => [d.slice(0, 7), v]); // [yyyy-mm, %mensual]
    }
  } catch(e) {}

  // Calcular inflación acumulada mes a mes desde fecha base
  const base = registros[0].fecha.slice(0, 7);
  const ipcAcum: Record<string, number> = { [base]: 0 };
  let acum = 100;
  for (const [mes, pct] of ipcData) {
    if (mes <= base) continue;
    acum = acum * (1 + (pct || 0) / 100);
    ipcAcum[mes] = (acum - 100);
  }

  // Tarifa base (usar armado si existe, sino operador, sino deposito)
  const campo = registros.some(r => Number(r.tarifa_armado) > 0) ? 'tarifa_armado'
    : registros.some(r => Number(r.tarifa_operador) > 0) ? 'tarifa_operador' : 'tarifa_deposito';
  const baseVal = Number(registros[0][campo]) || 1;

  // Construir puntos unificados (meses con registro o inflación)
  const meses = new Set<string>();
  registros.forEach(r => meses.add(r.fecha.slice(0, 7)));
  Object.keys(ipcAcum).forEach(m => meses.add(m));
  const mesesOrdenados = [...meses].sort();

  // Interpolar tarifa entre registros
  const tarifaPct: Record<string, number> = {};
  let lastVal = baseVal;
  let rIdx = 0;
  for (const mes of mesesOrdenados) {
    while (rIdx < registros.length - 1 && registros[rIdx + 1].fecha.slice(0, 7) <= mes) rIdx++;
    lastVal = Number(registros[rIdx][campo]) || lastVal;
    tarifaPct[mes] = ((lastVal - baseVal) / baseVal) * 100;
  }

  // SVG chart
  const W = 680, H = 200, PL = 52, PR = 16, PT = 16, PB = 36;
  const cW = W - PL - PR, cH = H - PT - PB;

  const allVals = [...mesesOrdenados.map(m => tarifaPct[m] ?? 0), ...mesesOrdenados.map(m => ipcAcum[m] ?? 0)];
  const minV = Math.min(0, ...allVals);
  const maxV = Math.max(1, ...allVals);
  const rangeV = maxV - minV || 1;

  const xScale = (i: number) => PL + (i / (mesesOrdenados.length - 1)) * cW;
  const yScale = (v: number) => PT + cH - ((v - minV) / rangeV) * cH;

  const pathLine = (vals: number[]) => vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(v).toFixed(1)}`).join(' ');

  const tarifaVals = mesesOrdenados.map(m => tarifaPct[m] ?? 0);
  const ipcVals    = mesesOrdenados.map(m => ipcAcum[m] ?? 0);

  // Eje Y ticks
  const ticks = 5;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => minV + (rangeV * i / ticks));

  // Etiquetas X (cada 3 meses aprox)
  const step = Math.max(1, Math.floor(mesesOrdenados.length / 6));
  const xLabels = mesesOrdenados.filter((_, i) => i % step === 0 || i === mesesOrdenados.length - 1);

  const svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:220px;font-family:sans-serif">
    <!-- Fondo -->
    <rect width="${W}" height="${H}" fill="none"/>
    <!-- Grid -->
    ${yTicks.map(v => `<line x1="${PL}" y1="${yScale(v).toFixed(1)}" x2="${W-PR}" y2="${yScale(v).toFixed(1)}" stroke="#333" stroke-width="0.5"/>`).join('')}
    <!-- Eje Y labels -->
    ${yTicks.map(v => `<text x="${PL-4}" y="${(yScale(v)+4).toFixed(1)}" text-anchor="end" font-size="9" fill="#888">${v.toFixed(0)}%</text>`).join('')}
    <!-- Eje X labels -->
    ${xLabels.map(m => {
      const i = mesesOrdenados.indexOf(m);
      const [yr, mo] = m.split('-');
      return `<text x="${xScale(i).toFixed(1)}" y="${H-6}" text-anchor="middle" font-size="9" fill="#888">${mo}/${yr.slice(2)}</text>`;
    }).join('')}
    <!-- Línea cero -->
    <line x1="${PL}" y1="${yScale(0).toFixed(1)}" x2="${W-PR}" y2="${yScale(0).toFixed(1)}" stroke="#555" stroke-width="1" stroke-dasharray="3,3"/>
    <!-- Línea inflación -->
    <path d="${pathLine(ipcVals)}" fill="none" stroke="#e05c5c" stroke-width="2"/>
    <!-- Línea tarifa -->
    <path d="${pathLine(tarifaVals)}" fill="none" stroke="#c9a84c" stroke-width="2.5"/>
    <!-- Leyenda -->
    <rect x="${PL}" y="4" width="10" height="4" fill="#c9a84c" rx="1"/>
    <text x="${PL+13}" y="9" font-size="9" fill="#c9a84c">Tarifa (${campo === 'tarifa_armado' ? 'armado' : campo === 'tarifa_operador' ? 'operador' : 'depósito'})</text>
    <rect x="${PL+120}" y="4" width="10" height="4" fill="#e05c5c" rx="1"/>
    <text x="${PL+133}" y="9" font-size="9" fill="#e05c5c">Inflación IPC</text>
  </svg>`;

  container.innerHTML = svg;
}

export function mostrarFormHistorial() {
  const f = document.getElementById('historial-form-nuevo');
  f.style.display = f.style.display === 'none' ? '' : 'none';
}

export async function guardarEntradaHistorial() {
  if (!_historialCtxId) return;
  const fechaRaw = (document.getElementById('hist-fecha') as HTMLInputElement).value.trim();
  const dep = parseARSInput(document.getElementById('hist-dep'));
  const arm = parseARSInput(document.getElementById('hist-arm'));
  const op  = parseARSInput(document.getElementById('hist-op'));
  if (!fechaRaw) { toast('Ingresá una fecha', 'err'); return; }
  // Parsear dd/mm/aaaa → yyyy-mm-dd
  const parts = fechaRaw.split('/');
  if (parts.length !== 3) { toast('Formato de fecha: dd/mm/aaaa', 'err'); return; }
  const fecha = `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
  try {
    await sbPost('personal_tarifas_historial', {
      personal_id: _historialCtxId, fecha,
      tarifa_deposito: dep || 0,
      tarifa_armado:   arm || 0,
      tarifa_operador: op  || 0,
    });
    document.getElementById('historial-form-nuevo').style.display = 'none';
    (document.getElementById('hist-fecha') as HTMLInputElement).value = '';
    (document.getElementById('hist-dep') as HTMLInputElement).value = '';
    (document.getElementById('hist-arm') as HTMLInputElement).value = '';
    (document.getElementById('hist-op') as HTMLInputElement).value = '';
    await renderHistorialTarifas();
  } catch(e) { toast('Error: ' + (e as any).message, 'err'); }
}

export async function eliminarEntradaHistorial(id: number) {
  if (!confirm('¿Eliminar este registro?')) return;
  await sbDelete('personal_tarifas_historial', id);
  await renderHistorialTarifas();
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
window.abrirHistorialTarifas = abrirHistorialTarifas;
window.mostrarFormHistorial = mostrarFormHistorial;
window.guardarEntradaHistorial = guardarEntradaHistorial;
window.eliminarEntradaHistorial = eliminarEntradaHistorial;
