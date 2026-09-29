-- Bloque 34 — saludo con el nombre para los clientes registrados de Delacour Joyería.
--
-- APLICAR SOLO DESPUÉS DEL MERGE DEL PR DEL BLOQUE 34 (y de que Vercel termine de publicar). Antes del
-- merge, el código no conoce `inicio.saludo_conocido` y la configuración se trataría como inválida: el
-- asistente dejaría de responder.
--
-- Solo agrega esa clave en la fila del agente de Delacour (su número); no toca nada más de `negocio`.
-- `{nombre}` se reemplaza por el primer nombre del cliente (sin nombre guardado, el saludo sale sin él).

-- 0) Respaldo: copia el resultado antes de aplicar (para volver atrás exactamente).
select negocio->'inicio' as inicio from public.dulabs_agente_runtime_config
where id_tenant = '0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4' and phone_number_id = '1428584886997210';

-- 1) Aplicar.
update public.dulabs_agente_runtime_config
set negocio = jsonb_set(negocio, '{inicio,saludo_conocido}', to_jsonb($s$¡Hola, {nombre}! ✨ Soy Aria, tu asesora de Delacour Joyería. Qué alegría saludarte 💎 ¿Qué estás buscando hoy?$s$::text), true)
where id_tenant = '0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4' and phone_number_id = '1428584886997210'
  and negocio ? 'inicio'
returning phone_number_id, negocio->'inicio'->>'saludo_conocido' as saludo_conocido;

-- Volver atrás (quita solo esa clave):
-- update public.dulabs_agente_runtime_config set negocio = negocio #- '{inicio,saludo_conocido}'
-- where id_tenant = '0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4' and phone_number_id = '1428584886997210';
