import { state } from '../state';
import { sb, sbPost, sbInsert, sbPatch, sbDelete, fmtARS, fmtDate, escHtml, calcularTotalConRecargos, today, formatTelefono, onTelefonoInput, formatDni, onDniInput, formatCuit, onCuitInput, badge, fmtInputARS, parseARSInput, toast, openModal, closeModal, LOGO_B64, buildTimeOpts, timeSelect, llenarSelectEventos, initDatePickers, renderHorariosEv, getHorariosEv } from '../helpers';
import { SB_URL, SB_KEY, FOLDER_LOGISTICAS, WA_EDGE_URL, EMAIL_EDGE_URL, EMAIL_SEGURO, DRIVE_FOLDER_ID, FOTOS_FOLDER_ID } from '../config';

// ── FINANZAS ──────────────────────────────────────────────
const MESES_NAMES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
let finanzasOffset = 0; // 0 = período actual, -1 = anterior, etc.
let _tipoCambioCache = null;
export async function fetchTipoCambioOficial() {
  if (_tipoCambioCache) return _tipoCambioCache;
  try {
    const r = await fetch('https://api.bluelytics.com.ar/v2/latest');
    const d = await r.json();
    _tipoCambioCache = Number(d.oficial?.value_sell) || null;
  } catch { _tipoCambioCache = null; }
  if (!_tipoCambioCache) {
    try {
      const r = await fetch('https://api.dolarapi.com/v1/dolares/oficial');
      const d = await r.json();
      _tipoCambioCache = Number(d.venta) || null;
    } catch { _tipoCambioCache = null; }
  }
  _tipoCambioCache = _tipoCambioCache || 1200; // fallback razonable
  return _tipoCambioCache;
}

export function getPeriodoFinanzas() {
  const modo = document.getElementById('finanzas-modo')?.value || 'mensual';
  const hoy = new Date();
  if (modo === 'mensual') {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() + finanzasOffset, 1);
    const desde = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
    const hasta = new Date(d.getFullYear(), d.getMonth()+1, 0).toISOString().split('T')[0];
    const label = d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
    return { desde, hasta, label, modo };
  } else {
    const anio = hoy.getFullYear() + finanzasOffset;
    return { desde: `${anio}-01-01`, hasta: `${anio}-12-31`, label: String(anio), modo };
  }
}

export function cambiarPeriodoFinanzas(dir) {
  finanzasOffset += dir;
  loadFinanzas();
}

export async function loadFinanzas() {
  _tipoCambioCache = null;
  const { desde, hasta, label, modo } = getPeriodoFinanzas();
  document.getElementById('finanzas-sub').textContent = label;

  try {
    // 1. Ingresos: pagos de eventos cuya fecha_evento cae en el período
    const eventosDelPeriodo = await sb('v_eventos', { select: 'id,venue,cliente_nombre', filters: [`fecha_evento=gte.${desde}`, `fecha_evento=lte.${hasta}`], limit: 200 });
    const eventoIds = eventosDelPeriodo.map(e => e.id);
    const cobros = eventoIds.length
      ? await sb('pagos', { filters: [`evento_id=in.(${eventoIds.join(',')})`], limit: 500 })
      : [];
    const totalIngresos = cobros.reduce((s, c) => s + Number(c.monto_ars || 0), 0);

    // 2. Impuestos: costos_fijos del mes/año del período (igual criterio que la pantalla Impuestos), excluye tarjeta
    const anioDesde = Number(desde.slice(0, 4));
    const anioHasta = Number(hasta.slice(0, 4));
    const mesesPeriodo = modo === 'mensual'
      ? [{ mes: MESES_NAMES[Number(desde.slice(5, 7)) - 1], anio: anioDesde }]
      : MESES_NAMES.map(m => ({ mes: m, anio: anioDesde }));
    const aniosFiltro = [...new Set(mesesPeriodo.map(m => m.anio))];
    const [impuestosAnio, tcOficial] = await Promise.all([
      sb('costos_fijos', { filters: [`anio=in.(${aniosFiltro.join(',')})`], limit: 1000 }),
      fetchTipoCambioOficial(),
    ]);
    const impuestos = impuestosAnio.filter(i =>
      !i.paga_por_tarjeta && mesesPeriodo.some(m => m.mes === i.mes && m.anio === i.anio)
    );
    const totalImpuestos = impuestos.reduce((s, i) =>
      s + Number(i.monto_ars || 0) + Number(i.monto_usd || 0) * tcOficial, 0);

    // 3. Pagos personal: entradas de caja con "Pago a"
    const egresos = await sb('caja', { filters: [`tipo=eq.egreso`, `fecha=gte.${desde}`, `fecha=lte.${hasta}`], limit: 500 });
    const pagosPersonal = egresos.filter(e => e.descripcion?.toLowerCase().startsWith('pago a '));
    const egresosFiltrados = egresos.filter(e => !e.descripcion?.toLowerCase().startsWith('pago a '));
    const totalPagos  = pagosPersonal.reduce((s, e) => s + Number(e.monto || 0), 0);
    const totalEgresos = egresosFiltrados.reduce((s, e) => s + Number(e.monto || 0), 0);

    // 5. Capital
    const capitalMovs = await sb('capital', { filters: [`fecha=gte.${desde}`, `fecha=lte.${hasta}`], order: 'fecha.desc', limit: 500 });
    const capitalIng = capitalMovs.filter(c => c.tipo === 'ingreso').reduce((s, c) => s + Number(c.monto || 0), 0);
    const capitalEg  = capitalMovs.filter(c => c.tipo === 'egreso').reduce((s, c) => s + Number(c.monto || 0), 0);
    const capitalNeto = capitalIng - capitalEg;

    const resultado = totalIngresos + capitalNeto - totalImpuestos - totalPagos - totalEgresos;

    // KPIs
    const capEl = document.getElementById('fin-capital');
    capEl.textContent = (capitalNeto >= 0 ? '+' : '') + fmtARS(capitalNeto);
    capEl.style.color = capitalNeto >= 0 ? 'var(--green)' : 'var(--red)';
    const resEl = document.getElementById('fin-resultado');
    resEl.textContent = fmtARS(resultado);
    resEl.style.color = resultado >= 0 ? 'var(--green)' : 'var(--red)';

    // KPIs adicionales: pendientes de cobro y jornadas sin pagar (estado actual, no atado al período)
    const cobrosPendientes = await sb('v_cobros_pendientes');
    document.getElementById('fin-pendientes-cobro').textContent = cobrosPendientes.length;
    const jornadasSinPagar = await sb('jornadas', { select: 'id', filters: ['pagado=eq.false'], limit: 1000 });
    document.getElementById('fin-jornadas-sin-pagar').textContent = jornadasSinPagar.length;

    // Detalle ingresos por evento
    const porEvento = {};
    cobros.forEach(c => {
      const key = c.evento_id || 'Sin evento';
      if (!porEvento[key]) porEvento[key] = { nombre: c.tipo || c.evento_id || 'Sin evento', monto: 0 };
      porEvento[key].monto += Number(c.monto_ars || 0);
    });
    // Usar los eventos ya cargados para armar el mapa de nombres
    const eventosMap = {};
    eventosDelPeriodo.forEach(e => eventosMap[e.id] = `${e.venue || ''} — ${e.cliente_nombre || ''}`);
    document.getElementById('fin-detalle-ingresos').innerHTML = cobros.length
      ? Object.entries(porEvento).map(([id, v]) => `
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px">
          <span style="color:var(--text-2)">${eventosMap[id] || v.nombre}</span>
          <span style="color:var(--green);font-weight:600">${fmtARS(v.monto)}</span>
        </div>`).join('')
      : '<div style="color:var(--text-3);font-size:13px">Sin ingresos en este período</div>';

    // Agrupar personal e impuestos
    const egResumen = [
      ...(totalImpuestos > 0 ? [{ desc: `Gastos fijos (${impuestos.length} ítems)`, monto: totalImpuestos, cat: 'Impuesto' }] : []),
      ...(totalPagos > 0 ? [{ desc: `Pagos al personal (${pagosPersonal.length} pagos)`, monto: totalPagos, cat: 'Personal' }] : []),
      ...egresosFiltrados.map(e => ({ desc: e.descripcion, monto: Number(e.monto), cat: 'Caja' })),
    ].sort((a, b) => b.monto - a.monto);

    const catColor = { Impuesto: 'var(--orange)', Personal: 'var(--blue)', Caja: 'var(--red)' };
    document.getElementById('fin-detalle-egresos').innerHTML = egResumen.length
      ? egResumen.map(e => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px">
          <div>
            <span style="font-size:10px;color:${catColor[e.cat]||'var(--text-3)'};margin-right:6px">${e.cat}</span>
            <span style="color:var(--text-2)">${e.desc}</span>
          </div>
          <span style="color:var(--red);font-weight:600">${fmtARS(e.monto)}</span>
        </div>`).join('')
      : '<div style="color:var(--text-3);font-size:13px">Sin egresos en este período</div>';

    // Detalle capital
    document.getElementById('fin-detalle-capital').innerHTML = capitalMovs.length
      ? capitalMovs.map(c => {
          const color = c.tipo === 'ingreso' ? 'var(--green)' : 'var(--red)';
          const signo = c.tipo === 'ingreso' ? '+' : '-';
          const fecha = new Date(c.fecha + 'T12:00:00').toLocaleDateString('es-AR');
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px">
            <div style="display:flex;gap:10px;align-items:center">
              <span style="color:var(--text-3);font-size:11px">${fecha}</span>
              <span style="color:var(--text-2)">${c.descripcion}</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <span style="color:${color};font-weight:600">${signo} ${fmtARS(c.monto)}</span>
              <button class="btn btn-ghost btn-sm" onclick="eliminarCapital(${c.id})" style="color:var(--red);padding:2px 6px">✕</button>
            </div>
          </div>`;
        }).join('')
      : '<div style="color:var(--text-3);font-size:13px">Sin movimientos de capital en este período</div>';

  } catch(e) { toast('Error cargando finanzas: ' + e.message, 'err'); }
}

export function setCapitalMoneda(moneda) {
  const esUSD = moneda === 'USD';
  document.getElementById('capital-monto-ars-wrap').style.display = esUSD ? 'none' : '';
  document.getElementById('capital-monto-usd-wrap').style.display = esUSD ? '' : 'none';
  document.getElementById('capital-moneda-ars').className = esUSD ? 'btn btn-ghost btn-sm' : 'btn btn-primary btn-sm';
  document.getElementById('capital-moneda-usd').className = esUSD ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm';
  document.getElementById('capital-monto').value = '';
  document.getElementById('capital-monto-usd').value = '';
}

export function abrirModalCapital(tipo) {
  document.getElementById('capital-tipo').value = tipo;
  document.getElementById('capital-modal-title').textContent = tipo === 'ingreso' ? '+ Ingreso capital' : '− Egreso capital';
  document.getElementById('capital-desc').value = '';
  setCapitalMoneda('ARS');
  const fp = document.getElementById('capital-fecha')._flatpickr;
  if (fp) fp.setDate(new Date());
  else document.getElementById('capital-fecha').value = new Date().toISOString().split('T')[0];
  openModal('modal-capital');
  setTimeout(() => initDatePickers(document.getElementById('modal-capital')), 50);
}

export async function guardarCapital() {
  const tipo = document.getElementById('capital-tipo').value;
  const desc = document.getElementById('capital-desc').value.trim();
  const fecha = document.getElementById('capital-fecha').value;
  const esUSD = document.getElementById('capital-monto-usd-wrap').style.display !== 'none';
  const montoUSD = esUSD ? parseFloat(document.getElementById('capital-monto-usd').value) : null;
  const montoARS = esUSD ? null : parseARSInput(document.getElementById('capital-monto'));
  if (!desc) { toast('Ingresá una descripción', 'err'); return; }
  if (esUSD && (!montoUSD || montoUSD <= 0)) { toast('Ingresá un monto válido', 'err'); return; }
  if (!esUSD && (!montoARS || montoARS <= 0)) { toast('Ingresá un monto válido', 'err'); return; }
  if (!fecha) { toast('Seleccioná una fecha', 'err'); return; }
  try {
    let monto = montoARS;
    if (esUSD) {
      const tc = await fetchTipoCambioOficial();
      monto = Math.round(montoUSD * tc);
    }
    await sbInsert('capital', { tipo, descripcion: desc, monto, monto_usd: montoUSD, fecha });
    closeModal('modal-capital');
    toast('✅ Movimiento de capital registrado');
    loadFinanzas();
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

export async function eliminarCapital(id) {
  if (!confirm('¿Eliminar este movimiento?')) return;
  try {
    await sbDelete('capital', id);
    toast('Eliminado');
    loadFinanzas();
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}


// Window assignments
window.fetchTipoCambioOficial = fetchTipoCambioOficial;
window.getPeriodoFinanzas = getPeriodoFinanzas;
window.cambiarPeriodoFinanzas = cambiarPeriodoFinanzas;
window.loadFinanzas = loadFinanzas;
window.setCapitalMoneda = setCapitalMoneda;
window.abrirModalCapital = abrirModalCapital;
window.guardarCapital = guardarCapital;
window.eliminarCapital = eliminarCapital;
