-- Imágenes de referencia por evento
CREATE TABLE IF NOT EXISTS evento_imagenes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  evento_id bigint NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  imagen_base64 text NOT NULL,
  nombre text,
  orden int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Fotos adicionales por producto de catálogo
ALTER TABLE catalogo ADD COLUMN IF NOT EXISTS fotos_adicionales jsonb DEFAULT '[]';
