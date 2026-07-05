import { sb, sbPost, sbInsert, sbPatch, sbDelete, fmtARS, fmtDate, escHtml, calcularTotalConRecargos, today, formatTelefono, onTelefonoInput, formatDni, onDniInput, formatCuit, onCuitInput, badge, fmtInputARS, parseARSInput, toast, openModal, closeModal, LOGO_B64, buildTimeOpts, timeSelect, llenarSelectEventos, initDatePickers, renderHorariosEv, getHorariosEv, evCache, persCache, setEvCache, setPersCache } from '../helpers.js';
import { SB_URL, SB_KEY, FOLDER_LOGISTICAS, WA_EDGE_URL, EMAIL_EDGE_URL, EMAIL_SEGURO, DRIVE_FOLDER_ID, FOTOS_FOLDER_ID } from '../config.js';

// ── GASTOS PERSONALES ─────────────────────────────────────
const GASTOS_CAT_COLOR = { Comida:'var(--orange)', Transporte:'var(--blue)', Salud:'var(--green)', Ropa:'var(--purple)', Entretenimiento:'var(--gold)', Hogar:'var(--text-2)', Educación:'var(--green)', Varios:'var(--text-3)' };
let _todosGastos = [];

export async function loadGastos() {
  document.getElementById('gastos-tbody').innerHTML = '<tr><td colspan="5" class="loading"><div class="spinner"></div></td></tr>';
  try {
    _todosGastos = await sb('gastos_personales', { order: 'fecha.desc,created_at.desc', limit: 500 });

    // KPIs globales (mes y año actuales, sin filtro)
    const ahora = new Date();
    let totalMes = 0, totalAnio = 0;
    _todosGastos.forEach(g => {
      const f = new Date(g.fecha + 'T12:00:00');
      if (f.getFullYear() === ahora.getFullYear()) {
        totalAnio += Number(g.monto);
        if (f.getMonth() === ahora.getMonth()) totalMes += Number(g.monto);
      }
    });
    document.getElementById('gastos-mes').textContent = fmtARS(totalMes);
    document.getElementById('gastos-anio').textContent = fmtARS(totalAnio);

    // Poblar selector de meses con los que existen
    const mesesSel = document.getElementById('gastos-filtro-mes');
    const valActual = mesesSel.value;
    const mesesVisto = new Set();
    _todosGastos.forEach(g => { if (g.fecha) mesesVisto.add(g.fecha.slice(0, 7)); });
    const mesesOrden = [...mesesVisto].sort().reverse();
    mesesSel.innerHTML = '<option value="">Todos los meses</option>' +
      mesesOrden.map(m => {
        const [y, mo] = m.split('-');
        const label = new Date(`${m}-15`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
        return `<option value="${m}" ${m === valActual ? 'selected' : ''}>${label}</option>`;
      }).join('');

    renderGastos();
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

const GASTOS_CAT_HEX = {
  Comida:'#f59e42', Transporte:'#4e9af1', Salud:'#4ade80', Ropa:'#a78bfa',
  Entretenimiento:'#fbbf24', Hogar:'#94a3b8', Educación:'#34d399', Varios:'#64748b'
};

export function renderDonutGastos(lista) {
  const totalesCat = {};
  lista.forEach(g => { totalesCat[g.categoria] = (totalesCat[g.categoria] || 0) + Number(g.monto); });
  const entradas = Object.entries(totalesCat).sort((a,b) => b[1]-a[1]);
  const total = entradas.reduce((s,[,v]) => s+v, 0);
  const svg = document.getElementById('gastos-donut');
  const ley = document.getElementById('gastos-leyenda');

  if (!total) {
    svg.innerHTML = `<circle cx="100" cy="100" r="78" fill="none" stroke="var(--surface-2)" stroke-width="28"/>`;
    ley.innerHTML = '';
    return;
  }

  const cx = 100, cy = 100, r = 78, sw = 28;
  const circ = 2 * Math.PI * r;
  let startAngle = -90;
  let segmentos = '';
  let leyendaHTML = '';

  entradas.forEach(([cat, val]) => {
    const pct = val / total;
    const dash = pct * circ;
    const color = GASTOS_CAT_HEX[cat] || '#64748b';
    // Cada segmento: dash cubre su arco, el resto es gap; rotate posiciona el inicio
    segmentos += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}"
      stroke-dasharray="${dash.toFixed(2)} ${(circ-dash).toFixed(2)}"
      transform="rotate(${startAngle.toFixed(2)} ${cx} ${cy})"/>`;
    startAngle += pct * 360;
    leyendaHTML += `<div style="display:flex;align-items:center;gap:6px">
      <span style="width:10px;height:10px;border-radius:2px;background:${color};flex-shrink:0"></span>
      <span style="color:var(--text-2)">${cat}</span>
      <span style="color:var(--text-3);margin-left:4px">${Math.round(pct*100)}%</span>
    </div>`;
  });

  svg.innerHTML = segmentos +
    `<circle cx="${cx}" cy="${cy}" r="${r - sw/2 - 1}" fill="var(--surface-1)"/>` +
    `<text x="${cx}" y="${cy-5}" text-anchor="middle" font-size="9" fill="var(--text-3)">TOTAL</text>` +
    `<text x="${cx}" y="${cy+8}" text-anchor="middle" font-size="10" font-weight="600" fill="var(--text-1)">${fmtARS(total).replace('$ ','$')}</text>`;
  ley.innerHTML = leyendaHTML;
}

export function renderGastos() {
  const filtroMes = document.getElementById('gastos-filtro-mes').value;
  const filtroCat = document.getElementById('gastos-filtro-cat').value;
  const lista = _todosGastos.filter(g => {
    if (filtroMes && !g.fecha?.startsWith(filtroMes)) return false;
    if (filtroCat && g.categoria !== filtroCat) return false;
    return true;
  });
  const totalFiltrado = lista.reduce((s, g) => s + Number(g.monto), 0);
  document.getElementById('gastos-total-filtrado').textContent = fmtARS(totalFiltrado);
  renderDonutGastos(lista);
  document.getElementById('gastos-tbody').innerHTML = lista.length
    ? lista.map(g => `<tr>
        <td>${fmtDate(g.fecha)}</td>
        <td>${g.descripcion}</td>
        <td><span style="font-size:11px;font-weight:600;color:${GASTOS_CAT_COLOR[g.categoria]||'var(--text-2)'}">${g.categoria}</span></td>
        <td>${fmtARS(g.monto)}</td>
        <td><button class="btn btn-ghost btn-sm" onclick="eliminarGasto(${g.id})">✕</button></td>
      </tr>`).join('')
    : '<tr><td colspan="5"><div class="empty"><div class="empty-icon">🧾</div>Sin gastos para este filtro</div></td></tr>';
}

export function limpiarFiltrosGastos() {
  document.getElementById('gastos-filtro-mes').value = '';
  document.getElementById('gastos-filtro-cat').value = '';
  renderGastos();
}

export function abrirModalGasto() {
  document.getElementById('gasto-id').value = '';
  document.getElementById('gasto-desc').value = '';
  document.getElementById('gasto-monto').value = '';
  document.getElementById('gasto-fecha').value = today();
  document.getElementById('gasto-categoria').value = 'Varios';
  document.getElementById('gasto-modal-title').textContent = 'Registrar gasto';
  openModal('modal-gasto');
}

export async function guardarGasto() {
  const desc = document.getElementById('gasto-desc').value.trim();
  const monto = parseARSInput(document.getElementById('gasto-monto'));
  const fecha = document.getElementById('gasto-fecha').value || today();
  const categoria = document.getElementById('gasto-categoria').value;
  if (!desc) { toast('Ingresá una descripción', 'err'); return; }
  if (!monto || monto <= 0) { toast('Ingresá un monto válido', 'err'); return; }
  try {
    await sbInsert('gastos_personales', { descripcion: desc, monto, fecha, categoria });
    closeModal('modal-gasto');
    toast('✅ Gasto registrado');
    loadGastos();
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

export async function eliminarGasto(id) {
  if (!confirm('¿Eliminar este gasto?')) return;
  try {
    await sbDelete('gastos_personales', id);
    toast('Gasto eliminado');
    loadGastos();
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

// ── GASTOS OFICINA ────────────────────────────────────────
const OFIC_CAT_COLOR = { Alquiler:'var(--orange)', Servicios:'var(--blue)', Materiales:'var(--gold)', Transporte:'var(--green)', Tecnología:'var(--purple)', Marketing:'var(--text-2)', Impuestos:'var(--red)', Varios:'var(--text-3)' };
const OFIC_CAT_HEX   = { Alquiler:'#f59e42', Servicios:'#4e9af1', Materiales:'#fbbf24', Transporte:'#4ade80', Tecnología:'#a78bfa', Marketing:'#94a3b8', Impuestos:'#f87171', Varios:'#64748b' };
let _todosGastosOficina = [];

export async function loadCaja() {
  document.getElementById('ofic-tbody').innerHTML = '<tr><td colspan="5" class="loading"><div class="spinner"></div></td></tr>';
  try {
    _todosGastosOficina = await sb('caja', { order: 'fecha.desc,created_at.desc', limit: 500 });
    const ahora = new Date();
    let totalMes = 0, totalAnio = 0;
    _todosGastosOficina.forEach(g => {
      const f = new Date(g.fecha + 'T12:00:00');
      if (f.getFullYear() === ahora.getFullYear()) {
        totalAnio += Number(g.monto);
        if (f.getMonth() === ahora.getMonth()) totalMes += Number(g.monto);
      }
    });
    document.getElementById('ofic-mes').textContent  = fmtARS(totalMes);
    document.getElementById('ofic-anio').textContent = fmtARS(totalAnio);
    const mesesSel = document.getElementById('ofic-filtro-mes');
    const valActual = mesesSel.value;
    const mesesVisto = new Set();
    _todosGastosOficina.forEach(g => { if (g.fecha) mesesVisto.add(g.fecha.slice(0, 7)); });
    mesesSel.innerHTML = '<option value="">Todos los meses</option>' +
      [...mesesVisto].sort().reverse().map(m => {
        const label = new Date(`${m}-15`).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
        return `<option value="${m}" ${m === valActual ? 'selected' : ''}>${label}</option>`;
      }).join('');
    renderGastosOficina();
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

export function renderGastosOficina() {
  const filtroMes = document.getElementById('ofic-filtro-mes').value;
  const filtroCat = document.getElementById('ofic-filtro-cat').value;
  const lista = _todosGastosOficina.filter(g => {
    if (filtroMes && !g.fecha?.startsWith(filtroMes)) return false;
    if (filtroCat && g.categoria !== filtroCat) return false;
    return true;
  });
  document.getElementById('ofic-total-filtrado').textContent = fmtARS(lista.reduce((s, g) => s + Number(g.monto), 0));
  renderDonutOficina(lista);
  document.getElementById('ofic-tbody').innerHTML = lista.length
    ? lista.map(g => {
        const color = g.tipo === 'ingreso' ? 'var(--green)' : 'var(--red)';
        const signo = g.tipo === 'ingreso' ? '+' : '-';
        return `<tr>
          <td>${fmtDate(g.fecha)}</td>
          <td>${g.descripcion}</td>
          <td><span style="font-size:11px;font-weight:600;color:${OFIC_CAT_COLOR[g.categoria]||'var(--text-2)'}">${g.categoria||'—'}</span></td>
          <td style="color:${color};font-weight:600">${signo} ${fmtARS(g.monto)}</td>
          <td><button class="btn btn-ghost btn-sm" onclick="eliminarGastoOficina(${g.id})">✕</button></td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="5"><div class="empty"><div class="empty-icon">🏢</div>Sin movimientos para este filtro</div></td></tr>';
}

export function renderDonutOficina(lista) {
  const totalesCat = {};
  lista.forEach(g => { totalesCat[g.categoria] = (totalesCat[g.categoria] || 0) + Number(g.monto); });
  const entradas = Object.entries(totalesCat).sort((a,b) => b[1]-a[1]);
  const total = entradas.reduce((s,[,v]) => s+v, 0);
  const svg = document.getElementById('ofic-donut');
  const ley = document.getElementById('ofic-leyenda');
  if (!total) { svg.innerHTML = `<circle cx="100" cy="100" r="78" fill="none" stroke="var(--surface-2)" stroke-width="28"/>`; ley.innerHTML = ''; return; }
  const circ = 2 * Math.PI * 78; let startAngle = -90; let seg = ''; let leyHTML = '';
  entradas.forEach(([cat, val]) => {
    const pct = val / total, dash = pct * circ, color = OFIC_CAT_HEX[cat] || '#64748b';
    seg += `<circle cx="100" cy="100" r="78" fill="none" stroke="${color}" stroke-width="28" stroke-dasharray="${dash.toFixed(2)} ${(circ-dash).toFixed(2)}" transform="rotate(${startAngle.toFixed(2)} 100 100)"/>`;
    startAngle += pct * 360;
    leyHTML += `<div style="display:flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:2px;background:${color};flex-shrink:0"></span><span style="color:var(--text-2)">${cat}</span><span style="color:var(--text-3);margin-left:4px">${Math.round(pct*100)}%</span></div>`;
  });
  svg.innerHTML = seg + `<circle cx="100" cy="100" r="63" fill="var(--surface-1)"/><text x="100" y="95" text-anchor="middle" font-size="9" fill="var(--text-3)">TOTAL</text><text x="100" y="108" text-anchor="middle" font-size="10" font-weight="600" fill="var(--text-1)">${fmtARS(total).replace('$ ','$')}</text>`;
  ley.innerHTML = leyHTML;
}

export function limpiarFiltrosOficina() {
  document.getElementById('ofic-filtro-mes').value = '';
  document.getElementById('ofic-filtro-cat').value = '';
  renderGastosOficina();
}

export function abrirModalGastoOficina() {
  document.getElementById('ofic-desc').value = '';
  document.getElementById('ofic-monto').value = '';
  document.getElementById('ofic-fecha').value = today();
  document.getElementById('ofic-categoria').value = 'Varios';
  openModal('modal-gasto-oficina');
}

export async function guardarGastoOficina() {
  const desc = document.getElementById('ofic-desc').value.trim();
  const monto = parseARSInput(document.getElementById('ofic-monto'));
  const fecha = document.getElementById('ofic-fecha').value || today();
  const categoria = document.getElementById('ofic-categoria').value;
  const tipo = document.getElementById('ofic-tipo').value;
  if (!desc) { toast('Ingresá una descripción', 'err'); return; }
  if (!monto || monto <= 0) { toast('Ingresá un monto válido', 'err'); return; }
  try {
    await sbInsert('caja', { tipo, descripcion: desc, monto, fecha, categoria });
    closeModal('modal-gasto-oficina');
    toast('✅ Movimiento registrado');
    loadCaja();
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

export async function eliminarGastoOficina(id) {
  if (!confirm('¿Eliminar este movimiento?')) return;
  try {
    await sbDelete('caja', id);
    toast('Movimiento eliminado');
    loadCaja();
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}


// Window assignments
window.loadGastos = loadGastos;
window.renderDonutGastos = renderDonutGastos;
window.renderGastos = renderGastos;
window.limpiarFiltrosGastos = limpiarFiltrosGastos;
window.abrirModalGasto = abrirModalGasto;
window.guardarGasto = guardarGasto;
window.eliminarGasto = eliminarGasto;
window.loadCaja = loadCaja;
window.renderGastosOficina = renderGastosOficina;
window.renderDonutOficina = renderDonutOficina;
window.limpiarFiltrosOficina = limpiarFiltrosOficina;
window.abrirModalGastoOficina = abrirModalGastoOficina;
window.guardarGastoOficina = guardarGastoOficina;
window.eliminarGastoOficina = eliminarGastoOficina;
