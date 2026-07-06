import { state } from '../state';
import { jsPDF } from 'jspdf';
import { sb, sbPost, sbInsert, sbPatch, sbDelete, fmtARS, fmtDate, escHtml, calcularTotalConRecargos, today, formatTelefono, onTelefonoInput, formatDni, onDniInput, formatCuit, onCuitInput, badge, fmtInputARS, parseARSInput, toast, openModal, closeModal, LOGO_B64, buildTimeOpts, timeSelect, llenarSelectEventos, initDatePickers, renderHorariosEv, getHorariosEv } from '../helpers';
import { SB_URL, SB_KEY, FOLDER_LOGISTICAS, WA_EDGE_URL, EMAIL_EDGE_URL, EMAIL_SEGURO, DRIVE_FOLDER_ID, FOTOS_FOLDER_ID } from '../config';
import { sbCached, invalidateCache } from '../query-cache';

// ── JORNADAS ──────────────────────────────────────────────
export async function loadJornadas() {
  try {
    const jornadas = await sbCached('v_jornadas', { limit: 100 });
    const semana = jornadas.filter(j => {
      const d = new Date(j.fecha);
      const hoy = new Date();
      const diff = (hoy - d) / 86400000;
      return diff <= 7;
    });
    const pendiente = 0; // tarifa se calcula al momento de pago

    document.getElementById('jorn-kpis').innerHTML = `
      <div class="kpi"><div class="kpi-label">Jornadas esta semana</div><div class="kpi-value">${semana.length}</div></div>
      <div class="kpi"><div class="kpi-label">Total pendiente pago ARS</div><div class="kpi-value gold">${fmtARS(pendiente)}</div></div>
      <div class="kpi"><div class="kpi-label">Total jornadas</div><div class="kpi-value">${jornadas.length}</div></div>
    `;

    document.getElementById('jorn-tbody').innerHTML = jornadas.length
      ? jornadas.map(j => {
          const tipoClass = j.tipo === 'Depósito' ? 'tipo-deposito'
            : ['Armado','Desarme'].includes(j.tipo) ? 'tipo-armado' : 'tipo-operador';
          return `<tr>
            <td>${fmtDate(j.fecha)}</td>
            <td><b>${j.personal_apellido ? j.personal_apellido + ' ' : ''}${j.personal_nombre || '—'}</b><br><span style="font-size:11px;color:var(--text-3)">${j.personal_tipo || ''}</span></td>
            <td>
              <span class="${tipoClass}" style="font-weight:500">${j.tipo}</span>
              ${j.transporte ? `<div style="font-size:11px;color:var(--text-2);margin-top:2px">🚛 ${j.transporte}${j.flete_personal ? ` — ${j.flete_personal}` : ''}</div>` : ''}
            </td>
            <td>${j.evento_codigo ? `<span style="font-size:11px;color:var(--text-2)">${j.evento_codigo}</span><br>${j.evento_venue || ''}` : '—'}</td>
            <td>
              —
              ${j.flete_monto ? `<div style="font-size:11px;color:var(--orange)">Flete: ${fmtARS(j.flete_monto)}</div>` : ''}
            </td>
            <td>
              ${j.pagado
                ? `<span style="color:var(--green);font-size:12px">✅ Pagado</span>`
                : `<button class="btn btn-ghost btn-sm" onclick="marcarPagada(${j.id})">Marcar pagada</button>`}
            </td>
            <td>
              <button class="btn btn-danger btn-sm" onclick="eliminarJornada(${j.id})">✕</button>
            </td>
          </tr>`;
        }).join('')
      : `<tr><td colspan="7"><div class="empty"><div class="empty-icon">👷</div>Sin jornadas registradas</div></td></tr>`;
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}


export function toggleTransporte() {
  const tipo = document.getElementById('jorn-tipo').value;
  document.getElementById('jorn-transporte-section').style.display =
    ['Armado','Desarme'].includes(tipo) ? 'block' : 'none';
  renderListaPersonal();
}

export function toggleFlete() {
  const esFlete = document.getElementById('jorn-tr-flete').checked;
  document.getElementById('jorn-flete-fields').style.display = esFlete ? 'grid' : 'none';
}

export async function abrirModalJornada() {
  document.getElementById('jorn-tipo').value  = '';
  document.getElementById('jorn-fecha').value = new Date().toISOString().split('T')[0];
  document.getElementById('jorn-notas').value = '';
  document.getElementById('jorn-transporte-section').style.display = 'none';
  document.getElementById('jorn-flete-fields').style.display       = 'none';
  document.querySelectorAll('input[name="jorn-transporte"]').forEach(r => r.checked = false);
  document.getElementById('jorn-flete-personal').value = '';
  document.getElementById('jorn-flete-monto').value    = '';

  llenarSelectEventos();
  renderListaPersonal();
  document.getElementById('jorn-tipo').onchange = toggleTransporte;
  openModal('modal-jornada');
}

export function renderListaPersonal() {
  const tipo  = document.getElementById('jorn-tipo').value;
  const lista = document.getElementById('jorn-personal-lista');
  if (!state.persCache.length) {
    lista.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-3);font-size:12px">No hay personal cargado. Agregá personal primero.</div>';
    return;
  }
  lista.innerHTML = state.persCache.map((p, i) => {
    const tarifa = tipo === 'Depósito'         ? p.tarifa_deposito
                 : ['Armado','Desarme'].includes(tipo) ? p.tarifa_armado
                 : tipo === 'Operador'          ? p.tarifa_operador
                 : null;
    const bg = i % 2 === 0 ? 'var(--bg)' : 'var(--surface2)';
    return `<label style="display:flex;align-items:center;gap:12px;padding:10px 14px;
                          background:${bg};cursor:pointer;border-bottom:1px solid var(--border)">
      <input type="checkbox" value="${p.id}" data-dep="${p.tarifa_deposito||0}"
             data-arm="${p.tarifa_armado||0}" data-op="${p.tarifa_operador||0}"
             style="width:16px;height:16px;accent-color:var(--gold);cursor:pointer">
      <div style="flex:1">
        <div style="font-size:13px;font-weight:500">${p.apellido||''} ${p.nombre}</div>
        <div style="font-size:11px;color:var(--text-3)">${p.tipo}</div>
      </div>
      <div style="text-align:right">
        ${tarifa
          ? `<div style="font-size:12px;font-weight:600;color:var(--gold)">${fmtARS(tarifa)}</div>
             <div style="font-size:10px;color:var(--text-3)">${tipo || 'seleccioná tipo'}</div>`
          : `<div style="font-size:11px;color:var(--text-3)">${tipo ? 'sin tarifa' : '—'}</div>`}
      </div>
    </label>`;
  }).join('');
}

// Guardar una jornada por cada persona seleccionada
export async function guardarJornadas() {
  const tipo  = document.getElementById('jorn-tipo').value;
  const fecha = document.getElementById('jorn-fecha').value;
  const notas = document.getElementById('jorn-notas').value;
  const evId  = parseInt(document.getElementById('jorn-evento').value) || null;

  if (!tipo)  { toast('Seleccioná el tipo de jornada', 'err'); return; }
  if (!fecha) { toast('La fecha es obligatoria', 'err'); return; }

  // Obtener checkboxes seleccionados
  const checks = document.querySelectorAll('#jorn-personal-lista input[type=checkbox]:checked');
  if (!checks.length) { toast('Seleccioná al menos una persona', 'err'); return; }

  try {
    const count = await sb('jornadas', { select: 'id' });
    let base = count.length + 1;

    for (const cb of checks) {
      const persId = parseInt(cb.value);
      const tarifa = tipo === 'Depósito'         ? parseFloat(cb.dataset.dep)
                   : ['Armado','Desarme'].includes(tipo) ? parseFloat(cb.dataset.arm)
                   : parseFloat(cb.dataset.op);

      const transporteVal = document.querySelector('input[name="jorn-transporte"]:checked')?.value || null;
      const row = {
        codigo:       `J${new Date().getFullYear()}-${String(base++).padStart(4, '0')}`,
        personal_id:  persId,
        tipo,
        fecha,
        pagado:       false,
        notas,
        transporte:   ['Armado','Desarme'].includes(tipo) ? transporteVal : null,
        flete_personal: (['Armado','Desarme'].includes(tipo) && transporteVal === 'Flete')
          ? document.getElementById('jorn-flete-personal').value.trim() || null : null,
        flete_monto:  (['Armado','Desarme'].includes(tipo) && transporteVal === 'Flete')
          ? parseARSInput(document.getElementById('jorn-flete-monto')) || null : null,
      };
      await sbPost('jornadas', row);
    }

    invalidateCache('jornadas');
    toast(`✅ ${checks.length} jornada${checks.length > 1 ? 's' : ''} registrada${checks.length > 1 ? 's' : ''}`);
    closeModal('modal-jornada');
    loadJornadas();
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

export async function marcarPagada(id) {
  await sbPatch('jornadas', id, { pagado: true, fecha_pago: today() });
  invalidateCache('jornadas');
  toast('Jornada marcada como pagada');
  loadJornadas();
}

export async function eliminarJornada(id) {
  if (!confirm('¿Eliminar esta jornada?')) return;
  await sbDelete('jornadas', id);
  invalidateCache('jornadas');
  toast('Jornada eliminada');
  loadJornadas();
}

// ── LIQUIDACIÓN SEMANAL ────────────────────────────────────
export async function refreshDriveToken() {
  const { data: { session } } = await state.supabaseClient.auth.getSession();
  const refresh = session?.provider_refresh_token || localStorage.getItem('drive_refresh_token');
  if (!refresh) return null;
  try {
    const r = await fetch('https://mitosihorpjmrosdxqbt.supabase.co/functions/v1/refresh-drive-token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (r.ok) {
      const { access_token } = await r.json();
      localStorage.setItem('drive_token', access_token);
      return access_token;
    }
  } catch(_) {}
  return null;
}

export async function getDriveToken() {
  const { data: { session } } = await state.supabaseClient.auth.getSession();
  return session?.provider_token || localStorage.getItem('drive_token') || await refreshDriveToken();
}

export async function subirPdfDrive(pdfBlob, nombreArchivo, folderId) {
  let token = await getDriveToken();
  if (!token) { toast('Sin acceso a Drive. Cerrá sesión y volvé a ingresar.', 'err'); return null; }

  const doUpload = async (t) => {
    const metadata = { name: nombreArchivo, parents: [folderId], mimeType: 'application/pdf' };
    const fd = new FormData();
    fd.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    fd.append('file', pdfBlob, nombreArchivo);
    return fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
      { method: 'POST', headers: { Authorization: `Bearer ${t}` }, body: fd });
  };

  let res = await doUpload(token);

  // Si el token expiró, refrescar y reintentar automáticamente
  if (res.status === 401) {
    localStorage.removeItem('drive_token');
    token = await refreshDriveToken();
    if (!token) { toast('Sesión de Drive expirada. Cerrá sesión y volvé a ingresar.', 'err'); return null; }
    res = await doUpload(token);
  }

  if (!res.ok) { toast('Error subiendo a Drive', 'err'); return null; }
  return (await res.json()).webViewLink;
}

export async function liquidarSemana() {
  // Calcular lunes y domingo de la semana pasada
  const hoy = new Date();
  const diaSemana = hoy.getDay() === 0 ? 7 : hoy.getDay(); // lunes=1 ... domingo=7
  const lunesAnterior = new Date(hoy); lunesAnterior.setDate(hoy.getDate() - diaSemana - 6);
  const domingoAnterior = new Date(lunesAnterior); domingoAnterior.setDate(lunesAnterior.getDate() + 6);

  const fmt = d => d.toISOString().split('T')[0];
  const desde = fmt(lunesAnterior);
  const hasta = fmt(domingoAnterior);

  // Traer jornadas no pagadas del período
  const todas = await sb('v_jornadas', { limit: 500 });
  const pendientes = todas.filter(j => !j.pagado && j.fecha >= desde && j.fecha <= hasta);

  if (!pendientes.length) {
    toast(`Sin jornadas pendientes entre ${desde} y ${hasta}`, 'err'); return;
  }

  const fmtPeriodo = `${lunesAnterior.toLocaleDateString('es-AR')} al ${domingoAnterior.toLocaleDateString('es-AR')}`;
  if (!confirm(`Liquidar ${pendientes.length} jornada(s) del ${fmtPeriodo}?\nSe generará un PDF por persona y se subirá a Drive.`)) return;

  // Agrupar por persona
  const persData = await sb('personal', { limit: 500 });
  const porPersona = {};
  pendientes.forEach(j => {
    const key = j.personal_id;
    if (!porPersona[key]) {
      const p = persData.find(x => x.id === j.personal_id) || {};
      porPersona[key] = { apellido: j.personal_apellido||'', nombre: j.personal_nombre||'', tipo: p.tipo||'Freelance', sueldo_fijo: p.sueldo_fijo||0, tarifa_armado: p.tarifa_armado||0, tarifa_operador: p.tarifa_operador||0, tarifa_deposito: p.tarifa_deposito||0, jornadas: [] };
    }
    porPersona[key].jornadas.push(j);
  });

  const FOLDER_ID = '101wBK_cRmy4rnVK-xalX1UKYOVhLNsV6';
  const fechaHoy = fmt(hoy);
  let ok = 0; let err = 0;

  for (const [persId, data] of Object.entries(porPersona)) {
    try {
      const pdfBlob = generarReciboPDF(data, fmtPeriodo, lunesAnterior);
      const nombreArchivo = `${fechaHoy}-${data.apellido},${data.nombre}.pdf`;
      const url = await subirPdfDrive(pdfBlob, nombreArchivo, FOLDER_ID);
      if (url) {
        // Marcar jornadas como pagadas
        for (const j of data.jornadas) {
          await sbPatch('jornadas', j.id, { pagado: true, fecha_pago: fechaHoy });
        }
        ok++;
      } else { err++; }
    } catch(e) { console.error(e); err++; }
  }

  toast(`✅ ${ok} recibo(s) generado(s)${err ? ` · ${err} error(es)` : ''}`);
  loadJornadas();
}

export function generarReciboPDF(data, periodo, lunesDate) {
  
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  const PW = 210; const PH = 297; const M = 14; const CW = PW - M * 2;
  let y = 0;

  const NEGRO  = [26, 26, 46];
  const ORO    = [201, 168, 76];
  const BLANCO = [255, 255, 255];
  const GRIS_F = [247, 247, 247];
  const GRIS_T = [85, 85, 85];

  const fill   = c => doc.setFillColor(c[0], c[1], c[2]);
  const stroke = c => doc.setDrawColor(c[0], c[1], c[2]);
  const text   = c => doc.setTextColor(c[0], c[1], c[2]);
  const font   = (style, size) => { doc.setFont('helvetica', style); doc.setFontSize(size); };

  // ── Header ────────────────────────────────────────────────
  fill(NEGRO); doc.rect(0, 0, PW, 30, 'F');
  try { doc.addImage(LOGO_B64, 'PNG', M, 1, 24, 24); } catch(e) {}
  font('bold', 16); text(BLANCO);
  doc.text('GROSSO ARGENTINA', M + 27, 11);
  font('normal', 9); text(ORO);
  doc.text('Soluciones Tecnologicas para Eventos', M + 27, 18);
  font('normal', 7.5); text([200,200,200]);
  doc.text('administracion@grossoarg.com', PW - M, 10, { align: 'right' });
  doc.text('Lomas de Zamora, Buenos Aires', PW - M, 16, { align: 'right' });
  doc.text('CUIT: 20-23091637-4', PW - M, 22, { align: 'right' });
  y = 33;

  stroke(ORO); doc.setLineWidth(0.8);
  doc.line(M, y, PW - M, y); y += 6;

  // ── Título ────────────────────────────────────────────────
  font('bold', 14); text(NEGRO);
  doc.text('LIQUIDACIÓN DE JORNADAS', M, y + 5);
  font('normal', 8); text(GRIS_T);
  doc.text(`Período: ${periodo}`, PW - M, y + 5, { align: 'right' });
  y += 14;

  // ── Datos de la persona ───────────────────────────────────
  fill(NEGRO); doc.rect(M, y, CW, 6, 'F');
  font('bold', 8); text(BLANCO);
  doc.text('PERSONAL', M + 2, y + 4); y += 7;

  fill(GRIS_F); doc.rect(M, y, CW, 9, 'F');
  font('bold', 11); text(NEGRO);
  doc.text(`${data.apellido} ${data.nombre}`, M + 3, y + 6.5); y += 12;

  // ── Tabla de jornadas ─────────────────────────────────────
  y += 3;
  fill(NEGRO); doc.rect(M, y, CW, 6, 'F');
  font('bold', 8); text(BLANCO);
  doc.text('DETALLE DE JORNADAS', M + 2, y + 4); y += 7;

  // Cabecera de tabla
  fill([44, 62, 80]); doc.rect(M, y, CW, 6, 'F');
  font('bold', 7.5); text(BLANCO);
  doc.text('FECHA',        M + 2,        y + 4);
  doc.text('TIPO',         M + 32,       y + 4);
  doc.text('EVENTO',       M + 72,       y + 4);
  doc.text('TARIFA',       PW - M - 2,   y + 4, { align: 'right' });
  y += 7;

  const esFijo = data.tipo === 'Fijo';

  const esIncluida = j => {
    if (!esFijo) return false;
    const dow = new Date(j.fecha + 'T12:00:00').getDay(); // 0=dom, 6=sab
    const esFinDeSemana = dow === 0 || dow === 6;
    if (j.tipo === 'Depósito') return true;
    if (['Armado','Desarme'].includes(j.tipo) && !esFinDeSemana) return true;
    return false;
  };

  const getTarifa = j => j.tipo === 'Depósito' ? (data.tarifa_deposito||0) : j.tipo === 'Operador' ? (data.tarifa_operador||0) : (data.tarifa_armado||0);
  const jSorted = data.jornadas.sort((a, b) => a.fecha.localeCompare(b.fecha));
  let total = esFijo ? (data.sueldo_fijo || 0) : 0;

  // Para Fijo: mostrar sueldo mensual como primera línea
  if (esFijo) {
    fill(GRIS_F); doc.rect(M, y, CW, 8, 'F');
    font('bold', 8); text(NEGRO);
    doc.text('Sueldo mensual', M + 2, y + 5.5);
    font('bold', 8); text([0, 128, 0]);
    doc.text(fmtARS(data.sueldo_fijo || 0), PW - M - 2, y + 5.5, { align: 'right' });
    y += 8;
  }

  jSorted.forEach((j, idx) => {
    if (y > PH - 35) { doc.addPage(); y = 15; }
    const incluida = esIncluida(j);
    fill(idx % 2 === 0 ? BLANCO : GRIS_F); doc.rect(M, y, CW, 8, 'F');
    font('normal', 8); text(incluida ? [150,150,150] : NEGRO);
    const fechaStr = new Date(j.fecha + 'T12:00:00').toLocaleDateString('es-AR');
    doc.text(fechaStr, M + 2, y + 5.5);
    doc.text((j.tipo || '') + (incluida ? ' (incluida)' : ''), M + 32, y + 5.5);
    const eventoStr = j.evento_codigo ? `${j.evento_codigo} · ${j.evento_venue || ''}` : '—';
    doc.text(eventoStr.substring(0, 28), M + 82, y + 5.5);
    font('bold', 8);
    if (incluida) {
      text([150,150,150]);
      doc.text('—', PW - M - 2, y + 5.5, { align: 'right' });
    } else {
      text(NEGRO);
      doc.text(fmtARS(getTarifa(j)), PW - M - 2, y + 5.5, { align: 'right' });
      total += getTarifa(j);
    }
    y += 8;
  });

  // ── Total ─────────────────────────────────────────────────
  y += 3;
  stroke(ORO); doc.setLineWidth(0.5);
  doc.line(M, y, PW - M, y); y += 6;
  fill(NEGRO); doc.rect(M, y, CW, 10, 'F');
  font('bold', 10); text(ORO);
  doc.text('TOTAL A LIQUIDAR', M + 3, y + 7);
  font('bold', 12); text(ORO);
  doc.text(fmtARS(total), PW - M - 3, y + 7, { align: 'right' });
  y += 18;

  // ── Footer ────────────────────────────────────────────────
  const footerY = PH - 12;
  fill(NEGRO); doc.rect(0, footerY, PW, 12, 'F');
  font('normal', 7.5); text(ORO);
  doc.text('Grosso Argentina | Soluciones Tecnologicas | administracion@grossoarg.com', M, footerY + 7);
  doc.text(`Liquidación ${new Date().toLocaleDateString('es-AR')}`, PW - M, footerY + 7, { align: 'right' });

  return doc.output('blob');
}

// ── LOGÍSTICA ─────────────────────────────────────────────
let logJornadas = [];
let waMensajesPendientes = []; // { personal_id, apellido, nombre, telefono, texto }

const DIAS_ES = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const MESES_ES_GEN = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

// ── LOGÍSTICA PANEL ────────────────────────────────────────
let logDias = [];
let logTipo = 'Evento';
let logEventosDepIds = []; // para tipo Depósito
let logEditId = null; // null = nueva, number = edición

export async function loadLogisticas() {
  const { desde, hasta, lunes, domingo } = getSemana(state.logOffset);
  const label = `${lunes.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit'})} — ${domingo.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'2-digit'})}`;
  document.getElementById('log-semana-label').textContent = label;

  const wrap = document.getElementById('log-lista-wrap');
  wrap.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const rows = await sbCached('logisticas', { order: 'created_at.desc', limit: 100 });
    if (!rows.length) {
      wrap.innerHTML = '<div class="empty"><div class="empty-icon">🗺️</div>Sin logísticas cargadas</div>';
      return;
    }
    const ids = rows.map(r => r.id);
    const [jornadas, logEvRels] = await Promise.all([
      sbCached('jornadas', { filters: [`logistica_id=in.(${ids.join(',')})`], select: 'logistica_id,tipo,fecha,personal_id,confirmada,pagado', limit: 2000 }),
      sbCached('logistica_eventos', { filters: [`logistica_id=in.(${ids.join(',')})`], limit: 500 }),
    ]);

    // Mapa logistica_id → evento_id (desde logistica_eventos, sin depender de logisticas.evento_id)
    const logToEvId = {};
    logEvRels.forEach(r => { if (!logToEvId[r.logistica_id]) logToEvId[r.logistica_id] = r.evento_id; });

    const TIPO_ORDEN = { 'Armado': 0, 'Operador': 1, 'Desarme': 2, 'Depósito': 3 };
    const TIPO_COLOR = { 'Armado': 'var(--gold)', 'Operador': 'var(--blue)', 'Desarme': 'var(--orange)', 'Depósito': 'var(--text-2)' };
    const TIPO_ICON  = { 'Armado': '🔧', 'Operador': '🎛️', 'Desarme': '📦', 'Depósito': '🏠' };

    // La logística original de cada evento es la de menor ID — no se puede eliminar
    const logIdOriginalPorEvento = {};
    rows.filter(r => logToEvId[r.id] && r.tipo !== 'Deposito').forEach(r => {
      const evId = logToEvId[r.id];
      if (!logIdOriginalPorEvento[evId] || r.id < logIdOriginalPorEvento[evId])
        logIdOriginalPorEvento[evId] = r.id;
    });

    const filas = [];
    rows.forEach(r => {
      const jors = jornadas.filter(j => j.logistica_id === r.id);
      const esDeposito = r.tipo === 'Deposito';


      let evLabel;
      if (esDeposito) {
        const evIds = logEvRels.filter(x => x.logistica_id === r.id).map(x => x.evento_id);
        const names = evIds.map(eid => { const e = (state.evCache||[]).find(x=>x.id===eid); return e ? (e.venue||e.codigo||e.id) : `#${eid}`; });
        evLabel = names.length ? names.join(', ') : '—';
      } else {
        const _evId = logToEvId[r.id];
        const ev = _evId ? (state.evCache||[]).find(e => e.id === _evId) : null;
        evLabel = ev ? (ev.venue || ev.codigo || ev.id) : (_evId ? `#${_evId}` : '—');
      }

      const evId = logToEvId[r.id] || null;
      const esOriginal = evId && logIdOriginalPorEvento[evId] === r.id;

      if (esDeposito) {
        const dias = [...new Set(jors.map(j => j.fecha))].sort();
        const persIds = [...new Set(jors.map(j => j.personal_id).filter(Boolean))];
        const fechaLabel = dias.length ? new Date(dias[0]+'T12:00:00').toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '—';
        filas.push({ logId: r.id, tipo: 'Depósito', evLabel, fechaLabel, persCount: persIds.length, orden: 3, eliminable: true });
      } else {
        const ev = evId ? (state.evCache||[]).find(e => e.id === evId) : null;
        const fechaFallback = { Armado: ev?.fecha_armado, Operador: ev?.fecha_evento, Desarme: ev?.fecha_desarme };
        const tiposBase = ['Armado', 'Operador', 'Desarme'];
        const tiposExtra = [...new Set(jors.map(j => j.tipo))].filter(t => !tiposBase.includes(t));
        // Solo mostrar tipos que realmente tienen jornadas; si no hay ninguna, mostrar el tipo de la logística
        const tiposConJornadas = tiposBase.filter(t => jors.some(j => j.tipo === t)).concat(tiposExtra);
        const tiposAMostrar = tiposConJornadas.length ? tiposConJornadas : [r.tipo];
        tiposAMostrar.forEach(tipo => {
          const jorsTipo = jors.filter(j => j.tipo === tipo);
          const dias = [...new Set(jorsTipo.map(j => j.fecha).filter(Boolean))].sort();
          const todasConfirmadas = jorsTipo.length > 0 && jorsTipo.every(j => j.confirmada);
          const todasPagadas = jorsTipo.length > 0 && jorsTipo.every(j => j.pagado);

          if (dias.length > 1) {
            // Una fila por fecha para eventos multi-día
            dias.forEach(dia => {
              const jorsDelDia = jorsTipo.filter(j => j.fecha === dia);
              const persIdsDia = [...new Set(jorsDelDia.map(j => j.personal_id).filter(Boolean))];
              const fechaLabel = new Date(dia+'T12:00:00').toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'2-digit'});
              filas.push({ logId: r.id, eventoId: evId, tipo, evLabel, fechaLabel, fechaSort: dia, persCount: persIdsDia.length, orden: TIPO_ORDEN[tipo]??9, eliminable: false, todasConfirmadas: jorsDelDia.every(j=>j.confirmada), todasPagadas: jorsDelDia.every(j=>j.pagado) });
            });
          } else {
            const persIds = [...new Set(jorsTipo.map(j => j.personal_id).filter(Boolean))];
            const fechaEfectiva = dias.length ? null : (fechaFallback[tipo] || null);
            const fechaLabel = dias.length
              ? new Date(dias[0]+'T12:00:00').toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'2-digit'})
              : fechaEfectiva
                ? `<span style="color:var(--text-3)">${new Date(fechaEfectiva+'T12:00:00').toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'2-digit'})}</span>`
                : '—';
            const fechaSort = dias.length ? dias[0] : (fechaEfectiva || '9999-99-99');
            filas.push({ logId: r.id, eventoId: evId, tipo, evLabel, fechaLabel, fechaSort, persCount: persIds.length, orden: TIPO_ORDEN[tipo]??9, eliminable: false, todasConfirmadas, todasPagadas });
          }
        });
      }
    });

    // Contar cuántas filas hay por (eventoId + tipo) para saber cuáles son eliminables
    const countPorTipo = {};
    filas.forEach(f => {
      const key = `${f.eventoId}__${f.tipo}`;
      countPorTipo[key] = (countPorTipo[key] || 0) + 1;
    });
    filas.forEach(f => {
      const key = `${f.eventoId}__${f.tipo}`;
      f.eliminable = countPorTipo[key] > 1;
    });

    // Ordenar por evento, tipo y fecha para numerar correctamente
    filas.sort((a,b) => (a.eventoId||0) - (b.eventoId||0) || a.orden - b.orden || (a.fechaSort||'').localeCompare(b.fechaSort||''));

    // Numerar tipos duplicados por evento según orden de fecha (Armado 1 = más temprano)
    const contadorTipo = {};
    filas.forEach(f => {
      const key = `${f.eventoId}__${f.tipo}`;
      contadorTipo[key] = (contadorTipo[key] || 0) + 1;
      f._tipoIdx = contadorTipo[key];
    });
    const maxPorTipo = {};
    filas.forEach(f => { const key = `${f.eventoId}__${f.tipo}`; maxPorTipo[key] = Math.max(maxPorTipo[key]||0, f._tipoIdx); });
    filas.forEach(f => {
      const key = `${f.eventoId}__${f.tipo}`;
      f.tipoLabel = maxPorTipo[key] > 1 ? `${f.tipo} ${f._tipoIdx}` : f.tipo;
    });

    // Calcular fecha ancla por logística = fecha del Operador (o la más temprana si no hay)
    const anclaLog = {};
    rows.forEach(r => {
      const jors = jornadas.filter(j => j.logistica_id === r.id);
      const opFechas = jors.filter(j => j.tipo === 'Operador').map(j => j.fecha).filter(Boolean).sort();
      const todasFechas = jors.map(j => j.fecha).filter(Boolean).sort();
      // Preferir fecha del evento desde state.evCache
      const evId = logToEvId[r.id];
      const ev = evId ? (state.evCache||[]).find(e => e.id === evId) : null;
      anclaLog[r.id] = (ev?.fecha_evento) || opFechas[0] || todasFechas[0] || null;
    });

    // Filtrar: una fila aparece en la semana si su logística tiene ancla en esa semana
    const filasSemanales = filas.filter(f => {
      const ancla = anclaLog[f.logId];
      return ancla && ancla >= desde && ancla <= hasta;
    });
    const filasSinFecha = filas.filter(f => !anclaLog[f.logId]);

    if (!filasSemanales.length && !filasSinFecha.length) {
      wrap.innerHTML = '<div class="empty"><div class="empty-icon">🗺️</div>Sin logísticas esta semana</div>';
      return;
    }

    filasSemanales.sort((a,b) => (a.fechaSort||'').localeCompare(b.fechaSort||'') || a.orden - b.orden);

    // Agrupar por día
    const porDia = {};
    filasSemanales.forEach(f => {
      if (!porDia[f.fechaSort]) porDia[f.fechaSort] = [];
      porDia[f.fechaSort].push(f);
    });

    const renderFila = f => `
      <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid var(--border)">
        <div style="flex:2;min-width:0">
          <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${f.evLabel}</div>
        </div>
        <div style="flex:1">
          <span style="font-size:12px;font-weight:600;color:${TIPO_COLOR[f.tipo]||'var(--text-1)'}">${TIPO_ICON[f.tipo]||''} ${f.tipoLabel}</span>
        </div>
        <div style="font-size:12px;color:var(--text-2);width:80px;text-align:center">${f.persCount} pers.</div>
        <div style="display:flex;gap:6px;flex-shrink:0;align-items:center">
          ${f.todasConfirmadas
            ? `<span style="font-size:11px;font-weight:600;color:var(--text-3);background:var(--bg-3);padding:3px 8px;border-radius:20px">✓ Confirmado</span>`
            : `<button class="btn btn-ghost btn-sm" onclick="confirmarJornadas(${f.logId},'${f.tipo}')" style="color:var(--green);border-color:rgba(46,204,113,.3)">✓ Confirmar</button>`}
          <button class="btn btn-ghost btn-sm" onclick="${f.eliminable ? `editarLogistica(${f.logId},'${f.tipo}',true)` : `abrirAgregarArmadoParaTipo(${f.logId},'${f.tipo}',${f.eventoId})`}">✏️</button>
          <button class="btn btn-ghost btn-sm" onclick="abrirDetLogistica(${f.logId},'${f.tipo}')">📋</button>
          ${f.eliminable ? `<button class="btn btn-danger btn-sm" onclick="eliminarLogistica(${f.logId})">✕</button>` : ''}
        </div>
      </div>`;

    let html = '';

    Object.keys(porDia).sort().forEach(dia => {
      const d = new Date(dia + 'T12:00:00');
      const diaLabel = d.toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long' });
      html += `<div style="font-size:12px;font-weight:600;color:var(--gold);letter-spacing:.06em;text-transform:uppercase;padding:10px 0 4px">${diaLabel}</div>
        <div class="card" style="margin-bottom:12px;padding:0;overflow:hidden">
          ${porDia[dia].map(renderFila).join('')}
        </div>`;
    });

    if (filasSinFecha.length) {
      html += `<div style="font-size:12px;font-weight:600;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase;padding:10px 0 4px">Sin fecha asignada</div>
        <div class="card" style="margin-bottom:12px;padding:0;overflow:hidden">
          ${filasSinFecha.map(renderFila).join('')}
        </div>`;
    }

    wrap.innerHTML = html;
  } catch(e) { wrap.innerHTML = `<div class="empty">Error: ${e.message}</div>`; }
}

let logEditTipo = null; // tipo filtrado en modo edición
let logEditEsExtra = false; // si es logística extra (fecha/hora editable)

export async function editarLogistica(id, tipo, esExtra = false) {
  logEditId = id;
  logEditTipo = tipo || null;
  logEditEsExtra = !!esExtra;
  logEventosDepIds = [];
  document.getElementById('nlg-modal-title').textContent = tipo ? `Editar ${tipo}` : 'Editar logística';
  document.getElementById('nlg-notas').value = '';

  const sel = document.getElementById('nlg-evento');
  sel.innerHTML = '<option value="">— Seleccioná un evento —</option>';
  const evRelevantes = (state.evCache || [])
    .filter(e => ['Confirmado','Realizado','Cobrado'].includes(e.estado))
    .sort((a,b) => (a.fecha_evento||'').localeCompare(b.fecha_evento||''));
  evRelevantes.forEach(e => {
    const opt = document.createElement('option');
    opt.value = e.id;
    const fecha = e.fecha_evento ? new Date(e.fecha_evento+'T12:00:00').toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit'}) : '';
    opt.textContent = `${fecha} — ${e.venue || e.codigo || e.id}`;
    sel.appendChild(opt);
  });

  openModal('modal-nueva-logistica');

  try {
    const [logRows, todasJornadas] = await Promise.all([
      sbCached('logisticas', { filters: [`id=eq.${id}`], limit: 1 }),
      sbCached('v_jornadas', { filters: [`logistica_id=eq.${id}`], order: 'fecha,tipo', limit: 500 }),
    ]);
    const log = logRows[0];
    if (!log) { toast('Logística no encontrada', 'err'); return; }

    if (log.notas) document.getElementById('nlg-notas').value = log.notas;
    setTipoLog(log.tipo === 'Deposito' ? 'Deposito' : 'Evento');
    if (log.tipo !== 'Deposito') {
      const evRel = await sbCached('logistica_eventos', { filters: [`logistica_id=eq.${id}`], select: 'evento_id', limit: 1 });
      if (evRel[0]?.evento_id) document.getElementById('nlg-evento').value = evRel[0].evento_id;
    }

    // Filtrar por tipo si estamos editando uno solo
    const jornadas = tipo ? todasJornadas.filter(j => j.tipo === tipo) : todasJornadas;

    const grupos = {};
    jornadas.forEach(j => {
      const key = `${j.tipo}__${j.fecha}`;
      if (!grupos[key]) grupos[key] = { id: Date.now() + Math.random(), tipo: j.tipo, fecha: j.fecha, hora_inicio: j.hora_inicio || '', personal: [], personalOriginal: {}, transporte: j.transporte || (['Armado','Desarme'].includes(j.tipo) ? 'Camioneta propia' : 'Sin transporte'), flete_personal: j.flete_personal || '', flete_monto: j.flete_monto || '' };
      if (j.personal_id && !grupos[key].personal.includes(j.personal_id)) {
        grupos[key].personal.push(j.personal_id);
        grupos[key].personalOriginal[j.personal_id] = j.id; // jornada_id original
      }
    });
    logDias = Object.values(grupos);

    const orden = { 'Armado': 0, 'Operador': 1, 'Desarme': 2 };
    logDias.sort((a,b) => (orden[a.tipo]??3) - (orden[b.tipo]??3) || a.fecha.localeCompare(b.fecha));

    renderDiasLog();
  } catch(e) { toast('Error cargando logística: ' + e.message, 'err'); }
}

export function setArmadoEvento(evId, tipo) {
  const ev = evId ? (state.evCache||[]).find(e => e.id === evId) : null;
  const evEl   = document.getElementById('armado-evento');
  const tipoEl = document.getElementById('armado-tipo');
  evEl.textContent    = ev ? `${ev.codigo} · ${ev.cliente_nombre}${ev.venue ? ' · ' + ev.venue : ''}` : '—';
  evEl.dataset.value  = evId || '';
  tipoEl.textContent   = tipo || '—';
  tipoEl.dataset.value = tipo || '';
  const fechaMap = { Armado: ev?.fecha_armado, Operador: ev?.fecha_evento, Desarme: ev?.fecha_desarme };
  const horaMap  = { Armado: ev?.hora_armado,  Operador: ev?.horario,      Desarme: ev?.hora_desarme };
  const fecha = fechaMap[tipo] || '';
  const hora  = horaMap[tipo]  || '';
  const fechaEl = document.getElementById('armado-fecha');
  const horaEl  = document.getElementById('armado-hora');
  fechaEl.textContent = fecha ? new Date(fecha+'T12:00:00').toLocaleDateString('es-AR',{weekday:'short',day:'2-digit',month:'2-digit',year:'numeric'}) : '—';
  fechaEl.dataset.value = fecha;
  horaEl.textContent = hora || '—';
  horaEl.dataset.value = hora;
}

export async function abrirAgregarArmadoParaTipo(logId, tipo, evId) {
  abrirAgregarArmado();
  document.getElementById('armado-modal-title').textContent = `Editar personal — ${tipo}`;
  setArmadoEvento(evId, tipo);
  // Guardar logId fijo: en modo edición nunca se crea logística nueva
  const btn = document.getElementById('armado-guardar');
  btn.dataset.editLogId = logId;
  // Pre-marcar personal ya asignado
  const jornTipo = tipo === 'Operador' ? 'Operador' : tipo;
  const asignadas = await sb('jornadas', { filters: [`logistica_id=eq.${logId}`, `tipo=eq.${jornTipo}`, `personal_id=not.is.null`], select: 'personal_id', limit: 100 });
  const asignadosIds = new Set(asignadas.map(j => j.personal_id));
  document.getElementById('armado-personal').querySelectorAll('input[type=checkbox]').forEach((cb: any) => {
    cb.checked = asignadosIds.has(parseInt(cb.value));
  });
}

export async function abrirPresupuestoParaEvento(eventoId) {
  const ev = (state.evCache || []).find(e => e.id === eventoId);
  if (!ev) return;
  state._presupuestoParaEventoId = eventoId;
  await abrirModalPresupuesto();
  document.querySelector('#modal-presupuesto .modal-title').textContent = `Presupuesto adicional — ${ev.cliente_nombre}`;
  document.getElementById('pres-cliente').value = ev.cliente_nombre || '';
  document.getElementById('pres-venue').value   = ev.venue || '';
  document.getElementById('pres-tipo').value    = ev.tipo_evento || 'Casamiento';
  const fp = document.getElementById('pres-fechas')._flatpickr;
  if (fp && ev.fecha_evento) fp.setDate([ev.fecha_evento]);
}

export function abrirAgregarDeposito() {
  abrirAgregarArmado();
  setTipoLog('Deposito');
  document.getElementById('armado-modal-title').textContent = 'Agregar día — Depósito';
}

export function abrirAgregarArmado() {
  // Resetear campos de solo lectura
  ['armado-evento','armado-tipo','armado-fecha','armado-hora'].forEach(id => {
    const el = document.getElementById(id); el.textContent = '—'; el.dataset.value = '';
  });
  // Personal checkboxes
  const persDiv = document.getElementById('armado-personal');
  persDiv.innerHTML = (state.persCache || []).map(p =>
    `<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
      <input type="checkbox" value="${p.id}" style="width:15px;height:15px;cursor:pointer">
      ${p.apellido} ${p.nombre}
    </label>`
  ).join('');
  document.getElementById('armado-modal-title').textContent = 'Agregar día de armado';
  delete (document.getElementById('armado-guardar') as HTMLElement).dataset.editLogId;
  openModal('modal-agregar-armado');
}

export async function guardarAgregarArmado() {
  const evId = parseInt(document.getElementById('armado-evento').dataset.value);
  const tipo  = document.getElementById('armado-tipo').dataset.value  || 'Armado';
  const fecha = document.getElementById('armado-fecha').dataset.value || '';
  const hora  = document.getElementById('armado-hora').dataset.value  || '';
  if (!evId || !fecha) { toast('Abrí el modal desde un evento para cargar la fecha', 'err'); return; }

  const persIds = [...document.getElementById('armado-personal').querySelectorAll('input[type=checkbox]:checked')].map(o => parseInt(o.value));

  const editLogId = parseInt((document.getElementById('armado-guardar') as HTMLElement).dataset.editLogId || '');
  const modoEdicion = !!editLogId;

  // Jornada tipo → logística tipo
  const JORNADA_TO_LOG_TIPO = { 'Operador': 'Evento', 'Armado': 'Armado', 'Desarme': 'Desarme', 'Depósito': 'Deposito' };
  const logTipoBuscado = JORNADA_TO_LOG_TIPO[tipo] || tipo;

  try {
    let logId: number | undefined = modoEdicion ? editLogId : undefined;
    if (!logId) {
      const armRels = await sb('logistica_eventos', { filters: [`evento_id=eq.${evId}`], select: 'logistica_id', limit: 20 });
      const logIds = armRels.map(r => r.logistica_id);
      if (logIds.length) {
        const logs = await sb('logisticas', { filters: [`id=in.(${logIds.join(',')})`], select: 'id,tipo', limit: 20 });
        logId = logs.find((l: any) => l.tipo === logTipoBuscado)?.id ?? logs[0]?.id;
      }
      if (!logId) {
        const ev = (state.evCache || []).find(e => e.id === evId);
        const newLog = await sbPost('logisticas', { tipo: logTipoBuscado, notas: `Logística — ${ev?.venue || ev?.cliente_nombre || ''}`, created_at: new Date().toISOString() });
        logId = Array.isArray(newLog) ? newLog[0]?.id : newLog?.id;
        await sbPost('logistica_eventos', { logistica_id: logId, evento_id: evId });
      }
    }

    const codigoBase = `J${Date.now()}`;
    if (persIds.length > 0) {
      // En modo edición: solo asignar a jornadas existentes sin personal, nunca crear nuevas
      const sinPersonal = await sb('jornadas', { filters: [`logistica_id=eq.${logId}`, `tipo=eq.${tipo}`, `fecha=eq.${fecha}`, `personal_id=is.null`], select: 'id', limit: 100 });
      for (let i = 0; i < Math.min(persIds.length, sinPersonal.length); i++) {
        await sbPatch('jornadas', sinPersonal[i].id, { personal_id: persIds[i] });
      }
      if (!modoEdicion) {
        const nuevas = persIds.slice(sinPersonal.length).map((pid, i) => ({
          codigo: `${codigoBase}-${i}`,
          logistica_id: logId,
          tipo,
          fecha: fecha || null,
          personal_id: pid,
          pagado: false,
        }));
        if (nuevas.length) await sbPost('jornadas', nuevas);
      }
    } else {
      toast('Seleccioná al menos una persona', 'err');
      return;
    }

    closeModal('modal-agregar-armado');
    invalidateCache('jornadas');
    invalidateCache('logisticas');
    invalidateCache('logistica_eventos');
    toast('Día agregado');
    loadLogisticas();
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

export async function confirmarJornadasPersona(persId, desde, hasta) {
  try {
    const jors = await sb('v_jornadas', { filters: [`personal_id=eq.${persId}`, `fecha=gte.${desde}`, `fecha=lte.${hasta}`, `pagado=eq.false`, `confirmada=eq.false`], select: 'id', limit: 200 });
    for (const j of jors) await sbPatch('jornadas', j.id, { confirmada: true });
    invalidateCache('jornadas');
    toast(`✅ ${jors.length} jornada(s) confirmadas`);
    loadPagos();
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

export async function confirmarJornadas(logId, tipo) {
  try {
    const jors = await sb('jornadas', { filters: [`logistica_id=eq.${logId}`, `tipo=eq.${tipo}`, `confirmada=eq.false`], select: 'id', limit: 200 });
    if (!jors.length) { toast('Ya están todas confirmadas'); return; }
    for (const j of jors) await sbPatch('jornadas', j.id, { confirmada: true });
    invalidateCache('jornadas');
    toast(`✅ ${jors.length} jornada(s) confirmadas — aparecen en Pagos`);
    loadLogisticas();
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

export function abrirNuevaLogistica() {
  logEditId = null;
  logEventosDepIds = [];
  document.getElementById('nlg-modal-title').textContent = 'Nueva logística';
  document.getElementById('nlg-notas').value = '';
  // Poblar evento single select
  const sel = document.getElementById('nlg-evento');
  sel.innerHTML = '<option value="">— Seleccioná un evento —</option>';
  const evRelevantes = (state.evCache || [])
    .filter(e => ['Confirmado','Realizado','Cobrado'].includes(e.estado))
    .sort((a,b) => (a.fecha_evento||'').localeCompare(b.fecha_evento||''));
  evRelevantes.forEach(e => {
    const opt = document.createElement('option');
    opt.value = e.id;
    const fecha = e.fecha_evento ? new Date(e.fecha_evento+'T12:00:00').toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit'}) : '';
    opt.textContent = `${fecha} — ${e.venue || e.codigo || e.id}`;
    sel.appendChild(opt);
  });
  // Poblar multi-evento para depósito
  document.getElementById('nlg-eventos-dep').innerHTML = evRelevantes.map(e => {
    const fecha = e.fecha_evento ? new Date(e.fecha_evento+'T12:00:00').toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit'}) : '';
    return `<label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;white-space:nowrap">
      <input type="checkbox" value="${e.id}" onchange="toggleEvDep(${e.id})">
      ${fecha} — ${e.venue || e.codigo || e.id}
    </label>`;
  }).join('');
  setTipoLog('Evento');
  openModal('modal-nueva-logistica');
}

export function setTipoLog(tipo) {
  logTipo = tipo;
  const hoy = new Date().toISOString().split('T')[0];
  document.getElementById('nlg-btn-evento').className   = tipo === 'Evento'   ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
  document.getElementById('nlg-btn-deposito').className = tipo === 'Deposito' ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
  document.getElementById('nlg-sec-evento').style.display   = tipo === 'Evento'   ? '' : 'none';
  document.getElementById('nlg-sec-deposito').style.display = tipo === 'Deposito' ? '' : 'none';
  if (tipo === 'Evento') {
    logDias = [
      { id: Date.now()+1, tipo: 'Armado',    fecha: '', hora_inicio: '', personal: [], transporte: 'Camioneta propia', flete_personal: '', flete_monto: '' },
      { id: Date.now()+2, tipo: 'Operador',  fecha: '', hora_inicio: '', personal: [], transporte: 'Sin transporte',   flete_personal: '', flete_monto: '' },
      { id: Date.now()+3, tipo: 'Desarme',  fecha: '', hora_inicio: '', personal: [], transporte: 'Camioneta propia', flete_personal: '', flete_monto: '' },
    ];
  } else {
    logDias = [
      { id: Date.now()+1, tipo: 'Depósito', fecha: hoy, personal: [], transporte: 'Sin transporte', flete_personal: '', flete_monto: '' },
    ];
  }
  renderDiasLog();
}

export function toggleEvDep(evId) {
  const idx = logEventosDepIds.indexOf(evId);
  if (idx === -1) logEventosDepIds.push(evId); else logEventosDepIds.splice(idx, 1);
}

export function onCambioEventoLog() {
  const evId = parseInt(document.getElementById('nlg-evento').value);
  const ev = (state.evCache || []).find(e => e.id === evId);
  if (!ev) return;
  let fechasOp = [];
  try { fechasOp = ev.fechas_evento ? (Array.isArray(ev.fechas_evento) ? ev.fechas_evento : JSON.parse(ev.fechas_evento)) : []; } catch(e) {}
  let horasOp = [];
  try { horasOp = ev.horarios_evento ? (Array.isArray(ev.horarios_evento) ? ev.horarios_evento : JSON.parse(ev.horarios_evento)) : []; } catch(e) {}
  if (!fechasOp.length && ev.fecha_evento) fechasOp = [ev.fecha_evento];
  if (!horasOp.length && ev.horario) horasOp = [ev.horario];

  let opIdx = 0;
  logDias.forEach(d => {
    if (d.tipo === 'Operador') {
      d.fecha      = fechasOp[opIdx] || fechasOp[0] || '';
      d.hora_inicio = horasOp[opIdx] || horasOp[0] || '';
      opIdx++;
    }
    if (d.tipo === 'Armado')  { d.fecha = ev.fecha_armado  || ''; d.hora_inicio = ev.hora_armado  || ''; }
    if (d.tipo === 'Desarme') { d.fecha = ev.fecha_desarme || ''; d.hora_inicio = ev.hora_desarme || ''; }
  });
  renderDiasLog();
}

export function agregarDiaLog() {
  const hoy = new Date().toISOString().split('T')[0];
  if (logTipo === 'Deposito') {
    logDias.push({ id: Date.now(), tipo: 'Depósito', fecha: hoy, personal: [], transporte: 'Sin transporte', flete_personal: '', flete_monto: '' });
  } else {
    logDias.push({ id: Date.now(), tipo: 'Armado', fecha: hoy, personal: [], transporte: 'Camioneta propia', flete_personal: '', flete_monto: '' });
  }
  renderDiasLog();
}

export function eliminarDiaLog(id) {
  logDias = logDias.filter(d => d.id !== id);
  renderDiasLog();
}

export function updateDiaLog(id, field, value) {
  const d = logDias.find(d => d.id === id);
  if (!d) return;
  d[field] = value;
  if (field === 'tipo') {
    if (value === 'Operador') {
      const evId = parseInt(document.getElementById('nlg-evento').value);
      const ev = (state.evCache || []).find(e => e.id === evId);
      if (ev) {
        let fOp = [];
        try { fOp = ev.fechas_evento ? (Array.isArray(ev.fechas_evento) ? ev.fechas_evento : JSON.parse(ev.fechas_evento)) : []; } catch(e) {}
        let hOp = [];
        try { hOp = ev.horarios_evento ? (Array.isArray(ev.horarios_evento) ? ev.horarios_evento : JSON.parse(ev.horarios_evento)) : []; } catch(e) {}
        d.fecha      = fOp[0] || ev.fecha_evento || d.fecha;
        d.hora_inicio = hOp[0] || ev.horario || '';
      }
    }
    renderDiasLog();
  } else if (field === 'transporte') {
    renderDiasLog();
  }
}

export function onFleteChofer(diaId, value) {
  const d = logDias.find(d => d.id === diaId);
  if (!d) return;
  if (value === '__otro__') { d.flete_personal = ''; }
  else { d.flete_personal = value; }
  renderDiasLog();
}

export function togglePersonalDia(diaId, persId) {
  const d = logDias.find(d => d.id === diaId);
  if (!d) return;
  const idx = d.personal.indexOf(persId);
  if (idx === -1) d.personal.push(persId); else d.personal.splice(idx, 1);
}

export function renderDiasLog() {
  const personal = (state.persCache || []).filter(p => p.activo !== false);
  const container = document.getElementById('nlg-dias');
  if (!logDias.length) {
    container.innerHTML = '<div style="color:var(--text-2);font-size:13px;padding:12px 0">No hay días. Hacé clic en "Agregar día".</div>';
    return;
  }
  const modoEdicion = !!logEditId;
  container.innerHTML = logDias.map(d => {
    const conTransporte = ['Armado','Desarme'].includes(d.tipo);
    const persHtml = personal.map(p => `
      <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;white-space:nowrap">
        <input type="checkbox" ${d.personal.includes(p.id)?'checked':''} onchange="togglePersonalDia(${d.id},${p.id})">
        ${p.apellido} ${p.nombre}
      </label>`).join('');

    if (modoEdicion) {
      const TIPO_COLOR = { 'Armado': 'var(--gold)', 'Operador': 'var(--blue)', 'Desarme': 'var(--orange)', 'Depósito': 'var(--text-2)' };
      const TIPO_ICON  = { 'Armado': '🔧', 'Operador': '🎛️', 'Desarme': '📦', 'Depósito': '🏠' };
      const fechaHoraHtml = logEditEsExtra
        ? `<input type="date" class="inp" style="width:150px" value="${d.fecha}" onchange="updateDiaLog(${d.id},'fecha',this.value)">
           <select class="inp" style="width:110px" onchange="updateDiaLog(${d.id},'hora_inicio',this.value)">${buildTimeOpts(d.hora_inicio||'')}</select>`
        : `<span style="font-size:12px;color:var(--text-2)">${d.fecha ? new Date(d.fecha+'T12:00:00').toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'}) : '—'} ${d.hora_inicio ? '· 🕐 '+d.hora_inicio : ''}</span>`;
      return `<div style="background:var(--surface2);border-radius:8px;padding:14px;margin-bottom:10px">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
          <span style="font-size:12px;font-weight:600;color:${TIPO_COLOR[d.tipo]||'var(--text)'}">${TIPO_ICON[d.tipo]||''} ${d.tipo}</span>
          ${fechaHoraHtml}
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:10px">${persHtml}</div>
      </div>`;
    }

    const choferes = (state.persCache || []).filter(p => p.activo !== false);
    const choferOpts = `<option value="">— Chofer —</option>` + choferes.map(p => `<option value="${p.apellido} ${p.nombre}" ${d.flete_personal === p.apellido+' '+p.nombre ? 'selected' : ''}>${p.apellido} ${p.nombre}</option>`).join('') + `<option value="__otro__" ${d.flete_personal && !choferes.some(p=>p.apellido+' '+p.nombre===d.flete_personal)?'selected':''}>Otro...</option>`;
    const fleteExtra = d.transporte === 'Flete' ? `
      <select class="inp" style="width:160px" onchange="onFleteChofer(${d.id},this.value)">${choferOpts}</select>
      ${d.flete_personal && !choferes.some(p=>p.apellido+' '+p.nombre===d.flete_personal) ? `<input class="inp" style="width:130px" placeholder="Nombre chofer" value="${d.flete_personal}" onchange="updateDiaLog(${d.id},'flete_personal',this.value)">` : ''}
      <input class="inp" style="width:110px" type="number" placeholder="Monto" value="${d.flete_monto}" onchange="updateDiaLog(${d.id},'flete_monto',this.value)">` : '';
    return `<div style="background:var(--surface2);border-radius:8px;padding:14px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          ${logTipo === 'Deposito'
            ? `<span style="font-size:12px;font-weight:600;color:var(--orange)">📦 Depósito</span>`
            : `<select class="inp" style="width:140px" onchange="updateDiaLog(${d.id},'tipo',this.value)">
                ${['Armado','Operador','Desarme'].map(t=>`<option ${d.tipo===t?'selected':''}>${t}</option>`).join('')}
               </select>`}
          ${['Operador','Armado','Desarme'].includes(d.tipo)
            ? `<span style="font-size:12px;color:var(--text-2);background:var(--bg-2);border:1px solid var(--border);border-radius:6px;padding:6px 10px">${d.fecha ? new Date(d.fecha+'T12:00:00').toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'numeric'}) : '—'}</span>
               <span style="font-size:12px;color:var(--text-2);background:var(--bg-2);border:1px solid var(--border);border-radius:6px;padding:6px 10px">🕐 ${d.hora_inicio || '—'}</span>`
            : `<input type="date" class="inp" style="width:150px" value="${d.fecha}" onchange="updateDiaLog(${d.id},'fecha',this.value)">
               <select class="inp" style="width:110px" onchange="updateDiaLog(${d.id},'hora_inicio',this.value)">${buildTimeOpts(d.hora_inicio||'')}</select>`}
          ${conTransporte ? `<select class="inp" style="width:160px" onchange="updateDiaLog(${d.id},'transporte',this.value)">
            ${['Camioneta propia','Flete','Sin transporte'].map(t=>`<option ${d.transporte===t?'selected':''}>${t}</option>`).join('')}
          </select>${fleteExtra}` : ''}
        </div>
        <button class="btn btn-danger btn-sm" onclick="eliminarDiaLog(${d.id})">✕</button>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:10px">${persHtml}</div>
    </div>`;
  }).join('');
  initDatePickers(container);
}

export async function guardarLogistica() {
  if (!logDias.length) { toast('Agregá al menos un día', 'err'); return; }
  if (!logDias.some(d => d.personal.length)) { toast('Asigná personal a al menos un día', 'err'); return; }
  const notas = document.getElementById('nlg-notas').value.trim();

  let eventoId = null;
  if (logTipo === 'Evento') {
    eventoId = document.getElementById('nlg-evento').value;
    if (!eventoId) { toast('Seleccioná un evento', 'err'); return; }
  } else {
    if (!logEventosDepIds.length) { toast('Seleccioná al menos un evento para el depósito', 'err'); return; }
  }

  try {
    let logId;

    if (logEditId) {
      await sbPatch('logisticas', logEditId, { notas: notas || null });
      logId = logEditId;
    } else {
      // Modo creación
      const logRow = await sbPost('logisticas', {
        tipo: logTipo,
        notas: notas || null,
      });
      logId = Array.isArray(logRow) ? logRow[0].id : logRow.id;
      if (logTipo === 'Evento' && eventoId) {
        await sbPost('logistica_eventos', { logistica_id: logId, evento_id: parseInt(eventoId) });
      } else if (logTipo === 'Deposito' && logEventosDepIds.length) {
        await sbPost('logistica_eventos', logEventosDepIds.map(eid => ({ logistica_id: logId, evento_id: eid })));
      }
    }

    if (logEditId) {
      // Modo edición: solo delta de personal (no tocar fechas ni tarifas)
      const codigoPrefix = `J${Date.now()}`;
      let seq = 0;
      const toInsert = [];
      const toDelete = [];
      logDias.forEach(d => {
        const original = d.personalOriginal || {};
        const originalIds = Object.keys(original).map(Number);
        const currentIds  = d.personal;
        // Personal nuevo → insertar
        currentIds.filter(id => !originalIds.includes(id)).forEach(persId => {
          const p = (state.persCache || []).find(x => x.id === persId);
          if (!p) return;
          const tarifa = d.tipo === 'Depósito' ? p.tarifa_deposito : d.tipo === 'Operador' ? p.tarifa_operador : p.tarifa_armado;
          toInsert.push({
            codigo: `${codigoPrefix}-${seq++}`,
            personal_id: persId,
            fecha: d.fecha,
            tipo: d.tipo === 'Depósito' ? 'Depósito' : d.tipo,
            pagado: false,
            transporte: ['Armado','Desarme'].includes(d.tipo) ? d.transporte : null,
            flete_personal: d.transporte === 'Flete' ? (d.flete_personal || null) : null,
            flete_monto: d.transporte === 'Flete' ? (parseFloat(d.flete_monto) || null) : null,
            logistica_id: logId,
          });
        });
        // Personal eliminado → borrar su jornada original (solo si no está pagada)
        originalIds.filter(id => !currentIds.includes(id)).forEach(id => {
          if (original[id]) toDelete.push(original[id]);
        });
      });
      if (toInsert.length) await sbPost('jornadas', toInsert);
      for (const jornadaId of toDelete) {
        await fetch(`${SB_URL}/rest/v1/jornadas?id=eq.${jornadaId}&pagado=eq.false`, {
          method: 'DELETE', headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
        });
      }
    } else {
      // Modo creación
      const codigoPrefix = `J${Date.now()}`;
      let seq = 0;
      const jornadasToInsert = [];
      logDias.forEach(d => {
        d.personal.forEach(persId => {
          const p = (state.persCache || []).find(x => x.id === persId);
          if (!p) return;
          const tarifa = d.tipo === 'Depósito' ? p.tarifa_deposito : d.tipo === 'Operador' ? p.tarifa_operador : p.tarifa_armado;
          jornadasToInsert.push({
            codigo: `${codigoPrefix}-${seq++}`,
            personal_id: persId,
            fecha: d.fecha,
            tipo: d.tipo === 'Depósito' ? 'Depósito' : d.tipo,
            pagado: false,
            transporte: ['Armado','Desarme'].includes(d.tipo) ? d.transporte : null,
            flete_personal: d.transporte === 'Flete' ? (d.flete_personal || null) : null,
            flete_monto: d.transporte === 'Flete' ? (parseFloat(d.flete_monto) || null) : null,
            logistica_id: logId,
          });
        });
      });
      if (jornadasToInsert.length) await sbPost('jornadas', jornadasToInsert);
    }
    closeModal('modal-nueva-logistica');
    const wasEdit = !!logEditId;
    logEditId = null;
    logEditTipo = null;
    invalidateCache('logisticas');
    invalidateCache('jornadas');
    invalidateCache('logistica_eventos');
    toast(wasEdit ? `✅ Logística actualizada` : `✅ Logística creada con ${jornadasToInsert?.length ?? 0} jornadas`);
    loadLogisticas();
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

export async function enviarMailSeguroEvento(eventoId, evLabel) {
  try {
    const evRow = await sb('eventos', { filters: [`id=eq.${eventoId}`], select: 'cliente_id,salon_id', limit: 1 });
    const ev0 = evRow[0] || {};
    let beneficiarios = [];
    if (ev0.cliente_id) {
      const clRow = await sb('clientes', { filters: [`id=eq.${ev0.cliente_id}`], select: 'seguro_info', limit: 1 });
      try { beneficiarios = clRow[0]?.seguro_info ? JSON.parse(clRow[0].seguro_info) : []; } catch(e) {}
    }
    if (!beneficiarios.length && ev0.salon_id) {
      const slRow = await sb('salones', { filters: [`id=eq.${ev0.salon_id}`], select: 'seguro_info', limit: 1 });
      try { beneficiarios = slRow[0]?.seguro_info ? JSON.parse(slRow[0].seguro_info) : []; } catch(e) {}
    }
    if (!beneficiarios.length) { toast('Cargá los beneficiarios en el cliente o salón primero', 'err'); return; }

    const segRels = await sb('logistica_eventos', { filters: [`evento_id=eq.${eventoId}`], select: 'logistica_id', limit: 50 });
    const segLogIds = segRels.map(r => r.logistica_id);
    const jornadas = segLogIds.length ? await sb('jornadas', { filters: [`logistica_id=in.(${segLogIds.join(',')})`], select: 'personal_id', limit: 500 }) : [];
    const persIds = [...new Set(jornadas.map(j => j.personal_id).filter(Boolean))];
    if (!persIds.length) { toast('Sin personal asignado a este evento', 'err'); return; }

    const personal = await sb('personal', {
      filters: [`id=in.(${persIds.join(',')})`],
      select: 'apellido,nombre,dni,cuit,fecha_nacimiento',
      order: 'apellido',
      limit: 200,
    });

    const filas = personal.map(p => {
      const nacStr = p.fecha_nacimiento ? new Date(p.fecha_nacimiento+'T12:00:00').toLocaleDateString('es-AR') : '—';
      return `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee">${p.apellido||'—'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee">${p.nombre||'—'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee">${p.dni||'—'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee">${p.cuit||'—'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee">${nacStr}</td>
      </tr>`;
    }).join('');

    const filasClausula = beneficiarios.map(b =>
      `<li style="margin-bottom:4px"><strong>${b.nombre}</strong> — CUIT ${b.cuit}</li>`
    ).join('');

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#1A1A2E;padding:20px 24px;border-radius:8px 8px 0 0">
          <h2 style="color:#c9a84c;margin:0;font-size:18px">GROSSO ARGENTINA</h2>
          <p style="color:#aaa;margin:4px 0 0;font-size:13px">Soluciones Tecnológicas para Eventos</p>
        </div>
        <div style="background:#f9f9f9;padding:24px;border-radius:0 0 8px 8px">
          <p style="margin:0 0 16px;font-size:14px;color:#333">
            Listado de personal para cobertura de seguro:<br><strong>${evLabel}</strong>
          </p>
          <div style="background:#fff;border-radius:6px;padding:14px 16px;margin-bottom:16px;box-shadow:0 1px 4px rgba(0,0,0,.08)">
            <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#333">Cláusula de no repetición a favor de:</p>
            <ul style="margin:0;padding-left:18px;font-size:13px;color:#555">${filasClausula}</ul>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;border-radius:6px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)">
            <thead>
              <tr style="background:#1A1A2E;color:#c9a84c">
                <th style="padding:10px 12px;text-align:left">Apellido</th>
                <th style="padding:10px 12px;text-align:left">Nombre</th>
                <th style="padding:10px 12px;text-align:left">DNI</th>
                <th style="padding:10px 12px;text-align:left">CUIT</th>
                <th style="padding:10px 12px;text-align:left">Fecha Nac.</th>
              </tr>
            </thead>
            <tbody>${filas}</tbody>
          </table>
          <p style="margin:20px 0 0;font-size:12px;color:#999">Grosso Argentina · administracion@grossoarg.com</p>
        </div>
      </div>`;

    toast('Enviando mail de seguro...');
    const res = await fetch(EMAIL_EDGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SB_KEY}`, 'apikey': SB_KEY },
      body: JSON.stringify({ to: EMAIL_SEGURO, subject: `Seguro personal — ${evLabel}`, html }),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      await sbPatch('eventos', eventoId, { seguro_enviado: true });
      invalidateCache('eventos');
      const ev = (state.evCache || []).find(e => e.id === eventoId);
      if (ev) ev.seguro_enviado = true;
      toast(`✅ Mail enviado a ${EMAIL_SEGURO}`);
      loadDashboard();
    } else {
      toast('Error enviando mail: ' + (data.error || 'desconocido'), 'err');
    }
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

export async function enviarMailSeguro(logId) {
  try {
    // Traer jornadas de esta logística con personal_id único
    const jornadas = await sb('jornadas', {
      filters: [`logistica_id=eq.${logId}`],
      select: 'personal_id',
      limit: 500,
    });
    const persIds = [...new Set(jornadas.map(j => j.personal_id))];
    if (!persIds.length) { toast('Sin personal en esta logística', 'err'); return; }

    // Traer datos de personal
    const personal = await sb('personal', {
      filters: [`id=in.(${persIds.join(',')})`],
      select: 'apellido,nombre,dni,cuit,fecha_nacimiento',
      order: 'apellido',
      limit: 200,
    });

    // Traer info del evento para el asunto
    const mailRel = await sb('logistica_eventos', { filters: [`logistica_id=eq.${logId}`], select: 'evento_id', limit: 1 });
    const ev = mailRel[0]?.evento_id ? (state.evCache||[]).find(e => e.id === mailRel[0].evento_id) : null;
    const evLabel = ev ? (ev.venue || ev.codigo || `Evento #${ev.id}`) : `Logística #${logId}`;

    const filas = personal.map(p => {
      const nacStr = p.fecha_nacimiento
        ? new Date(p.fecha_nacimiento + 'T12:00:00').toLocaleDateString('es-AR')
        : '—';
      return `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee">${p.apellido || '—'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee">${p.nombre || '—'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee">${p.dni || '—'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee">${p.cuit || '—'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee">${nacStr}</td>
      </tr>`;
    }).join('');

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#1A1A2E;padding:20px 24px;border-radius:8px 8px 0 0">
          <h2 style="color:#c9a84c;margin:0;font-size:18px">GROSSO ARGENTINA</h2>
          <p style="color:#aaa;margin:4px 0 0;font-size:13px">Soluciones Tecnológicas para Eventos</p>
        </div>
        <div style="background:#f9f9f9;padding:24px;border-radius:0 0 8px 8px">
          <p style="margin:0 0 16px;font-size:14px;color:#333">
            Se adjunta el listado de personal para cobertura de seguro correspondiente a:<br>
            <strong>${evLabel}</strong>
          </p>
          <table style="width:100%;border-collapse:collapse;font-size:13px;background:#fff;border-radius:6px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)">
            <thead>
              <tr style="background:#1A1A2E;color:#c9a84c">
                <th style="padding:10px 12px;text-align:left">Apellido</th>
                <th style="padding:10px 12px;text-align:left">Nombre</th>
                <th style="padding:10px 12px;text-align:left">DNI</th>
                <th style="padding:10px 12px;text-align:left">CUIT</th>
                <th style="padding:10px 12px;text-align:left">Fecha Nac.</th>
              </tr>
            </thead>
            <tbody>${filas}</tbody>
          </table>
          <p style="margin:20px 0 0;font-size:12px;color:#999">
            Grosso Argentina · administracion@grossoarg.com · Lomas de Zamora, Buenos Aires
          </p>
        </div>
      </div>`;

    toast('Enviando mail de seguro...');
    const res = await fetch(EMAIL_EDGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SB_KEY}`, 'apikey': SB_KEY },
      body: JSON.stringify({
        to: EMAIL_SEGURO,
        subject: `Seguro personal — ${evLabel}`,
        html,
      }),
    });
    const data = await res.json();
    if (res.ok && data.ok) toast(`✅ Mail enviado a ${EMAIL_SEGURO}`);
    else toast('Error enviando mail: ' + (data.error || 'desconocido'), 'err');
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

export async function eliminarLogistica(id) {
  if (!confirm('¿Eliminar esta logística? Se eliminarán también todas las jornadas y pagos asociados.')) return;
  try {
    // Obtener jornadas de esta logística para borrar pagos
    const jorns = await sb('jornadas', { filters: [`logistica_id=eq.${id}`], select: 'id', limit: 500 });
    // Eliminar jornadas (y sus pagos si hubiera tabla de pagos por jornada)
    if (jorns.length) {
      await fetch(`${SB_URL}/rest/v1/jornadas?logistica_id=eq.${id}`, {
        method: 'DELETE',
        headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` },
      });
    }
    // Eliminar relaciones logistica_eventos
    await fetch(`${SB_URL}/rest/v1/logistica_eventos?logistica_id=eq.${id}`, {
      method: 'DELETE',
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` },
    });
    await sbDelete('logisticas', id);
    invalidateCache('logisticas');
    invalidateCache('jornadas');
    invalidateCache('logistica_eventos');
    toast('Logística eliminada');
    loadLogisticas();
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

export async function confirmarPagosLogistica() {
  const pendientes = (logJornadas || []).filter(j => !j.confirmada);
  if (!pendientes.length) { toast('Todas las jornadas ya están confirmadas', 'err'); return; }
  if (!confirm(`¿Confirmar ${pendientes.length} jornada(s)? Aparecerán en Pagos para liquidar.`)) return;
  try {
    for (const j of pendientes) await sbPatch('jornadas', j.id, { confirmada: true });
    logJornadas = logJornadas.map(j => pendientes.some(p => p.id === j.id) ? { ...j, confirmada: true } : j);
    invalidateCache('jornadas');
    toast(`✅ ${pendientes.length} jornada(s) confirmadas — aparecen en Pagos`);
    closeModal('modal-log-det');
    loadLogisticas();
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

export async function abrirDetLogistica(id, tipo) {
  document.getElementById('log-editor').innerHTML = '<div class="spinner"></div>';
  document.getElementById('log-titulo').value    = '';
  document.getElementById('log-subtitulo').value = '';
  document.getElementById('log-direccion').value = '';
  document.getElementById('log-maps').value      = '';
  document.getElementById('log-notas').value     = '';
  openModal('modal-log-det');
  try {
    const logRows = await sbCached('logisticas', { filters: [`id=eq.${id}`] });
    const log = logRows[0];
    if (!log) { toast('Logística no encontrada', 'err'); return; }
    if (log.notas) document.getElementById('log-notas').value = log.notas;
    const detRel = await sbCached('logistica_eventos', { filters: [`logistica_id=eq.${id}`], select: 'evento_id', limit: 1 });
    let ev = detRel[0]?.evento_id ? (state.evCache || []).find(e => e.id === detRel[0].evento_id) : null;
    if (!ev && detRel[0]?.evento_id) {
      const evRows = await sbCached('v_eventos', { filters: [`id=eq.${detRel[0].evento_id}`], limit: 1 });
      ev = evRows[0] || null;
    }
    if (ev) {
      document.getElementById('log-titulo').value    = ev.venue || '';
      document.getElementById('log-subtitulo').value = ev.cliente_nombre || '';
      document.getElementById('log-direccion').value = ev.direccion || '';
      document.getElementById('log-maps').value      = ev.maps_link || '';
      document.getElementById('log-det-title').textContent = `Logística — ${ev.venue || ev.codigo || ev.id}`;
    }
    const filters = [`logistica_id=eq.${id}`];
    if (tipo) filters.push(`tipo=eq.${tipo}`);
    logJornadas = await sbCached('v_jornadas', { filters, order: 'fecha,personal_apellido', limit: 500 });
    if (tipo) document.getElementById('log-det-title').textContent += ` — ${tipo}`;
    if (!logJornadas.length) {
      document.getElementById('log-editor').innerHTML = '<div style="color:var(--text-2);font-size:13px">Sin jornadas en esta logística.</div>';
      return;
    }
    renderEditorLogistica();
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

export function renderEditorLogistica() {
  // Agrupar por fecha
  const porFecha = {};
  logJornadas.forEach(j => {
    if (!porFecha[j.fecha]) porFecha[j.fecha] = [];
    porFecha[j.fecha].push(j);
  });

  let html = '';
  Object.keys(porFecha).sort().forEach(fecha => {
    const d     = new Date(fecha + 'T12:00:00');
    const label = `${DIAS_ES[d.getDay()]} ${d.getDate()}/${d.getMonth()+1}`;
    html += `<div style="margin-bottom:20px">
      <div style="font-weight:600;color:var(--gold);font-size:13px;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid var(--border)">${label}</div>`;

    porFecha[fecha].filter(j => j.personal_id).forEach(j => {
      const jid = `log-j-${j.id}`;
      const transporteInfo = j.transporte === 'Camioneta propia' ? '🚛 Camioneta propia'
        : j.transporte === 'Flete' ? `🚛 Flete${j.flete_personal ? ` — ${j.flete_personal}` : ''}${j.flete_monto ? ` (${fmtARS(j.flete_monto)})` : ''}`
        : '';
      html += `<div style="display:grid;grid-template-columns:180px 1fr 1fr;gap:8px;align-items:center;margin-bottom:6px">
        <div style="font-size:13px"><b>${j.personal_apellido||''} ${j.personal_nombre||''}</b><br>
          <span style="font-size:11px;color:var(--text-2)">${j.tipo}</span>
          ${transporteInfo ? `<div style="font-size:11px;color:var(--orange);margin-top:2px">${transporteInfo}</div>` : ''}
        </div>
        <select class="inp" style="font-size:12px;width:110px" id="${jid}-hora">${buildTimeOpts('')}</select>
        <input class="inp" style="font-size:12px" placeholder="Notas extra" id="${jid}-notas">
      </div>`;
    });

    // Hora de llegada al venue (campo extra por día)
    html += `<div style="display:grid;grid-template-columns:160px 1fr;gap:8px;margin-top:4px">
      <div style="font-size:11px;color:var(--text-2);padding-top:8px">Hora llegada al venue:</div>
      <input class="inp" style="font-size:12px" placeholder="Ej: 23:30" id="log-llegada-${fecha}">
    </div>
    <div style="margin-top:4px">
      <input class="inp" style="font-size:12px" placeholder="Notas del día (ej: descargan, arrancan armado)" id="log-dia-notas-${fecha}">
    </div></div>`;
  });

  document.getElementById('log-editor').innerHTML = html;
}

export function recolectarDatosLogistica() {
  const porFecha = {};
  logJornadas.forEach(j => {
    if (!porFecha[j.fecha]) porFecha[j.fecha] = [];
    const jid   = `log-j-${j.id}`;
    const hora  = document.getElementById(`${jid}-hora`)?.value.trim()  || '';
    const notas = document.getElementById(`${jid}-notas`)?.value.trim() || '';
    porFecha[j.fecha].push({ ...j, hora, notas });
  });
  return porFecha;
}

export function generarWhatsappLogistica() {
  const titulo   = document.getElementById('log-titulo').value.trim();
  const dir      = document.getElementById('log-direccion').value.trim();
  const maps     = document.getElementById('log-maps').value.trim();
  if (!titulo) { toast('Ingresá el título del evento', 'err'); return; }

  const porFecha = recolectarDatosLogistica();

  // Agrupar por persona
  const porPersona = {};
  Object.keys(porFecha).sort().forEach(fecha => {
    const grupo = porFecha[fecha].map(j => (j.personal_apellido||j.personal_nombre||'').toUpperCase()).join('-');
    const llegada  = document.getElementById(`log-llegada-${fecha}`)?.value.trim() || '';
    const diaNota  = document.getElementById(`log-dia-notas-${fecha}`)?.value.trim() || '';

    porFecha[fecha].forEach(j => {
      const key = j.personal_id;
      if (!porPersona[key]) porPersona[key] = { nombre: j.personal_nombre||'', apellido: j.personal_apellido||'', dias: [] };
      const d     = new Date(fecha + 'T12:00:00');
      const label = `${DIAS_ES[d.getDay()].toUpperCase()} ${d.getDate()}`;
      porPersona[key].dias.push({ fecha, label, tipo: j.tipo, hora: j.hora, notas: j.notas, llegada, diaNota, grupo, transporte: j.transporte, flete_personal: j.flete_personal, flete_monto: j.flete_monto });
    });
  });

  waMensajesPendientes = [];
  let html = '';
  Object.values(porPersona).forEach(p => {
    const persData = state.persCache.find(x => x.nombre === p.nombre && x.apellido === p.apellido);
    const telefono = persData?.telefono || null;
    let texto = `${p.apellido.toUpperCase()}\n\n`;
    p.dias.forEach(dia => {
      texto += `*${dia.label} - ${titulo.toUpperCase()}*\n`;
      if (dia.hora)   texto += `${dia.hora} ${dia.tipo.toUpperCase()}`;
      if (dia.notas)  texto += ` - ${dia.notas}`;
      if (dia.hora || dia.notas) texto += '\n';
      if (dia.transporte === 'Camioneta propia') texto += `🚛 CAMIONETA EMPRESA\n`;
      if (dia.transporte === 'Flete') {
        texto += `🚛 FLETE${dia.flete_personal ? ` — ${dia.flete_personal.toUpperCase()}` : ''}${dia.flete_monto ? ` — ${fmtARS(dia.flete_monto)}` : ''}\n`;
      }
      if (dia.llegada) texto += `${dia.llegada} LLEGÁS ${titulo.toUpperCase()}\n`;
      if (dir)         texto += `DIRECCIÓN: ${dir}\n`;
      if (maps)        texto += `${maps}\n`;
      if (dia.diaNota) texto += `${dia.diaNota.toUpperCase()}\n`;
      texto += `GRUPO: ${dia.grupo}\n\n`;
    });

    waMensajesPendientes.push({ apellido: p.apellido, nombre: p.nombre, telefono, texto: texto.trim() });

    html += `<div style="background:var(--surface2);border-radius:8px;padding:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-weight:600;color:var(--gold)">${p.apellido} ${p.nombre}</span>
        <span style="font-size:11px;color:${telefono ? 'var(--green)' : 'var(--red)'}">${telefono ? '📱 ' + telefono : '⚠️ Sin teléfono'}</span>
      </div>
      <pre style="font-family:monospace;font-size:12px;white-space:pre-wrap;color:var(--text);margin:0 0 8px 0">${texto.trim()}</pre>
      <button class="btn btn-ghost btn-sm" onclick="copiarTexto(this, ${JSON.stringify(texto.trim())})">Copiar</button>
    </div>`;
  });

  document.getElementById('wa-log-body').innerHTML = html;
  openModal('modal-wa-log');
}

export async function enviarTodosWhatsapp() {
  const sinTelefono = waMensajesPendientes.filter(p => !p.telefono);
  if (sinTelefono.length) {
    const nombres = sinTelefono.map(p => `${p.apellido} ${p.nombre}`).join(', ');
    if (!confirm(`${sinTelefono.length} persona(s) sin teléfono registrado: ${nombres}.\n¿Enviás a los que sí tienen?`)) return;
  }

  const conTelefono = waMensajesPendientes.filter(p => p.telefono);
  if (!conTelefono.length) { toast('Ninguna persona tiene teléfono registrado', 'err'); return; }

  const btn = document.getElementById('btn-enviar-todos');
  btn.disabled = true; btn.textContent = 'Enviando...';

  let ok = 0; let err = 0;
  for (const p of conTelefono) {
    try {
      const res = await fetch(WA_EDGE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SB_KEY}`, 'apikey': SB_KEY },
        body: JSON.stringify({ to: p.telefono, message: p.texto }),
      });
      const data = await res.json();
      if (res.ok && data.ok) { ok++; }
      else { console.error(`Error enviando a ${p.apellido}:`, JSON.stringify(data)); err++; }
    } catch(e) { console.error(e); err++; }
  }

  btn.disabled = false; btn.textContent = '📲 Enviar a todos';
  toast(`✅ ${ok} mensaje(s) enviado(s)${err ? ` · ${err} error(es) — revisá la consola` : ''}`);
}

export function copiarTexto(btn, texto) {
  navigator.clipboard.writeText(texto).then(() => {
    btn.textContent = '✅ Copiado';
    setTimeout(() => btn.textContent = 'Copiar', 2000);
  });
}

export async function generarPDFLogistica() {
  const titulo    = document.getElementById('log-titulo').value.trim();
  const subtitulo = document.getElementById('log-subtitulo').value.trim();
  const dir       = document.getElementById('log-direccion').value.trim();
  const maps      = document.getElementById('log-maps').value.trim();
  const notasGen  = document.getElementById('log-notas').value.trim();
  if (!titulo) { toast('Ingresá el título del evento', 'err'); return; }

  const porFecha = recolectarDatosLogistica();
  const fechas   = Object.keys(porFecha).sort();
  if (!fechas.length) { toast('Cargá las jornadas primero', 'err'); return; }

  
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const PW = 210; const PH = 297; const M = 14; const CW = PW - M * 2;
  let y = 0;

  const NEGRO  = [26, 26, 46]; const ORO = [201, 168, 76];
  const BLANCO = [255, 255, 255]; const GRIS_F = [247, 247, 247]; const GRIS_T = [85, 85, 85];
  const fill   = c => doc.setFillColor(c[0], c[1], c[2]);
  const stroke = c => doc.setDrawColor(c[0], c[1], c[2]);
  const text   = c => doc.setTextColor(c[0], c[1], c[2]);
  const font   = (style, size) => { doc.setFont('helvetica', style); doc.setFontSize(size); };

  const addPage = () => { doc.addPage(); y = 15; };
  const checkY  = (needed) => { if (y + needed > PH - 20) addPage(); };

  // ── Header ────────────────────────────────────────────────
  fill(NEGRO); doc.rect(0, 0, PW, 30, 'F');
  try { doc.addImage(LOGO_B64, 'PNG', M, 1, 24, 24); } catch(e) {}
  font('bold', 16); text(BLANCO);
  doc.text('GROSSO ARGENTINA', M + 27, 11);
  font('normal', 9); text(ORO);
  doc.text('Soluciones Tecnologicas para Eventos', M + 27, 18);
  font('normal', 7.5); text([200,200,200]);
  doc.text('administracion@grossoarg.com', PW - M, 10, { align: 'right' });
  doc.text('Lomas de Zamora, Buenos Aires', PW - M, 16, { align: 'right' });
  y = 33;

  stroke(ORO); doc.setLineWidth(0.8); doc.line(M, y, PW - M, y); y += 6;

  // ── Título ────────────────────────────────────────────────
  font('bold', 16); text(NEGRO);
  const tituloLine = subtitulo ? `Logística — ${subtitulo}` : 'Logística';
  doc.text(tituloLine, M, y + 6);

  // Rango de fechas
  const d0 = new Date(fechas[0] + 'T12:00:00');
  const d1 = new Date(fechas[fechas.length-1] + 'T12:00:00');
  const rangoStr = fechas.length === 1
    ? `${d0.getDate()} de ${MESES_ES_GEN[d0.getMonth()]} ${d0.getFullYear()}`
    : `${d0.getDate()} al ${d1.getDate()} de ${MESES_ES_GEN[d1.getMonth()]} ${d1.getFullYear()}`;
  font('normal', 10); text(GRIS_T);
  doc.text(`${rangoStr} — ${titulo}`, M, y + 14);
  y += 22;

  // ── Por día ───────────────────────────────────────────────
  fechas.forEach(fecha => {
    checkY(30);
    const d       = new Date(fecha + 'T12:00:00');
    const dLabel  = `${DIAS_ES[d.getDay()]} ${d.getDate()} — ${titulo}`;
    const llegada = document.getElementById(`log-llegada-${fecha}`)?.value.trim() || '';
    const diaNota = document.getElementById(`log-dia-notas-${fecha}`)?.value.trim() || '';
    const items   = porFecha[fecha];

    // Cabecera del día
    fill(NEGRO); doc.rect(M, y, CW, 7, 'F');
    font('bold', 9); text(ORO);
    doc.text(dLabel.toUpperCase(), M + 2, y + 5); y += 9;

    // Dirección + maps
    if (dir || maps) {
      font('normal', 7.5); text(GRIS_T);
      const linea = [dir, maps].filter(Boolean).join(' — ');
      const wrapped = doc.splitTextToSize(linea, CW);
      doc.text(wrapped, M, y + 4);
      y += wrapped.length * 4 + 3;
    }

    // Personas con hora y notas
    items.forEach((j, idx) => {
      checkY(8);
      fill(idx % 2 === 0 ? GRIS_F : BLANCO); doc.rect(M, y, CW, 8, 'F');
      font('bold', 8); text(NEGRO);
      const nombre = `${j.personal_apellido||''} ${j.personal_nombre||''}`.trim();
      doc.text(nombre, M + 2, y + 5.5);
      font('normal', 8); text(GRIS_T);
      const transporteStr = j.transporte === 'Camioneta propia' ? 'Camioneta empresa'
        : j.transporte === 'Flete' ? `Flete${j.flete_personal ? ` — ${j.flete_personal}` : ''}${j.flete_monto ? ` (${fmtARS(j.flete_monto)})` : ''}`
        : '';
      const detalle = [j.hora, j.tipo, transporteStr, j.notas].filter(Boolean).join(' — ');
      if (detalle) doc.text(detalle, M + 55, y + 5.5);
      y += 8;
    });

    // Hora llegada venue
    if (llegada) {
      checkY(8);
      fill([44,62,80]); doc.rect(M, y, CW, 7, 'F');
      font('bold', 8); text(BLANCO);
      doc.text(`${llegada} — Llegan a ${titulo}`, M + 2, y + 5); y += 8;
    }

    // Nota del día
    if (diaNota) {
      checkY(8);
      font('italic', 8); text(GRIS_T);
      const wrapped = doc.splitTextToSize(diaNota, CW);
      doc.text(wrapped, M, y + 5);
      y += wrapped.length * 5 + 2;
    }

    y += 6;
  });

  // ── Notas generales ───────────────────────────────────────
  if (notasGen) {
    checkY(20);
    fill(NEGRO); doc.rect(M, y, CW, 7, 'F');
    font('bold', 8); text(BLANCO); doc.text('NOTAS GENERALES', M + 2, y + 5); y += 9;
    font('normal', 8); text(GRIS_T);
    const wrapped = doc.splitTextToSize(notasGen, CW);
    doc.text(wrapped, M, y + 4); y += wrapped.length * 5 + 4;
  }

  // ── Footer ────────────────────────────────────────────────
  const footerY = PH - 12;
  fill(NEGRO); doc.rect(0, footerY, PW, 12, 'F');
  font('normal', 7.5); text(ORO);
  doc.text('Grosso Argentina | Soluciones Tecnologicas | administracion@grossoarg.com', M, footerY + 7);
  doc.text(`Logística ${new Date().toLocaleDateString('es-AR')}`, PW - M, footerY + 7, { align: 'right' });

  const pdfBlob = doc.output('blob');
  const fechaHoy = new Date().toISOString().split('T')[0];
  const nombreArchivo = `${fechaHoy}-${titulo.replace(/\s+/g,'-')}.pdf`;
  toast('Subiendo a Drive...');
  const url = await subirPdfDrive(pdfBlob, nombreArchivo, FOLDER_LOGISTICAS);
  if (url) toast('✅ Logística guardada en Drive');
}


// Window assignments
window.loadJornadas = loadJornadas;
window.toggleTransporte = toggleTransporte;
window.toggleFlete = toggleFlete;
window.abrirModalJornada = abrirModalJornada;
window.renderListaPersonal = renderListaPersonal;
window.guardarJornadas = guardarJornadas;
window.marcarPagada = marcarPagada;
window.eliminarJornada = eliminarJornada;
window.refreshDriveToken = refreshDriveToken;
window.getDriveToken = getDriveToken;
window.subirPdfDrive = subirPdfDrive;
window.liquidarSemana = liquidarSemana;
window.generarReciboPDF = generarReciboPDF;
window.loadLogisticas = loadLogisticas;
window.editarLogistica = editarLogistica;
window.setArmadoEvento = setArmadoEvento;
window.abrirAgregarArmadoParaTipo = abrirAgregarArmadoParaTipo;
window.abrirPresupuestoParaEvento = abrirPresupuestoParaEvento;
window.abrirAgregarDeposito = abrirAgregarDeposito;
window.abrirAgregarArmado = abrirAgregarArmado;
window.guardarAgregarArmado = guardarAgregarArmado;
window.confirmarJornadasPersona = confirmarJornadasPersona;
window.confirmarJornadas = confirmarJornadas;
window.abrirNuevaLogistica = abrirNuevaLogistica;
window.setTipoLog = setTipoLog;
window.toggleEvDep = toggleEvDep;
window.onCambioEventoLog = onCambioEventoLog;
window.agregarDiaLog = agregarDiaLog;
window.eliminarDiaLog = eliminarDiaLog;
window.updateDiaLog = updateDiaLog;
window.onFleteChofer = onFleteChofer;
window.togglePersonalDia = togglePersonalDia;
window.renderDiasLog = renderDiasLog;
window.guardarLogistica = guardarLogistica;
window.enviarMailSeguroEvento = enviarMailSeguroEvento;
window.enviarMailSeguro = enviarMailSeguro;
window.eliminarLogistica = eliminarLogistica;
window.confirmarPagosLogistica = confirmarPagosLogistica;
window.abrirDetLogistica = abrirDetLogistica;
window.renderEditorLogistica = renderEditorLogistica;
window.recolectarDatosLogistica = recolectarDatosLogistica;
window.generarWhatsappLogistica = generarWhatsappLogistica;
window.enviarTodosWhatsapp = enviarTodosWhatsapp;
window.copiarTexto = copiarTexto;
window.generarPDFLogistica = generarPDFLogistica;
