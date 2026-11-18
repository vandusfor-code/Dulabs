-- AGENTE DE DELACOUR (ARIA) — VERIFICACIÓN DE SOLO LECTURA. No cambia nada: solo mira.
-- Corre en el SQL Editor de Supabase (una sentencia). Sirve cuando quieras saber «¿está sano el agente?»: ANTES de abrirlo al público, DESPUÉS de cada cambio y cuando algo se vea raro.
--
-- Devuelve una fila por comprobación; «ok» es verdadero cuando está como se espera. Las filas informativas (ok siempre verdadero) solo cuentan algo.
--   CONFIGURACIÓN   tienda_unica · fila_del_agente · proveedor_y_modelo · credencial_por_referencia · nivel_de_razonamiento · herramientas_conocidas · herramientas_de_venta ·
--                   negocio_solo_llaves_conocidas (una llave de más invalida la configuración y el agente CALLA) · canal
--   ACCESO          agente_habilitado · piloto · herramientas_comerciales (informativas: quién recibe qué)
--   CATÁLOGO        modulo_catalogo · modulo_cms_comercial · funcion_de_busqueda · columna_genero · piezas_activas · piezas_de_hombre · piezas_con_precio_cero · piezas_sin_precio_mayorista · piezas_sin_categoria · piezas_agotadas
--   ÚLTIMOS 7 DÍAS  turnos_7d · resultados_7d · errores_7d · sin_saldo_7d (verdadero = NINGÚN turno falló por crédito o cupo de Gemini agotado) · credencial_rechazada_7d · tokens_7d ·
--                   latencia_p95_ms · ultimo_turno
-- Nunca muestra claves, teléfonos completos ni textos de clientes: la credencial se ve por el NOMBRE de la variable y el piloto por los últimos 4 dígitos.
-- Si una tabla no existe (migración sin aplicar), esta consulta falla con «relation does not exist»: es la respuesta.
--
-- Las listas de herramientas y de llaves de `negocio` salen del código: la prueba agente-verificacion-sql.test.ts las compara y corre esta consulta contra un Postgres embebido.

with tienda as (
  select id_tenant from public.dulabs_catalogo_publicacion where slug = 'delacour'
),
t as (
  select (select id_tenant from tienda limit 1) as id
),
fila as (
  select * from public.dulabs_agente_runtime_config where id_tenant = (select id from t) and tipo = 'catalog_sales'
),
conocidas as (
  select unnest(array['search_products', 'resolve_product_by_reference', 'resolve_product_by_attributes', 'get_product_details', 'get_cart', 'update_cart', 'resolve_order', 'create_order_request', 'validate_order', 'confirm_order', 'get_customer_context', 'request_product_images', 'handoff_to_human', 'get_catalog_link', 'more_products', 'similar_products', 'consultar_envio', 'consultar_ofertas', 'consultar_combos', 'consultar_campanas', 'consultar_contenido_comercial']::text[]) as h
),
de_venta as (
  select unnest(array['search_products', 'resolve_product_by_reference', 'resolve_product_by_attributes', 'get_product_details', 'get_cart', 'update_cart', 'resolve_order', 'create_order_request', 'validate_order', 'confirm_order', 'get_customer_context', 'request_product_images', 'handoff_to_human', 'get_catalog_link', 'more_products', 'similar_products']::text[]) as h
),
llaves as (
  select unnest(array['nombre_agente', 'presentacion', 'tono', 'politicas', 'saludo', 'nombre_negocio', 'personalidad', 'conocimiento', 'comercial_piloto', 'inicio', 'pedido']::text[]) as k
),
piezas as (
  select p.*, to_jsonb(p) ->> 'genero' as genero_texto from public.dulabs_inventario_productos p where p.id_tenant = (select id from t)
),
turnos as (
  select created_at, resultado, traza from public.dulabs_agente_trazas where id_tenant = (select id from t) and tipo = 'turn' and created_at > now() - interval '7 days'
)
select comprobacion, ok, detalle
  from (
    -- CONFIGURACIÓN
    select 10 as o, 'tienda_unica' as comprobacion, (select count(*) from tienda) = 1 as ok, (select count(*) from tienda)::text || ' publicación(es) con slug delacour' as detalle
    union all
    select 11, 'fila_del_agente', (select count(*) from fila) = 1, (select count(*) from fila)::text || ' fila(s) catalog_sales de Delacour en dulabs_agente_runtime_config'
    union all
    select 12, 'proveedor_y_modelo', coalesce((select proveedor = 'gemini' and modelo = 'gemini-3.6-flash' from fila), false), coalesce((select proveedor || ' / ' || modelo from fila), 'sin fila')
    union all
    select 13, 'credencial_por_referencia', coalesce((select credencial_ref ~ '^env:GEMINI_KEY(_[A-Z0-9_]+)?$' from fila), false), coalesce((select credencial_ref from fila), 'sin fila') || ' (solo el NOMBRE de la variable de entorno, nunca la clave)'
    union all
    select 14, 'nivel_de_razonamiento', coalesce((select nivel_razonamiento is null or nivel_razonamiento in ('minimal', 'low', 'medium', 'high') from fila), false), coalesce((select coalesce(nivel_razonamiento, 'por defecto del modelo') from fila), 'sin fila')
    union all
    select 15, 'herramientas_conocidas',
           coalesce((select cardinality(herramientas) > 0 and not exists (select 1 from unnest(herramientas) x where x <> all (array(select h from conocidas))) from fila), false),
           coalesce((select cardinality(herramientas)::text || ' herramienta(s)' || coalesce(' · DESCONOCIDAS: ' || nullif(array_to_string(array(select x from unnest(herramientas) x where x <> all (array(select h from conocidas))), ', '), ''), '') from fila), 'sin fila')
    union all
    select 16, 'herramientas_de_venta',
           coalesce((select not exists (select 1 from de_venta d where d.h <> all (herramientas)) from fila), false),
           coalesce((select case when exists (select 1 from de_venta d where d.h <> all (herramientas)) then 'FALTAN: ' || array_to_string(array(select d.h from de_venta d where d.h <> all (herramientas)), ', ') else 'las 16 de venta están' end from fila), 'sin fila')
    union all
    select 17, 'negocio_solo_llaves_conocidas',
           coalesce((select case when jsonb_typeof(negocio) = 'object' then not exists (select 1 from jsonb_object_keys(negocio) k where k <> all (array(select l.k from llaves l))) else false end from fila), false),
           coalesce((select case when jsonb_typeof(negocio) <> 'object' then 'negocio no es un objeto JSON'
                                 when exists (select 1 from jsonb_object_keys(negocio) k where k <> all (array(select l.k from llaves l))) then 'LLAVES DESCONOCIDAS (el agente callaría): ' || array_to_string(array(select k from jsonb_object_keys(negocio) k where k <> all (array(select l.k from llaves l))), ', ')
                                 else 'llaves: ' || coalesce((select string_agg(k, ', ' order by k) from jsonb_object_keys(negocio) k), '(vacío)') end from fila), 'sin fila')
    union all
    select 18, 'canal', coalesce((select canal = 'retail' from fila), false), coalesce((select canal from fila), 'sin fila') || ' (Delacour atiende al detal: el mayorista lo decide cada cliente)'
    -- ACCESO (informativas)
    union all
    select 20, 'agente_habilitado', true, coalesce((select case when habilitado then 'habilitado' else 'APAGADO (habilitado = false): el número NO cae a ninguna otra IA, simplemente no responde con este agente' end from fila), 'sin fila')
    union all
    select 21, 'piloto', true,
           coalesce((select case when negocio->'comercial_piloto' is null then 'sin piloto: las herramientas comerciales (si las tiene) son para TODOS los clientes'
                                 else 'solo ' || jsonb_array_length(negocio->'comercial_piloto')::text || ' número(s): ' || (select string_agg('…' || right(n, 4), ', ') from jsonb_array_elements_text(negocio->'comercial_piloto') n) end from fila), 'sin fila')
    union all
    select 22, 'herramientas_comerciales', true,
           coalesce((select (select count(*) from unnest(array['consultar_ofertas', 'consultar_combos', 'consultar_campanas', 'consultar_contenido_comercial']::text[]) h where h = any (herramientas))::text || ' de 4 habilitadas' from fila), 'sin fila')
    -- CATÁLOGO
    union all
    select 30, 'modulo_catalogo', coalesce((select habilitado from public.dulabs_tenant_modulos where id_tenant = (select id from t) and modulo = 'catalogo'), false), 'el módulo catálogo debe estar habilitado para que el agente busque productos'
    union all
    select 31, 'modulo_cms_comercial', true, case when coalesce((select habilitado from public.dulabs_tenant_modulos where id_tenant = (select id from t) and modulo = 'cms_comercial'), false) then 'habilitado' else 'apagado: el agente no lee promociones, combos ni políticas del CMS' end
    union all
    select 32, 'funcion_de_busqueda', exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'dulabs_catalogo_buscar'), 'dulabs_catalogo_buscar (migración 20261111): sin ella el agente usa la búsqueda anterior, más pobre'
    union all
    select 33, 'columna_genero', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'dulabs_inventario_productos' and column_name = 'genero'), 'migración 20261215: sin ella el agente no separa Hombre y Mujer'
    union all
    select 34, 'piezas_activas', (select count(*) from piezas where activo) > 0, (select count(*) from piezas where activo)::text || ' activas de ' || (select count(*) from piezas)::text || ' en total'
    union all
    select 35, 'piezas_de_hombre', true, (select count(*) from piezas where activo and genero_texto = 'hombre')::text || ' de hombre y ' || (select count(*) from piezas where activo and coalesce(genero_texto, 'mujer') = 'mujer')::text || ' de mujer (activas)'
    union all
    select 36, 'piezas_con_precio_cero', (select count(*) from piezas where activo and precio = 0) = 0, (select count(*) from piezas where activo and precio = 0)::text || ' activa(s) con precio $0 al detal (el agente diría que cuestan $0)'
    union all
    select 37, 'piezas_sin_categoria', (select count(*) from piezas where activo and categoria_id is null) = 0, (select count(*) from piezas where activo and categoria_id is null)::text || ' activa(s) sin categoría (no salen al buscar por categoría)'
    union all
    select 39, 'piezas_sin_precio_mayorista', true, (select count(*) from piezas where activo and precio_mayor is null)::text || ' activa(s) sin precio al por mayor (a un mayorista el agente le diría «precio a consultar»)'
    union all
    select 38, 'piezas_agotadas', true, (select count(*) from piezas where activo and coalesce(controla_stock, true) and stock <= 0)::text || ' activa(s) agotada(s)'
    -- ÚLTIMOS 7 DÍAS
    union all
    select 40, 'turnos_7d', true, (select count(*) from turnos)::text || ' turno(s) del agente'
    union all
    select 41, 'resultados_7d', true, coalesce((select string_agg(resultado || ' ' || n, ' · ' order by n desc) from (select resultado, count(*) as n from turnos group by 1) r), 'sin turnos')
    union all
    select 42, 'errores_7d', not exists (select 1 from turnos where traza ->> 'error_kind' is not null),
           coalesce((select string_agg(k || ' ' || n, ' · ' order by n desc) from (select traza ->> 'error_kind' as k, count(*) as n from turnos where traza ->> 'error_kind' is not null group by 1) e), 'ningún turno con error')
    union all
    select 43, 'sin_saldo_7d', not exists (select 1 from turnos where traza ->> 'error_kind' in ('quota', 'side_quota')),
           (select count(*) from turnos where traza ->> 'error_kind' in ('quota', 'side_quota'))::text || ' turno(s) fallaron por crédito o cupo de Gemini agotado' || coalesce(' (el último: ' || (select max(created_at)::text from turnos where traza ->> 'error_kind' in ('quota', 'side_quota')) || ')', '')
    union all
    select 44, 'credencial_rechazada_7d', not exists (select 1 from turnos where traza ->> 'error_kind' in ('auth', 'side_auth')), (select count(*) from turnos where traza ->> 'error_kind' in ('auth', 'side_auth'))::text || ' turno(s) con la credencial rechazada por Gemini'
    union all
    select 45, 'tokens_7d', true,
           'entrada ' || coalesce((select sum((traza #>> '{usage,input}')::bigint) from turnos), 0)::text || ' · salida ' || coalesce((select sum((traza #>> '{usage,output}')::bigint) from turnos), 0)::text
             || ' · pensamiento ' || coalesce((select sum((traza #>> '{usage,thinking}')::bigint) from turnos), 0)::text || ' · de caché ' || coalesce((select sum((traza #>> '{usage,cached}')::bigint) from turnos), 0)::text
    union all
    select 46, 'latencia_p95_ms', true, coalesce((select round(percentile_cont(0.95) within group (order by (traza ->> 'latency_ms')::numeric))::text from turnos where traza ->> 'latency_ms' is not null), 'sin turnos')
    union all
    select 47, 'ultimo_turno', true, coalesce((select max(created_at)::text from turnos), 'ninguno en los últimos 7 días')
  ) x
 order by o;
