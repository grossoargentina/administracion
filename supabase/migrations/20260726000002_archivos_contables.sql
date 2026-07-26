CREATE TABLE IF NOT EXISTS archivos_contables (
  id          BIGSERIAL PRIMARY KEY,
  evento_id   BIGINT NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL CHECK (tipo IN ('pago','factura','retenciones')),
  nombre      TEXT NOT NULL,
  drive_url   TEXT,
  drive_id    TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_archivos_contables_evento ON archivos_contables(evento_id);
