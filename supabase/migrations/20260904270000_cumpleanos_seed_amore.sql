-- AMORE (Fase 6A, autorizado) — activa el módulo de cumpleaños para AMORE
-- con el mensaje EXACTO aprobado. Ningún otro tenant se ve afectado (no
-- existe fila para nadie más todavía -- cada negocio se activa por su
-- cuenta, ver dulabs_cumpleanos_config). El mensaje es solo de felicitación:
-- no invita a reservar, no vende, no ofrece descuentos.

insert into public.dulabs_cumpleanos_config (id_tenant, activo, mensaje, nombre_negocio, hora_envio, zona_horaria)
values (
  'ed6ae77f-8a0c-483e-a5d9-8ede68eca50f',
  true,
  '🎂✨ ¡Feliz cumpleaños, {{nombre}}!

Hoy queremos recordarte lo especial que eres y desearte un nuevo año lleno de amor, alegría y momentos inolvidables. 💗

Que tengas un día tan bonito como tú. ✨

Con cariño,
AMORE 💗',
  'AMORE',
  '09:00',
  'America/Bogota'
)
on conflict (id_tenant) do update set
  activo = excluded.activo,
  mensaje = excluded.mensaje,
  nombre_negocio = excluded.nombre_negocio,
  hora_envio = excluded.hora_envio,
  zona_horaria = excluded.zona_horaria,
  updated_at = now();
