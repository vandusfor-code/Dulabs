-- Si esta especialidad necesita que un humano apruebe cada solicitud (como
-- pestañas con Nicol -- también trabaja por fuera, su disponibilidad real no
-- la sabe el sistema) o si puede confirmarse sola en cuanto el horario está
-- libre (como el resto del equipo, agenda 100% dentro del spa). Por defecto
-- en true (manual) -- el comportamiento más seguro para cualquier
-- especialidad nueva que se cree sin pensarlo explícitamente.
alter table public.dulabs_especialistas
  add column if not exists requiere_aprobacion boolean not null default true;
