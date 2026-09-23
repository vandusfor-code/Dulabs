-- Catálogo DuLabs — verificación de 20261106000000_dulabs_catalogo_publicacion.sql
--
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO (inserta filas de prueba). NUNCA en Supabase.
-- Preparación: la misma de 20261105000000_dulabs_catalogo_fase1.test.sql, y después
--   \i supabase/migrations/20261106000000_dulabs_catalogo_publicacion.sql
\set ON_ERROR_STOP 1

insert into dulabs_catalogo_publicacion (id_tenant, slug, nombre_publico)
values ('0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4', 'delacour', 'Delacour & Orus Joyería');

do $$
declare t text;
begin
  select token_mayor into t from dulabs_catalogo_publicacion where slug = 'delacour';
  if t !~ '^[0-9a-f]{64}$' then raise exception 'FAIL token por defecto: %', t; end if;
  begin
    insert into dulabs_catalogo_publicacion (id_tenant, slug, nombre_publico) values (gen_random_uuid(), 'delacour', 'Otro');
    raise exception 'FAIL slug duplicado aceptado';
  exception when unique_violation then null;
  end;
  begin
    insert into dulabs_catalogo_publicacion (id_tenant, slug, nombre_publico) values (gen_random_uuid(), 'Mal Slug!', 'Otro');
    raise exception 'FAIL slug inválido aceptado';
  exception when check_violation then null;
  end;
  begin
    update dulabs_catalogo_publicacion set token_mayor = 'corto' where slug = 'delacour';
    raise exception 'FAIL token débil aceptado';
  exception when check_violation then null;
  end;
  raise notice 'PASS publicación: token 64 hex por defecto, slug único y validado, token débil rechazado';
end $$;
