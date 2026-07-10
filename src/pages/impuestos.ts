import { state } from '../state';
import { sb, sbPost, sbInsert, sbPatch, sbDelete, fmtARS, fmtDate, escHtml, calcularTotalConRecargos, today, formatTelefono, onTelefonoInput, formatDni, onDniInput, formatCuit, onCuitInput, badge, fmtInputARS, parseARSInput, toast, openModal, closeModal, LOGO_B64, buildTimeOpts, timeSelect, llenarSelectEventos, initDatePickers, renderHorariosEv, getHorariosEv } from '../helpers';
import { SB_URL, SB_KEY, FOLDER_LOGISTICAS, WA_EDGE_URL, EMAIL_EDGE_URL, EMAIL_SEGURO, DRIVE_FOLDER_ID, FOTOS_FOLDER_ID } from '../config';
import { sbCached, invalidateCache } from '../query-cache';

// ── IMPUESTOS ─────────────────────────────────────────────
const MESES_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const SECCIONES_ORDEN = ['Empresa','Familia','Suscripciones','Tarjetas','Planes','Deudas'];
const CATS_POR_SECCION = {
  'Empresa':       ['Oficina','Fiscal','Empresa'],
  'Familia':       ['Casa','Auto','Actividad'],
  'Suscripciones': ['Suscripción'],
  'Tarjetas':      ['Tarjeta'],
  'Planes':        ['Plan de pago'],
  'Deudas':        ['Deuda'],
};

let todosImpuestos = [];
let impMesIdx = new Date().getMonth();
let impAnio   = new Date().getFullYear();

// Normaliza mes a número (1-12), acepta tanto nombre "Julio" como número 7
const mesNum = (v) => {
  const n = Number(v);
  if (!isNaN(n) && n >= 1 && n <= 12) return n;
  const idx = MESES_NAMES.indexOf(String(v));
  return idx >= 0 ? idx + 1 : 0;
};

export async function loadImpuestos() {
  try {
    todosImpuestos = await sbCached('costos_fijos', { order: 'anio.asc,id.asc' });
    renderImpuestos();
    document.getElementById('imp-mes').value = MESES_NAMES[impMesIdx];
    actualizarCatImp();
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

export function cambiarMesImp(delta) {
  impMesIdx += delta;
  if (impMesIdx > 11) { impMesIdx = 0;  impAnio++; }
  if (impMesIdx < 0)  { impMesIdx = 11; impAnio--; }
  renderImpuestos();
}

export function actualizarCatImp() {
  const sec = document.getElementById('imp-seccion')?.value || 'Empresa / Fiscal';
  const cats = CATS_POR_SECCION[sec] || [];
  const sel = document.getElementById('imp-cat');
  if (sel) sel.innerHTML = cats.map(c => `<option>${c}</option>`).join('');
}

export async function renderImpuestos() {
  const mesNombre = MESES_NAMES[impMesIdx];
  document.getElementById('imp-mes-label').textContent = `${mesNombre} ${impAnio}`;
  document.getElementById('imp-mes').value = mesNombre;

  const hoy  = new Date();
  const lista = todosImpuestos.filter(i => mesNum(i.mes) === impMesIdx + 1 && Number(i.anio) === impAnio);

  const pagados  = lista.filter(i => i.pagado).length;
  const vencidos = lista.filter(i => !i.pagado && esVencido(i, hoy)).length;

  const tc = await fetchTipoCambioOficial();
  const totalARS = lista.reduce((s, i) => s + Number(i.monto_ars || 0), 0);
  const totalUSD = lista.reduce((s, i) => s + Number(i.monto_usd || 0), 0);
  const totalMes = totalARS + totalUSD * tc;

  document.getElementById('imp-kpis').innerHTML = `
    <div class="kpi"><div class="kpi-label">Total del mes</div><div class="kpi-value gold">${fmtARS(totalMes)}</div><div style="font-size:10px;color:var(--text-3);margin-top:4px">USD @ $${tc.toLocaleString('es-AR')}</div></div>
    <div class="kpi"><div class="kpi-label">Total ARS</div><div class="kpi-value" style="color:var(--text-1)">${fmtARS(totalARS)}</div></div>
    ${totalUSD ? `<div class="kpi"><div class="kpi-label">Total USD</div><div class="kpi-value" style="color:var(--text-1)">U$D ${totalUSD.toLocaleString('es-AR',{minimumFractionDigits:2})}</div></div>` : ''}
    <div class="kpi"><div class="kpi-label">Pagados</div><div class="kpi-value green">${pagados} / ${lista.length}</div></div>
    <div class="kpi"><div class="kpi-label">Vencidos sin pagar</div><div class="kpi-value red">${vencidos}</div></div>
  `;

  if (!lista.length) {
    document.getElementById('imp-tbody').innerHTML =
      `<tr><td colspan="9"><div class="empty"><div class="empty-icon">🗓️</div>Sin conceptos para ${mesNombre} ${impAnio}</div></td></tr>`;
    return;
  }

  // Agrupar por sección
  const grupos = {};
  lista.forEach(i => {
    const sec = i.seccion || 'General';
    if (!grupos[sec]) grupos[sec] = [];
    grupos[sec].push(i);
  });

  let html = '';
  const orden = [...SECCIONES_ORDEN, ...Object.keys(grupos).filter(s => !SECCIONES_ORDEN.includes(s))];
  orden.forEach(sec => {
    if (!grupos[sec]) return;
    const items = grupos[sec];
    const totalSec = items.reduce((s,i) => s + Number(i.monto_ars||0), 0);
    html += `<tr>
      <td colspan="9" style="background:var(--surface2);color:var(--gold);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.6px;padding:6px 10px">
        ${sec}${totalSec ? `<span style="float:right;color:var(--text-2)">${fmtARS(totalSec)}</span>` : ''}
      </td>
    </tr>`;
    const SECCION_BG = {
      'Empresa':       'rgba(52,152,219,.22)',
      'Familia':       'rgba(155,89,182,.22)',
      'Suscripciones': 'rgba(26,188,156,.22)',
      'Tarjetas':      'rgba(231,76,60,.22)',
      'Planes':        'rgba(241,196,15,.22)',
      'Deudas':        'rgba(231,76,60,.32)',
    };

    items.forEach(i => {
      const vencido = !i.pagado && esVencido(i, hoy);
      const venceProximo = !i.pagado && !vencido && i.vence_dia && (() => {
        const mesIdx = mesNum(i.mes) - 1;
        const fecha = new Date(i.anio, mesIdx, i.vence_dia);
        return (fecha - hoy) <= 7 * 24 * 60 * 60 * 1000;
      })();

      const rowBg = i.pagado
        ? 'color-mix(in srgb, var(--green) 8%, var(--bg-2))'
        : (SECCION_BG[sec] || '');

      const diaColor = vencido      ? 'color:var(--red);font-weight:600'
                     : venceProximo ? 'color:var(--orange);font-weight:600'
                     : '';

      html += `<tr style="background:${rowBg};${i.pagado ? 'border-left:3px solid var(--green)' : ''}">
        <td>
          <b>${i.concepto}</b>
          ${i.empresa ? `<div style="font-size:11px;color:var(--text-2)">${i.empresa}</div>` : ''}
        </td>
        <td><span style="font-size:11px;color:var(--text-2)">${i.categoria||''}</span></td>
        <td style="${diaColor}">${i.vence_dia ? `día ${i.vence_dia}` : '—'}</td>
        <td>${i.monto_ars ? fmtARS(i.monto_ars) : '<span style="color:var(--text-3)">—</span>'}
          ${i.paga_por_tarjeta ? `<div style="font-size:10px;color:var(--text-3);margin-top:2px">💳 tarjeta</div>` : ''}
        </td>
        <td>${i.monto_usd ? `U$D ${Number(i.monto_usd).toLocaleString('es-AR',{minimumFractionDigits:2})}` : '<span style="color:var(--text-3)">—</span>'}</td>
        <td>
          ${i.notas ? `<span style="font-size:11px;color:var(--text-2)">${i.notas}</span>` : '—'}
        </td>
        <td style="text-align:center">
          <input type="checkbox" ${i.paga_por_tarjeta ? 'checked' : ''} style="width:15px;height:15px;accent-color:var(--gold);cursor:pointer" onchange="toggleTarjeta(${i.id}, this.checked)">
        </td>
        <td>
          ${i.pagado
            ? `<button class="btn btn-ghost btn-sm" style="border-color:var(--green);color:var(--green)" onclick="desmarcarPagadoImp(${i.id})">✅ Pagado</button>`
            : vencido
              ? `<button class="btn btn-ghost btn-sm" style="border-color:var(--red);color:var(--red)" onclick="marcarPagadoImp(${i.id})">🔴 Marcar pagado</button>`
              : venceProximo
                ? `<button class="btn btn-ghost btn-sm" style="border-color:var(--orange);color:var(--orange)" onclick="marcarPagadoImp(${i.id})">⚠️ Marcar pagado</button>`
                : `<button class="btn btn-ghost btn-sm" onclick="marcarPagadoImp(${i.id})">Marcar pagado</button>`}
        </td>
        <td style="display:flex;gap:4px">
          <button class="btn btn-ghost btn-sm" onclick="editarImpuesto(${i.id})">✏️</button>
          <button class="btn btn-danger btn-sm" onclick="eliminarImpuesto(${i.id})">✕</button>
        </td>
      </tr>`;
    });
  });

  document.getElementById('imp-tbody').innerHTML = html;
}

export function esVencido(imp, hoy) {
  if (!imp.vence_dia) return false;
  const mesIdx = mesNum(imp.mes) - 1;
  if (mesIdx < 0) return false;
  return new Date(imp.anio, mesIdx, imp.vence_dia) < hoy;
}

export async function toggleTarjeta(id, valor) {
  const patch = { paga_por_tarjeta: valor };
  if (valor) { patch.pagado = true; patch.fecha_pago = today(); }
  await sbPatch('costos_fijos', id, patch);
  invalidateCache('costos_fijos');
  const item = todosImpuestos.find(x => x.id === id);
  if (item) Object.assign(item, patch);
  renderImpuestos();
}

export async function marcarPagadoImp(id) {
  await sbPatch('costos_fijos', id, { pagado: true, fecha_pago: today() });
  invalidateCache('costos_fijos');
  toast('Marcado como pagado');
  loadImpuestos();
}

export async function desmarcarPagadoImp(id) {
  if (!confirm('¿Marcar como no pagado?')) return;
  await sbPatch('costos_fijos', id, { pagado: false, fecha_pago: null });
  invalidateCache('costos_fijos');
  toast('Desmarcado');
  loadImpuestos();
}

export async function eliminarImpuesto(id) {
  if (!confirm('¿Eliminar este concepto?')) return;
  await sbDelete('costos_fijos', id);
  invalidateCache('costos_fijos');
  toast('Concepto eliminado');
  loadImpuestos();
}

export function nuevoConceptoImp() {
  document.getElementById('imp-id').value = '';
  document.getElementById('imp-modal-title').textContent = 'Agregar concepto';
  document.getElementById('imp-concepto').value  = '';
  document.getElementById('imp-empresa').value   = '';
  document.getElementById('imp-vence').value     = '';
  document.getElementById('imp-monto').value     = '';
  document.getElementById('imp-monto-usd').value = '';
  document.getElementById('imp-notas').value     = '';
  document.getElementById('imp-por-tarjeta').checked = false;
  document.getElementById('imp-mes').value       = MESES_NAMES[impMesIdx];
  document.getElementById('imp-anio').value      = impAnio;
  actualizarCatImp();
  openModal('modal-impuesto');
}

export function editarImpuesto(id) {
  const i = todosImpuestos.find(x => x.id === id);
  if (!i) return;
  document.getElementById('imp-id').value            = id;
  document.getElementById('imp-modal-title').textContent = 'Editar concepto';
  document.getElementById('imp-seccion').value       = i.seccion || 'Empresa / Fiscal';
  actualizarCatImp();
  document.getElementById('imp-cat').value           = i.categoria || '';
  document.getElementById('imp-concepto').value      = i.concepto || '';
  document.getElementById('imp-empresa').value       = i.empresa || '';
  document.getElementById('imp-mes').value           = MESES_NAMES[mesNum(i.mes) - 1] || '';
  document.getElementById('imp-anio').value          = i.anio || '';
  document.getElementById('imp-vence').value         = i.vence_dia || '';
  document.getElementById('imp-monto').value         = i.monto_ars > 0 ? Number(i.monto_ars).toLocaleString('es-AR', { maximumFractionDigits: 0 }) : '';
  document.getElementById('imp-monto-usd').value     = i.monto_usd || '';
  document.getElementById('imp-notas').value         = i.notas || '';
  document.getElementById('imp-por-tarjeta').checked = !!i.paga_por_tarjeta;
  openModal('modal-impuesto');
}

export async function guardarImpuesto() {
  const concepto = document.getElementById('imp-concepto').value.trim();
  if (!concepto) { toast('El concepto es obligatorio', 'err'); return; }
  const id = document.getElementById('imp-id').value;
  const data = {
    concepto,
    seccion:   document.getElementById('imp-seccion').value,
    categoria: document.getElementById('imp-cat').value,
    empresa:   document.getElementById('imp-empresa').value.trim() || null,
    mes:       mesNum(document.getElementById('imp-mes').value),
    anio:      parseInt(document.getElementById('imp-anio').value),
    vence_dia: parseInt(document.getElementById('imp-vence').value) || null,
    monto_ars: parseARSInput(document.getElementById('imp-monto')) || null,
    monto_usd: parseFloat(document.getElementById('imp-monto-usd').value) || null,
    notas:            document.getElementById('imp-notas').value.trim() || null,
    paga_por_tarjeta: document.getElementById('imp-por-tarjeta').checked,
  };
  try {
    if (id) {
      await sbPatch('costos_fijos', parseInt(id), data);
      invalidateCache('costos_fijos');
      toast('Concepto actualizado');
    } else {
      await sbPost('costos_fijos', data);
      invalidateCache('costos_fijos');
      toast('Concepto agregado');
    }
    closeModal('modal-impuesto');
    loadImpuestos();
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

export function generarMesNuevo() {
  const hoy = new Date();
  const mesOrigenIdx = impMesIdx;
  const mesDestinoIdx = (impMesIdx + 1) % 12;
  const anioDestino = mesDestinoIdx === 0 ? impAnio + 1 : impAnio;

  document.getElementById('mn-origen-mes').value  = MESES_NAMES[mesOrigenIdx];
  document.getElementById('mn-origen-anio').value = impAnio;
  document.getElementById('mn-destino-mes').value  = MESES_NAMES[mesDestinoIdx];
  document.getElementById('mn-destino-anio').value = anioDestino;

  openModal('modal-mes-nuevo');
}

export async function confirmarMesNuevo() {
  const mesOrigen  = document.getElementById('mn-origen-mes').value;
  const anioOrigen = parseInt(document.getElementById('mn-origen-anio').value);
  const mesDestino = document.getElementById('mn-destino-mes').value;
  const anioDestino = parseInt(document.getElementById('mn-destino-anio').value);

  const delMes = todosImpuestos.filter(i => mesNum(i.mes) === mesNum(mesOrigen) && Number(i.anio) === anioOrigen);
  if (!delMes.length) { toast(`No hay conceptos en ${mesOrigen} ${anioOrigen}`, 'err'); return; }

  const yaExiste = todosImpuestos.some(i => mesNum(i.mes) === mesNum(mesDestino) && Number(i.anio) === anioDestino);
  if (yaExiste) { toast(`${mesDestino} ${anioDestino} ya existe`, 'err'); return; }

  try {
    const variablesKeywords = ['iva','iibb','sircreb','cargas sociales','ganancias','anticipos','vep'];
    for (const item of delMes) {
      const esVariable = variablesKeywords.some(k => item.concepto.toLowerCase().includes(k));
      await sbPost('costos_fijos', {
        concepto:  item.concepto,
        seccion:   item.seccion,
        categoria: item.categoria,
        empresa:   item.empresa,
        mes:       mesNum(mesDestino),
        anio:      anioDestino,
        vence_dia: item.vence_dia,
        monto_ars: esVariable ? null : item.monto_ars,
        monto_usd: esVariable ? null : item.monto_usd,
        pagado:    false,
        notas:     item.notas,
      });
    }
    invalidateCache('costos_fijos');
    toast(`✅ ${mesDestino} ${anioDestino} generado — ${delMes.length} conceptos`);
    closeModal('modal-mes-nuevo');
    impMesIdx = MESES_NAMES.indexOf(mesDestino);
    impAnio = anioDestino;
    loadImpuestos();
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}



// Window assignments
window.loadImpuestos = loadImpuestos;
window.cambiarMesImp = cambiarMesImp;
window.actualizarCatImp = actualizarCatImp;
window.renderImpuestos = renderImpuestos;
window.esVencido = esVencido;
window.toggleTarjeta = toggleTarjeta;
window.marcarPagadoImp = marcarPagadoImp;
window.desmarcarPagadoImp = desmarcarPagadoImp;
window.eliminarImpuesto = eliminarImpuesto;
window.nuevoConceptoImp = nuevoConceptoImp;
window.editarImpuesto = editarImpuesto;
window.guardarImpuesto = guardarImpuesto;
window.generarMesNuevo = generarMesNuevo;
window.confirmarMesNuevo = confirmarMesNuevo;
