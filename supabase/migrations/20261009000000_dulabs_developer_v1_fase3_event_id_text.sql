-- DuLabs Developer V1 -- Fase 3 (Infraestructura, autorizado). Corrección
-- de esquema encontrada al correr los tests E2E reales contra Postgres
-- (evidencia real, no anticipada en el diseño): dulabs_dev_events.event_id
-- se creó como `uuid` en Fase 2, pero el diseño de Fase 3 (sección A del
-- documento, corregido explícitamente en la ronda 3 de revisión) exige
-- `event_id = SHA-256(canonicalización determinista del payload)` -- un
-- hex de 64 caracteres, NO un UUID. Ambas decisiones fueron correctas para
-- su momento; esta migración las hace compatibles cambiando el tipo de la
-- columna, sin tocar la garantía de unicidad/dedupe que ya la protegía.
--
-- Segura: 0 filas reales en producción en esta tabla al momento de
-- escribir esto (Developer V1 sigue sin desarrolladores reales todavía),
-- así que no hay valores UUID existentes que convertir.

alter table public.dulabs_dev_events
  alter column event_id type text;

comment on column public.dulabs_dev_events.event_id is
  'SHA-256 (hex, 64 caracteres) de la canonicalización determinista del payload del webhook de Meta -- ver lib/developer/meta-event-id.ts (Fase 3). Antes era uuid (Fase 2); cambiado a text porque el formato mandado por el diseño de Fase 3 no es un UUID. UNIQUE(event_id) se mantiene sin cambios (ver migración de Fase 2).';
