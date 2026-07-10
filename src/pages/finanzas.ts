import { state } from '../state';
import { sb, sbPost, sbInsert, sbPatch, sbDelete, fmtARS, fmtDate, escHtml, calcularTotalConRecargos, today, formatTelefono, onTelefonoInput, formatDni, onDniInput, formatCuit, onCuitInput, badge, fmtInputARS, parseARSInput, toast, openModal, closeModal, LOGO_B64, buildTimeOpts, timeSelect, llenarSelectEventos, initDatePickers, renderHorariosEv, getHorariosEv } from '../helpers';
import { SB_URL, SB_KEY, FOLDER_LOGISTICAS, WA_EDGE_URL, EMAIL_EDGE_URL, EMAIL_SEGURO, DRIVE_FOLDER_ID, FOTOS_FOLDER_ID } from '../config';
import { sbCached, invalidateCache } from '../query-cache';

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
    const eventosDelPeriodo = await sbCached('v_eventos', { select: 'id,venue,cliente_nombre', filters: [`fecha_evento=gte.${desde}`, `fecha_evento=lte.${hasta}`], limit: 200 });
    const eventoIds = eventosDelPeriodo.map(e => e.id);
    const [cobros, presupuestosEvento] = await Promise.all([
      eventoIds.length ? sbCached('pagos', { filters: [`evento_id=in.(${eventoIds.join(',')})`], limit: 500 }) : Promise.resolve([]),
      eventoIds.length ? sbCached('presupuestos', { select: 'evento_id,total_ars,estado_evento', filters: [`evento_id=in.(${eventoIds.join(',')})`, `estado_evento=eq.Confirmado`], limit: 200 }) : Promise.resolve([]),
    ]);
    const totalCobros = cobros.reduce((s, c) => s + Number(c.monto_ars || 0), 0);
    // Eventos sin cobros registrados → usar total_ars del presupuesto confirmado como proyectado
    const eventosCobrados = new Set(cobros.map(c => c.evento_id));
    const presSinCobro = presupuestosEvento.filter(p => !eventosCobrados.has(p.evento_id));
    const totalProyectado = presSinCobro.reduce((s, p) => s + Number(p.total_ars || 0), 0);
    const totalIngresos = totalCobros + totalProyectado;

    // 2. Impuestos: costos_fijos del mes/año del período (igual criterio que la pantalla Impuestos), excluye tarjeta
    const anioDesde = Number(desde.slice(0, 4));
    const anioHasta = Number(hasta.slice(0, 4));
    const mesesPeriodo = modo === 'mensual'
      ? [{ mes: Number(desde.slice(5, 7)), anio: anioDesde }]
      : Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, anio: anioDesde }));
    const aniosFiltro = [...new Set(mesesPeriodo.map(m => m.anio))];
    const [impuestosAnio, tcOficial] = await Promise.all([
      sbCached('costos_fijos', { filters: [`anio=in.(${aniosFiltro.join(',')})`], limit: 1000 }),
      fetchTipoCambioOficial(),
    ]);
    const impuestos = impuestosAnio.filter(i =>
      !i.paga_por_tarjeta && mesesPeriodo.some(m => m.mes === Number(i.mes) && m.anio === Number(i.anio))
    );
    const totalImpuestos = impuestos.reduce((s, i) =>
      s + Number(i.monto_ars || 0) + Number(i.monto_usd || 0) * tcOficial, 0);

    // 3. Pagos personal: entradas de caja con "Pago a"
    const egresos = await sbCached('caja', { filters: [`tipo=eq.egreso`, `fecha=gte.${desde}`, `fecha=lte.${hasta}`], limit: 500 });
    const pagosPersonal = egresos.filter(e => e.descripcion?.toLowerCase().startsWith('pago a '));
    const egresosFiltrados = egresos.filter(e => !e.descripcion?.toLowerCase().startsWith('pago a '));
    const totalPagos  = pagosPersonal.reduce((s, e) => s + Number(e.monto || 0), 0);
    const totalEgresos = egresosFiltrados.reduce((s, e) => s + Number(e.monto || 0), 0);

    // 4. Personal pendiente: jornadas sin pagar con personal asignado en el período
    const jornadasPendientes = await sbCached('v_jornadas', {
      filters: [`pagado=eq.false`, `personal_id=not.is.null`, `fecha=gte.${desde}`, `fecha=lte.${hasta}`],
      select: 'id,tipo,personal_id,personal_nombre,personal_apellido,tarifa_armado,tarifa_operador,tarifa_deposito',
      limit: 1000,
    });
    // Para Fijo: calcular sueldo prorrateado una vez por persona en el período
    const personalFijo = jornadasPendientes.length
      ? await sbCached('personal', { filters: [`tipo=eq.Fijo`, `activo=eq.true`], select: 'id,sueldo_fijo', limit: 200 })
      : [];
    const sueldoFijoMap: Record<number, number> = {};
    personalFijo.forEach(p => { sueldoFijoMap[p.id] = Number(p.sueldo_fijo || 0); });
    const esLaborable = (j) => {
      const dow = new Date(j.fecha + 'T12:00:00').getDay(); // 0=Dom,6=Sab
      return dow !== 0 && dow !== 6;
    };
    const tarifa = (j) => {
      const esFijo = !!sueldoFijoMap[j.personal_id];
      if (esFijo) {
        // Fijo: Operador + fines de semana son extra; el resto está incluido en el sueldo
        const esExtra = j.tipo === 'Operador' || !esLaborable(j);
        if (!esExtra) return 0;
        return j.tipo === 'Operador' ? Number(j.tarifa_operador || 0) : Number(j.tarifa_armado || 0);
      }
      return j.tipo === 'Depósito' ? Number(j.tarifa_deposito || 0)
           : j.tipo === 'Operador' ? Number(j.tarifa_operador || 0)
           : Number(j.tarifa_armado || 0);
    };
    // Sueldo fijo: una vez por persona que tenga jornadas en el período
    const persConJornadas = [...new Set(jornadasPendientes.filter(j => sueldoFijoMap[j.personal_id]).map(j => j.personal_id))];
    const totalSueldosFijos = persConJornadas.reduce((s, pid) => s + (sueldoFijoMap[pid] || 0), 0);
    const totalTarifasPendientes = jornadasPendientes.reduce((s, j) => s + tarifa(j), 0);
    const totalPersonalPendiente = totalSueldosFijos + totalTarifasPendientes;

    // 5. Capital
    const capitalMovs = await sbCached('capital', { filters: [`fecha=gte.${desde}`, `fecha=lte.${hasta}`], order: 'fecha.desc', limit: 500 });
    const capitalIng = capitalMovs.filter(c => c.tipo === 'ingreso').reduce((s, c) => s + Number(c.monto || 0), 0);
    const capitalEg  = capitalMovs.filter(c => c.tipo === 'egreso').reduce((s, c) => s + Number(c.monto || 0), 0);
    const capitalNeto = capitalIng - capitalEg;

    const resultado = totalIngresos + capitalNeto - totalImpuestos - totalPagos - totalEgresos - totalPersonalPendiente;

    // KPIs
    const capEl = document.getElementById('fin-capital');
    capEl.textContent = (capitalNeto >= 0 ? '+' : '') + fmtARS(capitalNeto);
    capEl.style.color = capitalNeto >= 0 ? 'var(--green)' : 'var(--red)';
    const resEl = document.getElementById('fin-resultado');
    resEl.textContent = fmtARS(resultado);
    resEl.style.color = resultado >= 0 ? 'var(--green)' : 'var(--red)';

    // KPIs adicionales: pendientes de cobro y jornadas sin pagar (estado actual, no atado al período)
    const cobrosPendientes = await sbCached('v_cobros_pendientes');
    document.getElementById('fin-pendientes-cobro').textContent = cobrosPendientes.length;
    const jornadasSinPagar = await sbCached('jornadas', { select: 'id', filters: ['pagado=eq.false', 'personal_id=not.is.null'], limit: 1000 });
    document.getElementById('fin-jornadas-sin-pagar').textContent = jornadasSinPagar.length;

    // Detalle ingresos por evento
    const porEvento: Record<string, { monto: number; proyectado: boolean }> = {};
    const eventosMap = {};
    eventosDelPeriodo.forEach(e => eventosMap[e.id] = `${e.venue || ''} — ${e.cliente_nombre || ''}`);
    cobros.forEach(c => {
      const key = c.evento_id || 'Sin evento';
      if (!porEvento[key]) porEvento[key] = { monto: 0, proyectado: false };
      porEvento[key].monto += Number(c.monto_ars || 0);
    });
    presSinCobro.forEach(p => {
      const key = p.evento_id;
      if (!porEvento[key]) porEvento[key] = { monto: 0, proyectado: true };
      porEvento[key].monto += Number(p.total_ars || 0);
      porEvento[key].proyectado = true;
    });
    const hayIngresos = Object.keys(porEvento).length > 0;
    document.getElementById('fin-detalle-ingresos').innerHTML = hayIngresos
      ? Object.entries(porEvento).map(([id, v]) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px${v.proyectado ? ';opacity:.75' : ''}">
          <div style="display:flex;align-items:center;gap:6px">
            <span style="color:var(--text-2)">${eventosMap[id] || id}</span>
            ${v.proyectado ? `<span style="font-size:10px;color:var(--text-3);font-style:italic">(proyectado)</span>` : ''}
          </div>
          <span style="color:var(--green);font-weight:600">${fmtARS(v.monto)}</span>
        </div>`).join('')
      : '<div style="color:var(--text-3);font-size:13px">Sin ingresos en este período</div>';

    // Agrupar personal e impuestos
    const egResumen = [
      ...(totalImpuestos > 0 ? [{ desc: `Gastos fijos (${impuestos.length} ítems)`, monto: totalImpuestos, cat: 'Impuesto', pendiente: false }] : []),
      ...(totalPagos > 0 ? [{ desc: `Personal pagado (${pagosPersonal.length} pagos)`, monto: totalPagos, cat: 'Personal', pendiente: false }] : []),
      ...(totalPersonalPendiente > 0 ? [{ desc: `Personal pendiente (${jornadasPendientes.length} jornadas)`, monto: totalPersonalPendiente, cat: 'Pendiente', pendiente: true }] : []),
      ...egresosFiltrados.map(e => ({ desc: e.descripcion, monto: Number(e.monto), cat: 'Caja', pendiente: false })),
    ].sort((a, b) => b.monto - a.monto);

    const catColor = { Impuesto: 'var(--orange)', Personal: 'var(--blue)', Pendiente: 'var(--text-3)', Caja: 'var(--red)' };
    document.getElementById('fin-detalle-egresos').innerHTML = egResumen.length
      ? egResumen.map(e => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px${e.pendiente ? ';opacity:.75' : ''}">
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:10px;color:${catColor[e.cat]||'var(--text-3)'}">${e.cat}</span>
            <span style="color:var(--text-2)">${e.desc}</span>
            ${e.pendiente ? `<span style="font-size:10px;color:var(--text-3);font-style:italic">(proyectado)</span>` : ''}
          </div>
          <span style="color:${e.pendiente ? 'var(--text-2)' : 'var(--red)'};font-weight:600">${fmtARS(e.monto)}</span>
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
  else document.getElementById('capital-fecha').value = today();
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
    invalidateCache('capital');
    toast('✅ Movimiento de capital registrado');
    loadFinanzas();
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

export async function eliminarCapital(id) {
  if (!confirm('¿Eliminar este movimiento?')) return;
  try {
    await sbDelete('capital', id);
    invalidateCache('capital');
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
