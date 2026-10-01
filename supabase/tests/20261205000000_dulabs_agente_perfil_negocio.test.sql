-- Prueba de la migración multi-negocio (PostgreSQL real): perfil por número y catálogo cerrado de pagos.
-- Todo en una transacción que se revierte. Ejecutar DESPUÉS de aplicar 20261205000000_dulabs_agente_perfil_negocio.sql.
\set ON_ERROR_STOP on
begin;

insert into public.dulabs_agente_runtime_config (id_tenant, phone_number_id, tipo, habilitado, proveedor, modelo, credencial_ref, nivel_razonamiento, herramientas, canal, negocio)
values (gen_random_uuid(), 'perfil-prueba', 'catalog_sales', true, 'gemini', 'gemini-3.6-flash', 'env:GEMINI_KEY_PRUEBA', 'low', array['search_products'], 'retail', '{}'::jsonb);

do $$
declare
  def text;
begin
  -- 1) Por defecto: sin vocabulario (neutral), sin opciones y SIN autorización del token de la plataforma.
  if exists (select 1 from public.dulabs_agente_runtime_config where phone_number_id = 'perfil-prueba'
              and (vocabulario is not null or checkout_opciones is not null or meta_token_plataforma)) then
    raise exception 'una fila nueva debe nacer neutral, sin opciones y sin token de la plataforma';
  end if;

  -- 2) Opciones con métodos del catálogo: aceptadas.
  update public.dulabs_agente_runtime_config
     set checkout_opciones = '{"entregas":["domicilio"],"pagos":[{"metodo":"contra_entrega"},{"metodo":"link_pago"},{"metodo":"transferencia"}]}'::jsonb,
         vocabulario = '{"producto":"producto","boton_buscar":"🔎 Buscar producto","ejemplos":[],"pistas_busqueda":"tipo de producto","palabras_producto":[],"no_es_nombre":[],"nombre_comercial":[]}'::jsonb
   where phone_number_id = 'perfil-prueba';

  -- 3) Un pago inventado: rechazado.
  begin
    update public.dulabs_agente_runtime_config set checkout_opciones = '{"entregas":["domicilio"],"pagos":[{"metodo":"efectivo"}]}'::jsonb where phone_number_id = 'perfil-prueba';
    raise exception 'debió rechazar un método de pago fuera del catálogo';
  exception when check_violation then null;
  end;

  -- 4) Una entrega inventada: rechazada.
  begin
    update public.dulabs_agente_runtime_config set checkout_opciones = '{"entregas":["dron"],"pagos":[{"metodo":"transferencia"}]}'::jsonb where phone_number_id = 'perfil-prueba';
    raise exception 'debió rechazar una entrega fuera del catálogo';
  exception when check_violation then null;
  end;

  -- 5) No es un objeto: rechazado (vocabulario y opciones).
  begin
    update public.dulabs_agente_runtime_config set vocabulario = '[]'::jsonb where phone_number_id = 'perfil-prueba';
    raise exception 'debió rechazar un vocabulario que no es objeto';
  exception when check_violation then null;
  end;
  begin
    update public.dulabs_agente_runtime_config set checkout_opciones = '{"entregas":"domicilio","pagos":[]}'::jsonb where phone_number_id = 'perfil-prueba';
    raise exception 'debió rechazar entregas que no son arreglo';
  exception when check_violation then null;
  end;

  -- 6) Pedidos: el CHECK de metodo_pago es el catálogo cerrado (4 métodos), nada más.
  select pg_get_constraintdef(c.oid) into def from pg_constraint c
   where c.conrelid = 'public.dulabs_catalogo_pedidos'::regclass and c.conname = 'dulabs_catalogo_pedidos_metodo_pago_check';
  if def is null or def not like '%contra_entrega%' or def not like '%link_pago%' or def not like '%pago_en_tienda%' or def not like '%transferencia%' or def like '%efectivo%' then
    raise exception 'CHECK de metodo_pago inesperado: %', def;
  end if;
end $$;

select 'OK multi-negocio: perfil por número y catálogo cerrado de pagos (6 controles)';
rollback;
