-- Notas administrativas: internas, se guardan y se muestran en Fechas, pero NO van al PDF
ALTER TABLE eventos ADD COLUMN IF NOT EXISTS notas_admin text;

CREATE OR REPLACE VIEW v_eventos_base AS
SELECT id, codigo, estado, cliente_id, cliente_nombre, tipo_evento, venue, total_ars,
    monto_base_ars, incluye_iva, pago_diferido, modalidad_pago, sena_monto, sena_cobrada,
    saldo_cobrado, fecha_sena, fecha_saldo, motivo_perdida, presupuesto_url, contrato_url,
    notas, created_at, updated_at, fecha_armado, hora_armado, fecha_desarme, hora_desarme,
    seguro_enviado, salon_id,
    CASE
        WHEN sena_cobrada AND saldo_cobrado THEN 'Cobrado completo'::text
        WHEN sena_cobrada THEN 'Seña cobrada'::text
        WHEN total_ars > 0::numeric THEN 'Sin cobrar'::text
        ELSE '—'::text
    END AS estado_cobro,
    ( SELECT min(j.fecha) AS min
       FROM jornadas j JOIN logistica_eventos le ON le.logistica_id = j.logistica_id
       WHERE le.evento_id = e.id AND j.tipo = 'Operador'::text) AS fecha_evento,
    ( SELECT j.hora_inicio
       FROM jornadas j JOIN logistica_eventos le ON le.logistica_id = j.logistica_id
       WHERE le.evento_id = e.id AND j.tipo = 'Operador'::text
       ORDER BY j.fecha LIMIT 1) AS horario,
    ( SELECT json_agg(j.hora_inicio ORDER BY j.fecha) AS json_agg
       FROM jornadas j JOIN logistica_eventos le ON le.logistica_id = j.logistica_id
       WHERE le.evento_id = e.id AND j.tipo = 'Operador'::text) AS horarios_evento,
    nombre_evento, notas_admin
FROM eventos e;

CREATE OR REPLACE VIEW v_pipeline AS
SELECT id, codigo, estado, cliente_id, cliente_nombre, tipo_evento, venue, total_ars,
    monto_base_ars, incluye_iva, pago_diferido, modalidad_pago, sena_monto, sena_cobrada,
    saldo_cobrado, fecha_sena, fecha_saldo, motivo_perdida, presupuesto_url, contrato_url,
    notas, created_at, updated_at, fecha_armado, hora_armado, fecha_desarme, hora_desarme,
    seguro_enviado, salon_id, estado_cobro, fecha_evento, horario, horarios_evento, nombre_evento, notas_admin
FROM v_eventos_base;

CREATE OR REPLACE VIEW v_eventos AS
SELECT id, codigo, estado, cliente_id, cliente_nombre, tipo_evento, venue, total_ars,
    monto_base_ars, incluye_iva, pago_diferido, modalidad_pago, sena_monto, sena_cobrada,
    saldo_cobrado, fecha_sena, fecha_saldo, motivo_perdida, presupuesto_url, contrato_url,
    notas, created_at, updated_at, fecha_armado, hora_armado, fecha_desarme, hora_desarme,
    seguro_enviado, salon_id, estado_cobro, fecha_evento, horario, horarios_evento, nombre_evento, notas_admin
FROM v_eventos_base
ORDER BY fecha_evento;
