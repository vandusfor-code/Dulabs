-- DuLabs — catalog_sales multi-negocio, FASE 2: transcripción de notas de voz (por número, APAGADA por defecto).
--
-- Con dulabs_agente_runtime_config.transcripcion_audio = true, una nota de voz del cliente se descarga de
-- Meta con la credencial del negocio, se transcribe con el proveedor y la clave del negocio (credencial_ref)
-- y entra como TEXTO del cliente al mismo camino que un mensaje escrito (buzón, intérprete, guardas):
-- misma autoridad, nunca un botón ni una confirmación. Si no se puede, se pide escrita (como hoy).
-- Ver lib/agente/transcripcion-audio.ts.
--
-- ADITIVA E IDEMPOTENTE: solo agrega la columna con false. No cambia ninguna fila: Delacour y cualquier
-- otro número siguen exactamente igual hasta que se encienda explícitamente.
-- Orden de despliegue indiferente: el código lee la fila sin esta columna como "apagada".
--
-- Rollback: alter table public.dulabs_agente_runtime_config drop column if exists transcripcion_audio;

alter table public.dulabs_agente_runtime_config
  add column if not exists transcripcion_audio boolean not null default false;

comment on column public.dulabs_agente_runtime_config.transcripcion_audio is
  'FASE 2 — true: las notas de voz se transcriben (credencial y modelo del negocio) y entran como texto del cliente, con su misma autoridad. false: se pide escrito.';
