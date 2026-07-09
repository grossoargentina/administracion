import { state } from '../state';
import { jsPDF } from 'jspdf';
import { sb, sbPost, sbInsert, sbPatch, sbDelete, fmtARS, fmtDate, escHtml, calcularTotalConRecargos, today, formatTelefono, onTelefonoInput, formatDni, onDniInput, formatCuit, onCuitInput, badge, fmtInputARS, parseARSInput, toast, openModal, closeModal, LOGO_B64, buildTimeOpts, timeSelect, llenarSelectEventos, initDatePickers, renderHorariosEv, getHorariosEv } from '../helpers';
import { SB_URL, SB_KEY, FOLDER_LOGISTICAS, WA_EDGE_URL, EMAIL_EDGE_URL, EMAIL_SEGURO, DRIVE_FOLDER_ID, FOTOS_FOLDER_ID } from '../config';
import { sbCached, invalidateCache } from '../query-cache';

// ── CATÁLOGO ──────────────────────────────────────────────
// ── CLIENTES ────────────────────────────────────────────
let clienteEditId = null;

export async function loadClientes() {
  const tbody = document.getElementById('clientes-tbody');
  tbody.innerHTML = '<tr><td colspan="4" class="loading"><div class="spinner"></div></td></tr>';
  try {
    const [clientes, eventos] = await Promise.all([
      sbCached('clientes', { order: 'nombre', limit: 500 }),
      sbCached('eventos', { select: 'cliente_id', filters: ['cliente_id=not.is.null'], limit: 500 }),
    ]);
    const countMap = {};
    eventos.forEach(e => { countMap[e.cliente_id] = (countMap[e.cliente_id] || 0) + 1; });

    if (!clientes.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="padding:16px;text-align:center;color:var(--text-3);font-size:13px">No hay clientes registrados. Se crean automáticamente al confirmar presupuestos.</td></tr>';
      return;
    }
    tbody.innerHTML = clientes.map(c => `<tr>
      <td style="font-weight:600;font-size:13px">${c.nombre}</td>
      <td style="font-size:12px">${c.seguro_info ? '<span style="color:var(--green);font-size:11px">✓ Cargado</span>' : '<span style="color:var(--text-3)">—</span>'}</td>
      <td style="font-size:12px">${countMap[c.id] || 0}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="editarCliente(${c.id})">✏️ Editar</button></td>
    </tr>`).join('');
  } catch(e) { tbody.innerHTML = `<tr><td colspan="4" style="padding:16px;color:var(--red)">${e.message}</td></tr>`; }
}

export async function editarCliente(id) {
  clienteEditId = id;
  try {
    const rows = await sbCached('clientes', { filters: [`id=eq.${id}`], limit: 1 });
    const c = rows[0]; if (!c) return;
    document.getElementById('cliente-modal-title').textContent = c.nombre;
    document.getElementById('cliente-nombre').value  = c.nombre || '';
    try { state.clienteBeneficiarios = c.seguro_info ? JSON.parse(c.seguro_info) : []; } catch(e) { state.clienteBeneficiarios = []; }
    renderClienteBenef();
    openModal('modal-cliente');
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

export async function guardarCliente() {
  const nombre = document.getElementById('cliente-nombre').value.trim();
  if (!nombre) { toast('El nombre es obligatorio', 'err'); return; }
  const benefs = state.clienteBeneficiarios.filter(b => b.nombre || b.cuit);
  try {
    await sbPatch('clientes', clienteEditId, { nombre, seguro_info: benefs.length ? JSON.stringify(benefs) : null });
    closeModal('modal-cliente');
    invalidateCache('clientes');
    toast('Cliente actualizado');
    loadClientes();
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

export async function verSegurosEvento(eventoId) {
  try {
    const rows = await sbCached('eventos', { filters: [`id=eq.${eventoId}`], select: 'cliente_id,salon_id,cliente_nombre,venue', limit: 1 });
    const ev = rows[0]; if (!ev) return;

    const fetches = [];
    if (ev.cliente_id) fetches.push(sbCached('clientes', { filters: [`id=eq.${ev.cliente_id}`], select: 'nombre,seguro_info', limit: 1 }));
    else fetches.push(Promise.resolve([]));
    if (ev.salon_id) fetches.push(sbCached('salones', { filters: [`id=eq.${ev.salon_id}`], select: 'nombre,seguro_info', limit: 1 }));
    else fetches.push(Promise.resolve([]));

    const [clRows, slRows] = await Promise.all(fetches);
    const cliente = clRows[0];
    const salon   = slRows[0];

    const seccionBenef = (titulo, seguroInfo) => {
      let benefs = [];
      try { benefs = seguroInfo ? JSON.parse(seguroInfo) : []; } catch(e) {}
      const contenido = benefs.length
        ? `<ul style="margin:0;padding-left:18px;font-size:13px;color:var(--text-1);line-height:1.8">${benefs.map(b => `<li><strong>${b.nombre}</strong>${b.cuit ? ` — CUIT ${b.cuit}` : ''}</li>`).join('')}</ul>`
        : `<div style="color:var(--text-3);font-size:13px;font-style:italic">Sin beneficiarios cargados</div>`;
      return `<div>
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--text-2);margin-bottom:6px">${titulo}</div>
        <div style="background:var(--bg-3);border:1px solid var(--border);border-radius:8px;padding:12px">${contenido}</div>
      </div>`;
    };

    document.getElementById('modal-seguros-body').innerHTML =
      seccionBenef(`🏛️ Salón — ${salon?.nombre || ev.venue || '—'}`, salon?.seguro_info) +
      seccionBenef(`👤 Cliente — ${cliente?.nombre || ev.cliente_nombre || '—'}`, cliente?.seguro_info);

    openModal('modal-seguros-evento');
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

// ── SALONES ─────────────────────────────────────────────
let salonEditId = null;

export async function loadSalones() {
  const tbody = document.getElementById('salones-tbody');
  tbody.innerHTML = '<tr><td colspan="5" class="loading"><div class="spinner"></div></td></tr>';
  try {
    const [salones, eventos] = await Promise.all([
      sbCached('salones', { order: 'nombre', limit: 200 }),
      sbCached('eventos', { select: 'salon_id', filters: ['salon_id=not.is.null'], limit: 500 }),
    ]);
    const countMap = {};
    eventos.forEach(e => { countMap[e.salon_id] = (countMap[e.salon_id] || 0) + 1; });

    if (!salones.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="padding:16px;text-align:center;color:var(--text-3);font-size:13px">No hay salones registrados aún. Se crean automáticamente al confirmar presupuestos.</td></tr>';
      return;
    }
    tbody.innerHTML = salones.map(s => `<tr>
      <td style="font-weight:600;font-size:13px">${s.nombre}</td>
      <td style="font-size:12px;color:var(--text-2)">${s.direccion || '<span style="color:var(--text-3)">—</span>'}</td>
      <td style="font-size:12px;color:var(--text-2);max-width:280px;white-space:pre-wrap">${s.seguro_info ? `<span style="color:var(--green);font-size:11px">✓ Cargado</span>` : '<span style="color:var(--text-3)">—</span>'}</td>
      <td style="font-size:12px">${countMap[s.id] || 0}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="editarSalon(${s.id})">✏️ Editar</button></td>
    </tr>`).join('');
  } catch(e) { tbody.innerHTML = `<tr><td colspan="5" style="padding:16px;color:var(--red)">${e.message}</td></tr>`; }
}

export async function editarSalon(id) {
  salonEditId = id;
  try {
    const rows = await sbCached('salones', { filters: [`id=eq.${id}`], limit: 1 });
    const s = rows[0];
    if (!s) return;
    document.getElementById('salon-modal-title').textContent = s.nombre;
    document.getElementById('salon-nombre').value    = s.nombre || '';
    document.getElementById('salon-direccion').value = s.direccion || '';
    try { state.salonBeneficiarios = s.seguro_info ? JSON.parse(s.seguro_info) : []; } catch(e) { state.salonBeneficiarios = []; }
    renderSalonBenef();
    openModal('modal-salon');
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

export async function guardarSalon() {
  const nombre   = document.getElementById('salon-nombre').value.trim();
  const direccion = document.getElementById('salon-direccion').value.trim();
  if (!nombre) { toast('El nombre es obligatorio', 'err'); return; }
  const benefs = state.salonBeneficiarios.filter(b => b.nombre || b.cuit);
  try {
    await sbPatch('salones', salonEditId, { nombre, direccion: direccion || null, seguro_info: benefs.length ? JSON.stringify(benefs) : null });
    invalidateCache('salones');
    closeModal('modal-salon');
    toast('Salón actualizado');
    loadSalones();
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

export async function upsertClienteYSalon(clienteNombre, salonNombre) {
  let clienteId = null, salonId = null;
  try {
    // Cliente: buscar por nombre (case-insensitive) o crear
    const clExist = await sb('clientes', { filters: [`nombre=ilike.${clienteNombre}`], select: 'id', limit: 1 });
    if (clExist.length) {
      clienteId = clExist[0].id;
    } else {
      const newCl = await sbPost('clientes', { nombre: clienteNombre });
      clienteId = Array.isArray(newCl) ? newCl[0]?.id : newCl?.id;
    }
  } catch(e) { console.warn('Error upsert cliente:', e.message); }
  try {
    if (salonNombre) {
      const slExist = await sb('salones', { filters: [`nombre=ilike.${salonNombre}`], select: 'id', limit: 1 });
      if (slExist.length) {
        salonId = slExist[0].id;
      } else {
        const newSl = await sbPost('salones', { nombre: salonNombre });
        salonId = Array.isArray(newSl) ? newSl[0]?.id : newSl?.id;
      }
    }
  } catch(e) { console.warn('Error upsert salon:', e.message); }
  return { clienteId, salonId };
}

export async function loadCatalogo() {
  document.getElementById('cat-tbody').innerHTML = '<tr><td colspan="5" class="loading"><div class="spinner"></div></td></tr>';
  try {
    const lista = await sbCached('catalogo', { select: 'id,codigo,categoria,producto,descripcion,precio_ars,activo,tiene_foto', filters:['activo=eq.true'], order:'categoria,codigo' });
    const cats = [...new Set(lista.map(i => i.categoria))];

    // Botones de filtro por categoría
    document.getElementById('cat-filters').innerHTML =
      `<button class="filter-btn active" onclick="filterCat('todos',this)">Todos (${lista.length})</button>` +
      cats.map(c => `<button class="filter-btn" onclick="filterCat('${c}',this)">${c}</button>`).join('');

    window._catLista = lista;
    renderCatalogo('todos');
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

export async function abrirModalProductoById(id) {
  const base = (window._catLista || []).find(i => String(i.id) === String(id));
  // Cargar foto_base64 solo ahora, bajo demanda
  let item = base ? { ...base } : { id };
  try {
    const rows = await sbCached('catalogo', { select: 'foto_base64', filters: [`id=eq.${id}`], limit: 1 });
    if (rows[0]?.foto_base64) item.foto_base64 = rows[0].foto_base64;
  } catch(e) { /* sin foto */ }
  abrirModalProducto(item);
}

export function abrirModalProducto(item) {
  document.getElementById('producto-id').value = item?.id || '';
  document.getElementById('producto-modal-title').textContent = item ? 'Editar producto' : 'Nuevo producto';
  document.getElementById('producto-codigo').value = item?.codigo || '';
  document.getElementById('producto-categoria').value = item?.categoria || '';
  document.getElementById('producto-nombre').value = item?.producto || '';
  document.getElementById('producto-descripcion').value = item?.descripcion || '';
  document.getElementById('producto-precio').value = item?.precio_ars > 0 ? Number(item.precio_ars).toLocaleString('es-AR', { maximumFractionDigits: 0 }) : '';
  // Reset foto
  document.getElementById('producto-foto-input').value = '';
  window._fotoBlob = null;
  const preview = document.getElementById('producto-foto-preview');
  const status  = document.getElementById('producto-foto-status');
  if (item?.foto_base64) {
    preview.src = item.foto_base64;
    preview.style.display = 'block';
    status.textContent = 'Foto actual — subí una nueva para reemplazarla';
    document.getElementById('producto-foto-label').querySelector('span').textContent = '📷 Cambiar imagen';
  } else {
    preview.style.display = 'none';
    preview.src = '';
    status.textContent = '';
    document.getElementById('producto-foto-label').querySelector('span').textContent = '📷 Subir imagen';
  }
  // Sugerir categorías existentes
  const cats = [...new Set((window._catLista || []).map(i => i.categoria))];
  document.getElementById('cat-datalist').innerHTML = cats.map(c => `<option value="${c}">`).join('');
  openModal('modal-producto');
}

export function previewFotoProducto(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      // Convertir a JPG via canvas, max 800px
      const MAX = 800;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else { w = Math.round(w * MAX / h); h = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob => {
        window._fotoBlob = blob;
        const preview = document.getElementById('producto-foto-preview');
        preview.src = URL.createObjectURL(blob);
        preview.style.display = 'block';
        document.getElementById('producto-foto-label').querySelector('span').textContent = '✅ ' + file.name;
        document.getElementById('producto-foto-status').textContent = `${w}×${h}px · ${(blob.size/1024).toFixed(0)} KB → se guardará como {CÓDIGO}.jpg`;
      }, 'image/jpeg', 0.85);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

export function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = e => res(e.target.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

export async function subirFotoProducto(codigo) {
  if (!window._fotoBlob) return;
  const token = await getDriveToken();
  if (!token) { toast('Sin acceso a Drive para subir foto', 'err'); return; }
  const nombre = `${codigo}.jpg`;
  // Buscar si ya existe para sobreescribir
  try {
    const listRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=name='${nombre}'+and+'${FOTOS_FOLDER_ID}'+in+parents+and+trashed=false&fields=files(id)`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const listData = await listRes.json();
    const existente = listData.files?.[0];
    if (existente) {
      // Actualizar archivo existente
      await fetch(`https://www.googleapis.com/upload/drive/v3/files/${existente.id}?uploadType=media`,
        { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' }, body: window._fotoBlob });
    } else {
      // Crear nuevo
      const meta = { name: nombre, parents: [FOTOS_FOLDER_ID], mimeType: 'image/jpeg' };
      const fd = new FormData();
      fd.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
      fd.append('file', window._fotoBlob, nombre);
      await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
        { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
    }
    catalogoCache = [];
  } catch(e) { toast('Error subiendo foto: ' + e.message, 'err'); }
}

export async function guardarProducto() {
  const id       = document.getElementById('producto-id').value;
  const categoria= document.getElementById('producto-categoria').value.trim();
  const producto = document.getElementById('producto-nombre').value.trim();
  const descripcion = document.getElementById('producto-descripcion').value.trim();
  const precio_ars = parseARSInput(document.getElementById('producto-precio'));
  if (!categoria || !producto || !precio_ars) { toast('Completá los campos obligatorios', 'err'); return; }
  try {
    let targetId = id;
    if (id) {
      const codigo = document.getElementById('producto-codigo').value.trim();
      await sbPatch('catalogo', id, { codigo, categoria, producto, descripcion, precio_ars });
    } else {
      const todos = await sb('catalogo', { select: 'id', limit: 1000 });
      const codigo = String(todos.length + 1);
      const inserted = await sbInsert('catalogo', { codigo, categoria, producto, descripcion, precio_ars, activo: true });
      targetId = Array.isArray(inserted) ? inserted[0]?.id : inserted?.id;
    }
    if (window._fotoBlob && targetId) {
      const b64 = await blobToBase64(window._fotoBlob);
      await sbPatch('catalogo', targetId, { foto_base64: b64, tiene_foto: true });
    }
    closeModal('modal-producto');
    catalogoCache = [];
    invalidateCache('catalogo');
    toast(id ? '✅ Producto actualizado' : '✅ Producto agregado');
    loadCatalogo();
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

export async function eliminarProducto(id) {
  if (!confirm('¿Eliminar este producto del catálogo?')) return;
  try {
    await sbPatch('catalogo', id, { activo: false });
    catalogoCache = [];
    invalidateCache('catalogo');
    toast('Producto eliminado');
    loadCatalogo();
  } catch(e) { toast('Error: ' + e.message, 'err'); }
}

let catFiltroActual = 'todos';
let catBusqueda = '';

export function filterCat(cat, btn) {
  catFiltroActual = cat;
  document.querySelectorAll('#cat-filters .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderCatalogo(cat);
}

export function buscarCatalogo(valor) {
  catBusqueda = valor;
  renderCatalogo(catFiltroActual);
}

export function initThumbObserver() {
  if (window._thumbObserver) window._thumbObserver.disconnect();
  window._thumbObserver = new IntersectionObserver(async (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target;
      const id = el.dataset.id;
      if (!id || el.dataset.loaded) continue;
      el.dataset.loaded = '1';
      window._thumbObserver.unobserve(el);
      try {
        const rows = await sbCached('catalogo', { select: 'foto_base64', filters: [`id=eq.${id}`], limit: 1 });
        if (rows[0]?.foto_base64) {
          el.innerHTML = '';
          const img = document.createElement('img');
          img.src = rows[0].foto_base64;
          img.style.cssText = 'width:100%;height:100%;object-fit:cover';
          el.appendChild(img);
        } else {
          el.textContent = '📷';
        }
      } catch(e) { el.textContent = '📷'; }
    }
  }, { rootMargin: '100px' });

  document.querySelectorAll('[data-id][data-thumb]').forEach(el => window._thumbObserver.observe(el));
}

export function renderCatalogo(cat) {
  let lista = cat === 'todos' ? window._catLista : window._catLista.filter(i => i.categoria === cat);
  if (catBusqueda.trim()) {
    const q = catBusqueda.trim().toLowerCase();
    lista = lista.filter(i => (i.producto || '').toLowerCase().includes(q) || String(i.codigo || '').toLowerCase().includes(q));
  }
  lista = applySort('cat', lista);
  const catActual = cat;
  document.getElementById('cat-tbody').innerHTML = lista.map(i => `<tr>
    <td style="color:var(--text-3);font-size:12px">${i.codigo || i.id}</td>
    <td><span style="font-size:11px;color:var(--gold)">${i.categoria}</span></td>
    <td>
      <div style="display:flex;align-items:center;gap:10px">
        <div ${i.tiene_foto ? `data-id="${i.id}" data-thumb="1"` : ''} style="width:40px;height:40px;border-radius:6px;border:1px solid var(--border);flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center;color:var(--text-3);font-size:16px;background:var(--bg-2)">${i.tiene_foto ? '⏳' : '📷'}</div>
        <div>
          <div style="font-weight:500">${i.producto}</div>
          <div style="font-size:11px;color:var(--text-3);margin-top:2px">${(i.descripcion||'').substring(0,80)}${(i.descripcion||'').length>80?'…':''}</div>
        </div>
      </div>
    </td>
    <td style="font-weight:600;color:var(--gold)">${fmtARS(i.precio_ars)}</td>
    <td style="white-space:nowrap">
      <button class="btn btn-ghost btn-sm" onclick="abrirModalProductoById('${i.id}')">✏️</button>
      <button class="btn btn-ghost btn-sm" onclick="eliminarProducto('${i.id}')" style="color:var(--red)">✕</button>
    </td>
  </tr>`).join('');
  initThumbObserver();
}



// ── CARGAR FOTOS DESDE DRIVE ──────────────────────────────
// ══════════════════════════════════════════════════════════
// MÓDULO PRESUPUESTOS
// ══════════════════════════════════════════════════════════

// LOGO_B64 imported from helpers.js

let presItems = [];       // items seleccionados
let catalogoCache = [];   // catálogo completo

// ── CONFIRMAR PRESUPUESTO → crea evento en pipeline ─────
let _confirmarPresupuestoCtx = null; // { id, p } — presupuesto pendiente de confirmar en el modal

export async function confirmarPresupuesto(id) {
  const p = (window._presupLista || []).find(p => p.id === id);
  if (!p) { toast('No se encontró el presupuesto', 'err'); return; }
  _confirmarPresupuestoCtx = { id, p };
  document.getElementById('confirmar-pres-cliente').textContent = p.cliente || '';
  document.getElementById('confirmar-iva').checked = false;
  document.getElementById('confirmar-pago-diferido').checked = false;
  actualizarTotalConfirmarPresupuesto();
  openModal('modal-confirmar-presupuesto');
  // Inicializar flatpickr con las fechas ya guardadas en el presupuesto
  setTimeout(() => {
    let fechasIniciales = [];
    try { fechasIniciales = p.fechas_evento ? (Array.isArray(p.fechas_evento) ? p.fechas_evento : JSON.parse(p.fechas_evento)) : []; } catch(e) {}
    if (!fechasIniciales.length && p.fecha_evento) fechasIniciales = [p.fecha_evento];
    initDatePickers(document.getElementById('modal-confirmar-presupuesto'));
    const fp = document.getElementById('confirmar-fechas')._flatpickr;
    if (fp && fechasIniciales.length) fp.setDate(fechasIniciales);
  }, 50);
}

export function actualizarTotalConfirmarPresupuesto() {
  if (!_confirmarPresupuestoCtx) return;
  const base       = _confirmarPresupuestoCtx.p.total_ars || 0;
  const incluyeIva = document.getElementById('confirmar-iva').checked;
  const diferido   = document.getElementById('confirmar-pago-diferido').checked;
  document.getElementById('confirmar-subtotal').textContent    = fmtARS(base);
  document.getElementById('confirmar-total-final').textContent = fmtARS(calcularTotalConRecargos(base, incluyeIva, diferido));
}

export async function confirmarPresupuestoFinal() {
  if (!_confirmarPresupuestoCtx) return;
  const ctx = _confirmarPresupuestoCtx;
  _confirmarPresupuestoCtx = null; // bloquear re-entradas inmediatamente
  const btn = document.querySelector('#modal-confirmar-presupuesto .btn-primary') as HTMLButtonElement;
  if (btn) { btn.disabled = true; btn.textContent = 'Confirmando...'; }
  const { id, p } = ctx;
  const cliente      = p.cliente || '';
  const tipo         = p.tipo_evento || '';
  const venue        = p.venue || '';
  const montoBase    = p.total_ars || 0;
  const modalidad    = p.modalidad || 'Pago total al finalizar';
  const senaMonto    = p.sena_monto || 0;
  const incluyeIva   = document.getElementById('confirmar-iva').checked;
  const pagoDiferido = document.getElementById('confirmar-pago-diferido').checked;
  const total        = calcularTotalConRecargos(montoBase, incluyeIva, pagoDiferido);
  // Leer fechas desde el flatpickr del modal de confirmación
  const fpConfirmar = document.getElementById('confirmar-fechas')._flatpickr;
  let fechasEvento = fpConfirmar ? fpConfirmar.selectedDates.map(d => d.toISOString().slice(0,10)).sort() : [];
  if (!fechasEvento.length) {
    try { fechasEvento = p.fechas_evento ? (Array.isArray(p.fechas_evento) ? p.fechas_evento : JSON.parse(p.fechas_evento)) : []; } catch(e) {}
  }
  const fecha = fechasEvento[0] || p.fecha_evento || null;

  
  closeModal('modal-confirmar-presupuesto');

  try {
    // Verificar en DB que no fue confirmado ya (previene duplicados por doble click o lag)
    const fresh = await sb('presupuestos', { filters: [`id=eq.${id}`], select: 'evento_id,estado_evento', limit: 1 });
    if (fresh[0]?.evento_id) {
      toast('Este presupuesto ya fue confirmado');
      loadPresupuestos();
      return;
    }

    // Generar código de evento
    const evCount = await sb('eventos', { select: 'id' });
    const codigo  = 'EV' + String(evCount.length + 1).padStart(3,'0');

    const esPagoTotal = modalidad === 'Pago total al finalizar';

    // Crear evento en pipeline
    const nuevoEv = await sbPost('eventos', {
      codigo,
      estado:          'Confirmado',
      cliente_nombre:  cliente,
      tipo_evento:     tipo || '',
      venue:           venue || '',
      monto_base_ars:  montoBase,
      incluye_iva:     incluyeIva,
      pago_diferido:   pagoDiferido,
      total_ars:       total || 0,
      sena_monto:      esPagoTotal ? 0 : (senaMonto || 0),
      modalidad_pago:  modalidad || 'Pago total al finalizar',
      sena_cobrada:    esPagoTotal ? true : false,
      saldo_cobrado:   false,
      created_at:      new Date().toISOString(),
      updated_at:      new Date().toISOString(),
    });

    // Actualizar estado del presupuesto y vincular evento
    await sbPatch('presupuestos', id, {
      estado_evento: 'Confirmado',
      evento_id:     (Array.isArray(nuevoEv) ? nuevoEv[0]?.id : nuevoEv?.id) || null,
    });

    // Descartar el resto de las versiones del mismo grupo, si las hay
    const confirmado = (window._presupLista || []).find(p => p.id === id);
    if (confirmado) {
      const root = grupoRootId(confirmado);
      const hermanas = (window._presupLista || []).filter(p =>
        p.id !== id && grupoRootId(p) === root && (p.estado_evento || 'Pendiente') === 'Pendiente');
      for (const h of hermanas) {
        await sbPatch('presupuestos', h.id, { estado_evento: 'Descartada' });
      }
    }

    const eventoId = (Array.isArray(nuevoEv) ? nuevoEv[0]?.id : nuevoEv?.id) || null;

    // Upsert cliente y salón, vincularlos al evento
    if (eventoId) {
      const { clienteId, salonId } = await upsertClienteYSalon(cliente, venue);
      if (clienteId || salonId) {
        const patch = {};
        if (clienteId) patch.cliente_id = clienteId;
        if (salonId)   patch.salon_id   = salonId;
        await sbPatch('eventos', eventoId, patch);
      }
    }

    // Crear las 3 logísticas automáticas: Armado, Evento, Desarme
    if (eventoId) {
      const fechas = fechasEvento.length ? fechasEvento : (fecha ? [fecha] : []);

      const tiposLog = [
        { tipo: 'Armado',   jornadaTipo: 'Armado',    fecha: fechas[0] || null },
        { tipo: 'Evento',   jornadaTipo: 'Operador',  fecha: null }, // una jornada por fecha
        { tipo: 'Desarme',  jornadaTipo: 'Desarme',   fecha: fechas[0] || null },
      ];

      for (const tl of tiposLog) {
        const logRow = await sbPost('logisticas', {
          tipo: tl.tipo,
          evento_id: eventoId,
          notas: `Logística automática — ${venue || cliente}`,
          created_at: new Date().toISOString(),
        });
        const logId = Array.isArray(logRow) ? logRow[0]?.id : logRow?.id;
        if (!logId) continue;

        await sbPost('logistica_eventos', { logistica_id: logId, evento_id: eventoId });

        if (tl.tipo === 'Evento') {
          // Una jornada Operador por cada fecha del evento
          const jornadasOp = fechas.map((f, i) => ({
            codigo: `J${Date.now()}-op${i}`,
            logistica_id: logId,
            tipo: 'Operador',
            fecha: f || null,
            pagado: false,
          }));
          if (jornadasOp.length) await sbPost('jornadas', jornadasOp);
        } else {
          // Una jornada de Armado o Desarme
          await sbPost('jornadas', [{
            codigo: `J${Date.now()}-${tl.jornadaTipo.toLowerCase()}`,
            logistica_id: logId,
            tipo: tl.jornadaTipo,
            fecha: tl.fecha,
            pagado: false,
          }]);
        }
      }
    }

    invalidateCache('presupuestos');
    invalidateCache('eventos');
    invalidateCache('jornadas');
    toast(`✅ Evento ${codigo} creado como Confirmado`);
    loadPresupuestos();
    // Actualizar caché de eventos
    state.evCache = (await sb('v_eventos', { filters:['estado=in.(Confirmado,Realizado,Cobrado)'], order:'fecha_evento' }));
    llenarSelectEventos();
  } catch(e) {
    toast('Error: ' + e.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✅ Confirmar'; }
  }
}

// ── PERDER PRESUPUESTO ────────────────────────────────────
export async function perderPresupuesto(id, cliente) {
  const motivos = [
    'Precio', 'Ya tenía proveedor', 'No respondió',
    'Fecha no disponible', 'Canceló el evento', 'Otro'
  ];
  const motivo = prompt(
    `¿Por qué se perdió el presupuesto de ${cliente}?\n\n` +
    motivos.map((m,i) => `${i+1}. ${m}`).join('\n') +
    '\n\nIngresá el número o escribí el motivo:'
  );
  if (!motivo) return;

  const motivoTexto = motivos[parseInt(motivo) - 1] || motivo;

  try {
    // Crear evento perdido en pipeline
    const evCount = await sb('eventos', { select: 'id' });
    const codigo  = 'EV' + String(evCount.length + 1).padStart(3,'0');

    await sbPost('eventos', {
      codigo,
      estado:         'Perdido',
      cliente_nombre: cliente,
      motivo_perdida: motivoTexto,
      created_at:     new Date().toISOString(),
      updated_at:     new Date().toISOString(),
    });

    // Actualizar estado del presupuesto
    await sbPatch('presupuestos', id, {
      estado_evento: 'Perdido',
    });

    invalidateCache('presupuestos');
    invalidateCache('eventos');
    toast(`Presupuesto marcado como perdido — ${motivoTexto}`);
    loadPresupuestos();
  } catch(e) {
    toast('Error: ' + e.message, 'err');
  }
}

// ── CARGAR LISTA DE PRESUPUESTOS ─────────────────────────
export function grupoRootId(p) { return p.grupo_id || p.id; }

export async function loadPresupuestos() {
  document.getElementById('presup-tbody').innerHTML = '<tr><td colspan="9" class="loading"><div class="spinner"></div></td></tr>';
  try {
    const lista = await sbCached('presupuestos', { order: 'created_at.desc', limit: 100 });
    window._presupLista = lista;

    // Ordenar grupos: por sort state si aplica, sino más reciente primero
    const grupos = {};
    lista.forEach(p => {
      const root = grupoRootId(p);
      if (!grupos[root]) grupos[root] = [];
      grupos[root].push(p);
    });
    const s = state._sortState['pres'];
    const rootsOrdenados = Object.keys(grupos).sort((a, b) => {
      const pa = grupos[a][0], pb = grupos[b][0];
      if (s) {
        const cmp = String(pa[s.campo] ?? '').localeCompare(String(pb[s.campo] ?? ''), 'es-AR', { numeric: true, sensitivity: 'base' });
        return s.dir === 'asc' ? cmp : -cmp;
      }
      const maxA = Math.max(...grupos[a].map(p => new Date(p.created_at).getTime()));
      const maxB = Math.max(...grupos[b].map(p => new Date(p.created_at).getTime()));
      return maxB - maxA;
    });

    const filas = [];
    rootsOrdenados.forEach(root => {
      const versiones = grupos[root].sort((a, b) => (a.version || 1) - (b.version || 1));
      versiones.forEach((p, idx) => {
        const estado = p.estado_evento || 'Pendiente';
        const estadoColor = estado === 'Confirmado' ? 'var(--green)'
          : estado === 'Perdido' ? 'var(--red)'
          : estado === 'Descartada' ? 'var(--text-3)' : 'var(--text-3)';
        const esPrimeraDelGrupo = idx === 0;
        const borderTop = esPrimeraDelGrupo && versiones.length > 1 ? 'border-top:2px solid var(--border)' : '';
        filas.push(`<tr style="${borderTop}">
            <td style="color:var(--text-2);font-size:12px">${fmtDate(p.created_at?.split('T')[0])}</td>
            <td style="font-weight:600;color:var(--gold)">${p.numero}</td>
            <td style="font-size:12px;color:var(--text-2)">v${p.version || 1}</td>
            <td><b>${p.cliente}</b></td>
            <td>${p.tipo_evento || '—'}</td>
            <td style="font-weight:600">${fmtARS(p.total_ars)}</td>
            <td style="font-size:12px;color:var(--text-2)">${p.modalidad || '—'}</td>
            <td style="font-size:12px;font-weight:600;color:${estadoColor}">${estado}</td>
            <td>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                ${p.pdf_url ? `<a href="${p.pdf_url}" target="_blank" class="btn btn-ghost btn-sm">PDF</a>` : ''}
                ${estado === 'Pendiente' ? `
                  <button class="btn btn-sm" style="background:rgba(46,204,113,.15);color:var(--green);border:1px solid rgba(46,204,113,.3)"
                    onclick="confirmarPresupuesto(${p.id})">
                    ✅ Confirmar
                  </button>
                  <button class="btn btn-ghost btn-sm" onclick="nuevaVersionPresupuesto(${p.id})">+ Nueva versión</button>
                  <button class="btn btn-sm btn-danger"
                    onclick="perderPresupuesto(${p.id},'${p.cliente.replace(/'/g,"\\'")}')">
                    ❌ Perder
                  </button>` : ''}
              </div>
            </td>
          </tr>`);
      });
    });

    document.getElementById('presup-tbody').innerHTML = filas.length
      ? filas.join('')
      : `<tr><td colspan="8"><div class="empty"><div class="empty-icon">📄</div>Sin presupuestos aún. Creá el primero.</div></td></tr>`;
  } catch(e) {
    document.getElementById('presup-tbody').innerHTML =
      `<tr><td colspan="8"><div class="empty"><div class="empty-icon">📄</div>Sin presupuestos aún.</div></td></tr>`;
  }
}

// ── ABRIR MODAL PRESUPUESTO ──────────────────────────────
let presVersionInfo = null; // { grupoId, nextVersion } cuando se está creando una nueva versión

export async function abrirModalPresupuesto() {
  presVersionInfo = null;
  document.querySelector('#modal-presupuesto .modal-title').textContent = 'Nuevo presupuesto';
  presItems = [];
  renderItemsPresup();
  calcularTotal();

  // Cargar catálogo si no está en cache
  if (!catalogoCache.length) {
    catalogoCache = await sbCached('catalogo', { filters:['activo=eq.true'], order:'categoria,codigo' });
  }

  // Llenar filtro de categorías
  const cats = [...new Set(catalogoCache.map(i => i.categoria))];
  const sel = document.getElementById('pres-cat-filtro');
  sel.innerHTML = '<option value="">Todas las categorías</option>' +
    cats.map(c => `<option value="${c}">${c}</option>`).join('');

  // Número automático
  try {
    const count = await sb('presupuestos', { select: 'id' });
    // Resetear modalidad y mostrar seña
  document.getElementById('pres-modalidad').value = 'Pago total al finalizar';
  toggleSena('Pago total al finalizar');

  document.getElementById('pres-numero').value =
      new Date().getFullYear() + '-' + String(count.length + 1).padStart(3,'0');
  } catch(e) {
    // Resetear modalidad y mostrar seña
  document.getElementById('pres-modalidad').value = 'Pago total al finalizar';
  toggleSena('Pago total al finalizar');

  document.getElementById('pres-numero').value = new Date().getFullYear() + '-001';
  }

  document.getElementById('pres-buscar').value = '';
  filtrarCatalogoPres();

  // Inicializar flatpickr multi-fecha (o limpiar si ya existe)
  const fpEl = document.getElementById('pres-fechas');
  if (fpEl._flatpickr) {
    fpEl._flatpickr.clear();

  } else {
    flatpickr(fpEl, {
      mode: 'multiple',
      locale: 'es',
      dateFormat: 'Y-m-d',
      altInput: true,
      altFormat: 'j M Y',
      conjunction: ', ',
    });
  }

  // Poblar autocomplete de cliente y venue
  try {
    const [clientes, salones] = await Promise.all([
      sbCached('clientes', { select: 'nombre', order: 'nombre', limit: 500 }),
      sbCached('salones',  { select: 'nombre', order: 'nombre', limit: 500 }),
    ]);
    state._acData['pres-cliente'] = clientes.map(c => c.nombre);
    state._acData['pres-venue']   = salones.map(s => s.nombre);
  } catch(e) { /* no bloquear si falla */ }

  openModal('modal-presupuesto');
}

// ── NUEVA VERSIÓN DE UN PRESUPUESTO EXISTENTE ────────────
export async function nuevaVersionPresupuesto(id) {
  const base = (window._presupLista || []).find(p => p.id === id);
  if (!base) return;
  const root = grupoRootId(base);
  const versiones = (window._presupLista || []).filter(p => grupoRootId(p) === root);
  const nextVersion = Math.max(...versiones.map(p => p.version || 1)) + 1;

  await abrirModalPresupuesto();

  presVersionInfo = { grupoId: root, nextVersion };
  document.querySelector('#modal-presupuesto .modal-title').textContent = `Nueva versión — v${nextVersion}`;

  document.getElementById('pres-numero').value   = base.numero;
  document.getElementById('pres-cliente').value  = base.cliente || '';
  document.getElementById('pres-tipo').value     = base.tipo_evento || 'Casamiento';
  // Cargar fechas guardadas en el flatpickr multi-fecha
  const fpPres = document.getElementById('pres-fechas')._flatpickr;
  if (fpPres) {
    fpPres.clear();
    const fechasGuardadas = base.fechas_evento
      ? (Array.isArray(base.fechas_evento) ? base.fechas_evento : JSON.parse(base.fechas_evento))
      : (base.fecha_evento ? [base.fecha_evento] : []);
    if (fechasGuardadas.length) {
      fpPres.setDate(fechasGuardadas);
      const horariosGuardados = base.horarios_evento
        ? (Array.isArray(base.horarios_evento) ? base.horarios_evento : JSON.parse(base.horarios_evento))
        : [];
    }
  }
  document.getElementById('pres-venue').value    = base.venue || '';
  document.getElementById('pres-modalidad').value = base.modalidad || 'Pago total al finalizar';
  toggleSena(base.modalidad || 'Pago total al finalizar');
  const presSenaMonto = base.sena_monto || 0;
  document.getElementById('pres-sena').value = presSenaMonto > 0 ? presSenaMonto.toLocaleString('es-AR', { maximumFractionDigits: 0 }) : '';

  try {
    const items = await sbCached('presupuesto_items', { filters: [`presupuesto_id=eq.${id}`], limit: 200 });
    presItems = items.map(it => ({
      id: it.catalogo_id || ('C' + it.id),
      producto: it.producto,
      descripcion: it.descripcion || '',
      foto_base64: it.foto_base64 || null,
      categoria: it.categoria || 'OTROS',
      precio: Number(it.precio_ars) || 0,
      cantidad: it.cantidad || 1,
      esCustom: !!it.es_custom,
    }));
    renderItemsPresup();
    calcularTotal();
    filtrarCatalogoPres();
  } catch(e) { toast('No se pudieron cargar los ítems de la versión anterior', 'err'); }
}

// ── FILTRAR CATÁLOGO EN EL MODAL ─────────────────────────

export function filtrarCatalogoPres() {
  const q    = document.getElementById('pres-buscar').value.toLowerCase();
  const cat  = document.getElementById('pres-cat-filtro').value;
  const lista = catalogoCache.filter(i =>
    (!cat || i.categoria === cat) &&
    (!q || i.producto.toLowerCase().includes(q) || (i.descripcion||'').toLowerCase().includes(q)) &&
    !presItems.some(p => String(p.id) === String(i.id) && !p.esCustom)
  );

  const wrap = document.getElementById('pres-catalogo-lista');
  if (!lista.length) {
    wrap.innerHTML = '<div style="padding:16px;text-align:center;color:var(--text-3);font-size:12px">Sin resultados</div>';
    return;
  }

  wrap.innerHTML = lista.map(item => {
    const yaAgregado = presItems.some(p => String(p.id) === String(item.id) && !p.esCustom);
    return `<div style="display:flex;align-items:center;justify-content:space-between;
                        padding:10px 14px;border-bottom:1px solid var(--border);
                        ${yaAgregado ? 'opacity:.5' : ''}">
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.producto}</div>
        <div style="font-size:10px;color:var(--text-3)">${item.categoria} · ${fmtARS(item.precio_ars)}</div>
      </div>
      <button class="btn btn-ghost btn-sm" ${yaAgregado ? 'disabled' : ''}
        onclick="agregarItemCatalogo('${item.id}')">
        ${yaAgregado ? '✓' : '+ Agregar'}
      </button>
    </div>`;
  }).join('');
}

// ── AGREGAR ITEM DESDE CATÁLOGO ──────────────────────────
export function agregarItemCatalogo(id) {
  const cat = catalogoCache.find(c => String(c.id) === String(id));
  if (!cat) return;
  presItems.push({
    id: cat.id, producto: cat.producto, descripcion: cat.descripcion || '',
    precio: cat.precio_ars, cantidad: 1, esCustom: false, categoria: cat.categoria,
  });
  renderItemsPresup();
  calcularTotal();
  filtrarCatalogoPres(); // actualizar botones
}

// ── AGREGAR ITEM PERSONALIZADO ───────────────────────────
let _customFotoB64 = null;

export function onCustomFotoChange(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    _customFotoB64 = e.target.result;
    const preview = document.getElementById('pres-custom-foto-preview');
    preview.innerHTML = `<img src="${_customFotoB64}" style="width:100%;height:100%;object-fit:cover">`;
  };
  reader.readAsDataURL(file);
}

export function agregarItemCustom() {
  const nombre = document.getElementById('pres-custom-nombre').value.trim();
  const desc   = document.getElementById('pres-custom-desc').value.trim();
  const precio = parseARSInput(document.getElementById('pres-custom-precio')) || 0;
  if (!nombre) { toast('Ingresá un título para el ítem', 'err'); return; }
  presItems.push({ id: 'C' + Date.now(), producto: nombre, descripcion: desc, foto_base64: _customFotoB64 || null, precio, cantidad: 1, esCustom: true, categoria: 'PERSONALIZADO' });
  document.getElementById('pres-custom-nombre').value = '';
  document.getElementById('pres-custom-desc').value   = '';
  document.getElementById('pres-custom-precio').value = '';
  document.getElementById('pres-custom-foto').value   = '';
  document.getElementById('pres-custom-foto-preview').innerHTML = '📷';
  _customFotoB64 = null;
  renderItemsPresup();
  calcularTotal();
}

// ── RENDER TABLA DE ITEMS ────────────────────────────────
export function renderItemsPresup() {
  const tbody = document.getElementById('pres-items-tbody');
  if (!presItems.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="padding:16px;text-align:center;color:var(--text-3);font-size:12px">Seleccioná productos del catálogo o agregá ítems personalizados</td></tr>';
    return;
  }
  tbody.innerHTML = presItems.map((item, i) => `
    <tr style="border-bottom:1px solid var(--border)">
      <td style="padding:8px 12px;font-size:12px">
        <div style="display:flex;align-items:flex-start;gap:8px">
          ${item.foto_base64
            ? `<img src="${item.foto_base64}" style="width:36px;height:36px;object-fit:cover;border-radius:6px;flex-shrink:0;border:1px solid var(--border)">`
            : ''}
          <div style="flex:1;min-width:0">
            <div style="font-weight:500">${item.producto}</div>
            <textarea rows="1" placeholder="Descripción (opcional)"
              style="width:100%;font-size:11px;color:var(--text-2);margin-top:3px;background:var(--bg);
                     border:1px solid var(--border);border-radius:4px;padding:3px 6px;resize:vertical;
                     font-family:inherit"
              onchange="cambiarDescripcion(${i}, this.value)">${escHtml(item.descripcion)}</textarea>
            <div style="display:flex;align-items:center;gap:8px;margin-top:3px">
              ${item.esCustom ? '<span style="font-size:10px;color:var(--purple)">a medida</span>' :
                `<span style="font-size:10px;color:var(--text-3)">${item.categoria}</span>`}
              ${item.esCustom ? '' : `<button type="button" onclick="guardarItemEnCatalogo(${i})"
                style="background:none;border:none;color:var(--text-3);cursor:pointer;font-size:11px;padding:0"
                title="Actualizar precio y descripción en el catálogo para futuros presupuestos">💾 Actualizar catálogo</button>`}
            </div>
          </div>
        </div>
      </td>
      <td style="padding:8px;text-align:center">
        <input type="number" min="1" value="${item.cantidad}"
          style="width:52px;text-align:center;background:var(--bg);border:1px solid var(--border);
                 border-radius:6px;color:var(--text);padding:4px;font-size:12px"
          onchange="cambiarCantidad(${i}, this.value)">
      </td>
      <td style="padding:8px 12px;text-align:right;font-size:12px">
        <input type="text" value="${(item.precio||0).toLocaleString('es-AR',{maximumFractionDigits:0})}"
          style="width:110px;text-align:right;background:var(--bg);border:1px solid var(--border);
                 border-radius:6px;color:var(--text);padding:4px;font-size:12px"
          oninput="fmtInputARS(this)" onchange="cambiarPrecio(${i}, this)">
      </td>
      <td style="padding:8px 12px;text-align:right;font-size:12px;font-weight:600">
        ${fmtARS(item.precio * item.cantidad)}
      </td>
      <td style="padding:8px;text-align:center">
        <button onclick="quitarItem(${i})"
          style="background:none;border:none;color:var(--text-3);cursor:pointer;font-size:14px;
                 padding:2px 6px;border-radius:4px;transition:color .15s"
          onmouseover="this.style.color='var(--red)'" onmouseout="this.style.color='var(--text-3)'">✕</button>
      </td>
    </tr>`).join('');
}

export function cambiarCantidad(i, v) {
  presItems[i].cantidad = Math.max(1, parseInt(v) || 1);
  renderItemsPresup();
  calcularTotal();
}

export function cambiarPrecio(i, v) {
  presItems[i].precio = parseARSInput(v) || 0;
  renderItemsPresup();
  calcularTotal();
}

export function cambiarDescripcion(i, v) {
  presItems[i].descripcion = v;
}

// Aplica el precio/descripción editados en este presupuesto al producto del catálogo,
// para que queden como default en futuros presupuestos
export async function guardarItemEnCatalogo(i) {
  const item = presItems[i];
  if (!item || item.esCustom) return;
  try {
    await sbPatch('catalogo', item.id, { descripcion: item.descripcion || null, precio_ars: item.precio });
    const cacheItem = catalogoCache.find(c => String(c.id) === String(item.id));
    if (cacheItem) { cacheItem.descripcion = item.descripcion || ''; cacheItem.precio_ars = item.precio; }
    invalidateCache('catalogo');
    toast('✅ Producto actualizado en el catálogo');
  } catch(e) {
    toast('Error actualizando catálogo: ' + e.message, 'err');
  }
}

export function quitarItem(i) {
  presItems.splice(i, 1);
  renderItemsPresup();
  calcularTotal();
  filtrarCatalogoPres();
}

// ── CALCULAR TOTAL ────────────────────────────────────────
export function calcularTotal() {
  const total = presItems.reduce((s, it) => s + it.precio * it.cantidad, 0);
  const el = document.getElementById('pres-total-display');
  if (el) el.textContent = fmtARS(total);
  return { total };
}

// Mostrar/ocultar seña según modalidad
export function toggleSena(modalidad) {
  const wrap = document.getElementById('pres-sena-wrap');
  if (wrap) wrap.style.display = modalidad === 'Pago total al finalizar' ? 'none' : '';
}
export function toggleSenaEv(modalidad) {
  const wrap = document.getElementById('ev-sena-wrap');
  if (wrap) wrap.style.display = modalidad === 'Pago total al finalizar' ? 'none' : '';
}

// Recalcula el total final del evento (base + IVA + recargo por pago diferido)
export function actualizarTotalFinalEv() {
  const base       = parseARSInput(document.getElementById('ev-total')) || 0;
  const incluyeIva = document.getElementById('ev-iva').checked;
  const diferido   = document.getElementById('ev-pago-diferido').checked;
  document.getElementById('ev-total-final').textContent = fmtARS(calcularTotalConRecargos(base, incluyeIva, diferido));
}

// ── GENERAR PDF Y SUBIR A DRIVE ───────────────────────────
export async function generarPresupuesto() {
  const cliente = document.getElementById('pres-cliente').value.trim();
  const venue   = document.getElementById('pres-venue').value.trim();
  if (!cliente) { toast('El cliente es obligatorio', 'err'); return; }
  if (!presItems.length) { toast('Agregá al menos un producto', 'err'); return; }

  const btn = document.querySelector('#modal-presupuesto .btn-primary');
  btn.textContent = '⏳ Generando...';
  btn.disabled = true;

  try {
    const numero    = document.getElementById('pres-numero').value;
    const tipo      = document.getElementById('pres-tipo').value;
    const fpPres    = document.getElementById('pres-fechas')._flatpickr;
    const fechasEvento = fpPres ? fpPres.selectedDates.map(d => d.toISOString().slice(0,10)).sort() : [];
    const fecha        = fechasEvento[0] || '';
    const horario      = '';
    const modalidad = document.getElementById('pres-modalidad').value;
    const senaMonto = parseARSInput(document.getElementById('pres-sena'));
    const hoy       = new Date().toLocaleDateString('es-AR');

    const { total } = calcularTotal();
    const sena  = senaMonto;
    const saldo = total - sena;

    const fmtA  = v => '$ ' + Math.round(v).toLocaleString('es-AR');

    // ── Agrupar por categoría ──
    const grupos = {};
    presItems.forEach(it => {
      const c = it.categoria || 'OTROS';
      if (!grupos[c]) grupos[c] = [];
      grupos[c].push(it);
    });

    // ── Generar PDF con jsPDF directo ───────────────────────
    function slugify(s) {
      return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
        .toUpperCase().replace(/[^A-Z0-9]+/g,'-').replace(/^-+|-+$/g,'');
    }
    const fechaHoy = new Date().toISOString().split('T')[0];
    const versionNum = presVersionInfo ? presVersionInfo.nextVersion : 1;
    const nombreArchivo = `${fechaHoy}-${slugify(venue||'evento')}-${slugify(cliente)}-v${versionNum}.pdf`;

    // ── Fotos del catálogo (desde Supabase foto_base64) ───────
    const fotosMap = {};
    presItems.filter(it => !it.esCustom).forEach(it => {
      const cat = (catalogoCache.length ? catalogoCache : (window._catLista||[])).find(c => String(c.id) === String(it.id));
      if (cat?.foto_base64) fotosMap[it.id] = cat.foto_base64;
    });
    console.log(`Fotos disponibles: ${Object.keys(fotosMap).length}`);

    
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const PW = 210; // ancho A4
    const PH = 297; // alto A4
    const M  = 14;  // margen
    const CW = PW - M * 2; // ancho contenido
    let y = 0;

    // ── Colores ───────────────────────────────────────────
    const NEGRO  = [26, 26, 46];
    const ORO    = [201, 168, 76];
    const BLANCO = [255, 255, 255];
    const GRIS_F = [247, 247, 247];
    const GRIS_T = [85, 85, 85];

    // Helper: setColor — usa ?? para no fallar con 0
    const fill  = (c) => doc.setFillColor(c[0] ?? 0, c[1] ?? 0, c[2] ?? 0);
    const stroke= (c) => doc.setDrawColor(c[0] ?? 0, c[1] ?? 0, c[2] ?? 0);
    const text  = (c) => doc.setTextColor(c[0] ?? 0, c[1] ?? 0, c[2] ?? 0);
    const font  = (style, size) => { doc.setFont('helvetica', style); doc.setFontSize(size); };

    // ── HEADER ────────────────────────────────────────────
    fill(NEGRO); doc.rect(0, 0, PW, 30, 'F');

    // Logo (cuadrado negro se mezcla con fondo)
    try {
      doc.addImage(LOGO_B64, 'PNG', M, 1, 24, 24);
    } catch(e) { console.log('Logo error:', e); }

    // Nombre y subtítulo
    font('bold', 16); text(BLANCO);
    doc.text('GROSSO ARGENTINA', M + 27, 11);
    font('normal', 9); text(ORO);
    doc.text('Soluciones Tecnologicas para Eventos', M + 27, 18);

    // Datos contacto (derecha)
    font('normal', 7.5); text([200,200,200]);
    doc.text('administracion@grossoarg.com', PW - M, 10, { align: 'right' });
    doc.text('Lomas de Zamora, Buenos Aires', PW - M, 16, { align: 'right' });
    doc.text('CUIT: 20-23091637-4', PW - M, 22, { align: 'right' });
    y = 33;

    // Línea dorada
    stroke(ORO); doc.setLineWidth(0.8);
    doc.line(M, y, PW - M, y); y += 4;

    // ── TÍTULO ────────────────────────────────────────────
    font('bold', 14); text(NEGRO);
    doc.text('PRESUPUESTO DE ILUMINACION', M, y + 5);
    font('normal', 8); text(GRIS_T);
    doc.text(`N\u00b0 ${numero}`, PW - M, y + 3, { align: 'right' });
    doc.text(`Fecha: ${hoy}`, PW - M, y + 8, { align: 'right' });
    y += 13;

    // ── DATOS DEL EVENTO ──────────────────────────────────
    fill(NEGRO); doc.rect(M, y, CW, 6, 'F');
    font('bold', 8); text(BLANCO);
    doc.text('DATOS DEL EVENTO', M + 2, y + 4); y += 7;

    const eventoRows = [
      ['Cliente:', cliente, 'Tipo:', tipo],
      [`Fecha${fechasEvento.length > 1 ? 's' : ''}:`, fechasEvento.length ? fechasEvento.map(f => new Date(f+'T12:00:00').toLocaleDateString('es-AR')).join(' · ') : (fecha ? new Date(fecha+'T12:00:00').toLocaleDateString('es-AR') : '-'), '', ''],
      ['Venue:', venue||'-', '', ''],
    ];
    eventoRows.forEach((row, ri) => {
      fill(ri%2===0 ? GRIS_F : BLANCO);
      doc.rect(M, y, CW, 6, 'F');
      font('bold', 8); text(GRIS_T);
      doc.text(row[0], M+2, y+4.2);
      font('normal', 8); text(NEGRO);
      doc.text(String(row[1]), M+28, y+4.2);
      if (row[2]) {
        font('bold', 8); text(GRIS_T);
        doc.text(row[2], M+CW/2+2, y+4.2);
        font('normal', 8); text(NEGRO);
        doc.text(String(row[3]), M+CW/2+22, y+4.2);
      }
      y += 6;
    });
    y += 2;

    // ── DETALLE DE SERVICIOS ──────────────────────────────
    fill(NEGRO); doc.rect(M, y, CW, 6, 'F');
    font('bold', 8); text(BLANCO);
    doc.text('DETALLE DE SERVICIOS', M+2, y+4); y += 7;

    // Cabecera tabla
    fill([44, 62, 80]); doc.rect(M, y, CW, 6, 'F');
    font('bold', 7.5); text(BLANCO);
    doc.text('PRODUCTO', M+2, y+4);
    doc.text('CANT.', M+CW-50, y+4, { align:'center' });
    doc.text('TOTAL ARS', PW-M-2, y+4, { align:'right' });
    y += 7;

    // Items agrupados por categoría
    let idx2 = 0;
    Object.entries(grupos).forEach(([cat, items]) => {
      // Verificar espacio en página
      if (y > PH - 40) { doc.addPage(); y = 15; }
      fill([44, 62, 80]); doc.rect(M, y, CW, 5, 'F');
      font('bold', 7.5); text(ORO);
      doc.text(cat, M+2, y+3.5); y += 5;

      items.forEach(it => {
        const foto = it.esCustom ? (it.foto_base64 || null) : fotosMap[it.id];
        const desc = it.descripcion || '';
        const hasDesc = !!desc;
        const imgSize = 24;
        const xText = foto ? M+imgSize+3 : M+2;

        font('normal', 7.5);
        const descLines = hasDesc ? doc.splitTextToSize(desc, CW - (xText - M) - 2) : [];
        const descLineH = 4;
        const textH = 6 + (hasDesc ? descLines.length * descLineH : 0) + 2;
        const rowHFinal = Math.max(foto ? imgSize + 3 : 9, textH);

        if (y + rowHFinal > PH - 30) { doc.addPage(); y = 15; }
        fill(idx2%2===0 ? BLANCO : GRIS_F);
        doc.rect(M, y, CW, rowHFinal, 'F');

        if (foto) {
          try { doc.addImage(foto, M+1, y+1, imgSize, imgSize); } catch(e) {}
        }
        font('bold', 8.5); text(NEGRO);
        const maxChars = foto ? 42 : 55;
        const prod = it.producto.length > maxChars ? it.producto.substring(0, maxChars-3)+'...' : it.producto;
        const yProd = y + (hasDesc ? 5 : rowHFinal/2 + 2);
        doc.text(prod, xText, yProd);
        if (hasDesc) {
          font('normal', 7.5); text([80,80,80]);
          descLines.forEach((line, li) => doc.text(line, xText, yProd + 4.5 + li*descLineH));
        }
        const yCant = y + rowHFinal / 2 + 2;
        font('normal', 8.5); text(NEGRO);
        doc.text(String(it.cantidad), M+CW-50, yCant, { align:'center' });
        doc.text(fmtA(it.precio * it.cantidad), PW-M-2, yCant, { align:'right' });
        y += rowHFinal; idx2++;
      });
    });


    // Total
    if (y > PH - 20) { doc.addPage(); y = 15; }
    fill(ORO); doc.rect(M, y, CW, 0.8, 'F');
    y += 1;
    fill([245, 230, 184]); doc.rect(M, y, CW, 8, 'F');
    font('bold', 11); text(NEGRO);
    doc.text('TOTAL', M+2, y+6);
    text(ORO);
    doc.text(fmtA(total), PW-M-2, y+6, { align:'right' });
    fill(ORO); doc.rect(M, y+8, CW, 0.8, 'F');
    y += 12;

    font('normal', 7); text([150,150,150]);
    doc.text('* Precios en pesos argentinos (ARS).', M, y); y += 5;

    // ── CONDICIONES DE PAGO ───────────────────────────────
    if (y > PH - 50) { doc.addPage(); y = 15; }
    fill(NEGRO); doc.rect(M, y, CW, 6, 'F');
    font('bold', 8); text(BLANCO);
    doc.text('CONDICIONES DE PAGO', M+2, y+4); y += 7;

    if (modalidad === 'Señ a + saldo' || modalidad === 'Seña + saldo') {
      // Cabecera
      fill([44,62,80]); doc.rect(M, y, CW, 5.5, 'F');
      font('bold', 7.5); text(BLANCO);
      doc.text('Concepto', M+2, y+4);
      doc.text('Importe', PW-M-42, y+4);
      doc.text('Cuando', PW-M-2, y+4, { align:'right' });
      y += 5.5;

      const pagoRows = [
        [`Seña - Reserva de fecha`, fmtA(sena), 'Al confirmar'],
        ['Saldo restante', fmtA(saldo), 'Previo al evento'],
        ['TOTAL', fmtA(total), ''],
      ];
      pagoRows.forEach((row, ri) => {
        const isTot = ri === 2;
        fill(isTot ? [245,230,184] : ri%2===0 ? GRIS_F : BLANCO);
        doc.rect(M, y, CW, 6, 'F');
        font(isTot?'bold':'normal', 8);
        text(isTot ? NEGRO : NEGRO);
        doc.text(row[0], M+2, y+4);
        text(isTot ? ORO : NEGRO);
        doc.text(row[1], PW-M-42, y+4);
        if (row[2]) { text(NEGRO); doc.text(row[2], PW-M-2, y+4, { align:'right' }); }
        y += 6;
      });
      y += 2;
      font('normal', 7); text(GRIS_T);
      y += 2;
    } else {
      fill([245,230,184]); doc.rect(M, y, CW, 8, 'F');
      font('bold', 10); text(NEGRO);
      doc.text('TOTAL - Pago al finalizar el evento', M+2, y+6);
      text(ORO);
      doc.text(fmtA(total), PW-M-2, y+6, { align:'right' });
      y += 10;
      font('normal', 7.5); text([21, 101, 192]);
      doc.text('No se requiere seña. El pago total se realiza una vez finalizado el evento.', M, y);
      y += 5;
    }

    // ── NOTAS ─────────────────────────────────────────────
    if (y > PH - 40) { doc.addPage(); y = 15; }
    y += 1;
    fill(NEGRO); doc.rect(M, y, CW, 5.5, 'F');
    font('bold', 7.5); text(BLANCO);
    doc.text('NOTAS Y CONDICIONES GENERALES', M+2, y+3.8); y += 10;

    const notas = [
      'Precios expresados en pesos argentinos (ARS).',
      'El presupuesto incluye traslado dentro de CABA y alrededores.',
      'El presupuesto incluye costos de armado, operador y desarme.',
      'Valores de pago en efectivo (Factura A – Más IVA).',
      'Vigencia presupuesto por 15 días.',
      'Congela valor con pago del 100%.',
      'Se aceptan pagos diferidos (recargo del 5%).',
    ];
    font('normal', 7); text(NEGRO);
    notas.forEach((n, i) => {
      if (y > PH - 18) { doc.addPage(); y = 15; }
      doc.text(`${i+1}. ${n}`, M, y); y += 3.8;
    });

    // ── FOOTER — fijo al pie de la hoja ──────────────────
    const footerY = PH - 12;
    fill(NEGRO); doc.rect(0, footerY, PW, 12, 'F');
    font('normal', 7.5); text(ORO);
    doc.text('Grosso Argentina | Soluciones Tecnologicas | administracion@grossoarg.com', M, footerY + 7);
    doc.text(`N\u00b0 ${numero}`, PW - M, footerY + 7, { align: 'right' });

    // ── Exportar como Blob ────────────────────────────────
    const pdfBlob = doc.output('blob');

    // ── Subir a Google Drive ──────────────────────────────
    const { data: { session } } = await state.supabaseClient.auth.getSession();

    // provider_token no persiste entre recargas — usar localStorage o refrescar
    let accessToken = session?.provider_token || localStorage.getItem('drive_token');

    if (!accessToken) {
      const refreshToken = session?.provider_refresh_token || localStorage.getItem('drive_refresh_token');
      if (refreshToken) {
        try {
          const r = await fetch('https://mitosihorpjmrosdxqbt.supabase.co/functions/v1/refresh-drive-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refreshToken }),
          });
          if (r.ok) {
            const { access_token } = await r.json();
            accessToken = access_token;
            localStorage.setItem('drive_token', access_token);
          }
        } catch(e) { console.warn('Error refrescando token:', e); }
      }
    }
    console.log('Token Drive:', accessToken ? 'OK' : 'NO DISPONIBLE');

    let pdfUrl = null;

    if (accessToken) {
      const metadata = { name: nombreArchivo, parents: [DRIVE_FOLDER_ID], mimeType: 'application/pdf' };
      const formData = new FormData();
      formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      formData.append('file', pdfBlob, nombreArchivo);

      const uploadRes = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
        { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: formData }
      );

      if (uploadRes.ok) {
        const fileData = await uploadRes.json();
        pdfUrl = fileData.webViewLink;

        // Hacer el archivo público (lectura)
        await fetch(`https://www.googleapis.com/drive/v3/files/${fileData.id}/permissions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'reader', type: 'anyone' }),
        });
      } else if (uploadRes.status === 401) {
        // Token expirado — limpiar y pedir re-login
        localStorage.removeItem('drive_token');
        toast('Sesión de Google Drive expirada. Cerrá sesión y volvé a ingresar.', 'err');
        return;
      }
    } else {
      // Sin token de Drive — solo descargar localmente
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url; a.download = nombreArchivo; a.click();
      URL.revokeObjectURL(url);
      toast('PDF descargado localmente (sin subir a Drive)');
    }

    // ── Guardar en Supabase ───────────────────────────────
    try {
      const pres = await sbPost('presupuestos', {
        numero, cliente, tipo_evento: tipo,
        fecha_evento: fecha || null, venue,
        fechas_evento: fechasEvento.length ? JSON.stringify(fechasEvento) : null,
        dias_evento: fechasEvento.length || 1,
        modalidad, sena_monto: senaMonto || null,
        subtotal_ars: total, total_ars: total,
        pdf_url: pdfUrl,
        nombre_archivo: nombreArchivo,
        estado_evento: 'Pendiente',
        evento_id: state._presupuestoParaEventoId || null,
        version: presVersionInfo ? presVersionInfo.nextVersion : 1,
        grupo_id: presVersionInfo ? presVersionInfo.grupoId : null,
      });
      // Guardar items
      const presId = Array.isArray(pres) ? pres[0]?.id : pres?.id;
      if (presId && presItems.length) {
        await sbPost('presupuesto_items', presItems.map(it => ({
          presupuesto_id: presId,
          catalogo_id: it.esCustom ? null : (it.id || null),
          producto: it.producto,
          descripcion: it.descripcion || null,
          foto_base64: (it.esCustom && it.foto_base64) ? it.foto_base64 : null,
          categoria: it.categoria || null,
          precio_ars: it.precio,
          cantidad: it.cantidad || 1,
          es_custom: !!it.esCustom,
        })));
      }
    } catch(e) { console.error('Error guardando presupuesto:', e); }

    invalidateCache('presupuestos');
    invalidateCache('presupuesto_items');
    toast(pdfUrl ? '✅ PDF generado y guardado en Drive' : '✅ PDF generado');
    closeModal('modal-presupuesto');
    presItems = [];
    presVersionInfo = null;
    state._presupuestoParaEventoId = null;
    loadPresupuestos();

  } catch(e) {
    toast('Error generando PDF: ' + e.message, 'err');
    console.error(e);
  } finally {
    btn.textContent = '📄 Generar PDF y guardar';
    btn.disabled = false;
  }
}


// Window assignments
window.loadClientes = loadClientes;
window.editarCliente = editarCliente;
window.guardarCliente = guardarCliente;
window.verSegurosEvento = verSegurosEvento;
window.loadSalones = loadSalones;
window.editarSalon = editarSalon;
window.guardarSalon = guardarSalon;
window.upsertClienteYSalon = upsertClienteYSalon;
window.loadCatalogo = loadCatalogo;
window.abrirModalProductoById = abrirModalProductoById;
window.abrirModalProducto = abrirModalProducto;
window.previewFotoProducto = previewFotoProducto;
window.blobToBase64 = blobToBase64;
window.subirFotoProducto = subirFotoProducto;
window.guardarProducto = guardarProducto;
window.eliminarProducto = eliminarProducto;
window.filterCat = filterCat;
window.buscarCatalogo = buscarCatalogo;
window.initThumbObserver = initThumbObserver;
window.renderCatalogo = renderCatalogo;
window.confirmarPresupuesto = confirmarPresupuesto;
window.actualizarTotalConfirmarPresupuesto = actualizarTotalConfirmarPresupuesto;
window.confirmarPresupuestoFinal = confirmarPresupuestoFinal;
window.perderPresupuesto = perderPresupuesto;
window.grupoRootId = grupoRootId;
window.loadPresupuestos = loadPresupuestos;
window.abrirModalPresupuesto = abrirModalPresupuesto;
window.nuevaVersionPresupuesto = nuevaVersionPresupuesto;
window.filtrarCatalogoPres = filtrarCatalogoPres;
window.agregarItemCatalogo = agregarItemCatalogo;
window.onCustomFotoChange = onCustomFotoChange;
window.agregarItemCustom = agregarItemCustom;
window.renderItemsPresup = renderItemsPresup;
window.cambiarCantidad = cambiarCantidad;
window.cambiarPrecio = cambiarPrecio;
window.cambiarDescripcion = cambiarDescripcion;
window.guardarItemEnCatalogo = guardarItemEnCatalogo;
window.quitarItem = quitarItem;
window.calcularTotal = calcularTotal;
window.toggleSena = toggleSena;
window.toggleSenaEv = toggleSenaEv;
window.actualizarTotalFinalEv = actualizarTotalFinalEv;
window.generarPresupuesto = generarPresupuesto;
