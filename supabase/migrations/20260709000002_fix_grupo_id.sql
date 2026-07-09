-- Fijar grupo_id = id en presupuestos que no tienen grupo asignado
UPDATE presupuestos SET grupo_id = id WHERE grupo_id IS NULL;
