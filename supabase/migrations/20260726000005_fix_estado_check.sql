ALTER TABLE eventos DROP CONSTRAINT IF EXISTS eventos_estado_check;

ALTER TABLE eventos ADD CONSTRAINT eventos_estado_check
  CHECK (estado IN ('Confirmado', 'En logística', 'Realizado', 'Cobrado', 'Perdido', 'Dado de baja'));
