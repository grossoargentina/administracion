DROP VIEW IF EXISTS v_eventos;
DROP VIEW IF EXISTS v_pipeline;

CREATE VIEW v_eventos AS
SELECT id, codigo, estado, cliente_id, cliente_nombre, tipo_evento, venue, total_ars,
    modalidad_pago, sena_cobrada, saldo_cobrado, fecha_sena, fecha_saldo, motivo_perdida,
    presupuesto_url, contrato_url, notas, created_at, updated_at, fecha_armado, hora_armado,
    fecha_desarme, hora_desarme, seguro_enviado, salon_id, sena_monto,
    CASE
        WHEN (sena_cobrada AND saldo_cobrado) THEN 'Cobrado completo'
        WHEN sena_cobrada THEN 'Seña cobrada'
        WHEN (total_ars > 0) THEN 'Sin cobrar'
        ELSE '—'
    END AS estado_cobro,
    ( SELECT min(j.fecha) FROM jornadas j
      JOIN logistica_eventos le ON le.logistica_id = j.logistica_id
      WHERE le.evento_id = e.id AND j.tipo = 'Operador') AS fecha_evento,
    ( SELECT j.hora_inicio FROM jornadas j
      JOIN logistica_eventos le ON le.logistica_id = j.logistica_id
      WHERE le.evento_id = e.id AND j.tipo = 'Operador'
      ORDER BY j.fecha LIMIT 1) AS horario,
    ( SELECT json_agg(j.hora_inicio ORDER BY j.fecha) FROM jornadas j
      JOIN logistica_eventos le ON le.logistica_id = j.logistica_id
      WHERE le.evento_id = e.id AND j.tipo = 'Operador') AS horarios_evento,
    monto_base_ars, incluye_iva, pago_diferido
FROM eventos e
ORDER BY ( SELECT min(j.fecha) FROM jornadas j
           JOIN logistica_eventos le ON le.logistica_id = j.logistica_id
           WHERE le.evento_id = e.id AND j.tipo = 'Operador');

CREATE VIEW v_pipeline AS
SELECT id, codigo, estado, cliente_id, cliente_nombre, tipo_evento, venue, total_ars,
    modalidad_pago, sena_cobrada, saldo_cobrado, fecha_sena, fecha_saldo, motivo_perdida,
    presupuesto_url, contrato_url, notas, created_at, updated_at, fecha_armado, hora_armado,
    fecha_desarme, hora_desarme, seguro_enviado, salon_id, sena_monto,
    ( SELECT min(j.fecha) FROM jornadas j
      JOIN logistica_eventos le ON le.logistica_id = j.logistica_id
      WHERE le.evento_id = e.id AND j.tipo = 'Operador') AS fecha_evento,
    ( SELECT j.hora_inicio FROM jornadas j
      JOIN logistica_eventos le ON le.logistica_id = j.logistica_id
      WHERE le.evento_id = e.id AND j.tipo = 'Operador'
      ORDER BY j.fecha LIMIT 1) AS horario,
    ( SELECT json_agg(j.hora_inicio ORDER BY j.fecha) FROM jornadas j
      JOIN logistica_eventos le ON le.logistica_id = j.logistica_id
      WHERE le.evento_id = e.id AND j.tipo = 'Operador') AS horarios_evento,
    monto_base_ars, incluye_iva, pago_diferido
FROM eventos e;
