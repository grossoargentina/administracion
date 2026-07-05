import { state } from '../state';
import { jsPDF } from 'jspdf';
import { sb, sbPost, sbInsert, sbPatch, sbDelete, fmtARS, fmtDate, escHtml, calcularTotalConRecargos, today, formatTelefono, onTelefonoInput, formatDni, onDniInput, formatCuit, onCuitInput, badge, fmtInputARS, parseARSInput, toast, openModal, closeModal, LOGO_B64, buildTimeOpts, timeSelect, llenarSelectEventos, initDatePickers, renderHorariosEv, getHorariosEv } from '../helpers';
import { SB_URL, SB_KEY, FOLDER_LOGISTICAS, WA_EDGE_URL, EMAIL_EDGE_URL, EMAIL_SEGURO, DRIVE_FOLDER_ID, FOTOS_FOLDER_ID } from '../config';

// ── PAGOS ─────────────────────────────────────────────────
let pagosOffset = 0; // 0 = semana actual, -1 = anterior, etc.

export function getSemana(offset) {
  const hoy = new Date();
  const dow = hoy.getDay() === 0 ? 7 : hoy.getDay();
  const lunes = new Date(hoy); lunes.setDate(hoy.getDate() - dow + 1 + offset * 7);
  const domingo = new Date(lunes); domingo.setDate(lunes.getDate() + 6);
  const fmt = d => d.toISOString().split('T')[0];
  return { desde: fmt(lunes), hasta: fmt(domingo), lunes, domingo };
}

export function cambiarSemanaPagos(dir) {
  pagosOffset += dir;
  loadPagos();
}

export function cambiarSemanaLog(dir) {
  state.logOffset += dir;
  window.loadLogisticas();
}

export function esIncluida(tipo, fecha) {
  const dow = new Date(fecha + 'T12:00:00').getDay();
  const esFinde = dow === 0 || dow === 6;
  if (tipo === 'Depósito') return true;
  if ((['Armado','Desarme'].includes(tipo)) && !esFinde) return true;
  return false;
}

export async function loadPagos() {
  const { desde, hasta, lunes, domingo } = getSemana(pagosOffset);

  const label = `${lunes.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit'})} — ${domingo.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'2-digit'})}`;
  document.getElementById('pagos-semana-label').textContent = label;
  document.getElementById('pagos-periodo-sub').textContent = `Semana del ${label}`;

  const content = document.getElementById('pagos-content');
  content.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const [jornadas, jornadasPagadas, personal, extrasDB] = await Promise.all([
      sb('v_jornadas', { filters: [`fecha=gte.${desde}`, `fecha=lte.${hasta}`, `pagado=eq.false`, `confirmada=eq.true`, `personal_id=not.is.null`], limit: 500 }),
      sb('v_jornadas', { filters: [`fecha_pago=gte.${desde}`, `fecha_pago=lte.${hasta}`, `pagado=eq.true`, `personal_id=not.is.null`], limit: 500 }),
      sb('personal', { limit: 200 }),
      sb('pago_extras', { filters: [`semana_desde=eq.${desde}`, `semana_hasta=eq.${hasta}`], limit: 200 }),
    ]);
    window._extrasCache = extrasDB;

    // Agrupar jornadas por persona
    const porPersona = {};
    jornadas.forEach(j => {
      if (!porPersona[j.personal_id]) {
        const p = personal.find(x => x.id === j.personal_id) || {};
        porPersona[j.personal_id] = {
          id: j.personal_id,
          apellido: j.personal_apellido || '',
          nombre: j.personal_nombre || '',
          tipo: p.tipo || 'Freelance',
          sueldo_fijo: p.sueldo_fijo || 0,
          jornadas: [],
        };
      }
      // Siempre usar la tarifa vigente del personal (no la guardada en jornada)
      const p2 = personal.find(x => x.id === j.personal_id) || {};
      const tarifaVigente = j.tipo === 'Depósito' ? p2.tarifa_deposito
                          : j.tipo === 'Operador' ? p2.tarifa_operador
                          : p2.tarifa_armado;
      j = { ...j, tarifa_ars: tarifaVigente || 0 };
      porPersona[j.personal_id].jornadas.push(j);
    });

    // Fijos sin jornadas esa semana pero con sueldo en semana del 1° del mes
    const semanaContieneUno = lunes.getDate() <= 7 && lunes.getMonth() === domingo.getMonth() || (domingo.getDate() >= 1 && lunes.getMonth() !== domingo.getMonth());
    const primeroDentroSemana = (() => {
      for (let d = new Date(lunes); d <= domingo; d.setDate(d.getDate() + 1)) {
        if (d.getDate() === 1) return true;
      }
      return false;
    })();

    if (primeroDentroSemana) {
      personal.filter(p => p.tipo === 'Fijo' && p.sueldo_fijo && !porPersona[p.id]).forEach(p => {
        porPersona[p.id] = { id: p.id, apellido: p.apellido, nombre: p.nombre, tipo: 'Fijo', sueldo_fijo: p.sueldo_fijo, jornadas: [] };
      });
    }

    const filas = Object.values(porPersona).sort((a,b) => a.apellido.localeCompare(b.apellido));

    // Sección pagados
    const porPersonaPagado = {};
    jornadasPagadas.forEach(j => {
      if (!porPersonaPagado[j.personal_id]) {
        porPersonaPagado[j.personal_id] = { apellido: j.personal_apellido || '', nombre: j.personal_nombre || '', jornadas: [] };
      }
      porPersonaPagado[j.personal_id].jornadas.push(j);
    });
    const filasPagadas = Object.values(porPersonaPagado).sort((a,b) => a.apellido.localeCompare(b.apellido));
    const htmlPagados = filasPagadas.length ? `
      <div style="margin-top:24px;margin-bottom:10px;font-size:12px;font-weight:600;color:var(--text-3);letter-spacing:.06em;text-transform:uppercase">✅ Pagados esta semana</div>
      ${filasPagadas.map(p => {
        const total = p.jornadas.reduce((s,j) => s + Number(j.tarifa_ars||0), 0);
        const filas2 = p.jornadas.sort((a,b) => a.fecha.localeCompare(b.fecha)).map(j => {
          const dow = new Date(j.fecha+'T12:00:00').toLocaleDateString('es-AR',{weekday:'short',day:'2-digit',month:'2-digit'});
          return `<tr style="font-size:12px;color:var(--text-3)">
            <td style="padding:4px 8px">${dow}</td>
            <td style="padding:4px 8px">${j.tipo}</td>
            <td style="padding:4px 8px">${j.venue||j.evento_codigo||'—'}</td>
            <td style="padding:4px 8px;text-align:right">${fmtARS(j.tarifa_ars)}</td>
          </tr>`;
        }).join('');
        return `<div class="card" style="margin-bottom:10px;border-left:3px solid var(--green);background:color-mix(in srgb, var(--green) 6%, var(--bg-2))">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="color:var(--green);font-size:14px">✅</span>
              <span style="font-weight:600;font-size:14px">${p.apellido} ${p.nombre}</span>
            </div>
            <span style="font-size:16px;font-weight:700;color:var(--green)">${fmtARS(total)}</span>
          </div>
          <table style="width:100%;border-collapse:collapse">${filas2}</table>
        </div>`;
      }).join('')}` : '';

    if (!filas.length) {
      content.innerHTML = '<div class="empty"><div class="empty-icon">💸</div>Sin pagos pendientes esta semana</div>' + htmlPagados;
      return;
    }

    content.innerHTML = '<div id="pagos-pendientes-wrap">' + filas.map(p => {
      const esFijo = p.tipo === 'Fijo';
      const incluidas = p.jornadas.filter(j => esFijo && esIncluida(j.tipo, j.fecha));
      const extras    = p.jornadas.filter(j => !esFijo || !esIncluida(j.tipo, j.fecha));
      const totalExtras = extras.reduce((s, j) => s + Number(j.tarifa_ars || 0), 0);
      const sueldo = (esFijo && primeroDentroSemana) ? p.sueldo_fijo : 0;
      const total = sueldo + totalExtras;

      const filaJornadas = p.jornadas.sort((a,b) => a.fecha.localeCompare(b.fecha)).map(j => {
        const inc = esFijo && esIncluida(j.tipo, j.fecha);
        const dow = new Date(j.fecha+'T12:00:00').toLocaleDateString('es-AR',{weekday:'short',day:'2-digit',month:'2-digit'});
        return `<tr style="font-size:12px;color:${inc?'var(--text-3)':'var(--text)'}">
          <td style="padding:4px 8px">${dow}</td>
          <td style="padding:4px 8px">${j.tipo}</td>
          <td style="padding:4px 8px;color:var(--text-2)">${j.venue||j.evento_codigo||'—'}</td>
          <td style="padding:4px 8px;text-align:right">${inc ? '<span style="color:var(--text-3);font-size:11px">incl. en sueldo</span>' : fmtARS(j.tarifa_ars)}</td>
        </tr>`;
      }).join('');

      const sueldoRow = (esFijo && primeroDentroSemana) ? `
        <tr style="font-size:12px;color:var(--green)">
          <td style="padding:4px 8px" colspan="3">Sueldo mensual</td>
          <td style="padding:4px 8px;text-align:right;font-weight:600">${fmtARS(p.sueldo_fijo)}</td>
        </tr>` : '';

      const extrasPersona = (extrasDB || []).filter(e => e.personal_id == p.id);
      const totalConExtras = total + extrasPersona.reduce((s, e) => s + Number(e.monto || 0), 0);
      return `<div class="card" style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div>
            <span style="font-weight:600;font-size:15px">${p.apellido} ${p.nombre}</span>
            <span style="margin-left:8px;font-size:11px;color:${esFijo?'var(--green)':'var(--blue)'}">${p.tipo}</span>
          </div>
          <div style="display:flex;align-items:center;gap:12px">
            <span id="pago-total-${p.id}" data-base="${total}" style="font-size:18px;font-weight:700;color:var(--gold)">${fmtARS(totalConExtras)}</span>
            <button class="btn btn-ghost btn-sm" onclick="generarReciboIndividual(${JSON.stringify(p).replace(/"/g,'&quot;')})">📄 Recibo</button>
            ${p.jornadas.every(j => j.confirmada)
              ? `<button class="btn btn-primary btn-sm" onclick="marcarPagadoPersona(${p.id},'${desde}','${hasta}','${p.apellido} ${p.nombre}',${total})">✓ Pagar</button>`
              : `<button class="btn btn-ghost btn-sm" onclick="confirmarJornadasPersona(${p.id},'${desde}','${hasta}')">✓ Confirmar jornada</button>`}
          </div>
        </div>
        <table style="width:100%;border-collapse:collapse">
          ${sueldoRow}${filaJornadas}
          <tbody id="pago-extras-${p.id}">${extrasPersona.map(ex => `
            <tr style="font-size:12px;color:var(--text-2)">
              <td style="padding:4px 8px" colspan="2">
                <input class="inp" style="font-size:12px;padding:4px 8px" placeholder="Descripción (ej: hora extra)" value="${ex.descripcion||''}"
                  onchange="actualizarExtraPagos(${ex.id},'descripcion',this.value)">
              </td>
              <td style="padding:4px 8px;text-align:right">
                <input class="inp ars-input" type="text" style="font-size:12px;padding:4px 8px;width:110px;text-align:right" placeholder="0" value="${ex.monto ? String(ex.monto).replace('.',',') : ''}"
                  oninput="fmtInputARS(this)" onchange="actualizarExtraPagos(${ex.id},'monto',parseARSInput(this))">
              </td>
              <td style="padding:4px 8px">
                <button class="btn btn-danger btn-sm" onclick="eliminarExtraPagos(${ex.id})">✕</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
        <div style="margin-top:8px">
          <button class="btn btn-ghost btn-sm" style="font-size:12px" onclick="agregarExtraPagos(${p.id},'${desde}','${hasta}')">+ Extra / Descuento</button>
        </div>
      </div>`;
    }).join('') + '</div>' + htmlPagados;

  } catch(e) { content.innerHTML = `<div class="empty">Error: ${e.message}</div>`; }
}

export async function agregarExtraPagos(persId, desde, hasta) {
  try {
    await sbInsert('pago_extras', { personal_id: persId, semana_desde: desde, semana_hasta: hasta, descripcion: '', monto: 0 });
    loadPagos();
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

export async function eliminarExtraPagos(extraId) {
  try {
    await sbDelete('pago_extras', extraId);
    loadPagos();
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

export async function actualizarExtraPagos(extraId, campo, valor) {
  const patch = {};
  patch[campo] = campo === 'monto' ? (parseFloat(valor) || 0) : valor;
  try {
    await sbPatch('pago_extras', extraId, patch);
    // recalcular sin recargar todo
    const allExtras = window._extrasCache || [];
    const ex = allExtras.find(e => e.id === extraId);
    if (ex) { ex[campo] = patch[campo]; recalcularCardTotalDesdeCache(ex.personal_id); }
  } catch(e) { /* silencioso */ }
}

export function recalcularCardTotalDesdeCache(persId) {
  const totalEl = document.getElementById(`pago-total-${persId}`);
  if (!totalEl) return;
  const base = parseFloat(totalEl.dataset.base || 0);
  const extras = (window._extrasCache || []).filter(e => e.personal_id == persId).reduce((s, e) => s + Number(e.monto || 0), 0);
  totalEl.textContent = fmtARS(base + extras);
}

export function renderExtrasPagos(persId, extras) {
  const container = document.getElementById(`pago-extras-${persId}`);
  if (!container) return;
  container.innerHTML = extras.map(ex => `
    <tr style="font-size:12px;color:var(--text-2)">
      <td style="padding:4px 8px" colspan="2">
        <input class="inp" style="font-size:12px;padding:4px 8px" placeholder="Descripción (ej: hora extra)" value="${ex.descripcion||''}"
          onchange="actualizarExtraPagos(${ex.id},'descripcion',this.value)">
      </td>
      <td style="padding:4px 8px;text-align:right">
        <input class="inp" type="number" style="font-size:12px;padding:4px 8px;width:110px;text-align:right" placeholder="Monto" value="${ex.monto||''}"
          onchange="actualizarExtraPagos(${ex.id},'monto',this.value)">
      </td>
      <td style="padding:4px 8px">
        <button class="btn btn-danger btn-sm" onclick="eliminarExtraPagos(${ex.id})">✕</button>
      </td>
    </tr>`).join('');
}

export function marcarPagadoPersona(persId, desde, hasta, nombre, baseTotal) {
  const extras = (window._extrasCache || []).filter(e => e.personal_id == persId);
  const totalExtras = extras.reduce((s, e) => s + Number(e.monto || 0), 0);
  const total = baseTotal + totalExtras;
  document.getElementById('pago-metodo-nombre').textContent = nombre;
  document.getElementById('pago-metodo-total').textContent = fmtARS(total);
  document.getElementById('pago-metodo-persId').value = persId;
  document.getElementById('pago-metodo-desde').value = desde;
  document.getElementById('pago-metodo-hasta').value = hasta;
  document.getElementById('pago-metodo-total-val').value = total;
  document.getElementById('pago-metodo-extras').value = JSON.stringify(extras);
  openModal('modal-pago-metodo');
}

export async function confirmarPagoPersona(metodo) {
  const persId = document.getElementById('pago-metodo-persId').value;
  const desde  = document.getElementById('pago-metodo-desde').value;
  const hasta  = document.getElementById('pago-metodo-hasta').value;
  const total  = parseFloat(document.getElementById('pago-metodo-total-val').value);
  const nombre = document.getElementById('pago-metodo-nombre').textContent;
  const extras = JSON.parse(document.getElementById('pago-metodo-extras').value || '[]');
  closeModal('modal-pago-metodo');
  const hoy = new Date().toISOString().split('T')[0];
  try {
    const jornadas = await sb('v_jornadas', { filters: [`personal_id=eq.${persId}`, `fecha=gte.${desde}`, `fecha=lte.${hasta}`, `pagado=eq.false`, `confirmada=eq.true`], limit: 200 });
    for (const j of jornadas) await sbPatch('jornadas', j.id, { pagado: true, fecha_pago: hoy });
    if (total !== 0) {
      await sbInsert('caja', { tipo: 'egreso', descripcion: `Pago a ${nombre}`, monto: total, fecha: hoy, metodo_pago: metodo });
    }
    // Borrar extras de la BD y registrar cada uno en caja
    for (const ex of extras) {
      await fetch(`${SUPABASE_URL}/rest/v1/pago_extras?id=eq.${ex.id}`, { method: 'DELETE', headers: sbHeaders() });
      if (!ex.monto) continue;
      const tipo = Number(ex.monto) > 0 ? 'egreso' : 'ingreso';
      await sbInsert('caja', { tipo, descripcion: ex.descripcion || `Extra — ${nombre}`, monto: Math.abs(Number(ex.monto)), fecha: hoy, metodo_pago: metodo });
    }
    toast(`✅ Pago registrado`);
    loadPagos();
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

export function generarReciboIndividual(p) {
  const { desde, hasta } = getSemana(pagosOffset);
  const lunes = new Date(desde + 'T12:00:00');
  const domingo = new Date(hasta + 'T12:00:00');
  const periodo = `${lunes.toLocaleDateString('es-AR')} al ${domingo.toLocaleDateString('es-AR')}`;
  // Reusar generarReciboPDF con datos de esta persona
  sb('v_jornadas', { filters: [`personal_id=eq.${p.id}`, `fecha=gte.${desde}`, `fecha=lte.${hasta}`, `pagado=eq.false`, `confirmada=eq.true`], limit: 200 })
    .then(jornadas => {
      const data = { apellido: p.apellido, nombre: p.nombre, tipo: p.tipo, sueldo_fijo: p.sueldo_fijo, tarifa_armado: p.tarifa_armado||0, tarifa_operador: p.tarifa_operador||0, tarifa_deposito: p.tarifa_deposito||0, jornadas };
      const blob = generarReciboPDF(data, periodo, lunes);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    });
}


// Window assignments
window.getSemana = getSemana;
window.cambiarSemanaPagos = cambiarSemanaPagos;
window.cambiarSemanaLog = cambiarSemanaLog;
window.esIncluida = esIncluida;
window.loadPagos = loadPagos;
window.agregarExtraPagos = agregarExtraPagos;
window.eliminarExtraPagos = eliminarExtraPagos;
window.actualizarExtraPagos = actualizarExtraPagos;
window.recalcularCardTotalDesdeCache = recalcularCardTotalDesdeCache;
window.renderExtrasPagos = renderExtrasPagos;
window.marcarPagadoPersona = marcarPagadoPersona;
window.confirmarPagoPersona = confirmarPagoPersona;
window.generarReciboIndividual = generarReciboIndividual;
