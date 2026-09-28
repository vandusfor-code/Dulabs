-- Business Agent 2.0, FASE 6 — verificación de 20261126000000_dulabs_ba_onboarding.sql
--
-- ⚠️  SOLO contra un PostgreSQL LOCAL EFÍMERO. Ver scripts/verify-ba-onboarding.sh (prepara roles, tablas mínimas del
-- registro con la función REAL dulabs_flow_publish_version, aplica FASE 5 y FASE 6 dos veces, corre este archivo y la
-- concurrencia real).

\set ON_ERROR_STOP 1

create or replace function pg_temp.art(p_tenant uuid, p_agent text, p_version integer, p_fp text default repeat('b', 32))
returns jsonb language sql as $$
  select jsonb_build_object(
    'artifactSchema', 'business-agent.artifact/1.0.0', 'compilerVersion', '5.0.0', 'source', 'business_model',
    'tenantId', p_tenant::text, 'agentId', p_agent, 'version', jsonb_build_object('ref', 'ubm-v' || p_version, 'publishedVersion', p_version),
    'checksum', repeat('a', 64), 'executionFingerprint', p_fp);
$$;

do $$
declare
  t1 constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  t2 constant uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  f1 constant uuid := 'f1f1f1f1-0000-4000-8000-000000000001';
  f2 constant uuid := 'f2f2f2f2-0000-4000-8000-000000000002';
  v1 constant uuid := 'a1a1a1a1-0000-4000-8000-000000000001';
  v2 constant uuid := 'a2a2a2a2-0000-4000-8000-000000000002';
  v3 constant uuid := 'a3a3a3a3-0000-4000-8000-000000000003';
  vx constant uuid := 'b9b9b9b9-0000-4000-8000-000000000009';
  vf constant uuid := 'a4a4a4a4-0000-4000-8000-000000000004';
  d constant jsonb := '{"version":"business-agent.onboarding-draft/1"}';
  m constant jsonb := '{"schemaVersion":"business-agent.business-model/1.0.0"}';
  r record;
  n integer;
  u uuid;
begin
  insert into dulabs_flows (tenant_id, id, slug, name) values (t1, f1, 'business-agent', 'BA'), (t2, f2, 'business-agent', 'BA');
  insert into dulabs_flow_versions (tenant_id, id, flow_id, version_number, definition_json) values
    (t1, v1, f1, 1, '{}'), (t1, v2, f1, 2, '{}'), (t1, v3, f1, 3, '{}'), (t2, vx, f2, 1, '{}'), (t1, vf, f1, 4, '{}');
  insert into dulabs_business_agent_versions (tenant_id, flow_id, flow_version_id, validation_status) values
    (t1, f1, v1, 'validated'), (t1, f1, v2, 'validated'), (t1, f1, v3, 'validated'), (t2, f2, vx, 'validated'), (t1, f1, vf, 'failed');

  -- 1. Borrador con revisión optimista.
  select * into r from dulabs_ba_save_onboarding_draft(t1, f1::text, 0, d, null);
  if r.outcome <> 'saved' or r.revision <> 1 then raise exception 'FAIL 1 primer guardado %', r.outcome; end if;
  select * into r from dulabs_ba_save_onboarding_draft(t1, f1::text, 0, d, null);
  if r.outcome <> 'conflict' or r.revision <> 1 then raise exception 'FAIL 1 conflicto %', r.outcome; end if;
  select * into r from dulabs_ba_save_onboarding_draft(t1, f1::text, 1, d, null);
  if r.outcome <> 'saved' or r.revision <> 2 then raise exception 'FAIL 1 segundo guardado %', r.outcome; end if;
  begin
    perform dulabs_ba_save_onboarding_draft(t1, f1::text, 2, '{"version":"otra"}', null);
    raise exception 'FAIL 1 borrador sin versión aceptado';
  exception when check_violation then null;
  end;
  raise notice 'PASS 1 borrador: revisión optimista (0 => 1, revisión vieja => conflict, 1 => 2) y forma verificada';

  -- 2. Publicación atómica: modelo + artefacto + registro + enlace; retira la versión anterior del registro.
  update dulabs_flows set published_version_id = v1, status = 'published' where tenant_id = t1 and id = f1;
  select * into r from dulabs_ba_publish_onboarding(t1, f1::text, v2, 2, 0, m, repeat('c', 64), pg_temp.art(t1, f1::text, 1), repeat('a', 64), repeat('b', 32));
  if r.outcome <> 'published' or r.published_version <> 1 then raise exception 'FAIL 2 %', r.outcome; end if;
  select published_version_id into u from dulabs_flows where tenant_id = t1 and id = f1;
  if u <> v2 then raise exception 'FAIL 2 puntero del registro %', u; end if;
  if (select retired_at from dulabs_flow_versions where tenant_id = t1 and id = v1) is null then raise exception 'FAIL 2 no retiró v1'; end if;
  select published_version into n from dulabs_ba_active_artifacts where id_tenant = t1 and agent_id = f1::text;
  if n <> 1 then raise exception 'FAIL 2 versión activa %', n; end if;
  if dulabs_ba_active_artifact_flow_version(t1, f1::text) <> v2 then raise exception 'FAIL 2 enlace'; end if;
  select * into r from dulabs_ba_onboarding_last_publication(t1, f1::text);
  if r.draft_revision <> 2 then raise exception 'FAIL 2 revisión publicada'; end if;
  raise notice 'PASS 2 publicación atómica: registro, modelo, artefacto, versión activa y enlace en una transacción';

  -- 3. Revisión del borrador vieja => draft_conflict y NADA escrito.
  select * into r from dulabs_ba_publish_onboarding(t1, f1::text, v3, 1, 1, m, repeat('c', 64), pg_temp.art(t1, f1::text, 2), repeat('a', 64), repeat('b', 32));
  if r.outcome <> 'draft_conflict' then raise exception 'FAIL 3 %', r.outcome; end if;
  -- 4. Versión del modelo vieja => version_conflict y NADA escrito.
  select * into r from dulabs_ba_publish_onboarding(t1, f1::text, v3, 2, 0, m, repeat('c', 64), pg_temp.art(t1, f1::text, 1), repeat('a', 64), repeat('b', 32));
  if r.outcome <> 'version_conflict' then raise exception 'FAIL 4 %', r.outcome; end if;
  select published_version_id into u from dulabs_flows where tenant_id = t1 and id = f1;
  select count(*) into n from dulabs_ba_business_models where id_tenant = t1;
  if u <> v2 or n <> 1 then raise exception 'FAIL 3/4 quedó algo escrito (puntero %, modelos %)', u, n; end if;
  raise notice 'PASS 3 revisión del borrador vieja => draft_conflict, nada escrito';
  raise notice 'PASS 4 versión del modelo vieja => version_conflict, nada escrito';

  -- 5. Versión del registro no validada o de otro tenant => invalid, nada escrito.
  select * into r from dulabs_ba_publish_onboarding(t1, f1::text, vf, 2, 1, m, repeat('c', 64), pg_temp.art(t1, f1::text, 2), repeat('a', 64), repeat('b', 32));
  if r.outcome <> 'invalid' then raise exception 'FAIL 5 no validada %', r.outcome; end if;
  select * into r from dulabs_ba_publish_onboarding(t1, f1::text, vx, 2, 1, m, repeat('c', 64), pg_temp.art(t1, f1::text, 2), repeat('a', 64), repeat('b', 32));
  if r.outcome <> 'invalid' then raise exception 'FAIL 5 otro tenant %', r.outcome; end if;
  -- Artefacto que declara otro tenant => invalid (CHECK de FASE 5), nada escrito.
  select * into r from dulabs_ba_publish_onboarding(t1, f1::text, v3, 2, 1, m, repeat('c', 64), pg_temp.art(t2, f1::text, 2), repeat('a', 64), repeat('b', 32));
  if r.outcome <> 'invalid' then raise exception 'FAIL 5 artefacto ajeno %', r.outcome; end if;
  select count(*) into n from dulabs_ba_business_models where id_tenant = t1;
  if n <> 1 then raise exception 'FAIL 5 quedaron % modelos', n; end if;
  raise notice 'PASS 5 versión del registro no validada / de otro tenant / artefacto ajeno => invalid, nada escrito';

  -- 6. Si el RPC del registro falla DESPUÉS de publicar el modelo, se revierte TODO: la versión del registro validada
  --    apunta a una versión de flow inexistente => dulabs_flow_publish_version lanza FLOW_PUBLISH_VERSION_NOT_FOUND.
  u := gen_random_uuid();
  insert into dulabs_business_agent_versions (tenant_id, flow_id, flow_version_id, validation_status) values (t1, f1, u, 'validated');
  begin
    perform dulabs_ba_publish_onboarding(t1, f1::text, u, 2, 1, m, repeat('c', 64), pg_temp.art(t1, f1::text, 2), repeat('a', 64), repeat('b', 32));
    raise exception 'FAIL 6 no lanzó';
  exception when others then
    if sqlerrm not like '%FLOW_PUBLISH_VERSION_NOT_FOUND%' then raise exception 'FAIL 6 error inesperado: %', sqlerrm; end if;
  end;
  select count(*) into n from dulabs_ba_business_models where id_tenant = t1;
  if n <> 1 then raise exception 'FAIL 6 quedaron % modelos (el de v2 debía revertirse)', n; end if;
  select published_version into n from dulabs_ba_active_artifacts where id_tenant = t1 and agent_id = f1::text;
  if n <> 1 then raise exception 'FAIL 6 versión activa movida a %', n; end if;
  raise notice 'PASS 6 el registro falla después de escribir el modelo => se revierte modelo, artefacto y versión activa';

  -- 7. Inmutabilidad del enlace; RLS; permisos.
  begin
    update dulabs_ba_onboarding_publications set draft_revision = 99 where id_tenant = t1;
    raise exception 'FAIL 7 enlace mutable';
  exception when check_violation then null;
  end;
  select count(*) into n from pg_class where relname in ('dulabs_ba_onboarding_drafts', 'dulabs_ba_onboarding_publications') and relrowsecurity;
  if n <> 2 then raise exception 'FAIL 7 RLS'; end if;
  if has_function_privilege('anon', 'public.dulabs_ba_publish_onboarding(uuid, text, uuid, integer, integer, jsonb, text, jsonb, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.dulabs_ba_save_onboarding_draft(uuid, text, integer, jsonb, uuid)', 'execute') then
    raise exception 'FAIL 7 permisos';
  end if;
  raise notice 'PASS 7 enlace inmutable, RLS activa y solo service_role ejecuta';

  -- 8. Aislamiento: el tenant 2 no ve el borrador ni la publicación del tenant 1.
  select count(*) into n from dulabs_ba_onboarding_last_publication(t2, f1::text);
  if n <> 0 or dulabs_ba_active_artifact_flow_version(t2, f1::text) is not null then raise exception 'FAIL 8'; end if;
  select * into r from dulabs_ba_save_onboarding_draft(t2, f1::text, 1, d, null);
  if r.outcome <> 'conflict' then raise exception 'FAIL 8 tenant ajeno escribió'; end if;
  raise notice 'PASS 8 aislamiento por tenant (lectura, enlace y escritura)';
end;
$$;
