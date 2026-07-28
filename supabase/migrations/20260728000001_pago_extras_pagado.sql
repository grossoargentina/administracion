ALTER TABLE pago_extras ADD COLUMN IF NOT EXISTS pagado boolean NOT NULL DEFAULT false;
ALTER TABLE pago_extras ADD COLUMN IF NOT EXISTS fecha_pago date;
