-- ── 1. ÍNDICES ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_jornadas_logistica_id ON jornadas(logistica_id);
CREATE INDEX IF NOT EXISTS idx_jornadas_tipo        ON jornadas(tipo);
CREATE INDEX IF NOT EXISTS idx_jornadas_fecha       ON jornadas(fecha);
CREATE INDEX IF NOT EXISTS idx_logistica_eventos_evento_id ON logistica_eventos(evento_id);
CREATE INDEX IF NOT EXISTS idx_presupuestos_grupo_id ON presupuestos(grupo_id);
CREATE INDEX IF NOT EXISTS idx_presupuestos_estado  ON presupuestos(estado_evento);

-- ── 2. evento_id DIRECTO EN logisticas ─────────────────────────────────────
ALTER TABLE logisticas ADD COLUMN IF NOT EXISTS evento_id integer REFERENCES eventos(id) ON DELETE SET NULL;

-- Backfill desde logistica_eventos (tomar el primer evento para no-Deposito)
UPDATE logisticas l
SET evento_id = (
  SELECT le.evento_id FROM logistica_eventos le
  WHERE le.logistica_id = l.id
  LIMIT 1
)
WHERE l.tipo != 'Deposito' AND l.evento_id IS NULL;

-- ── 3. VISTAS CONSOLIDADAS ──────────────────────────────────────────────────
DROP VIEW IF EXISTS v_eventos;
DROP VIEW IF EXISTS v_pipeline;

-- Eliminar columna horarios_evento de eventos (se deriva de jornadas via vista)
ALTER TABLE eventos DROP COLUMN IF EXISTS horarios_evento;

-- Vista base con todos los campos derivados
CREATE VIEW v_eventos_base AS
SELECT
  e.id, e.codigo, e.estado, e.cliente_id, e.cliente_nombre, e.tipo_evento, e.venue,
  e.total_ars, e.monto_base_ars, e.incluye_iva, e.pago_diferido, e.modalidad_pago,
  e.sena_monto, e.sena_cobrada, e.saldo_cobrado, e.fecha_sena, e.fecha_saldo,
  e.motivo_perdida, e.presupuesto_url, e.contrato_url, e.notas,
  e.created_at, e.updated_at, e.fecha_armado, e.hora_armado, e.fecha_desarme, e.hora_desarme,
  e.seguro_enviado, e.salon_id,
  CASE
    WHEN (e.sena_cobrada AND e.saldo_cobrado) THEN 'Cobrado completo'
    WHEN e.sena_cobrada THEN 'Seña cobrada'
    WHEN (e.total_ars > 0) THEN 'Sin cobrar'
    ELSE '—'
  END AS estado_cobro,
  ( SELECT min(j.fecha)
    FROM jornadas j
    JOIN logistica_eventos le ON le.logistica_id = j.logistica_id
    WHERE le.evento_id = e.id AND j.tipo = 'Operador'
  ) AS fecha_evento,
  ( SELECT j.hora_inicio
    FROM jornadas j
    JOIN logistica_eventos le ON le.logistica_id = j.logistica_id
    WHERE le.evento_id = e.id AND j.tipo = 'Operador'
    ORDER BY j.fecha LIMIT 1
  ) AS horario,
  ( SELECT json_agg(j.hora_inicio ORDER BY j.fecha)
    FROM jornadas j
    JOIN logistica_eventos le ON le.logistica_id = j.logistica_id
    WHERE le.evento_id = e.id AND j.tipo = 'Operador'
  ) AS horarios_evento
FROM eventos e;

CREATE VIEW v_eventos AS
SELECT * FROM v_eventos_base
ORDER BY fecha_evento;

CREATE VIEW v_pipeline AS
SELECT * FROM v_eventos_base;
