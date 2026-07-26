CREATE TABLE IF NOT EXISTS archivos_impuestos (
  id              BIGSERIAL PRIMARY KEY,
  costo_fijo_id   BIGINT NOT NULL REFERENCES costos_fijos(id) ON DELETE CASCADE,
  tipo            TEXT NOT NULL CHECK (tipo IN ('factura','comprobante_pago')),
  nombre          TEXT NOT NULL,
  drive_url       TEXT,
  drive_id        TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_archivos_impuestos_costo ON archivos_impuestos(costo_fijo_id);
