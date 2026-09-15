-- AGENDA V2 (autorizado) -- CASO 5 ("evitar bucles"): cuántos mensajes
-- SEGUIDOS no se pudieron interpretar en la sesión activa, sin ningún
-- avance real desde el último. Se reinicia a 0 automáticamente cada vez
-- que se muestra un menú nuevo (ver actualizarSesionAgendaV2,
-- lib/agenda-v2/sesiones.ts) -- nunca requiere que cada punto del router
-- lo reinicie a mano.
--
-- El código YA es defensivo si esta migración todavía no se ha aplicado
-- (ver el catch de "columna no existe", Postgres 42703, en
-- actualizarSesionAgendaV2): Agenda V2 sigue funcionando normalmente, solo
-- sin la protección anti-bucle, hasta que este archivo se corra en
-- producción vía el SQL Editor de Supabase (ver PENDING_MIGRATIONS.md).

alter table dulabs_agenda_v2_sesiones
  add column if not exists intentos_fallidos_consecutivos integer not null default 0;
