-- Bloque 24 — VERIFICACIÓN DE PRODUCCIÓN DEL PILOTO DE DELACOUR (SOLO LECTURA).
--
-- Pegar COMPLETO en el SQL Editor de Supabase. No escribe nada (transacción de solo lectura que
-- además termina en ROLLBACK). Devuelve UNA tabla: una fila por control con
--   estado = OK | ALERTA | CRITICO
-- CRITICO => no encender el piloto hasta corregirlo. No muestra teléfonos de clientes, claves ni
-- tokens: los números autorizados se cuentan, no se listan.
--
-- La consulta 2 (al final, aparte) lista las referencias con foto para
-- scripts/piloto/auditar-fotos.mjs.

begin transaction read only;

with t as (select '0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4'::uuid as id),
num as (select c.* from public.dulabs_clientes_config c join t on c.id_tenant = t.id),
ag as (select a.* from public.dulabs_agente_runtime_config a join t on a.id_tenant = t.id),
aut as (
  select n.phone_number_id, x as wa
    from num n, unnest(string_to_array(regexp_replace(coalesce(n.ia_restringida_a, ''), '\s', '', 'g'), ',')) x
   where x <> ''
),
prod as (select p.* from public.dulabs_inventario_productos p join t on p.id_tenant = t.id),
foto as (
  select m.* from public.dulabs_catalogo_media m join t on m.id_tenant = t.id
)
select * from (
  select 1 as orden, 'numero_whatsapp' as control,
         case when count(*) = 1 then 'OK' when count(*) = 0 then 'CRITICO' else 'ALERTA' end as estado,
         'números del negocio: ' || count(*) || ' (' || coalesce(string_agg(phone_number_id, ', '), '-') || ')' as detalle
    from num
  union all
  select 2, 'fila_del_agente',
         case when bool_and(exists (select 1 from ag where ag.phone_number_id = num.phone_number_id)) then 'OK' else 'CRITICO' end,
         'sin fila del agente el número cae a la IA legacy (Claude) si ia_pausada = false'
    from num
  union all
  select 3, 'agente_habilitado', case when bool_and(habilitado) then 'OK' else 'ALERTA' end,
         'habilitado = ' || coalesce(string_agg(habilitado::text, ', '), 'sin fila') || ' (false = el agente calla; no cae a otro bot)'
    from ag
  union all
  select 4, 'proveedor_y_modelo',
         case when bool_and(proveedor = 'gemini' and modelo = 'gemini-3.6-flash') then 'OK' else 'CRITICO' end,
         coalesce(string_agg(proveedor || ' / ' || modelo, ', '), 'sin fila') || ' (especificación: gemini / gemini-3.6-flash; otro modelo => el agente calla)'
    from ag
  union all
  select 5, 'credencial', case when bool_and(credencial_ref = 'env:GEMINI_KEY_DELACOUR') then 'OK' else 'CRITICO' end,
         coalesce(string_agg(credencial_ref, ', '), 'sin fila') || ' (la clave vive SOLO en Vercel; aquí solo el nombre)'
    from ag
  union all
  select 6, 'herramientas', case when bool_and(cardinality(herramientas) = 16) then 'OK' else 'ALERTA' end,
         coalesce(string_agg(cardinality(herramientas)::text, ', '), '0') || ' herramientas (esperado 16)'
    from ag
  union all
  select 7, 'canal', case when bool_and(canal = 'retail') then 'OK' else 'ALERTA' end,
         coalesce(string_agg(canal, ', '), 'sin fila') || ' (el piloto es al detal)'
    from ag
  union all
  select 8, 'limites', 'OK', coalesce(string_agg(coalesce(limites::text, '{}'), ', '), '-') || ' ({} = por defecto: 8/min y 300/día por cliente, 20M tokens/día)'
    from ag
  union all
  select 9, 'ia_pausada (interruptor)', 'OK',
         coalesce(string_agg(phone_number_id || '=' || coalesce(ia_pausada::text, 'null'), ', '), '-') || ' (true = apagado inmediato)'
    from num
  union all
  select 10, 'numeros_autorizados',
         case when bool_and(ia_restringida_a is not null and btrim(ia_restringida_a) <> '') is not true then 'CRITICO'
              when bool_and(regexp_replace(ia_restringida_a, '\s', '', 'g') ~ '^[0-9]{10,15}(,[0-9]{10,15})*$') then 'OK'
              else 'ALERTA' end,
         (select count(*) from aut) || ' números autorizados. Vacío => responde a TODOS. Formato: solo dígitos con indicativo (573001112233), separados por coma; otro formato => ese número no recibe respuesta'
    from num
  union all
  select 11, 'pausas_vigentes_autorizados',
         case when count(*) = 0 then 'OK' else 'ALERTA' end,
         count(*) || ' números autorizados con el chat en pausa (una asesora lo tiene): el agente no les responderá hasta que se devuelva a la IA'
    from public.dulabs_pausas_chat pc join aut on aut.phone_number_id = pc.phone_number_id and aut.wa = pc.telefono_cliente
   where pc.pausado_hasta > now()
  union all
  select 12, 'conexion_whatsapp', case when bool_and(coalesce(estado_conexion, 'conectado') <> 'desconectado') then 'OK' else 'CRITICO' end,
         coalesce(string_agg(coalesce(estado_conexion, 'null'), ', '), '-') || ' / flow_activo=' || coalesce(string_agg(coalesce(flow_activo::text, 'null'), ', '), '-')
    from num
  union all
  select 13, 'suscripcion', case when count(*) > 0 then 'OK' else 'CRITICO' end,
         coalesce(string_agg(plan || ' (' || estado || ')', ', '), 'sin suscripción activa => cupo 0: la IA calla')
    from public.dulabs_suscripciones s join t on s.id_tenant = t.id where s.estado = 'activa'
  union all
  select 14, 'modulo_catalogo', case when bool_or(habilitado) then 'OK' else 'CRITICO' end, 'módulo catálogo habilitado = ' || coalesce(bool_or(habilitado)::text, 'sin fila')
    from public.dulabs_tenant_modulos mo join t on mo.id_tenant = t.id where mo.modulo = 'catalogo'
  union all
  select 15, 'publicacion', case when bool_or(publicado) then 'OK' else 'CRITICO' end,
         'slug=' || coalesce(string_agg(slug, ', '), '-') || ' publicado=' || coalesce(bool_or(publicado)::text, 'sin fila') || ' (sin publicar => no hay fotos para WhatsApp)'
    from public.dulabs_catalogo_publicacion pu join t on pu.id_tenant = t.id
  union all
  select 16, 'catalogo', case when count(*) filter (where activo) > 0 then 'OK' else 'CRITICO' end,
         count(*) filter (where activo) || ' activos; ' || count(*) filter (where activo and precio > 0) || ' con precio; '
         || count(*) filter (where activo and (not controla_stock or stock > 0)) || ' disponibles; '
         || count(*) filter (where activo and precio_mayor is not null) || ' con precio mayorista'
    from prod
  union all
  select 17, 'productos_activos_sin_foto',
         case when count(*) = 0 then 'OK' else 'ALERTA' end,
         count(*) || ' activos sin foto principal (el agente dice que no tiene foto; nunca inventa una)'
    from prod p where p.activo and not exists (select 1 from foto f where f.producto_id = p.id)
  union all
  select 18, 'fotos_formato', case when count(*) filter (where mime_type not in ('image/webp', 'image/jpeg', 'image/png')) = 0 then 'OK' else 'ALERTA' end,
         count(*) || ' fotos; formatos: ' || coalesce((select string_agg(mime_type || '=' || c, ', ') from (select mime_type, count(*) c from foto group by 1) z), '-')
         || ' (WhatsApp recibe SIEMPRE un JPEG generado desde la original)'
    from foto
  union all
  select 19, 'fotos_dimensiones', case when count(*) = 0 then 'OK' else 'ALERTA' end,
         count(*) || ' fotos principales de productos activos con lado menor < 500 px o sin medidas (se ven pequeñas o pixeladas)'
    from foto f join prod p on p.id = f.producto_id
   where p.activo and f.es_principal and (f.ancho is null or f.alto is null or least(f.ancho, f.alto) < 500)
  union all
  select 20, 'migraciones_del_agente',
         case when to_regclass('public.dulabs_agente_buzon') is not null and to_regclass('public.dulabs_agente_trazas') is not null
               and to_regclass('public.dulabs_catalogo_reservas') is not null and to_regclass('public.dulabs_agente_medios_enviados') is not null
               and to_regprocedure('public.dulabs_agente_consumo(uuid,text,text)') is not null
               and to_regprocedure('public.dulabs_agente_diagnosticar(uuid,text,integer)') is not null then 'OK' else 'CRITICO' end,
         'buzón, trazas, reservas, registro de fotos, consumo (topes) y diagnóstico'
  union all
  select 21, 'pedidos_abiertos', 'OK',
         (select count(*) from public.dulabs_catalogo_pedidos o join t on o.id_tenant = t.id where o.estado in ('pending_confirmation', 'confirmed', 'handoff')) || ' abiertos; '
         || (select count(*) from public.dulabs_catalogo_reservas r join t on r.id_tenant = t.id where r.estado = 'activa') || ' reservas activas'
  union all
  select 22, 'actividad_del_agente_24h', 'OK',
         coalesce((select string_agg(resultado || '=' || c, ', ') from (select resultado, count(*) c from public.dulabs_agente_trazas tr join t on tr.id_tenant = t.id where tr.created_at > now() - interval '24 hours' group by 1) z), 'sin turnos en 24 h')
) v
order by orden;

rollback;

-- ---------------------------------------------------------------------------
-- CONSULTA 2 (aparte): referencias activas con foto, para auditar-fotos.mjs
-- ---------------------------------------------------------------------------
-- select string_agg(p.referencia, ',' order by p.referencia) as referencias
--   from public.dulabs_inventario_productos p
--  where p.id_tenant = '0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4' and p.activo
--    and exists (select 1 from public.dulabs_catalogo_media m where m.producto_id = p.id and m.es_principal);
