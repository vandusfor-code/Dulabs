# AMORE — scripts de producción para «Mi cita»

Los corre el dueño en el SQL Editor de Supabase. **Nada de esto se ejecutó desde el repositorio.** Validados en un Postgres local efímero (PGlite) con datos de prueba:
solo se reparan las citas futuras y activas de AMORE con identidad del portal antiguo; no se toca ninguna otra cita ni otro negocio; el segundo run no cambia nada;
la reversa devuelve el estado de antes.

Orden:

1. Migración `supabase/migrations/20261209000000_dulabs_cita_enlaces.sql` (ver `PENDING_MIGRATIONS.md`).
2. `01_diagnostico_citas_solo_lectura.sql` — **solo lectura**. Devuelve un json: migración aplicada, citas futuras activas, cuántas son invisibles para el bot
   (identidad legacy o teléfono sin normalizar), cuántas no tienen evento en Google Calendar y el detalle (teléfono enmascarado).
3. Si `invisibles_para_el_chat` > 0: `02_reparar_identidad_citas_portal.sql` — una sola sentencia atómica e idempotente. Devuelve los valores anteriores de cada cita
   reparada (guárdalos: la reversa está en el encabezado del script). No crea los eventos de Google que esas citas nunca tuvieron.

Contexto y riesgos: `docs/AMORE_RESERVAS_POR_ENLACE.md`.
