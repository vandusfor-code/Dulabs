-- Prueba SQL de 20261209000000_dulabs_cita_enlaces.sql (AMORE «Mi cita»).
-- Se corre SOLO en una BD local efímera (nunca en producción), con las migraciones anteriores ya aplicadas.
-- Cada bloque lanza una excepción si algo no se cumple. Todo queda dentro de una transacción que se revierte.
begin;

do $$
declare
  t uuid := gen_random_uuid();
  esp bigint;
  c1 bigint;
  c2 bigint;
  h1 text := repeat('a', 64);
  h2 text := repeat('b', 64);
  h3 text := repeat('c', 64);
  fallo boolean;
begin
  -- Una especialista y dos citas mínimas para colgar los enlaces.
  insert into public.dulabs_especialistas (id_tenant, phone_number_id, nombre, numero_whatsapp, servicio, duracion_min, token)
  values (t, 'pn-test', 'Prueba', '573000000000', 'general', 60, 'tok-' || gen_random_uuid()) returning id into esp;
  insert into public.dulabs_citas_especialista (especialista_id, id_tenant, phone_number_id, nombre_cliente, servicio, inicio, fin)
  values (esp, t, 'pn-test', 'Ana', 'Manicure', now() + interval '1 day', now() + interval '1 day 1 hour') returning id into c1;
  insert into public.dulabs_citas_especialista (especialista_id, id_tenant, phone_number_id, nombre_cliente, servicio, inicio, fin)
  values (esp, t, 'pn-test', 'Beto', 'Pedicure', now() + interval '2 days', now() + interval '2 days 1 hour') returning id into c2;

  -- 1) Un enlace válido se guarda.
  insert into public.dulabs_cita_enlaces (id_tenant, cita_id, token_hash, token_cifrado, expira_at) values (t, c1, h1, 'v1:x:y:z', now() + interval '10 days');

  -- 2) El mismo token (hash) no puede pertenecer a dos citas.
  fallo := false;
  begin
    insert into public.dulabs_cita_enlaces (id_tenant, cita_id, token_hash, token_cifrado, expira_at) values (t, c2, h1, 'v1:x:y:z', now() + interval '10 days');
  exception when unique_violation then fallo := true;
  end;
  if not fallo then raise exception 'dos citas pudieron compartir el mismo token'; end if;

  -- 3) Una cita no puede tener dos enlaces ACTIVOS.
  fallo := false;
  begin
    insert into public.dulabs_cita_enlaces (id_tenant, cita_id, token_hash, token_cifrado, expira_at) values (t, c1, h2, 'v1:x:y:z', now() + interval '10 days');
  exception when unique_violation then fallo := true;
  end;
  if not fallo then raise exception 'una cita pudo tener dos enlaces activos'; end if;

  -- 4) Revocado el primero, SÍ se puede emitir otro (rotación).
  update public.dulabs_cita_enlaces set revocado_at = now() where cita_id = c1;
  insert into public.dulabs_cita_enlaces (id_tenant, cita_id, token_hash, token_cifrado, expira_at) values (t, c1, h2, 'v1:x:y:z', now() + interval '10 days');

  -- 5) El hash debe ser sha256 hex (64): un valor corto o con mayúsculas se rechaza (no se puede guardar un token en claro por error).
  fallo := false;
  begin
    insert into public.dulabs_cita_enlaces (id_tenant, cita_id, token_hash, token_cifrado, expira_at) values (t, c2, 'token-en-claro', 'v1:x:y:z', now() + interval '10 days');
  exception when check_violation then fallo := true;
  end;
  if not fallo then raise exception 'el CHECK del hash dejó pasar un valor que no es sha256 hex'; end if;

  -- 6) El vencimiento debe ser posterior a la creación.
  fallo := false;
  begin
    insert into public.dulabs_cita_enlaces (id_tenant, cita_id, token_hash, token_cifrado, expira_at) values (t, c2, h3, 'v1:x:y:z', now() - interval '1 day');
  exception when check_violation then fallo := true;
  end;
  if not fallo then raise exception 'un enlace pudo nacer ya vencido'; end if;

  -- 7) El enlace no existe sin su cita (clave foránea) y desaparece con ella (cascade).
  fallo := false;
  begin
    insert into public.dulabs_cita_enlaces (id_tenant, cita_id, token_hash, token_cifrado, expira_at) values (t, -1, h3, 'v1:x:y:z', now() + interval '10 days');
  exception when foreign_key_violation then fallo := true;
  end;
  if not fallo then raise exception 'un enlace pudo apuntar a una cita inexistente'; end if;
  delete from public.dulabs_citas_especialista where id = c1;
  if exists (select 1 from public.dulabs_cita_enlaces where cita_id = c1) then raise exception 'el enlace sobrevivió al borrado de su cita'; end if;

  -- 8) RLS activado y SIN políticas: ni anon ni authenticated pueden leer o escribir.
  if not (select relrowsecurity from pg_class where oid = 'public.dulabs_cita_enlaces'::regclass) then raise exception 'RLS no está activado'; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'dulabs_cita_enlaces') then raise exception 'no debe haber políticas: solo service_role accede'; end if;

  raise notice 'OK: token único, un enlace activo por cita, hash validado, vigencia, cascada y RLS';
end $$;

rollback;
