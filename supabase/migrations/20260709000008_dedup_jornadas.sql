-- Eliminar jornadas duplicadas (mismo logistica_id + tipo + fecha + personal_id)
-- Mantiene la de menor id
DELETE FROM jornadas
WHERE id NOT IN (
  SELECT MIN(id)
  FROM jornadas
  WHERE personal_id IS NOT NULL
  GROUP BY logistica_id, tipo, fecha, personal_id
)
AND personal_id IS NOT NULL;
