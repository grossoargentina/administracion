-- La tabla se creó con RLS activado y sin políticas, bloqueando lectura y escritura
-- vía la API (la app usa la clave anónima para todo, sin roles de Postgres por usuario)
ALTER TABLE archivos_impuestos DISABLE ROW LEVEL SECURITY;
