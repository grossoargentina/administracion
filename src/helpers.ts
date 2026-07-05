import { jsPDF } from 'jspdf';
import flatpickr from 'flatpickr';
import 'flatpickr/dist/flatpickr.min.css';
import 'flatpickr/dist/l10n/es.js';
import { SB_URL, SB_KEY } from './config';
import { state } from './state';

export async function sb(table, opts = {}) {
  const { method = 'GET', body, select = '*', filters = [], order, limit } = opts;
  let url = `${SB_URL}/rest/v1/${table}?select=${select}`;
  filters.forEach(f => url += `&${f}`);
  if (order) url += `&order=${order}`;
  if (limit) url += `&limit=${limit}`;
  const res = await fetch(url, {
    method,
    headers: {
      'apikey': SB_KEY,
      'Authorization': `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.message || 'Error Supabase'); }
  if (method === 'GET') return res.json();
  return res.status === 204 ? null : res.json();
}

export async function sbPost(table, body) { return sb(table, { method: 'POST', body }); }
export async function sbInsert(table, body) { return sbPost(table, body); }
export async function sbPatch(table, id, body) {
  const res = await fetch(`${SB_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.ok;
}
export async function sbDelete(table, id) {
  const res = await fetch(`${SB_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'DELETE',
    headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` },
  });
  return res.ok;
}
// ── HELPERS ───────────────────────────────────────────────
export const fmtARS = v => v == null ? '—' : '$ ' + Number(v).toLocaleString('es-AR', {maximumFractionDigits:0});
export const fmtDate = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('es-AR') : '—';
export const escHtml = s => String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
// Aplica 21% de IVA y/o 5% de recargo por pago diferido (sobre el monto ya con IVA, si corresponde) a un monto base sin IVA
export function calcularTotalConRecargos(base, incluyeIva, pagoDiferido) {
  let t = Number(base) || 0;
  if (incluyeIva) t *= 1.21;
  if (pagoDiferido) t *= 1.05;
  return t;
}
export const today = () => new Date().toISOString().split('T')[0];

export function formatTelefono(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 0) return '';
  // Quitar prefijo 54 o 549 si viene pegado
  let local = digits;
  if (local.startsWith('549')) local = local.slice(3);
  else if (local.startsWith('54')) local = local.slice(2);
  // Quitar 9 o 0 iniciales de área
  if (local.startsWith('9')) local = local.slice(1);
  if (local.startsWith('0')) local = local.slice(1);
  // Tomar área (2 dígitos si empieza con 11, sino los primeros dígitos del área)
  if (local.length === 0) return '+54 9 ';
  const area = local.slice(0, 2); // asumimos AMBA (11)
  const num = local.slice(2);
  let result = '+54 9 ' + area;
  if (num.length > 0) result += ' ' + num.slice(0, 4);
  if (num.length > 4) result += '-' + num.slice(4, 8);
  return result;
}
export function onTelefonoInput(el) {
  const pos = el.selectionStart;
  const prev = el.value;
  el.value = formatTelefono(el.value);
  const diff = el.value.length - prev.length;
  try { el.setSelectionRange(pos + diff, pos + diff); } catch(_) {}
}

export function formatDni(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0,2)}.${digits.slice(2)}`;
  return `${digits.slice(0,2)}.${digits.slice(2,5)}.${digits.slice(5)}`;
}
export function onDniInput(el) {
  const pos = el.selectionStart;
  const prev = el.value;
  el.value = formatDni(el.value);
  const diff = el.value.length - prev.length;
  try { el.setSelectionRange(pos + diff, pos + diff); } catch(_) {}
}

export function formatCuit(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 0) return '';
  if (digits.length <= 2) return digits;
  if (digits.length <= 10) return `${digits.slice(0,2)}-${digits.slice(2)}`;
  return `${digits.slice(0,2)}-${digits.slice(2,10)}-${digits.slice(10,11)}`;
}
export function onCuitInput(el) {
  const pos = el.selectionStart;
  const prev = el.value;
  el.value = formatCuit(el.value);
  // ajustar cursor si se insertó un guión
  const diff = el.value.length - prev.length;
  try { el.setSelectionRange(pos + diff, pos + diff); } catch(_) {}
}

export function badge(estado) {
  const map = {
    'Confirmado':  'confirmado',
    'Realizado':   'realizado',
    'Cobrado':     'cobrado',
    'Cancelado':   'cancelado',
  };
  const cls = map[estado] || 'cancelado';
  return `<span class="badge ${cls}"><span class="badge-dot"></span>${estado}</span>`;
}

export function fmtInputARS(el) {
  const raw = el.value.replace(/\./g, '').replace(/[^0-9]/g, '');
  const num = parseInt(raw, 10);
  el.value = isNaN(num) ? '' : num.toLocaleString('es-AR', { maximumFractionDigits: 0 });
}
export function parseARSInput(el) {
  return parseFloat((el.value || '0').replace(/\./g, '').replace(',', '.')) || 0;
}

export function toast(msg, type = 'ok') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `show ${type}`;
  setTimeout(() => t.className = '', 3000);
}

export function openModal(id) { document.getElementById(id).classList.add('open'); }
export function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// Cerrar modal al click fuera
document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
});

export const LOGO_B64 = 'data:image/png;base64,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dceOHY7jJDGoBcdxdu/e/dOf/vSOO+5Yt27dr3/9602bNi1btuxv/uZvvvvd74Zh2AptRFSv17dv375jx44k6j388MMnnnjiX/7lX3Z0dNRqtdHMC4Jg586dCUeJ6JxzzhGRe++9NzmF0ceQnMI//dM/feMb31i0aNGKFSueffbZ1MW/n3Fw48aNIvLoo48mdjuTySRCMg5f/epXATz44IMicu211076gV//+tcTMgH4+7//exH5whe+wMwTo4zWmpnvvPNOEfmHf/gHAAsWLHj88ccP58ejKPrWt76V8L6zs/Ohhx6Sw+O73/2u1tpxnJ6eHhFJjPzhMhRPPPGEtTbRv2kRDfV0oVepVAIwe/bs5KuPouiLX/xiV1eXtVYpFYbh9ddff+6557ZUBEAQBB0dHd/4xjcSz5vo1tKlS6+66ioACVES+zJr1ixrbTI6m5gUmDFjRjLcA/DGG29s3Lhx48aNixYtavlxIjLGzJo167bbbrv77rsfe+yxn//85/39/ZdccsnGjRuPOeaYFhWSD+zs7Lz55ptvvvnmJ5988r777qtUKgCKxeKkjEn+la6uLiJKch+pXL2fHqtQKOzdu9cYc95557UC2Wh85zvfEZE777yzpViXXnrpypUrJ0rFnj17rrnmmuSvLr30UhF55ZVXXNdNJGq0009+89xzz4nIlVdemZj9N7E4N910kzHmr//6r5N0w5skSC+//PI4ju+//34A999/v4h885vfHHcASqnkNNevXx9FUU9PTz6fny4eaxrUoiTD+OHh4fvuu4+Zv/Od76xevXrS5Oe432QymR07dmzYsGHdunXnn3/+mWee+f3vfz8Rv02bNiVX8dFHH33ppZdWrFhx7733FgqFOI5NE3Ect7W1fec73znhhBO2bt368MMPJ/boTQRjxowZrXAWhqE9fIVnokDJnj/84Q8B3HHHHdddd93oAzDGRFG0Zs2ab3/721rrH/7wh+VyuZU9SUPh+wBrLTN/61vfuvDCC0877bQnnnjiV7/61c6dO1smPYqiM844o2V7rbVxHDNzEASPPvpo63M2bdrU2dl59dVX//u///sll1yybdu2OI5vvfXWf/u3f7vxxhvXrVv3yCOPDA4OKqWMMcViccOGDccee2y9Xr/11lvL5TKAm2++efny5cmHjz5CY8zs2bOTBMfjjz8O4IYbblizZs3EPZPYes011zBzcmyPPPLIPffc89WvfvWBBx74zGc+8+yzzyamXkSWLFly6aWX5vP5p59++p577hk3AZDifQuI3d3dSRbqcPja174G4Be/+IWIfPzjH0+CVyu0EZHv+7/5zW8Sz3TaaaclH7thw4Y//OEPk37g5s2bkzR9Ehm3bNkib4p//Md/TPb87W9/++Z7Pvjgg77vt3Tr61//el9f36R7/vjHP545c+b0yrxPy7nCE0888eyzzy4Wi6ODQkKaX/7yl5s2bfroRz+6du3aH/3oRy+//PLouzz5ubOz86abburo6HjxxRcfeOCBRJ9c1z3vvPNOOOEEz/OS9EEQBM8///xjjz3WyrAnZF26dGkYhhOvcRRFzzzzzKOPPpoc50c+8pHVq1dP3JOI4jjevHnzQw891Dqp5HXu3Lnr169fsGBB608GBgaefPLJ559/Hulc4R+bW+/xrp30z9+8DOGPN7wffTBv8q+897NOFevtpkwPRwVrbZKASFIAh6umSq6iiCSFA2jWw0yshUpmskdf/je5xqP3f/t7jj6viRxKzijVlBQpUqRIkSJFihQpUqRIkSJFihQpUqRIkSJFihQpUqRIkSJFihQpUqRIkSJFihQpUqRIkSJFihQpUqRIkSJFihQpUqRIkSJFihQpUqRIkSJFihQp3gP+P/q5mS2JnbJXAAAAAElFTkSuQmCC';

export function buildTimeOpts(selected) {
  const opts = ['<option value="">— Hora —</option>'];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      const val = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
      opts.push(`<option value="${val}" ${selected === val ? 'selected' : ''}>${val}</option>`);
    }
  }
  return opts.join('');
}

export function timeSelect(id, value, extraStyle, onchangeFn) {
  return `<select class="inp" id="${id||''}" style="${extraStyle||''}" ${onchangeFn ? `onchange="${onchangeFn}"` : ''}>${buildTimeOpts(value||'')}</select>`;
}

export function llenarSelectEventos() {
  const sel = document.getElementById('jorn-evento');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Sin evento (jornada de depósito suelta) —</option>' +
    state.evCache.map(e => `<option value="${e.id}">${e.codigo} · ${e.cliente_nombre} · ${e.venue || ''}</option>`).join('');
}


// ── INIT ──────────────────────────────────────────────────
export function initDatePickers(root) {
  const container = root || document;
  container.querySelectorAll('input[type="date"]:not(._fp)').forEach(el => {
    el.classList.add('_fp');
    flatpickr(el, {
      locale: 'es',
      dateFormat: 'Y-m-d',
      altInput: true,
      altFormat: 'd/m/Y',
      allowInput: false,
      disableMobile: true,
      parseDate: (dateStr) => {
        const [y, m, d] = dateStr.split('-').map(Number);
        return new Date(y, m - 1, d);
      },
      formatDate: (date, fmt) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        if (fmt === 'Y-m-d') return `${y}-${m}-${d}`;
        if (fmt === 'd/m/Y') return `${d}/${m}/${y}`;
        return `${y}-${m}-${d}`;
      },
    });
  });

  // Flatpickr multi-fecha para evento
  const evFechaEl = document.getElementById('ev-fecha');
  if (evFechaEl && !evFechaEl._flatpickr) {
    flatpickr(evFechaEl, {
      mode: 'multiple',
      locale: 'es',
      dateFormat: 'Y-m-d',
      altInput: true,
      altFormat: 'j M Y',
      conjunction: ', ',
      onChange(selectedDates) {
        renderHorariosEv([...selectedDates].sort((a,b) => a-b));
      },
    });
  }
}

export function renderHorariosEv(dates, horariosGuardados = []) {
  const wrap = document.getElementById('ev-fechas-horarios');
  if (!wrap) return;
  if (!dates.length) { wrap.style.display = 'none'; wrap.innerHTML = ''; return; }
  wrap.style.display = 'flex';
  wrap.innerHTML = dates.map((d, i) => {
    const label = d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
    const val   = horariosGuardados[i] || '';
    return `<div style="display:flex;align-items:center;gap:10px">
      <span style="font-size:12px;color:var(--text-2);min-width:180px;text-transform:capitalize">${label}</span>
      <input type="time" class="inp" data-ev-hora-idx="${i}" value="${val}"
        style="width:120px;font-size:13px" placeholder="--:--">
    </div>`;
  }).join('');
}

export function getHorariosEv() {
  const wrap = document.getElementById('ev-fechas-horarios');
  if (!wrap) return [];
  return Array.from(wrap.querySelectorAll('input[data-ev-hora-idx]'))
    .sort((a,b) => a.dataset.evHoraIdx - b.dataset.evHoraIdx)
    .map(el => el.value || null);
}

