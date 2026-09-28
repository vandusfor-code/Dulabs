-- Prueba del Bloque 32 (PostgreSQL real): `negocio` admite ~11 KB y sigue rechazando lo desmedido y
-- lo que no es un objeto. Todo en una transacción que se revierte.
\set ON_ERROR_STOP on
begin;

insert into public.dulabs_agente_runtime_config (id_tenant, phone_number_id, tipo, habilitado, proveedor, modelo, credencial_ref, nivel_razonamiento, herramientas, canal, negocio)
values (gen_random_uuid(), 'b32-prueba-negocio', 'catalog_sales', true, 'gemini', 'gemini-3.6-flash', 'env:GEMINI_KEY_PRUEBA', 'low', array['search_products'], 'retail', '{}'::jsonb);

do $$
declare
  grande jsonb := jsonb_build_object('conocimiento', (select jsonb_agg(jsonb_build_object('tema', 't' || i, 'info', repeat('ñ', 700))) from generate_series(1, 12) i));
begin
  -- 1) ~11 KB (como la asesora de Delacour): aceptado.
  update public.dulabs_agente_runtime_config set negocio = grande where phone_number_id = 'b32-prueba-negocio';
  if octet_length((select negocio from public.dulabs_agente_runtime_config where phone_number_id = 'b32-prueba-negocio')::text) <= 8192 then
    raise exception 'la prueba debe superar 8 KB';
  end if;
  -- 2) Desmedido (> 64 KB): rechazado.
  begin
    update public.dulabs_agente_runtime_config set negocio = jsonb_build_object('x', repeat(md5(random()::text), 5000)) where phone_number_id = 'b32-prueba-negocio';
    raise exception 'debió rechazar > 64 KB';
  exception when check_violation then null;
  end;
  -- 3) No es un objeto: rechazado.
  begin
    update public.dulabs_agente_runtime_config set negocio = '[]'::jsonb where phone_number_id = 'b32-prueba-negocio';
    raise exception 'debió rechazar un arreglo';
  exception when check_violation then null;
  end;
end $$;

select 'OK Bloque 32: negocio del agente hasta 64 KB (3 controles)';
rollback;
