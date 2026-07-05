import { SB_URL, SB_KEY, ALLOWED_EMAILS } from './config.js';
import { sb, llenarSelectEventos, buildTimeOpts, initDatePickers } from './helpers.js';
import { state } from './state.js';

// ── AUTH SUPABASE + GOOGLE ────────────────────────────────

// Inicializar cliente Supabase Auth via CDN
const { createClient } = supabase;
state.supabaseClient = createClient(SB_URL, SB_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const isAllowedEmail = email => ALLOWED_EMAILS.includes(email);
let _appInitialized = false;

export async function initAuth() {
  const hasOAuthHash = window.location.hash.includes('access_token');

  state.supabaseClient.auth.onAuthStateChange(async (event, session) => {
    console.log('Auth event:', event, session?.user?.email);

    if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
      if (isAllowedEmail(session?.user?.email)) {
        state.AUTH = true;
        if (session.provider_token)
          localStorage.setItem('drive_token', session.provider_token);
        if (session.provider_refresh_token)
          localStorage.setItem('drive_refresh_token', session.provider_refresh_token);
        if (window.location.hash)
          history.replaceState(null, '', window.location.pathname);
        // Solo inicializar la app una vez por carga de página
        if (!_appInitialized) {
          _appInitialized = true;
          showApp();
        }
      } else if (session?.user?.email) {
        await state.supabaseClient.auth.signOut();
        showError('Cuenta no autorizada: ' + session.user.email);
        renderGoogleBtn();
      }
    } else if (event === 'SIGNED_OUT') {
      state.AUTH = false;
      _appInitialized = false;
      document.getElementById('app').classList.remove('visible');
      document.getElementById('login-screen').style.display = 'flex';
      renderGoogleBtn();
    }
  });

  // Verificar sesión existente al cargar
  const { data: { session } } = await state.supabaseClient.auth.getSession();
  if (isAllowedEmail(session?.user?.email)) {
    state.AUTH = true;
    if (!_appInitialized) {
      _appInitialized = true;
      showApp();
    }
    return;
  }

  if (hasOAuthHash) {
    setTimeout(() => { if (!state.AUTH) renderGoogleBtn(); }, 3000);
    return;
  }

  renderGoogleBtn();
}

// Re-chequear sesión cuando el usuario vuelve a la pestaña
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || state.AUTH) return;
  const { data: { session } } = await state.supabaseClient.auth.getSession();
  if (isAllowedEmail(session?.user?.email)) {
    state.AUTH = true;
    if (!_appInitialized) { _appInitialized = true; showApp(); }
  }
});

// Refrescar el token de Google cada 50 minutos (expira al hora)
setInterval(async () => {
  if (!state.AUTH) return;
  try {
    const { data: { session } } = await state.supabaseClient.auth.getSession();
    if (session?.provider_refresh_token) {
      localStorage.setItem('drive_refresh_token', session.provider_refresh_token);
    }
    if (session?.provider_token) {
      localStorage.setItem('drive_token', session.provider_token);
    }
    if (window.refreshDriveToken) await window.refreshDriveToken();
  } catch(e) { console.warn('Token refresh silencioso falló:', e); }
}, 50 * 60 * 1000);


export function renderGoogleBtn() {
  document.getElementById('g-signin-btn').innerHTML = `
    <button class="g-custom-btn" onclick="loginConGoogle()">
      <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google">
      Continuar con Google
    </button>`;
}

export async function loginConGoogle() {
  const { error } = await state.supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.href,
      scopes: 'https://www.googleapis.com/auth/drive',
      queryParams: {
        access_type: 'offline',
        // 'consent' fuerza re-autorización siempre; solo pedir cuando no hay refresh_token
        prompt: localStorage.getItem('drive_refresh_token') ? 'select_account' : 'consent',
      },
    }
  });
  if (error) showError('Error al conectar con Google: ' + error.message);
}

export function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').classList.add('visible');
  initApp();
}

export function showError(msg) {
  document.getElementById('l-err').textContent = msg;
}

export async function logout() {
  await state.supabaseClient.auth.signOut();
  state.AUTH = false;
  document.getElementById('app').classList.remove('visible');
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('l-err').textContent = '';
}


// ── NAVEGACIÓN ────────────────────────────────────────────

export function goTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.mobile-nav-item').forEach(n => n.classList.remove('active'));

  document.getElementById(`p-${page}`).classList.add('active');

  document.querySelectorAll('.nav-item[data-page]').forEach(n => {
    if (n.dataset.page === page) n.classList.add('active');
  });
  document.querySelectorAll('.mobile-nav-item[data-page]').forEach(n => {
    if (n.dataset.page === page) n.classList.add('active');
  });

  state.currentPage = page;
  localStorage.setItem('lastPage', page);
  loadPage(page);
}

export async function loadPage(page) {
  switch(page) {
    case 'dashboard':  window.loadDashboard(); break;
    case 'eventos':    window.loadEventos(); break;
    case 'cobros':     window.loadCobros(); break;
    case 'jornadas':   window.loadJornadas(); break;
    case 'logistica':  state.logOffset = 0; window.loadLogisticas(); break;
    case 'pagos':      window.loadPagos(); break;
    case 'caja':       window.loadCaja(); break;
    case 'mensajes':   window.loadMensajes(); break;
    case 'finanzas':   window.loadFinanzas(); break;
    case 'personal':   window.loadPersonal(); break;
    case 'impuestos':  window.loadImpuestos(); break;
    case 'presupuestos': window.loadPresupuestos(); break;
    case 'catalogo':   window.loadCatalogo(); break;
    case 'salones':    window.loadSalones(); break;
    case 'clientes':   window.loadClientes(); break;
    case 'gastos':     window.loadGastos(); break;
  }
}

export async function initApp() {
  const fecha = new Date();
  document.getElementById('dash-fecha').textContent =
    fecha.toLocaleDateString('es-AR', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  try {
    const _pc = await sb('personal', { filters:['activo=eq.true'], order:'nombre' });
    const _ec = await sb('v_eventos', { filters:['estado=in.(Confirmado,Realizado,Cobrado)'], order:'fecha_evento' });
    state.persCache = _pc;
    state.evCache = _ec;
    llenarSelectEventos();
    ['ev-hora-armado','ev-hora-desarme'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = buildTimeOpts('');
    });
  } catch(e) {}

  initDatePickers();
  initRealtime();
  window.checkMensajesNuevos();
  setInterval(() => window.checkMensajesNuevos(), 60000);
  const lastPage = localStorage.getItem('lastPage') || 'dashboard';
  goTo(lastPage);
}

export function initRealtime() {
  const canalesActivos = state.supabaseClient.getChannels();
  if (canalesActivos.some(c => c.topic === 'realtime:realtime-cambios')) return;
  const tablaAPagina = {
    eventos:    ['dashboard', 'eventos', 'cobros'],
    jornadas:   ['jornadas', 'dashboard'],
    logisticas: ['logistica'],
    personal:   ['personal'],
    cobros:     ['cobros', 'dashboard'],
    costos_fijos: ['impuestos', 'dashboard'],
    presupuestos: ['presupuestos', 'dashboard'],
  };

  let reloadTimer = null;
  const reloadSiCorresponde = (tabla) => {
    const paginas = tablaAPagina[tabla] || [];
    if (!paginas.includes(state.currentPage)) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => loadPage(state.currentPage), 600);
  };

  state.supabaseClient
    .channel('realtime-cambios')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'eventos' },    () => reloadSiCorresponde('eventos'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'jornadas' },   () => reloadSiCorresponde('jornadas'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'logisticas' }, () => reloadSiCorresponde('logisticas'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'personal' },   () => reloadSiCorresponde('personal'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pagos' },      () => reloadSiCorresponde('cobros'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'costos_fijos'},() => reloadSiCorresponde('costos_fijos'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'presupuestos'},() => reloadSiCorresponde('presupuestos'))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'whatsapp_mensajes'}, () => {
      window.checkMensajesNuevos();
      if (state.currentPage === 'mensajes') window.loadMensajes();
    })
    .subscribe();
}

// Window assignments
window.goTo = goTo;
window.loadPage = loadPage;
window.initApp = initApp;
window.initAuth = initAuth;
window.initRealtime = initRealtime;
window.renderGoogleBtn = renderGoogleBtn;
window.loginConGoogle = loginConGoogle;
window.showApp = showApp;
window.showError = showError;
window.logout = logout;

initAuth();
