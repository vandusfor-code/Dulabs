-- CMS COMERCIAL (Bloque 29) — VERIFICACIÓN DE SOLO LECTURA para Delacour.
-- No cambia nada: solo mira. Corre en el SQL Editor de Supabase (una sentencia). Sirve ANTES y DESPUÉS de cada paso de la activación.
--
-- Devuelve una fila por comprobación; «ok» es verdadero cuando todo está como se espera en ese momento:
--   migracion_aplicada      las 4 tablas y la función de lectura pública existen
--   rls_activa              las 4 tablas tienen RLS (solo service_role)
--   funciones_solo_service  ninguna función del CMS es ejecutable por anon ni authenticated
--   tienda_unica            existe UNA sola publicación con slug «delacour»
--   modulo_habilitado       el módulo cms_comercial está habilitado para Delacour (falso = todavía apagado: lo esperado antes del script 02)
--   publicados / borradores / pausados   cuántos elementos hay en cada estado (todo en 0 antes de empezar a usar el CMS)
--   otros_negocios          elementos del CMS de OTROS negocios (informativo)
-- Si la migración no está aplicada, esta consulta falla con «relation does not exist»: es la respuesta (primero hay que correr la migración).
with tienda as (
  select id_tenant from public.dulabs_catalogo_publicacion where slug = 'delacour'
),
tablas as (
  select count(*) as n from pg_class where relkind = 'r' and relname in ('dulabs_cms_entidades', 'dulabs_cms_versiones', 'dulabs_cms_auditoria', 'dulabs_cms_assets')
),
funcion as (
  select count(*) as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'dulabs_cms_lectura_activa'
)
select 'migracion_aplicada' as comprobacion, ((select n from tablas) = 4 and (select n from funcion) = 1) as ok, ((select n from tablas)::text || ' tablas, ' || (select n from funcion)::text || ' función de lectura') as detalle
union all
select 'rls_activa', coalesce((select bool_and(relrowsecurity) from pg_class where relkind = 'r' and relname like 'dulabs\_cms\_%'), false), 'las 4 tablas con RLS y sin políticas (solo service_role)'
union all
select 'funciones_solo_service',
       coalesce((select not bool_or(has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
                   from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'dulabs\_cms\_%'), false),
       'ni anon ni authenticated pueden ejecutar las funciones del CMS'
union all
select 'tienda_unica', (select count(*) from tienda) = 1, (select count(*) from tienda)::text || ' publicación(es) con slug delacour'
union all
select 'modulo_habilitado', coalesce((select habilitado from public.dulabs_tenant_modulos where id_tenant = (select id_tenant from tienda limit 1) and modulo = 'cms_comercial'), false), 'falso = módulo apagado (lo esperado hasta correr el script 02)'
union all
select 'publicados', true, (select count(*) from public.dulabs_cms_entidades where id_tenant = (select id_tenant from tienda limit 1) and estado = 'publicada')::text
union all
select 'borradores', true, (select count(*) from public.dulabs_cms_entidades where id_tenant = (select id_tenant from tienda limit 1) and estado = 'borrador')::text
union all
select 'pausados', true, (select count(*) from public.dulabs_cms_entidades where id_tenant = (select id_tenant from tienda limit 1) and estado = 'pausada')::text
union all
select 'otros_negocios', true, (select count(*) from public.dulabs_cms_entidades where id_tenant <> (select id_tenant from tienda limit 1))::text;
