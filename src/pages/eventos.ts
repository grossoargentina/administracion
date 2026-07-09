import { state } from '../state';
import { sb, sbPost, sbInsert, sbPatch, sbDelete, fmtARS, fmtDate, escHtml, calcularTotalConRecargos, today, formatTelefono, onTelefonoInput, formatDni, onDniInput, formatCuit, onCuitInput, badge, fmtInputARS, parseARSInput, toast, openModal, closeModal, LOGO_B64, buildTimeOpts, timeSelect, llenarSelectEventos, initDatePickers, renderHorariosEv, getHorariosEv } from '../helpers';
import { SB_URL, SB_KEY, FOLDER_LOGISTICAS, WA_EDGE_URL, EMAIL_EDGE_URL, EMAIL_SEGURO, DRIVE_FOLDER_ID, FOTOS_FOLDER_ID } from '../config';
import { sbCached, invalidateCache } from '../query-cache';

// ── EVENTOS ───────────────────────────────────────────────
let todosEventos = [];
let filtroEvento = 'todos';
let busquedaEvento = '';

// ── SORT SYSTEM ───────────────────────────────────────────
export function toggleSort(tabla, campo, renderFn) {
  if (state._sortState[tabla]?.campo === campo) {
    state._sortState[tabla].dir = state._sortState[tabla].dir === 'asc' ? 'desc' : 'asc';
  } else {
    state._sortState[tabla] = { campo, dir: 'asc' };
  }
  renderFn();
}
export function applySort(tabla, lista) {
  const s = state._sortState[tabla];
  if (!s) return lista;
  return [...lista].sort((a, b) => {
    let va = a[s.campo] ?? '';
    let vb = b[s.campo] ?? '';
    const cmp = String(va).localeCompare(String(vb), 'es-AR', { numeric: true, sensitivity: 'base' });
    return s.dir === 'asc' ? cmp : -cmp;
  });
}
export function sortClasses(tabla, campo) {
  const s = state._sortState[tabla];
  if (s?.campo !== campo) return 'sortable';
  return s.dir === 'asc' ? 'sortable sort-asc' : 'sortable sort-desc';
}

export async function loadEventos() {
  document.getElementById('ev-tbody').innerHTML = '<tr><td colspan="8" class="loading"><div class="spinner"></div></td></tr>';
  try {
    todosEventos = await sbCached('v_pipeline', { limit: 200 });
    renderEventos();
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

export function renderEventos() {
  let lista = filtroEvento === 'todos'
    ? todosEventos
    : todosEventos.filter(e => e.estado === filtroEvento);
  if (busquedaEvento.trim()) {
    const q = busquedaEvento.trim().toLowerCase();
    lista = lista.filter(e => (e.cliente_nombre || '').toLowerCase().includes(q));
  }
  lista = applySort('ev', lista);

  document.getElementById('ev-tbody').innerHTML = lista.length
    ? lista.map(e => `<tr>
        <td>${badge(e.estado)}</td>
        <td><b>${e.cliente_nombre}</b></td>
        <td>${e.tipo_evento || '—'}</td>
        <td>${fmtDate(e.fecha_evento)}</td>
        <td>${e.venue || '—'}</td>
        <td>${fmtARS(e.total_ars)}</td>
        <td>${(() => {
          let label = e.estado_cobro;
          let color;
          if (e.modalidad_pago === 'Pago total al finalizar') {
            label = e.saldo_cobrado ? 'Cobrado' : 'Pendiente';
            color = e.saldo_cobrado ? 'var(--green)' : 'var(--red)';
          } else {
            color = e.estado_cobro==='Cobrado completo'?'var(--green)':e.estado_cobro==='Seña cobrada'?'var(--orange)':'var(--red)';
          }
          return `<div style="font-size:11px;color:${color}">${label}</div>`;
        })()}</td>
        <td>
          <div style="display:flex;gap:6px">
            <button class="btn btn-ghost btn-sm" onclick="editEvento(${e.id})">Editar</button>
            ${e.estado === 'Confirmado' || e.estado === 'En logística'
              ? `<button class="btn btn-ghost btn-sm" onclick="registrarCobro(${e.id},'${e.cliente_nombre}',${e.sena_cobrada},${e.saldo_cobrado})">Cobro</button>
                 <button class="btn btn-ghost btn-sm" onclick="window.abrirPresupuestoParaEvento(${e.id})">+ Presupuesto</button>`
              : ''}
          </div>
        </td>
      </tr>`).join('')
    : `<tr><td colspan="9"><div class="empty"><div class="empty-icon">📋</div>Sin eventos en este estado</div></td></tr>`;
}

export function filterEventos(estado, btn) {
  filtroEvento = estado;
  document.querySelectorAll('#ev-filters .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderEventos();
}

export function buscarEventos(valor) {
  busquedaEvento = valor;
  renderEventos();
}


let editingEventoId = null;
// ── AUTOCOMPLETE CUSTOM ──────────────────────────────────
export function acFilter(inputId, dropId) {
  const q = (document.getElementById(inputId).value || '').toLowerCase();
  const opts = state._acData[inputId] || [];
  const matches = opts.filter(o => !q || o.toLowerCase().includes(q)).slice(0, 10);
  const drop = document.getElementById(dropId);
  if (!drop) return;
  if (!matches.length) { drop.style.display = 'none'; return; }
  drop.innerHTML = matches.map(m =>
    `<div style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border)"
      onmousedown="acSelect('${inputId}','${dropId}',this)"
      onmouseover="this.style.background='var(--bg-3)'"
      onmouseout="this.style.background=''">${m}</div>`
  ).join('');
  drop.style.display = 'block';
}
export function acHide(dropId) {
  setTimeout(() => { const d = document.getElementById(dropId); if (d) d.style.display = 'none'; }, 150);
}
export function acSelect(inputId, dropId, el) {
  document.getElementById(inputId).value = el.textContent;
  document.getElementById(dropId).style.display = 'none';
}

// ── BENEFICIARIOS CLIENTE ────────────────────────────────
export function renderClienteBenef() {
  document.getElementById('cliente-benef-lista').innerHTML = state.clienteBeneficiarios.map((b, i) => `
    <div style="display:flex;gap:8px;align-items:center">
      <input class="inp" style="flex:2" placeholder="Nombre (ej: CENCOSUD S.A.)" value="${b.nombre}" oninput="state.clienteBeneficiarios[${i}].nombre=this.value">
      <input class="inp" style="flex:1" placeholder="CUIT (ej: 30-59036076-3)" value="${b.cuit}" maxlength="13" oninput="onCuitInput(this);state.clienteBeneficiarios[${i}].cuit=this.value">
      <button type="button" class="btn btn-danger btn-sm" onclick="state.clienteBeneficiarios.splice(${i},1);renderClienteBenef()">✕</button>
    </div>`).join('');
}
export function agregarBenefCliente() {
  state.clienteBeneficiarios.push({ nombre: '', cuit: '' });
  renderClienteBenef();
}

// ── BENEFICIARIOS SALON ──────────────────────────────────
export function renderSalonBenef() {
  document.getElementById('salon-benef-lista').innerHTML = state.salonBeneficiarios.map((b, i) => `
    <div style="display:flex;gap:8px;align-items:center">
      <input class="inp" style="flex:2" placeholder="Nombre (ej: CENCOSUD S.A.)" value="${b.nombre}" oninput="state.salonBeneficiarios[${i}].nombre=this.value">
      <input class="inp" style="flex:1" placeholder="CUIT (ej: 30-59036076-3)" value="${b.cuit}" maxlength="13" oninput="onCuitInput(this);state.salonBeneficiarios[${i}].cuit=this.value">
      <button type="button" class="btn btn-danger btn-sm" onclick="state.salonBeneficiarios.splice(${i},1);renderSalonBenef()">✕</button>
    </div>`).join('');
}
export function agregarBenefSalon() {
  state.salonBeneficiarios.push({ nombre: '', cuit: '' });
  renderSalonBenef();
}

export async function editEvento(id) {
  const ev = todosEventos.find(e => e.id === id);
  if (!ev) return;
  editingEventoId = id;
  document.getElementById('modal-evento-title').textContent = 'Editar evento';
  document.getElementById('ev-cliente').value   = ev.cliente_nombre;
  document.getElementById('ev-tipo').value      = ev.tipo_evento || 'Casamiento';
  const fpFecha = document.getElementById('ev-fecha')._flatpickr;
  if (fpFecha) {
    fpFecha.clear();
    renderHorariosEv([]);
    try {
      const logRels = await sbCached('logistica_eventos', { filters: [`evento_id=eq.${id}`], select: 'logistica_id', limit: 50 });
      const logIds = logRels.map(r => r.logistica_id);
      const jorns = logIds.length
        ? await sbCached('jornadas', { filters: [`logistica_id=in.(${logIds.join(',')})`, 'tipo=eq.Operador'], select: 'fecha', order: 'fecha', limit: 100 })
        : [];
      const fechas   = jorns.map(j => j.fecha).filter(Boolean);
      let horarios = [];
      try { horarios = ev.horarios_evento ? (Array.isArray(ev.horarios_evento) ? ev.horarios_evento : JSON.parse(ev.horarios_evento)) : []; } catch(e) {}
      if (!horarios.length && ev.horario) horarios = fechas.map(() => ev.horario);
      if (fechas.length) {
        fpFecha.setDate(fechas);
        renderHorariosEv(fpFecha.selectedDates.slice().sort((a,b) => a-b), horarios);
      }
    } catch(e) {}
  }
  document.getElementById('ev-venue').value     = ev.venue || '';
  const evMontoBase = ev.monto_base_ars ?? ev.total_ars ?? 0;
  document.getElementById('ev-total').value     = evMontoBase > 0 ? Number(evMontoBase).toLocaleString('es-AR', { maximumFractionDigits: 0 }) : '';
  document.getElementById('ev-iva').checked           = !!ev.incluye_iva;
  document.getElementById('ev-pago-diferido').checked = !!ev.pago_diferido;
  actualizarTotalFinalEv();
  document.getElementById('ev-modalidad').value = ev.modalidad_pago || 'Pago total al finalizar';
  toggleSenaEv(ev.modalidad_pago || 'Pago total al finalizar');
  const evSenaEl = document.getElementById('ev-sena');
  const evSenaMonto = ev.sena_monto || 0;
  evSenaEl.value = evSenaMonto > 0 ? evSenaMonto.toLocaleString('es-AR', { maximumFractionDigits: 0 }) : '';
  document.getElementById('ev-estado').value    = ev.estado;
  document.getElementById('ev-notas').value = ev.notas || '';
  const fpArmado = document.getElementById('ev-fecha-armado')._flatpickr;
  if (fpArmado) { ev.fecha_armado ? fpArmado.setDate(ev.fecha_armado, false, 'Y-m-d') : fpArmado.clear(); }
  else { document.getElementById('ev-fecha-armado').value = ev.fecha_armado || ''; }
  document.getElementById('ev-hora-armado').innerHTML = buildTimeOpts(ev.hora_armado || '');
  const fpDesarme = document.getElementById('ev-fecha-desarme')._flatpickr;
  if (fpDesarme) { ev.fecha_desarme ? fpDesarme.setDate(ev.fecha_desarme, false, 'Y-m-d') : fpDesarme.clear(); }
  else { document.getElementById('ev-fecha-desarme').value = ev.fecha_desarme || ''; }
  document.getElementById('ev-hora-desarme').innerHTML = buildTimeOpts(ev.hora_desarme || '');
  openModal('modal-evento');
}

export async function guardarEvento() {
  const cliente = document.getElementById('ev-cliente').value.trim();
  if (!cliente) { toast('El cliente es obligatorio', 'err'); return; }

  const fpEv = document.getElementById('ev-fecha')._flatpickr;
  const fechasEv = fpEv ? fpEv.selectedDates.map(d => d.toISOString().slice(0,10)).sort() : [];
  const horariosEv = getHorariosEv();

  const evMontoBase    = parseARSInput(document.getElementById('ev-total')) || 0;
  const evIncluyeIva   = document.getElementById('ev-iva').checked;
  const evPagoDiferido = document.getElementById('ev-pago-diferido').checked;

  const data = {
    cliente_nombre:  cliente,
    tipo_evento:     document.getElementById('ev-tipo').value,
    venue:           document.getElementById('ev-venue').value,
    monto_base_ars: evMontoBase,
    incluye_iva:    evIncluyeIva,
    pago_diferido:  evPagoDiferido,
    total_ars:      calcularTotalConRecargos(evMontoBase, evIncluyeIva, evPagoDiferido),
    modalidad_pago: document.getElementById('ev-modalidad').value,
    sena_monto:     parseARSInput(document.getElementById('ev-sena')),
    estado:         document.getElementById('ev-estado').value,
    notas:          document.getElementById('ev-notas').value,
    fecha_armado:      document.getElementById('ev-fecha-armado').value || null,
    hora_armado:       document.getElementById('ev-hora-armado').value || null,
    fecha_desarme:     document.getElementById('ev-fecha-desarme').value || null,
    hora_desarme:      document.getElementById('ev-hora-desarme').value || null,
    updated_at:        new Date().toISOString(),
  };

  try {
    if (editingEventoId) {
      await sbPatch('eventos', editingEventoId, data);
      invalidateCache('eventos');
      invalidateCache('v_pipeline');
      invalidateCache('jornadas');
      // Sincronizar fechas/horas en jornadas automáticas
      const logRels = await sb('logistica_eventos', { filters: [`evento_id=eq.${editingEventoId}`], select: 'logistica_id', limit: 50 });
      const logIdsEv = logRels.map(r => r.logistica_id);
      const jornadasEv = logIdsEv.length ? await sb('jornadas', { filters: [`logistica_id=in.(${logIdsEv.join(',')})`], select: 'id,tipo,logistica_id', limit: 100 }) : [];
      // Sincronizar jornadas Operador con las fechas seleccionadas
      const jornadasOp = jornadasEv.filter(j => j.tipo === 'Operador');
      // Usar la logística tipo 'Evento' para las jornadas Operador
      const logsData = logIdsEv.length ? await sb('logisticas', { filters: [`id=in.(${logIdsEv.join(',')})`], select: 'id,tipo', limit: 20 }) : [];
      const logIdEvento = logsData.find(l => l.tipo === 'Evento')?.id ?? logsData.find(l => l.tipo === 'Armado')?.id ?? logIdsEv[0];
      if (logIdEvento) {
        // Eliminar jornadas sobrantes (más jornadas que fechas)
        for (let i = fechasEv.length; i < jornadasOp.length; i++) {
          await sbDelete('jornadas', jornadasOp[i].id);
        }
        // Actualizar las que coinciden por posición
        for (let i = 0; i < Math.min(jornadasOp.length, fechasEv.length); i++) {
          await sbPatch('jornadas', jornadasOp[i].id, { fecha: fechasEv[i], hora_inicio: horariosEv[i] || null });
        }
        // Crear jornadas nuevas si hay más fechas que jornadas
        if (fechasEv.length > jornadasOp.length) {
          const nuevas = fechasEv.slice(jornadasOp.length).map((f, i) => ({
            codigo: `J${Date.now()}-op${jornadasOp.length + i}`,
            logistica_id: logIdEvento,
            tipo: 'Operador',
            fecha: f,
            hora_inicio: horariosEv[jornadasOp.length + i] || null,
            pagado: false,
          }));
          await sbPost('jornadas', nuevas);
        }
      }
      for (const j of jornadasEv.filter(j => j.tipo !== 'Operador')) {
        const jPatch = {};
        if (j.tipo === 'Armado'  && data.fecha_armado)  jPatch.fecha = data.fecha_armado;
        if (j.tipo === 'Desarme' && data.fecha_desarme)  jPatch.fecha = data.fecha_desarme;
        if (Object.keys(jPatch).length) await sbPatch('jornadas', j.id, jPatch);
      }
      invalidateCache('eventos');
      invalidateCache('v_pipeline');
      toast('Evento actualizado');
    } else {
      // Generar código único
      const count = await sb('eventos', { select: 'id' });
      data.codigo = 'EV' + String(count.length + 1).padStart(3, '0');
      data.created_at = new Date().toISOString();
      const evRow = await sbPost('eventos', data);
      const newEvId = Array.isArray(evRow) ? evRow[0]?.id : evRow?.id;
      if (newEvId) {
        const newLog = await sbPost('logisticas', { tipo: 'Evento', notas: null });
        const newLogId = Array.isArray(newLog) ? newLog[0]?.id : newLog?.id;
        if (newLogId) await sbPost('logistica_eventos', { logistica_id: newLogId, evento_id: newEvId });
      }
      invalidateCache('eventos');
      invalidateCache('v_pipeline');
      toast('Evento creado');
    }
    closeModal('modal-evento');
    editingEventoId = null;
    document.getElementById('modal-evento-title').textContent = 'Nuevo evento';
    loadEventos();
    state.evCache = (await sb('v_eventos', { filters:['estado=in.(Confirmado,Realizado,Cobrado)'], order:'fecha_evento' }));
    llenarSelectEventos();
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

let _cobroCtx = null;
let _dashData = null;

export function onCobroTipoChange() {
  const tipo = document.getElementById('cobro-tipo').value;
  document.getElementById('cobro-nota-wrap').style.display = tipo === 'Parcial' ? '' : 'none';
}

export async function registrarCobro(id, cliente, senaOk, saldoOk) {
  if (senaOk && saldoOk) { toast('Este evento ya está cobrado completo'); return; }

  const ev = (todosEventos || []).find(e => e.id === id);
  const totalEv = Number(ev?.total_ars) || 0;
  const esPagoTotal = ev?.modalidad_pago === 'Pago total al finalizar';

  // Buscar pendiente real desde pagos registrados
  const pagosEv = await sb('pagos', { filters: [`evento_id=eq.${id}`], limit: 100 });
  const totalPagado = pagosEv.reduce((s, p) => s + Number(p.monto_ars || 0), 0);
  const pendienteReal = Math.max(0, totalEv - totalPagado);
  const montosena = Number(ev?.sena_monto) || 0;

  _cobroCtx = { id, cliente, senaOk, saldoOk, totalEv, esPagoTotal, pendienteReal, montosena };

  // Armar opciones de tipo
  const sel = document.getElementById('cobro-tipo');
  sel.innerHTML = '';
  if (!esPagoTotal && !senaOk) sel.innerHTML += '<option value="Seña">Seña</option>';
  if (!saldoOk) sel.innerHTML += '<option value="Saldo">Saldo</option>';
  sel.innerHTML += '<option value="Parcial">Parcial</option>';

  const getMontoSug = (t) => t === 'Seña' ? montosena : t === 'Saldo' ? pendienteReal : 0;

  const fmtARS0 = v => v > 0 ? Number(v).toLocaleString('es-AR', { maximumFractionDigits: 0 }) : '';
  document.getElementById('cobro-monto').value = fmtARS0(getMontoSug(sel.value));
  document.getElementById('cobro-fecha').value = today();
  document.getElementById('cobro-nota').value = '';
  document.getElementById('cobro-nota-wrap').style.display = sel.value === 'Parcial' ? '' : 'none';
  document.getElementById('cobro-titulo').textContent = `Cobro — ${cliente}`;

  sel.onchange = () => {
    onCobroTipoChange();
    document.getElementById('cobro-monto').value = fmtARS0(getMontoSug(sel.value));
  };

  openModal('modal-cobro');
}

export async function confirmarCobro() {
  if (!_cobroCtx) return;
  const { id, cliente, senaOk, totalEv, montosena, esPagoTotal } = _cobroCtx;
  const tipo = document.getElementById('cobro-tipo').value;
  const monto = parseARSInput(document.getElementById('cobro-monto'));
  const fecha = document.getElementById('cobro-fecha').value || today();
  const nota = document.getElementById('cobro-nota').value.trim();

  if (!monto || monto <= 0) { toast('Ingresá un monto válido', 'err'); return; }

  try {
    await sbPost('pagos', {
      evento_id: id,
      tipo: tipo === 'Parcial' ? (nota || 'Parcial') : tipo,
      monto_ars: monto,
      fecha_cobro: fecha,
    });

    let patch = {};
    if (tipo === 'Seña') patch = { sena_cobrada: true, fecha_sena: fecha };
    else if (tipo === 'Saldo') patch = { saldo_cobrado: true, fecha_saldo: fecha, estado: 'Realizado' };
    // Parcial: si el monto cubre el saldo completo, marcar como cobrado
    else {
      if (!senaOk && monto >= montosena) patch = { sena_cobrada: true, fecha_sena: fecha };
      if (monto >= totalEv) patch = { ...patch, saldo_cobrado: true, fecha_saldo: fecha, estado: 'Realizado' };
    }
    if (esPagoTotal && tipo === 'Saldo') patch.estado = 'Realizado';

    if (Object.keys(patch).length) await sbPatch('eventos', id, patch);

    closeModal('modal-cobro');
    invalidateCache('pagos');
    invalidateCache('eventos');
    invalidateCache('v_pipeline');
    toast(`Cobro registrado para ${cliente}`);
    loadEventos();
    if (currentPage === 'dashboard') loadDashboard();
    if (currentPage === 'cobros') loadCobros();
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

// ── COBROS ────────────────────────────────────────────────
export async function loadCobros() {
  try {
    const cobros = await sbCached('v_cobros_pendientes');
    const total = cobros.reduce((s,c) => s + Number(c.pendiente_ars||0), 0);
    const eventos = cobros.length;

    document.getElementById('cobros-kpis').innerHTML = `
      <div class="kpi"><div class="kpi-label">Eventos con deuda</div><div class="kpi-value red">${eventos}</div></div>
      <div class="kpi"><div class="kpi-label">Total pendiente ARS</div><div class="kpi-value gold">${fmtARS(total)}</div></div>
    `;

    document.getElementById('cobros-tbody').innerHTML = cobros.length
      ? cobros.map(c => {
          const pct = c.total_ars > 0 ? Math.round((c.total_ars - c.pendiente_ars) / c.total_ars * 100) : 0;
          const vencido = c.fecha_evento && new Date(c.fecha_evento) < new Date(today()) && Number(c.pendiente_ars) > 0;
          return `<tr ${vencido ? 'style="background:rgba(255,80,80,0.08)"' : ''}>
            <td><b>${c.cliente_nombre}</b></td>
            <td>${c.tipo_evento || '—'}</td>
            <td>${fmtDate(c.fecha_evento)} ${vencido ? '<span style="color:var(--red);font-size:10px;font-weight:600">⚠ VENCIDO</span>' : ''}</td>
            <td>${fmtARS(c.total_ars)}</td>
            <td style="color:var(--red);font-weight:600">${fmtARS(c.pendiente_ars)}</td>
            <td>${c.modalidad_pago === 'Pago total al finalizar' ? '<span style="color:var(--text-3)">—</span>' : (c.sena_cobrada ? '✅' : '❌')}</td>
            <td>${c.saldo_cobrado ? '✅' : '❌'}</td>
            <td>
              <div class="cobro-bar" style="width:80px">
                <div class="cobro-fill" style="width:${pct}%"></div>
              </div>
              <div style="font-size:10px;color:var(--text-3);margin-top:2px">${pct}%</div>
            </td>
          </tr>`;
        }).join('')
      : `<tr><td colspan="9"><div class="empty"><div class="empty-icon">✅</div>Sin cobros pendientes. Todo al día.</div></td></tr>`;
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}


// Window assignments
window.toggleSort = toggleSort;
window.applySort = applySort;
window.sortClasses = sortClasses;
window.loadEventos = loadEventos;
window.renderEventos = renderEventos;
window.filterEventos = filterEventos;
window.buscarEventos = buscarEventos;
window.acFilter = acFilter;
window.acHide = acHide;
window.acSelect = acSelect;
window.renderClienteBenef = renderClienteBenef;
window.agregarBenefCliente = agregarBenefCliente;
window.renderSalonBenef = renderSalonBenef;
window.agregarBenefSalon = agregarBenefSalon;
window.editEvento = editEvento;
window.guardarEvento = guardarEvento;
window.onCobroTipoChange = onCobroTipoChange;
window.registrarCobro = registrarCobro;
window.confirmarCobro = confirmarCobro;
window.loadCobros = loadCobros;
