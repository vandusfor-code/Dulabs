-- FASE 3B.9A — VERIFICACIÓN DE ESTADO DE AQUÍ SÍ LO COMPRAS (SOLO LECTURA).
--
-- Corre en el SQL Editor de Supabase. Es UNA sola consulta SELECT (el editor muestra el resultado de la última sentencia): no modifica nada.
-- Se corre DOS veces: ANTES de 02_aprovisionar_sin_activar.sql (estado inicial) y DESPUÉS (estado final); se comparan los dos resultados.
--
-- No muestra secretos: de las credenciales solo dice si existen y su largo; del WABA y de los números autorizados, solo los últimos dígitos.
-- Identifica al negocio por su tenant, su phone_number_id o su nombre; "una_sola_fila_aslc" debe ser true (si hay otra fila parecida, avisa la ambigüedad).
-- Ojo: identidad.telefono_negocio es el teléfono REGISTRADO en la base para el número de Meta, no necesariamente el que informó el negocio.
--
-- Qué buscar:
--   identidad.id_tenant / phone_number_id  -> los ids del negocio (compararlos con los últimos conocidos de la Fase 3A).
--   identidad.ia_pausada = true, ia_restringida_a_final -> el estado seguro que debe mantenerse.
--   agente_aslc = [] (antes) o una fila con habilitado=false (después). Si ya existe una fila habilitada: DETENERSE.
--   modulos_aslc, huella_modulos_por_negocio -> después, solo debe cambiar la huella de ASLC.
--   equipo_aslc -> personas del equipo (¿ya existe la persona responsable REAL?).
--   migraciones -> si 20261207 y 20261208 están aplicadas.
--   catalogo_aslc -> productos y pedidos de ASLC (el catálogo real NO se carga en esta fase).

with aslc as (
  select c.*
    from public.dulabs_clientes_config c
   where c.id_tenant::text = '320121d7-2bc5-472d-944b-5191cc228e1f'
      or c.phone_number_id::text = '1317599831437793'
      or c.nombre_negocio ~* 'lo compras'
),
agente_aslc as (
  select r.* from public.dulabs_agente_runtime_config r where r.phone_number_id in (select phone_number_id from aslc)
),
migracion_notificaciones as (
  select pg_get_constraintdef(oid) as definicion
    from pg_constraint
   where conrelid = to_regclass('public.dulabs_catalogo_pedido_notificaciones')
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%pago_recibido%'
)
select jsonb_pretty(jsonb_build_object(
  'identidad', (
    select coalesce(jsonb_agg(
      (to_jsonb(a) - 'meta_permanent_token' - 'api_key_ia' - 'prompt_sistema' - 'base_conocimiento' - 'whatsapp_business_account_id' - 'ia_restringida_a' - 'ia_numeros_bloqueados')
      || jsonb_build_object(
           'waba_enmascarado', left(a.whatsapp_business_account_id, 4) || '…' || right(a.whatsapp_business_account_id, 4),
           'tiene_token_meta', a.meta_permanent_token is not null,
           'largo_token_meta_cifrado', length(a.meta_permanent_token),
           'tiene_api_key_ia_legacy', a.api_key_ia is not null,
           'tiene_prompt_legacy', a.prompt_sistema is not null,
           'ia_restringida_a_final', (select string_agg('…' || right(n, 4), ', ') from unnest(string_to_array(coalesce(a.ia_restringida_a, ''), ',')) n where btrim(n) <> ''),
           'ia_numeros_bloqueados_cantidad', (select count(*) from unnest(string_to_array(coalesce(a.ia_numeros_bloqueados, ''), ',')) n where btrim(n) <> '')
         )
    ), '[]'::jsonb) from aslc a
  ),
  'agente_aslc', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from agente_aslc r),
  'agentes_de_la_plataforma', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id_tenant', r.id_tenant, 'phone_number_id_final', right(r.phone_number_id, 4), 'habilitado', r.habilitado,
      'credencial_ref', r.credencial_ref, 'herramientas', cardinality(r.herramientas),
      'checkout_conversacional', to_jsonb(r) -> 'checkout_conversacional', 'transcripcion_audio', to_jsonb(r) -> 'transcripcion_audio',
      'meta_token_plataforma', to_jsonb(r) -> 'meta_token_plataforma'
    ) order by r.created_at), '[]'::jsonb) from public.dulabs_agente_runtime_config r
  ),
  'credenciales_compartidas_entre_numeros', (
    select coalesce(jsonb_agg(credencial_ref), '[]'::jsonb)
      from (select credencial_ref from public.dulabs_agente_runtime_config group by credencial_ref having count(*) > 1) x
  ),
  'modulos_aslc', (
    select coalesce(jsonb_agg(jsonb_build_object('modulo', m.modulo, 'habilitado', m.habilitado) order by m.modulo), '[]'::jsonb)
      from public.dulabs_tenant_modulos m where m.id_tenant in (select id_tenant from aslc)
  ),
  'huella_modulos_por_negocio', (
    select coalesce(jsonb_object_agg(id_tenant, huella), '{}'::jsonb)
      from (select id_tenant::text as id_tenant, md5(string_agg(modulo || ':' || habilitado::text, ',' order by modulo)) as huella from public.dulabs_tenant_modulos group by id_tenant) h
  ),
  'equipo_aslc', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'miembro_id', e.id, 'rol', e.rol, 'estado', e.estado, 'nombre', e.nombre,
      'correo_enmascarado', left(e.email, 2) || '***@' || split_part(e.email, '@', 2)
    ) order by e.id), '[]'::jsonb) from public.dulabs_miembros_equipo e where e.tenant_id in (select id_tenant from aslc)
  ),
  'migraciones', jsonb_build_object(
    'tabla_notificaciones_existe', to_regclass('public.dulabs_catalogo_pedido_notificaciones') is not null,
    'check_tipo_notificaciones', (select coalesce(jsonb_agg(definicion), '[]'::jsonb) from migracion_notificaciones),
    'm20261208_aplicada_tipo_aceptado', exists (select 1 from migracion_notificaciones where definicion ilike '%aceptado%'),
    'm20261207_aplicada_pending_acceptance', exists (select 1 from pg_constraint where conname = 'dulabs_catalogo_pedidos_estado_check' and pg_get_constraintdef(oid) ilike '%pending_acceptance%'),
    'columnas_agente', (
      select coalesce(jsonb_agg(column_name order by column_name), '[]'::jsonb) from information_schema.columns
       where table_schema = 'public' and table_name = 'dulabs_agente_runtime_config'
         and column_name in ('transcripcion_audio', 'checkout_opciones', 'vocabulario', 'meta_token_plataforma', 'checkout_conversacional', 'clasificacion_cliente', 'limites')
    )
  ),
  'catalogo_aslc', jsonb_build_object(
    'productos', (select count(*) from public.dulabs_inventario_productos p where p.id_tenant in (select id_tenant from aslc)),
    'pedidos', (select count(*) from public.dulabs_catalogo_pedidos o where o.id_tenant in (select id_tenant from aslc)),
    'pedidos_pendientes_de_aceptacion', (select count(*) from public.dulabs_catalogo_pedidos o where o.id_tenant in (select id_tenant from aslc) and o.estado = 'pending_acceptance'),
    'notificaciones_registradas', (select count(*) from public.dulabs_catalogo_pedido_notificaciones n where n.id_tenant in (select id_tenant from aslc))
  ),
  'comprobaciones', jsonb_build_object(
    'una_sola_fila_aslc', (select count(*) from aslc) = 1,
    'aslc_pausado', coalesce((select bool_and(coalesce(ia_pausada, false)) from aslc), false),
    'aslc_sin_fila_de_agente_habilitada', not exists (select 1 from agente_aslc where habilitado),
    'aslc_con_fila_de_agente', exists (select 1 from agente_aslc),
    'agente_aslc_con_checkout_y_audio_apagados', not exists (select 1 from agente_aslc r where coalesce((to_jsonb(r) -> 'checkout_conversacional')::text = 'true', false) or coalesce((to_jsonb(r) -> 'transcripcion_audio')::text = 'true', false)),
    'agente_aslc_sin_token_de_plataforma', not exists (select 1 from agente_aslc r where coalesce((to_jsonb(r) -> 'meta_token_plataforma')::text = 'true', false)),
    'modulo_notificaciones_pedidos_apagado', not exists (select 1 from public.dulabs_tenant_modulos m where m.id_tenant in (select id_tenant from aslc) and m.modulo = 'notificaciones_pedidos' and m.habilitado),
    'credencial_de_aslc_no_compartida', not exists (select 1 from agente_aslc r where r.credencial_ref in (select credencial_ref from public.dulabs_agente_runtime_config group by credencial_ref having count(*) > 1))
  )
));
