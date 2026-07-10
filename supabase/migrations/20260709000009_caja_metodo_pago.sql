-- La tabla caja no tenía columna para el método de pago (efectivo/transferencia),
-- pero pagos.ts la inserta al confirmar el pago de personal
ALTER TABLE caja ADD COLUMN IF NOT EXISTS metodo_pago text;
