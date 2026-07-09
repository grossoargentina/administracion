-- Trigger para auto-setear grupo_id = id en presupuestos nuevos sin grupo
CREATE OR REPLACE FUNCTION set_grupo_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.grupo_id IS NULL THEN
    NEW.grupo_id := NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_grupo_id ON presupuestos;
CREATE TRIGGER trg_set_grupo_id
  BEFORE INSERT ON presupuestos
  FOR EACH ROW EXECUTE FUNCTION set_grupo_id();
