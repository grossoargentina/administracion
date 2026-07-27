-- Mismo problema que archivos_impuestos y evento_imagenes: se crearon con RLS
-- activado y sin políticas, bloqueando lectura y escritura vía la API (anon key)
ALTER TABLE archivos_contables DISABLE ROW LEVEL SECURITY;
ALTER TABLE archivos_finanzas DISABLE ROW LEVEL SECURITY;
