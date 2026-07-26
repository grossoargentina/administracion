CREATE TABLE IF NOT EXISTS archivos_finanzas (
  id         BIGSERIAL PRIMARY KEY,
  anio       INT NOT NULL,
  mes        INT NOT NULL,
  tipo       TEXT NOT NULL CHECK (tipo IN ('caja_ahorro_pesos','caja_ahorro_dolares','cuenta_corriente')),
  nombre     TEXT NOT NULL,
  drive_url  TEXT,
  drive_id   TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_archivos_finanzas_periodo ON archivos_finanzas(anio, mes);
