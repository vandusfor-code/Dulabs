-- AMORE «Mi cita» — DIAGNÓSTICO de las citas futuras (SOLO LECTURA: un único SELECT, no escribe nada).
--
-- Corre en el SQL Editor de Supabase. Devuelve UN json con:
--   · si la migración 20261209 (tabla dulabs_cita_enlaces) está aplicada;
--   · cuántas citas FUTURAS y activas (pendiente / confirmada) tiene AMORE;
--   · cuántas quedaron con la identidad del portal ANTIGUO (phone_number_id legacy de Meta o un teléfono sin normalizar): el bot de WhatsApp NO las encuentra al
--     pedir cancelar, cambiar o consultar. 02_reparar_identidad_citas_portal.sql las corrige (usa exactamente los mismos criterios);
--   · cuántas NO tienen su evento de Google Calendar guardado (las que creó el portal antiguo nunca lo tuvieron): no bloquean el calendario de la profesional;
--   · el detalle de las afectadas (teléfono enmascarado: solo los 4 últimos dígitos).
-- No muestra nombres completos, correos ni tokens.

with params as (
  select 'ed6ae77f-8a0c-483e-a5d9-8ede68eca50f'::uuid as t
),
futuras as (
  select c.id, c.especialista_id, c.inicio, c.estado, c.phone_number_id, c.telefono_cliente,
         regexp_replace(coalesce(c.telefono_cliente, ''), '\D', '', 'g') as digitos,
         exists (select 1 from public.dulabs_agenda_v2_citas_nylas n where n.cita_id = c.id) as tiene_evento
    from public.dulabs_citas_especialista c, params p
   where c.id_tenant = p.t and c.estado in ('pendiente', 'confirmada') and c.inicio >= now()
),
normalizadas as (
  select f.*,
         case when length(f.digitos) = 10 and f.digitos like '3%' then '57' || f.digitos else f.digitos end as telefono_normalizado
    from futuras f
),
marcadas as (
  select n.*,
         (n.phone_number_id is distinct from 'whatsapp-qr:' || (select t from params)::text) as identidad_legacy,
         (length(n.telefono_normalizado) between 10 and 15 and n.telefono_normalizado <> coalesce(n.telefono_cliente, '')) as telefono_sin_normalizar
    from normalizadas n
)
select jsonb_pretty(jsonb_build_object(
  'migracion_20261209_aplicada', to_regclass('public.dulabs_cita_enlaces') is not null,
  'citas_futuras_activas', (select count(*) from marcadas),
  'con_identidad_legacy', (select count(*) from marcadas where identidad_legacy),
  'con_telefono_sin_normalizar', (select count(*) from marcadas where telefono_sin_normalizar),
  'invisibles_para_el_chat', (select count(*) from marcadas where identidad_legacy or telefono_sin_normalizar),
  'sin_evento_en_google_calendar', (select count(*) from marcadas where not tiene_evento),
  'detalle_invisibles_para_el_chat', coalesce((
    select jsonb_agg(jsonb_build_object(
             'cita_id', m.id,
             'inicio', m.inicio,
             'estado', m.estado,
             'profesional', (select e.nombre from public.dulabs_especialistas e where e.id = m.especialista_id),
             'telefono_final', right(m.digitos, 4),
             'identidad_legacy', m.identidad_legacy,
             'telefono_sin_normalizar', m.telefono_sin_normalizar,
             'sin_evento_en_google', not m.tiene_evento) order by m.inicio)
      from marcadas m where m.identidad_legacy or m.telefono_sin_normalizar), '[]'::jsonb)
));
