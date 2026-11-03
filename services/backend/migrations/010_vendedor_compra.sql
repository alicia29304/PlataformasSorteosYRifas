-- 010: vendedor elegido por el comprador en la web.
--
-- El comprador puede indicar que vendedor (promotor) lo atendio. Se guarda el
-- id y el nombre del momento (congelado, sin JOIN fragil) para que el admin vea
-- a quien atribuir la venta. Opcional: NULL = "ninguno".
--
-- Idempotente: migrate.js re-ejecuta el archivo en cada arranque en frio.

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS seller_id   UUID,
  ADD COLUMN IF NOT EXISTS seller_name TEXT;
