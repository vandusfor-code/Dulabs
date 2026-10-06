-- AMORE «Mi cita» — REPARA la identidad de las citas FUTURAS que creó el portal antiguo, para que el bot de WhatsApp las encuentre.
--
-- PROBLEMA: el portal antiguo (/reservar/amore, antes del cambio a «Mi cita») guardaba la cita con el phone_number_id LEGACY de Meta («pendiente-amore-…») y con
-- el teléfono tal como lo escribió la clienta («314 812 7388»). El bot de WhatsApp busca por «whatsapp-qr:<negocio>» y el teléfono normalizado («573148127388»), así que
-- NO encontraba esas citas al pedir cancelar, cambiar o consultar. Las citas nuevas ya se crean bien; esto arregla las que quedaron.
--
-- QUÉ HACE (UNA sola sentencia, atómica): en las citas FUTURAS y activas (pendiente / confirmada) de AMORE cuya identidad no es la del chat:
--   · phone_number_id  -> 'whatsapp-qr:<negocio>';
--   · telefono_cliente -> solo dígitos con indicativo (10 dígitos que empiezan por 3 -> '57' + dígitos), la misma regla que usa el bot (normalizarTelefono), SOLO si
--     el resultado tiene entre 10 y 15 dígitos (un teléfono que no se pueda interpretar se deja como está: no se inventa nada).
--   Devuelve una fila por cita reparada con los valores ANTERIORES (guárdalos: sirven para revertir).
-- QUÉ NO HACE: no toca citas pasadas, canceladas ni de otro negocio; no crea ni borra nada; no toca fechas, servicios ni profesionales; no envía mensajes;
--   NO crea los eventos de Google Calendar que esas citas nunca tuvieron (eso no es una escritura en la base: ver el diagnóstico 01).
-- Idempotente: volver a correrlo no cambia nada ni devuelve filas (ya no quedan citas por reparar).
--
-- REVERSA (por cada fila devuelta, con sus valores anteriores):
--   update public.dulabs_citas_especialista set phone_number_id = '<phone_number_id_anterior>', telefono_cliente = '<telefono_anterior>' where id = <cita_id>;
--   (si telefono_anterior vino vacío: telefono_cliente = null)

with base as (
  select c.id, c.phone_number_id as phone_number_id_anterior, c.telefono_cliente as telefono_anterior,
         regexp_replace(coalesce(c.telefono_cliente, ''), '\D', '', 'g') as digitos
    from public.dulabs_citas_especialista c
   where c.id_tenant = 'ed6ae77f-8a0c-483e-a5d9-8ede68eca50f'::uuid
     and c.estado in ('pendiente', 'confirmada')
     and c.inicio >= now()
),
normalizadas as (
  select b.*,
         case when length(b.digitos) = 10 and b.digitos like '3%' then '57' || b.digitos else b.digitos end as telefono_normalizado
    from base b
),
reparables as (
  select n.*, (length(n.telefono_normalizado) between 10 and 15) as telefono_interpretable
    from normalizadas n
   where n.phone_number_id_anterior is distinct from 'whatsapp-qr:ed6ae77f-8a0c-483e-a5d9-8ede68eca50f'
      or (length(n.telefono_normalizado) between 10 and 15 and n.telefono_normalizado <> coalesce(n.telefono_anterior, ''))
),
actualizadas as (
  update public.dulabs_citas_especialista c
     set phone_number_id = 'whatsapp-qr:ed6ae77f-8a0c-483e-a5d9-8ede68eca50f',
         telefono_cliente = case when r.telefono_interpretable then r.telefono_normalizado else c.telefono_cliente end,
         updated_at = now()
    from reparables r
   where c.id = r.id and c.id_tenant = 'ed6ae77f-8a0c-483e-a5d9-8ede68eca50f'::uuid
  returning c.id
)
select r.id as cita_id, r.phone_number_id_anterior, r.telefono_anterior,
       'whatsapp-qr:ed6ae77f-8a0c-483e-a5d9-8ede68eca50f' as phone_number_id_nuevo,
       case when r.telefono_interpretable then r.telefono_normalizado else r.telefono_anterior end as telefono_nuevo
  from reparables r join actualizadas a on a.id = r.id
 order by r.id;
