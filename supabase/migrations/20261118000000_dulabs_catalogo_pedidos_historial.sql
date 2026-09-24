-- DuLabs Catálogo — Bloque 21: índice del HISTORIAL de pedidos (panel de la asesora).
--
-- Para qué sirve: el historial muestra los pedidos CERRADOS (completados, cancelados, vencidos) del
-- negocio, del más reciente al más antiguo, de a una página con cursor (keyset por creación +
-- número público). Sin este índice, cada página recorre y ordena TODOS los pedidos cerrados del
-- negocio: medido con 100.000 pedidos cerrados, ~23–26 ms por página y creciendo en línea con el
-- volumen. Con él, cualquier página (la primera o la número mil) cuesta ~0,1 ms.
--
-- Qué hace: SOLO crea un índice parcial (únicamente filas en estado final). No toca datos, no
-- cambia funciones, triggers, permisos ni RLS, y no afecta a AMORE ni a otros módulos.
-- Sin esta migración el historial funciona igual (mismo resultado), solo más lento con mucho volumen.
--
-- Idempotente (IF NOT EXISTS). Tamaño medido: ~8,6 MB por cada 150.000 pedidos cerrados.
-- Con pocos pedidos se crea al instante; si la tabla ya fuera muy grande, puede crearse con
-- CREATE INDEX CONCURRENTLY fuera de una transacción (misma definición).
--
-- Rollback: drop index if exists public.dulabs_catalogo_pedidos_historial_idx;

create index if not exists dulabs_catalogo_pedidos_historial_idx
  on public.dulabs_catalogo_pedidos (id_tenant, created_at desc, pedido_publico desc)
  where estado in ('completed', 'cancelled', 'expired');

comment on index public.dulabs_catalogo_pedidos_historial_idx is
  'Bloque 21 — historial de pedidos cerrados del panel: keyset (created_at, pedido_publico) DESC por negocio.';
