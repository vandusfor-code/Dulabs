-- Business Agent 2.0, FASE 5 — verificación de 20261125000000_dulabs_ba_business_models.sql
--
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO. Ver scripts/verify-ba-business-models.sh (prepara roles, aplica la
-- migración dos veces, corre este archivo y la publicación concurrente real).

\set ON_ERROR_STOP 1

create or replace function pg_temp.art(p_tenant uuid, p_agent text, p_version integer, p_source text default 'business_model')
returns jsonb language sql as $$
  select jsonb_build_object(
    'artifactSchema', 'business-agent.artifact/1.0.0', 'compilerVersion', '5.0.0', 'source', p_source,
    'tenantId', p_tenant::text, 'agentId', p_agent, 'version', jsonb_build_object('ref', 'ubm-v' || p_version, 'publishedVersion', p_version),
    'checksum', repeat('a', 64), 'executionFingerprint', repeat('b', 32));
$$;

do $$
declare
  t1 constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  t2 constant uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  m constant jsonb := '{"schemaVersion":"business-agent.business-model/1.0.0"}';
  mc constant text := repeat('c', 64);
  ac constant text := repeat('a', 64);
  fp constant text := repeat('b', 32);
  r record;
  ok boolean;
  n integer;
begin
  -- 1. Primera publicación: versión 1, modelo + artefacto + puntero activo.
  select * into r from dulabs_ba_publish_business_model(t1, 'flow-1', 0, m, mc, pg_temp.art(t1, 'flow-1', 1), ac, fp);
  if r.outcome <> 'published' or r.published_version <> 1 then raise exception 'FAIL 1 %', r.outcome; end if;
  select published_version into n from dulabs_ba_active_artifacts where id_tenant = t1 and agent_id = 'flow-1';
  if n <> 1 then raise exception 'FAIL 1 puntero %', n; end if;
  raise notice 'PASS 1 publicar v1: modelo, artefacto y versión activa en una transacción';

  -- 2. Control optimista: quien publica sobre una versión vieja ve conflict (no pisa ni duplica).
  select * into r from dulabs_ba_publish_business_model(t1, 'flow-1', 0, m, mc, pg_temp.art(t1, 'flow-1', 1), ac, fp);
  if r.outcome <> 'conflict' or r.published_version <> 1 then raise exception 'FAIL 2 %', r.outcome; end if;
  select * into r from dulabs_ba_publish_business_model(t1, 'flow-1', 1, m, mc, pg_temp.art(t1, 'flow-1', 2), ac, fp);
  if r.outcome <> 'published' or r.published_version <> 2 then raise exception 'FAIL 2 v2 %', r.outcome; end if;
  raise notice 'PASS 2 versión = max + 1 con control optimista (expected_version viejo => conflict)';

  -- 3. Inmutabilidad (append-only).
  begin
    update dulabs_ba_business_models set model = '{"schemaVersion":"business-agent.business-model/1.0.0","x":1}' where id_tenant = t1;
    raise exception 'FAIL 3 update de modelo permitido';
  exception when check_violation then null;
  end;
  begin
    delete from dulabs_ba_agent_artifacts where id_tenant = t1;
    raise exception 'FAIL 3 delete de artefacto permitido';
  exception when check_violation then null;
  end;
  raise notice 'PASS 3 modelos y artefactos publicados son inmutables (sin UPDATE ni DELETE)';

  -- 4. El contenido debe coincidir con las columnas: otro tenant / otra versión / origen legacy => invalid, nada escrito.
  select * into r from dulabs_ba_publish_business_model(t1, 'flow-1', 2, m, mc, pg_temp.art(t2, 'flow-1', 3), ac, fp);
  if r.outcome <> 'invalid' then raise exception 'FAIL 4 tenant ajeno %', r.outcome; end if;
  select * into r from dulabs_ba_publish_business_model(t1, 'flow-1', 2, m, mc, pg_temp.art(t1, 'flow-1', 7), ac, fp);
  if r.outcome <> 'invalid' then raise exception 'FAIL 4 versión %', r.outcome; end if;
  select * into r from dulabs_ba_publish_business_model(t1, 'flow-1', 2, m, mc, pg_temp.art(t1, 'flow-1', 3, 'legacy_spec'), ac, fp);
  if r.outcome <> 'invalid' then raise exception 'FAIL 4 legacy %', r.outcome; end if;
  select * into r from dulabs_ba_publish_business_model(t1, 'flow-1', 2, m, mc, pg_temp.art(t1, 'flow-1', 3), repeat('d', 64), fp);
  if r.outcome <> 'invalid' then raise exception 'FAIL 4 checksum %', r.outcome; end if;
  select count(*) into n from dulabs_ba_business_models where id_tenant = t1;
  if n <> 2 then raise exception 'FAIL 4 quedaron % modelos', n; end if;
  raise notice 'PASS 4 artefacto con tenant/versión/checksum/origen distintos a sus columnas => invalid y nada escrito';

  -- 5. Rollback: activar una versión anterior (sin borrar historia); una inexistente no.
  select dulabs_ba_activate_business_model_version(t1, 'flow-1', 1) into ok;
  if not ok then raise exception 'FAIL 5 rollback'; end if;
  select published_version into n from dulabs_ba_active_business_artifact(t1, 'flow-1');
  if n <> 1 then raise exception 'FAIL 5 activa %', n; end if;
  select dulabs_ba_activate_business_model_version(t1, 'flow-1', 99) into ok;
  if ok then raise exception 'FAIL 5 activó una versión inexistente'; end if;
  select count(*) into n from dulabs_ba_agent_artifacts where id_tenant = t1;
  if n <> 2 then raise exception 'FAIL 5 historia %', n; end if;
  raise notice 'PASS 5 rollback activa v1 conservando v2; versión inexistente => false';

  -- 6. Aislamiento: otro tenant no ve el artefacto; no puede apuntar al artefacto de otro tenant ni activarlo.
  select count(*) into n from dulabs_ba_active_business_artifact(t2, 'flow-1');
  if n <> 0 then raise exception 'FAIL 6 tenant ajeno lee %', n; end if;
  select dulabs_ba_activate_business_model_version(t2, 'flow-1', 1) into ok;
  if ok then raise exception 'FAIL 6 tenant ajeno activó'; end if;
  begin
    insert into dulabs_ba_active_artifacts (id_tenant, agent_id, published_version, artifact_id)
    select t2, 'flow-1', a.published_version, a.id from dulabs_ba_agent_artifacts a where a.id_tenant = t1 limit 1;
    raise exception 'FAIL 6 puntero cruzado entre tenants';
  exception when foreign_key_violation then null;
  end;
  select * into r from dulabs_ba_publish_business_model(t2, 'flow-1', 0, m, mc, pg_temp.art(t2, 'flow-1', 1), ac, fp);
  if r.outcome <> 'published' or r.published_version <> 1 then raise exception 'FAIL 6 versiones por tenant %', r.outcome; end if;
  raise notice 'PASS 6 aislamiento por tenant: lectura, activación, FK compuesta y numeración independiente';

  -- 7. Lectura del activo: artefacto + modelo del MISMO tenant/versión.
  select * into r from dulabs_ba_active_business_artifact(t1, 'flow-1');
  if r.artifact->>'tenantId' <> t1::text or r.model->>'schemaVersion' <> 'business-agent.business-model/1.0.0' then raise exception 'FAIL 7'; end if;
  raise notice 'PASS 7 lectura del artefacto activo con su modelo';

  -- 8. Seguridad: RLS activa; funciones sin EXECUTE para anon/authenticated.
  select count(*) into n from pg_class where relname in ('dulabs_ba_business_models', 'dulabs_ba_agent_artifacts', 'dulabs_ba_active_artifacts') and relrowsecurity;
  if n <> 3 then raise exception 'FAIL 8 RLS %', n; end if;
  if has_function_privilege('anon', 'public.dulabs_ba_publish_business_model(uuid, text, integer, jsonb, text, jsonb, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.dulabs_ba_active_business_artifact(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.dulabs_ba_activate_business_model_version(uuid, text, integer)', 'execute') then
    raise exception 'FAIL 8 permisos';
  end if;
  if not has_function_privilege('service_role', 'public.dulabs_ba_publish_business_model(uuid, text, integer, jsonb, text, jsonb, text, text)', 'execute') then
    raise exception 'FAIL 8 service_role sin permiso';
  end if;
  raise notice 'PASS 8 RLS en las 3 tablas; solo service_role ejecuta las funciones';
end;
$$;
