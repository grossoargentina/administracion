-- Recrear v_jornadas sin la columna confirmada
DROP VIEW IF EXISTS v_jornadas;

CREATE VIEW v_jornadas AS
SELECT
  j.id,
  j.codigo,
  j.logistica_id,
  j.tipo,
  j.fecha,
  j.hora_inicio,
  j.personal_id,
  j.pagado,
  j.fecha_pago,
  j.monto_adicional,
  p.nombre  AS personal_nombre,
  p.apellido AS personal_apellido,
  p.tarifa_armado,
  p.tarifa_operador,
  p.tarifa_deposito,
  le.evento_id
FROM jornadas j
LEFT JOIN personal p ON p.id = j.personal_id
LEFT JOIN logistica_eventos le ON le.logistica_id = j.logistica_id;

-- Ahora es seguro dropear la columna
ALTER TABLE jornadas DROP COLUMN IF EXISTS confirmada;
