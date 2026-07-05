import { state } from '../state.js';
import { jsPDF } from 'jspdf';
import { sb, sbPost, sbInsert, sbPatch, sbDelete, fmtARS, fmtDate, escHtml, calcularTotalConRecargos, today, formatTelefono, onTelefonoInput, formatDni, onDniInput, formatCuit, onCuitInput, badge, fmtInputARS, parseARSInput, toast, openModal, closeModal, LOGO_B64, buildTimeOpts, timeSelect, llenarSelectEventos, initDatePickers, renderHorariosEv, getHorariosEv } from '../helpers.js';
import { SB_URL, SB_KEY, FOLDER_LOGISTICAS, WA_EDGE_URL, EMAIL_EDGE_URL, EMAIL_SEGURO, DRIVE_FOLDER_ID, FOTOS_FOLDER_ID } from '../config.js';

let dashOffset = 0;
let _dashData = null;

export function cambiarSemana(dir) { dashOffset += dir; loadDashboard(); }

export function onDashCheckbox() {
  const checked = document.querySelectorAll('#dash-eventos-semana input[type=checkbox]:checked');
  document.getElementById('btn-pdf-fechas').style.display = checked.length ? '' : 'none';
}

export async function generarPDFFechas() {
  if (!_dashData) return;
  const checked = [...document.querySelectorAll('#dash-eventos-semana input[type=checkbox]:checked')];
  const ids = checked.map(c => Number(c.dataset.evId));
  const eventos = _dashData.eventos.filter(e => ids.includes(e.id)).sort((a,b) => (a.fecha_evento||'').localeCompare(b.fecha_evento||''));
  if (!eventos.length) return;

  
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const PW = 210, PH = 297, M = 14, CW = PW - M * 2;
  let y = 0;

  const NEGRO = [26,26,46], ORO = [201,168,76], BLANCO = [255,255,255], GRIS_F = [247,247,247], GRIS_T = [85,85,85];
  const fill   = c => doc.setFillColor(c[0],c[1],c[2]);
  const stroke = c => doc.setDrawColor(c[0],c[1],c[2]);
  const text   = c => doc.setTextColor(c[0],c[1],c[2]);
  const font   = (style, size) => { doc.setFont('helvetica', style); doc.setFontSize(size); };
  const checkY = (n) => { if (y + n > PH - 20) { doc.addPage(); y = 15; } };

  const drawHeader = () => {
    fill(NEGRO); doc.rect(0, 0, PW, 30, 'F');
    try { doc.addImage(LOGO_B64, 'PNG', M, 1, 24, 24); } catch(e) {}
    font('bold', 16); text(BLANCO); doc.text('GROSSO ARGENTINA', M + 27, 11);
    font('normal', 9); text(ORO); doc.text('Soluciones Tecnologicas para Eventos', M + 27, 18);
    font('normal', 7.5); text([200,200,200]);
    doc.text('administracion@grossoarg.com', PW - M, 10, { align: 'right' });
    doc.text('Lomas de Zamora, Buenos Aires', PW - M, 16, { align: 'right' });
    y = 33;
    stroke(ORO); doc.setLineWidth(0.8); doc.line(M, y, PW - M, y); y += 6;
  };

  drawHeader();

  // Título general
  font('bold', 15); text(NEGRO);
  doc.text('Resumen de fechas', M, y + 6);
  font('normal', 9); text(GRIS_T);
  const fechaHoy = new Date().toLocaleDateString('es-AR', { day:'numeric', month:'long', year:'numeric' });
  doc.text(`Generado el ${fechaHoy}`, PW - M, y + 6, { align: 'right' });
  y += 16;

  // Un bloque por evento
  for (const ev of eventos) {
    checkY(40);

    // Cabecera del evento
    fill(NEGRO); doc.rect(M, y, CW, 9, 'F');
    font('bold', 10); text(ORO);
    const fechaEv = new Date((ev.fecha_evento||ev.fecha) + 'T12:00:00');
    const fechaLabel = fechaEv.toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    doc.text(`${(ev.venue||'—').toUpperCase()}  ·  ${fechaLabel.toUpperCase()}`, M + 2, y + 6);
    y += 11;

    // Cliente y estado
    font('normal', 9); text(GRIS_T);
    doc.text(`Cliente: ${ev.cliente_nombre || ev.cliente || '—'}   |   Estado: ${ev.estado || '—'}`, M, y + 5);
    y += 10;

    // Productos
    const items = _dashData.presByEvento[ev.id] || [];
    if (items.length) {
      checkY(16);
      fill(GRIS_F); doc.rect(M, y, CW, 6, 'F');
      font('bold', 8); text(NEGRO);
      doc.text('PRODUCTOS', M + 2, y + 4); y += 8;

      const IMG_W = 28, IMG_H = 28, IMG_GAP = 4, TEXT_X_FOTO = M + IMG_W + IMG_GAP;
      const TEXT_W_FOTO = CW - IMG_W - IMG_GAP;

      items.forEach((item, idx) => {
        const nombre = `${item.cantidad > 1 ? item.cantidad + '× ' : ''}${item.producto}`;
        const desc   = item.descripcion || '';
        const hasFoto = !!(item.foto_base64);

        const textX = hasFoto ? TEXT_X_FOTO : M + 2;
        const textW = hasFoto ? TEXT_W_FOTO - 2 : CW - 4;

        font('bold', 8); text(NEGRO);
        const nombreWrapped = doc.splitTextToSize(nombre, textW);
        font('normal', 7.5); text(GRIS_T);
        const descWrapped = desc ? doc.splitTextToSize(desc, textW) : [];

        const textLines = nombreWrapped.length + descWrapped.length;
        const rowH = Math.max(hasFoto ? IMG_H + 4 : 0, textLines * 4.2 + 8);

        checkY(rowH + 2);

        if (idx > 0) {
          stroke([220,220,220]); doc.setLineWidth(0.2);
          doc.line(M, y, M + CW, y);
        }
        y += 3;

        if (hasFoto) {
          try {
            doc.addImage(item.foto_base64, 'JPEG', M, y, IMG_W, IMG_H);
          } catch(e) {
            try { doc.addImage(item.foto_base64, 'PNG', M, y, IMG_W, IMG_H); } catch(e2) {}
          }
        }

        font('bold', 8); text(NEGRO);
        doc.text(nombreWrapped, textX, y + 5);
        if (descWrapped.length) {
          font('normal', 7.5); text(GRIS_T);
          doc.text(descWrapped, textX, y + 5 + nombreWrapped.length * 4.5);
        }

        y += rowH;
      });
      y += 4;
    }

    // Logística (personal)
    const logIds = _dashData.logEvs.filter(le => le.evento_id === ev.id).map(le => le.logistica_id);
    const logsEvento = _dashData.logisticas.filter(l => logIds.includes(l.id));
    const logIdsEv = logsEvento.map(l => l.id);
    const jornadasEv = _dashData.jornadas.filter(j => logIdsEv.includes(j.logistica_id));

    if (jornadasEv.length) {
      checkY(16);
      fill(GRIS_F); doc.rect(M, y, CW, 6, 'F');
      font('bold', 8); text(NEGRO);
      doc.text('LOGÍSTICA', M + 2, y + 4); y += 7;

      // Agrupar por tipo y fecha
      const grupos = {};
      const horaFallback = { Armado: ev.hora_armado, Operador: ev.horario, Desarme: ev.hora_desarme };
      jornadasEv.forEach(j => {
        const key = `${j.tipo}||${j.fecha}`;
        if (!grupos[key]) grupos[key] = { tipo: j.tipo, fecha: j.fecha, hora: horaFallback[j.tipo] || '', personas: [] };
        const nombre = `${j.personal_nombre||''} ${j.personal_apellido||''}`.trim();
        if (nombre && !grupos[key].personas.includes(nombre)) grupos[key].personas.push(nombre);
      });

      const tipoOrden = ['Depósito','Armado','Operador','Desarme'];
      const gruposOrden = Object.values(grupos).sort((a,b) => {
        const oi = t => tipoOrden.indexOf(t) === -1 ? 99 : tipoOrden.indexOf(t);
        return oi(a.tipo) - oi(b.tipo) || (a.fecha||'').localeCompare(b.fecha||'');
      });

      gruposOrden.forEach(g => {
        checkY(10);
        const fLabel = new Date(g.fecha + 'T12:00:00').toLocaleDateString('es-AR', { weekday:'short', day:'numeric', month:'short' });
        font('bold', 8); text(NEGRO);
        doc.text(`${g.tipo}  —  ${fLabel}${g.hora ? '  ' + g.hora : ''}`, M + 2, y + 4);
        font('normal', 8); text(GRIS_T);
        doc.text(g.personas.join(', ') || 'Sin personal', M + 2, y + 9);
        y += 13;
      });
    }

    stroke([220,220,220]); doc.setLineWidth(0.3); doc.line(M, y, PW - M, y); y += 8;
  }

  doc.save(`fechas-${new Date().toISOString().split('T')[0]}.pdf`);
}

export function getSemanaActual() {
  const hoy = new Date();
  const dow = hoy.getDay() === 0 ? 6 : hoy.getDay() - 1; // lunes=0
  const lunes = new Date(hoy); lunes.setDate(hoy.getDate() - dow + dashOffset * 7);
  const domingo = new Date(lunes); domingo.setDate(lunes.getDate() + 6);
  const fmt = d => d.toISOString().split('T')[0];
  return { desde: fmt(lunes), hasta: fmt(domingo), lunes, domingo };
}

export async function loadDashboard() {
  const hoy = new Date();
  document.getElementById('dash-fecha').textContent = hoy.toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long' });

  const { desde, hasta, lunes, domingo } = getSemanaActual();
  const label = `${lunes.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit'})} — ${domingo.toLocaleDateString('es-AR',{day:'2-digit',month:'2-digit',year:'2-digit'})}`;
  document.getElementById('dash-semana-label').textContent = label;

  const cont = document.getElementById('dash-eventos-semana');
  cont.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    const [eventos, logisticas, logEvs] = await Promise.all([
      sb('v_eventos', { filters: [`fecha_evento=gte.${desde}`, `fecha_evento=lte.${hasta}`], order: 'fecha_evento.asc', limit: 100 }),
      sb('logisticas', { limit: 200 }),
      sb('logistica_eventos', { limit: 500 }),
    ]);

    // Buscar jornadas por evento_id, no por fecha de jornada
    let jornadas = [];
    if (eventos.length) {
      const evIds = eventos.map(e => e.id);
      jornadas = await sb('v_jornadas', { filters: [`evento_id=in.(${evIds.join(',')})`], select: 'id,evento_id,logistica_id,tipo,fecha,hora_inicio,personal_id,personal_nombre,personal_apellido', limit: 500 });
    }

    if (!eventos.length) {
      cont.innerHTML = '<div class="empty"><div class="empty-icon">📅</div>Sin eventos esta semana</div>';
      document.getElementById('btn-pdf-fechas').style.display = 'none';
      return;
    }

    // Buscar presupuestos vinculados a estos eventos
    const evIds = eventos.map(e => e.id);
    const presupuestos = await sb('presupuestos', { filters: [`evento_id=in.(${evIds.join(',')})`], select: 'id,evento_id', limit: 200 });
    const presIds = presupuestos.map(p => p.id);
    let presItemsAll = [];
    if (presIds.length) {
      presItemsAll = await sb('presupuesto_items', { filters: [`presupuesto_id=in.(${presIds.join(',')})`], select: 'presupuesto_id,producto,cantidad,descripcion,foto_base64,catalogo_id', limit: 1000 });
      // Cargar fotos del catálogo para items sin foto propia
      const catIds = [...new Set(presItemsAll.filter(i => !i.foto_base64 && i.catalogo_id).map(i => i.catalogo_id))];
      if (catIds.length) {
        const catFotos = await sb('catalogo', { filters: [`id=in.(${catIds.join(',')})`], select: 'id,foto_base64', limit: catIds.length });
        const fotosByCatId = {};
        catFotos.forEach(c => { if (c.foto_base64) fotosByCatId[c.id] = c.foto_base64; });
        presItemsAll = presItemsAll.map(i => (!i.foto_base64 && i.catalogo_id && fotosByCatId[i.catalogo_id])
          ? { ...i, foto_base64: fotosByCatId[i.catalogo_id] } : i);
      }
    }

    // Map evento_id → items
    const presByEvento = {};
    for (const p of presupuestos) {
      const items = presItemsAll.filter(i => i.presupuesto_id === p.id);
      if (!presByEvento[p.evento_id]) presByEvento[p.evento_id] = [];
      presByEvento[p.evento_id].push(...items);
    }

    // Guardar para PDF
    _dashData = { eventos, jornadas, logisticas, logEvs, presByEvento };

    const estadoColor = { 'Confirmado':'var(--green)', 'Realizado':'var(--purple)', 'Cobrado':'var(--blue)' };

    cont.innerHTML = eventos.map(ev => {
      const fecha = new Date((ev.fecha_evento || ev.fecha) + 'T12:00:00').toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long' });
      const color = estadoColor[ev.estado] || 'var(--text-2)';

      // Logísticas de este evento
      const logIds = logEvs.filter(le => le.evento_id === ev.id).map(le => le.logistica_id);
      const logsEvento = logisticas.filter(l => logIds.includes(l.id));

      // Jornadas de este evento (via logísticas asignadas)
      const logIdsEv = logsEvento.map(l => l.id);
      const jornadasEv = jornadas.filter(j => logIdsEv.includes(j.logistica_id));

      // Agrupar jornadas por tipo
      const soloArmados  = jornadasEv.filter(j => j.tipo === 'Armado');
      const soloDesarmes = jornadasEv.filter(j => j.tipo === 'Desarme');
      const operadors    = jornadasEv.filter(j => j.tipo === 'Operador');
      const depositos    = jornadasEv.filter(j => j.tipo === 'Depósito');

      function renderColumna(titulo, jorns) {
        const fecha = new Date(jorns[0].fecha + 'T12:00:00').toLocaleDateString('es-AR', { weekday:'short', day:'numeric', month:'short' });
        const horaEvMap = { 'Armado': ev.hora_armado, 'Operador': ev.horario, 'Desarme': ev.hora_desarme, 'Depósito': '' };
        const hora  = horaEvMap[titulo] || '';
        const pers  = [...new Map(jorns.map(j => [j.personal_id, `${j.personal_nombre||''} ${j.personal_apellido||''}`.trim()])).values()].filter(Boolean);
        return `<div style="flex:1;min-width:160px;background:var(--bg-2);border-radius:8px;padding:10px 12px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--gold);margin-bottom:6px">${titulo}</div>
          <div style="font-size:12px;color:var(--text-1);font-weight:600;margin-bottom:2px">${fecha}</div>
          ${hora ? `<div style="font-size:11px;color:var(--text-2);margin-bottom:6px">🕐 ${hora}</div>` : '<div style="margin-bottom:6px"></div>'}
          <div style="display:flex;flex-direction:column;gap:3px">
            ${pers.map(n => `<span style="font-size:11px;color:var(--text-2)">· ${n}</span>`).join('')}
          </div>
        </div>`;
      }

      // Construir columnas — solo las que tienen datos
      const cols = [];
      const fechasArmado = [...new Set(soloArmados.map(j => j.fecha))].sort();
      fechasArmado.forEach((f, i) => {
        const jorns = soloArmados.filter(j => j.fecha === f);
        if (jorns.length) cols.push(renderColumna(fechasArmado.length > 1 ? `Armado ${i+1}` : 'Armado', jorns));
      });
      if (operadors.length) cols.push(renderColumna('Operador', operadors));
      const fechasDesarme = [...new Set(soloDesarmes.map(j => j.fecha))].sort();
      fechasDesarme.forEach((f, i) => {
        const jorns = soloDesarmes.filter(j => j.fecha === f);
        if (jorns.length) cols.push(renderColumna(fechasDesarme.length > 1 ? `Desarme ${i+1}` : 'Desarme', jorns));
      });
      if (depositos.length) cols.push(renderColumna('Depósito', depositos));

      const columnsHtml = cols.length
        ? `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">${cols.join('')}</div>`
        : `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);font-size:12px;color:var(--text-3)">Sin personal asignado</div>`;

      const items = presByEvento[ev.id] || [];
      const productosHtml = items.length
        ? `<div style="margin-top:10px;border-top:1px solid var(--border);padding-top:8px">
            <div style="font-size:11px;color:var(--text-3);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">Productos</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px">
              ${items.map(i => `<span style="font-size:11px;background:var(--bg-3);border:1px solid var(--border);border-radius:5px;padding:2px 7px;color:var(--text-1)">${i.cantidad > 1 ? `${i.cantidad}× ` : ''}${i.producto}</span>`).join('')}
            </div>
          </div>`
        : '';

      return `<div class="card" style="margin-bottom:12px;padding:16px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
          <div style="display:flex;align-items:flex-start;gap:10px">
            <input type="checkbox" data-ev-id="${ev.id}" style="margin-top:4px;width:16px;height:16px;cursor:pointer;accent-color:var(--gold)" onchange="onDashCheckbox()">
            <div>
              <div style="font-weight:700;font-size:17px">${ev.venue || '—'}</div>
              <div style="color:var(--text-2);font-size:13px;margin-top:2px">${ev.cliente_nombre || ev.cliente || ''}</div>
            </div>
          </div>
          <div style="text-align:right">
            <div style="font-size:12px;color:${color};font-weight:600">${ev.estado || ''}</div>
            <div style="font-size:12px;color:var(--text-2);margin-top:2px">${fecha}</div>
          </div>
        </div>
        ${columnsHtml}
        ${productosHtml}
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);display:flex;justify-content:flex-end">
          <button class="btn btn-ghost btn-sm" onclick="verSegurosEvento(${ev.id})">🛡️ Ver cláusulas</button>
          ${ev.seguro_enviado
            ? `<button class="btn btn-ghost btn-sm" style="opacity:.4;cursor:not-allowed" disabled>✅ Seguros enviados</button>`
            : `<button class="btn btn-ghost btn-sm" onclick="enviarMailSeguroEvento(${ev.id},'${(ev.venue||ev.codigo||'').replace(/'/g,"\\'")}')">📧 Enviar seguro</button>`}
        </div>
      </div>`;
    }).join('');

  } catch(e) {
    cont.innerHTML = `<div class="empty">Error: ${e.message}</div>`;
  }
}



// Window assignments
window.cambiarSemana = cambiarSemana;
window.onDashCheckbox = onDashCheckbox;
window.generarPDFFechas = generarPDFFechas;
window.getSemanaActual = getSemanaActual;
window.loadDashboard = loadDashboard;
