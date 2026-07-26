CREATE TABLE IF NOT EXISTS personal_tarifas_historial (
  id          BIGSERIAL PRIMARY KEY,
  personal_id BIGINT NOT NULL REFERENCES personal(id) ON DELETE CASCADE,
  fecha       DATE NOT NULL,
  tarifa_deposito  NUMERIC DEFAULT 0,
  tarifa_armado    NUMERIC DEFAULT 0,
  tarifa_operador  NUMERIC DEFAULT 0,
  notas       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pth_personal ON personal_tarifas_historial(personal_id, fecha);
ALTER TABLE personal_tarifas_historial DISABLE ROW LEVEL SECURITY;
