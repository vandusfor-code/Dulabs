-- Datos de DEMOSTRACIÓN (no tráfico real) para la cuenta de prueba que usa
-- Meta en la revisión de la app: duvan.ramos@peoplebpo.com.
--
-- Qué hace: siembra 7 días de conversaciones entrante/saliente (con la
-- misma columna "origen" real que usa el resto del dashboard), una plantilla
-- de ejemplo ya aprobada, y una campaña de ejemplo con métricas de entrega/
-- lectura reales — todo insertado en las tablas reales, para que el
-- dashboard (con su código normal, sin atajos) se vea con actividad cuando
-- el revisor entre.
--
-- Corre esto UNA VEZ en el SQL Editor de Supabase, después de aplicar todas
-- las migraciones. No es una migración de esquema — no la pongas en
-- supabase/migrations/. Es seguro volver a correrlo (usa "on conflict" en
-- la plantilla y no duplica si ya existe), pero volver a correrlo SÍ
-- agregará otra tanda de 7 días de mensajes y otra campaña.

do $$
declare
  v_tenant uuid;
  v_phone_number_id text;
  v_waba_id text;
  v_plantilla_id bigint;
  v_campana_id bigint;
  v_dia timestamptz;
  v_escenario int;
  i int;
begin
  select id into v_tenant from auth.users where email = 'duvan.ramos@peoplebpo.com';
  if v_tenant is null then
    raise exception 'No se encontró el usuario duvan.ramos@peoplebpo.com en auth.users';
  end if;

  select phone_number_id, whatsapp_business_account_id
    into v_phone_number_id, v_waba_id
  from public.dulabs_clientes_config
  where id_tenant = v_tenant
  order by updated_at desc
  limit 1;

  if v_phone_number_id is null then
    raise exception 'Ese usuario no tiene ningún número de WhatsApp conectado todavía';
  end if;

  -- ---------- 7 días de conversaciones (3 escenarios que rotan) ----------
  -- El día 0 (hoy) usa horas relativas a "now()" en vez de horas fijas del
  -- reloj, para que siempre caiga dentro de "últimas 24h" sin importar a
  -- qué hora se corra este script.
  for i in 0..6 loop
    v_dia := case when i = 0 then now() - interval '20 hours' else date_trunc('day', now()) - (i || ' days')::interval end;
    v_escenario := i % 3;

    if v_escenario = 0 then
      insert into public.dulabs_mensajes_log
        (phone_number_id, telefono_cliente, direccion, contenido, origen, created_at)
      values
        (v_phone_number_id, '15555550101', 'entrante', 'Hola, ¿tienen turno disponible para mañana?', 'entrante', v_dia + interval '10 hours'),
        (v_phone_number_id, '15555550101', 'saliente', '¡Hola! Sí, tenemos disponibilidad a las 10:00am y 3:00pm. ¿Cuál prefieres?', 'ia', v_dia + interval '10 hours 2 minutes'),
        (v_phone_number_id, '15555550101', 'entrante', 'La de las 3pm por favor', 'entrante', v_dia + interval '10 hours 5 minutes'),
        (v_phone_number_id, '15555550101', 'saliente', 'Listo, quedas agendado hoy a las 3:00pm. ¡Te esperamos!', 'ia', v_dia + interval '10 hours 6 minutes');
    elsif v_escenario = 1 then
      insert into public.dulabs_mensajes_log
        (phone_number_id, telefono_cliente, direccion, contenido, origen, created_at)
      values
        (v_phone_number_id, '15555550102', 'entrante', '¿Cuánto cuesta el corte de cabello?', 'entrante', v_dia + interval '15 hours'),
        (v_phone_number_id, '15555550102', 'saliente', 'El corte de cabello tiene un valor de $30.000 COP. ¿Deseas agendar una cita?', 'ia', v_dia + interval '15 hours 2 minutes'),
        (v_phone_number_id, '15555550102', 'entrante', 'Sí, ¿qué días tienen disponible esta semana?', 'entrante', v_dia + interval '15 hours 4 minutes'),
        (v_phone_number_id, '15555550102', 'saliente', 'Tenemos cupos de martes a sábado, de 9:00am a 6:00pm. ¿Qué día te queda mejor?', 'ia', v_dia + interval '15 hours 5 minutes');
    else
      insert into public.dulabs_mensajes_log
        (phone_number_id, telefono_cliente, direccion, contenido, origen, created_at)
      values
        (v_phone_number_id, '15555550103', 'entrante', 'Buenas, ¿están abiertos hoy?', 'entrante', v_dia + interval '18 hours'),
        (v_phone_number_id, '15555550103', 'saliente', '¡Sí! Atendemos de lunes a sábado, de 9:00am a 6:00pm.', 'ia', v_dia + interval '18 hours 2 minutes');
    end if;
  end loop;

  -- ---------- Plantilla de ejemplo, ya aprobada ----------
  insert into public.dulabs_plantillas
    (id_tenant, phone_number_id, whatsapp_business_account_id, nombre, categoria, idioma, cuerpo, meta_template_id, estado)
  values
    (v_tenant, v_phone_number_id, v_waba_id, 'promo_bienvenida_demo', 'MARKETING', 'es_CO',
     'Hola, gracias por visitarnos. Como cliente nuevo tienes 15% de descuento en tu primera cita.',
     'demo_meta_template_id', 'APPROVED')
  on conflict (whatsapp_business_account_id, nombre, idioma) do nothing;

  select id into v_plantilla_id
  from public.dulabs_plantillas
  where whatsapp_business_account_id = v_waba_id and nombre = 'promo_bienvenida_demo' and idioma = 'es_CO';

  -- ---------- Campaña de ejemplo, con métricas de entrega/lectura reales ----------
  insert into public.dulabs_campanas
    (id_tenant, phone_number_id, plantilla_id, nombre, destinatarios_total, created_at)
  values
    (v_tenant, v_phone_number_id, v_plantilla_id, 'promo_bienvenida_demo', 5, now() - interval '2 days')
  returning id into v_campana_id;

  insert into public.dulabs_mensajes_log
    (phone_number_id, telefono_cliente, direccion, contenido, origen, campana_id,
     estado_entrega, entregado_at, leido_at, respondido, created_at)
  values
    (v_phone_number_id, '15555550201', 'saliente', '[Campaña: promo_bienvenida_demo] Hola, gracias por visitarnos. Como cliente nuevo tienes 15% de descuento en tu primera cita.', 'campaña', v_campana_id,
     'leido', now() - interval '2 days' + interval '2 minutes', now() - interval '2 days' + interval '10 minutes', true, now() - interval '2 days'),
    (v_phone_number_id, '15555550202', 'saliente', '[Campaña: promo_bienvenida_demo] Hola, gracias por visitarnos. Como cliente nuevo tienes 15% de descuento en tu primera cita.', 'campaña', v_campana_id,
     'leido', now() - interval '2 days' + interval '3 minutes', now() - interval '2 days' + interval '40 minutes', false, now() - interval '2 days'),
    (v_phone_number_id, '15555550203', 'saliente', '[Campaña: promo_bienvenida_demo] Hola, gracias por visitarnos. Como cliente nuevo tienes 15% de descuento en tu primera cita.', 'campaña', v_campana_id,
     'entregado', now() - interval '2 days' + interval '2 minutes', null, false, now() - interval '2 days'),
    (v_phone_number_id, '15555550204', 'saliente', '[Campaña: promo_bienvenida_demo] Hola, gracias por visitarnos. Como cliente nuevo tienes 15% de descuento en tu primera cita.', 'campaña', v_campana_id,
     'entregado', now() - interval '2 days' + interval '4 minutes', null, false, now() - interval '2 days'),
    (v_phone_number_id, '15555550205', 'saliente', '[Campaña: promo_bienvenida_demo] Hola, gracias por visitarnos. Como cliente nuevo tienes 15% de descuento en tu primera cita.', 'campaña', v_campana_id,
     'fallido', null, null, false, now() - interval '2 days');

  -- ---------- Reflejar el consumo real en el contador del plan ----------
  -- 12 respuestas de IA (rotando 3 escenarios en 7 días) + 4 envíos de
  -- campaña exitosos (el 5º quedó marcado como fallido a propósito).
  update public.dulabs_clientes_config
  set mensajes_usados_mes = mensajes_usados_mes + 16,
      mes_actual = to_char(now(), 'YYYY-MM')
  where phone_number_id = v_phone_number_id;

end $$;
