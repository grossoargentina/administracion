CREATE TABLE IF NOT EXISTS archivos_seguros (
  id          BIGSERIAL PRIMARY KEY,
  evento_id   BIGINT NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL CHECK (tipo IN ('clausulas','certificado')),
  nombre      TEXT NOT NULL,
  drive_url   TEXT,
  drive_id    TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_archivos_seguros_evento ON archivos_seguros(evento_id);
ALTER TABLE archivos_seguros DISABLE ROW LEVEL SECURITY;
