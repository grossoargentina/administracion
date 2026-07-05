// Shared mutable state — imported by modules that need cross-module state
export const state = {
  // Auth
  AUTH: false,
  supabaseClient: null,

  // Caches preloaded on app init
  evCache: [],
  persCache: [],

  // Navigation
  currentPage: 'dashboard',

  // Shared between logistica ↔ pagos
  logOffset: 0,

  // Shared between logistica ↔ presupuestos
  _presupuestoParaEventoId: null,

  // Shared between eventos ↔ presupuestos
  clienteBeneficiarios: [],
  salonBeneficiarios: [],
  _sortState: {},
  _acData: {},
};
