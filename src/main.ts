// Entry point - imports all modules which self-register via window assignments
import { state } from './state';
import { openModal, closeModal } from './helpers';
window.state = state; // expose for inline HTML handlers (e.g. state.clienteBeneficiarios[i].nombre)
window.openModal = openModal;
window.closeModal = closeModal;
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
