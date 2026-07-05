// Entry point - imports all modules which self-register via window assignments
import { state } from './state';
import { openModal, closeModal, toast } from './helpers';
import { invalidateCache, clearCache } from './query-cache';
window.state = state; // expose for inline HTML handlers (e.g. state.clienteBeneficiarios[i].nombre)
window.openModal = openModal;
window.closeModal = closeModal;
window.toast = toast;
window.invalidateCache = invalidateCache;
window.clearCache = clearCache;

window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled promise rejection:', e.reason);
  const msg = (e.reason as any)?.message || String(e.reason) || 'Error inesperado';
  (window as any).toast?.('Error: ' + msg, 'err');
});
import './auth.js';
import './pages/dashboard.js';
import './pages/eventos.js';
import './pages/logistica.js';
import './pages/pagos.js';
import './pages/finanzas.js';
import './pages/mensajes.js';
import './pages/gastos.js';
import './pages/personal.js';
import './pages/impuestos.js';
import './pages/presupuestos.js';
