-- DuLabs — catalog_sales MULTI-NEGOCIO (Fase 1): perfil comercial EXPLÍCITO por número.
--
-- Para qué: el motor catalog_sales (agente conversacional + checkout del sistema) tenía escritos en el
-- código el rubro de Delacour (joyería: "Buscar una joya", "aretes", "dijes"…) y sus formas de pago
-- (pago en tienda o transferencia). Esta migración agrega lo MÍNIMO para que cada número declare su
-- perfil y escribe el de Delacour EXACTAMENTE como funciona hoy:
--
--   1. dulabs_agente_runtime_config.vocabulario (jsonb). null = vocabulario NEUTRAL de la plataforma
--      ("producto", sin ejemplos). Lo valida el código (lib/agente/perfil-negocio.ts, estricto).
--   2. dulabs_agente_runtime_config.checkout_opciones (jsonb): entregas y pagos que el negocio OFRECE,
--      su orden, políticas (pago solo con cierta entrega) y textos. null = sin configurar: con el
--      checkout encendido la config es INVÁLIDA y el agente no responde (nunca se inventa un método).
--   3. dulabs_agente_runtime_config.meta_token_plataforma (boolean, false): sin token de Meta propio,
--      el número puede enviar con el token de la plataforma SOLO si su fila lo autoriza. Sin autorización
--      y sin token propio: error controlado (nunca la credencial de otro).
--   4. dulabs_catalogo_pedidos.metodo_pago: el CHECK admite el catálogo CERRADO de la plataforma
--      (pago_en_tienda, transferencia, contra_entrega, link_pago). Ningún valor arbitrario.
--   5. Delacour (tenant 0d3ae22d-…, número 1428584886997210): su perfil actual EXPLÍCITO y, SOLO si hoy
--      no tiene token propio, la autorización explícita del token de la plataforma (lo que usa hoy).
--      Mismo contenido que PERFIL_LEGADO en lib/agente/perfil-negocio.ts (la prueba de paridad lo verifica).
--   6. Avisos (NOTICE) de cualquier OTRA fila que cambie de comportamiento al aplicarla.
--
-- Orden de despliegue: indiferente.
--   - Código nuevo SIN esta migración: lee la fila sin estas columnas => comportamiento anterior.
--   - Esta migración con el código anterior: las columnas nuevas se ignoran; el CHECK ampliado no cambia nada.
--
-- No toca pedidos, productos, clientes, conversaciones ni otros negocios (salvo los avisos del paso 6,
-- que solo informan). Tablas con RLS y sin políticas nuevas: solo el backend (service_role).
-- Idempotente (IF NOT EXISTS, DROP/ADD de los CHECK, updates solo sobre valores null).
--
-- Rollback (deja todo como antes; el código nuevo vuelve al perfil legado al no ver las columnas):
--   alter table public.dulabs_catalogo_pedidos drop constraint if exists dulabs_catalogo_pedidos_metodo_pago_check;
--   alter table public.dulabs_catalogo_pedidos add constraint dulabs_catalogo_pedidos_metodo_pago_check
--     check (metodo_pago is null or metodo_pago in ('pago_en_tienda', 'transferencia'));   -- (falla si ya hay pedidos con los métodos nuevos)
--   alter table public.dulabs_agente_runtime_config drop column if exists vocabulario,
--     drop column if exists checkout_opciones, drop column if exists meta_token_plataforma;

begin;

-- ============================================================
-- 1-3. Perfil del número (configuración del agente)
-- ============================================================
alter table public.dulabs_agente_runtime_config
  add column if not exists vocabulario jsonb,
  add column if not exists checkout_opciones jsonb,
  add column if not exists meta_token_plataforma boolean not null default false;

alter table public.dulabs_agente_runtime_config drop constraint if exists dulabs_agente_runtime_config_vocabulario_check;
alter table public.dulabs_agente_runtime_config add constraint dulabs_agente_runtime_config_vocabulario_check
  check (vocabulario is null or (jsonb_typeof(vocabulario) = 'object' and pg_column_size(vocabulario) <= 16384));

-- Defensa en profundidad: además de la validación estricta del código, la BD solo admite métodos del catálogo.
alter table public.dulabs_agente_runtime_config drop constraint if exists dulabs_agente_runtime_config_checkout_opciones_check;
alter table public.dulabs_agente_runtime_config add constraint dulabs_agente_runtime_config_checkout_opciones_check
  check (
    checkout_opciones is null
    or (
      jsonb_typeof(checkout_opciones) = 'object'
      and pg_column_size(checkout_opciones) <= 8192
      and jsonb_typeof(checkout_opciones -> 'entregas') = 'array'
      and jsonb_typeof(checkout_opciones -> 'pagos') = 'array'
      and not jsonb_path_exists(checkout_opciones, '$.entregas[*] ? (@ != "tienda" && @ != "domicilio")')
      and not jsonb_path_exists(checkout_opciones, '$.pagos[*].metodo ? (@ != "pago_en_tienda" && @ != "transferencia" && @ != "contra_entrega" && @ != "link_pago")')
    )
  );

comment on column public.dulabs_agente_runtime_config.vocabulario is 'Multi-negocio — cómo se nombra lo que vende (botón de búsqueda, ejemplos, palabras de producto / que no son un nombre). null = neutral ("producto"). Ver lib/agente/perfil-negocio.ts.';
comment on column public.dulabs_agente_runtime_config.checkout_opciones is 'Multi-negocio — entregas y pagos que OFRECE el negocio (catálogo cerrado), orden, políticas y textos. null = sin configurar (con checkout encendido: config inválida).';
comment on column public.dulabs_agente_runtime_config.meta_token_plataforma is 'Multi-negocio — true: sin token propio, puede enviar con el token de la plataforma (números conectados a mano). false: solo su token; sin él, el agente no responde.';

-- ============================================================
-- 4. Métodos de pago del pedido: catálogo cerrado de la plataforma
-- ============================================================
alter table public.dulabs_catalogo_pedidos drop constraint if exists dulabs_catalogo_pedidos_metodo_pago_check;
alter table public.dulabs_catalogo_pedidos add constraint dulabs_catalogo_pedidos_metodo_pago_check
  check (metodo_pago is null or metodo_pago in ('pago_en_tienda', 'transferencia', 'contra_entrega', 'link_pago'));

-- Si el CHECK original tenía otro nombre, seguiría limitando a los 2 métodos: se aborta (nada queda a medias).
do $$
begin
  if exists (
    select 1 from pg_constraint c
     where c.conrelid = 'public.dulabs_catalogo_pedidos'::regclass and c.contype = 'c'
       and c.conname <> 'dulabs_catalogo_pedidos_metodo_pago_check'
       and pg_get_constraintdef(c.oid) like '%metodo_pago%' and pg_get_constraintdef(c.oid) like '%transferencia%'
  ) then
    raise exception 'dulabs_catalogo_pedidos tiene otro CHECK de metodo_pago: revisarlo antes de aplicar esta migración';
  end if;
end $$;

-- ============================================================
-- 5. Delacour: su perfil de hoy, EXPLÍCITO (solo si aún no tiene uno)
-- ============================================================
update public.dulabs_agente_runtime_config
   set vocabulario = $vocabulario${
  "producto": "joya",
  "boton_buscar": "🔎 Buscar una joya",
  "ejemplos": ["dijes", "aretes dorados", "collar corazón"],
  "pistas_busqueda": "tipo de joya, color, material, presupuesto",
  "palabras_producto": [
    "arete", "aretes", "collar", "collares", "dije", "dijes", "pulsera", "pulseras", "anillo", "anillos", "cadena", "cadenas",
    "tobillera", "tobilleras", "candonga", "candongas", "joya", "joyas", "otra joya"
  ],
  "palabras_producto_direccion": ["aretes", "collar", "dije", "dijes", "pulsera", "anillo"],
  "no_es_nombre": ["arete", "aretes", "collar", "collares", "dije", "dijes", "pulsera", "pulseras", "anillo", "anillos", "cadena", "cadenas", "joya", "joyas"],
  "nombre_comercial": ["joya", "joyas"]
}$vocabulario$::jsonb
 where id_tenant = '0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4' and phone_number_id = '1428584886997210' and vocabulario is null;

update public.dulabs_agente_runtime_config
   set checkout_opciones = $checkout${
  "entregas": ["tienda", "domicilio"],
  "pagos": [{ "metodo": "pago_en_tienda" }, { "metodo": "transferencia" }],
  "mensajes": {
    "duda": "Claro 😊 ¿Qué quieres cambiar? Puedes escribirme, por ejemplo, *recoger en tienda*, *domicilio*, *transferencia* o *pago en tienda*. Para cambiar cantidades dime cuántas y de cuál producto.",
    "pago_no_disponible": "Por ahora no manejamos pago contra entrega 🙏 Puedes pagar por *transferencia* o *en la tienda*.",
    "recordatorio_entrega": "Escríbeme si prefieres *domicilio* o *recoger en tienda*.",
    "recordatorio_pago": "Escríbeme si pagas por *transferencia* o *en tienda*."
  }
}$checkout$::jsonb
 where id_tenant = '0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4' and phone_number_id = '1428584886997210' and checkout_opciones is null;

-- Token de la plataforma: solo si HOY Delacour no tiene token propio (es lo que usa hoy). Con token propio, nada cambia.
update public.dulabs_agente_runtime_config r
   set meta_token_plataforma = true
  from public.dulabs_clientes_config c
 where r.id_tenant = '0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4' and r.phone_number_id = '1428584886997210'
   and c.id_tenant = r.id_tenant and c.phone_number_id = r.phone_number_id
   and coalesce(c.meta_permanent_token, '') = '';

-- ============================================================
-- 6. Avisos: otras filas que cambian de comportamiento con esta migración
-- ============================================================
do $$
declare r record;
begin
  for r in
    select a.id_tenant, a.phone_number_id from public.dulabs_agente_runtime_config a
     where a.tipo = 'catalog_sales' and a.habilitado and a.checkout_conversacional and a.checkout_opciones is null
  loop
    raise notice 'ATENCION: % / % tiene el checkout encendido SIN checkout_opciones: su agente no respondera (config invalida) hasta configurarlas.', r.id_tenant, r.phone_number_id;
  end loop;
  for r in
    select a.id_tenant, a.phone_number_id from public.dulabs_agente_runtime_config a
      join public.dulabs_clientes_config c on c.id_tenant = a.id_tenant and c.phone_number_id = a.phone_number_id
     where a.habilitado and not a.meta_token_plataforma and coalesce(c.meta_permanent_token, '') = ''
  loop
    raise notice 'ATENCION: % / % no tiene token de Meta propio ni autorizacion del de la plataforma: su agente no respondera hasta conectar su WhatsApp.', r.id_tenant, r.phone_number_id;
  end loop;
  for r in
    select a.id_tenant, a.phone_number_id from public.dulabs_agente_runtime_config a
     where a.tipo = 'catalog_sales' and a.vocabulario is null
  loop
    raise notice 'Aviso: % / % queda con el vocabulario NEUTRAL ("producto").', r.id_tenant, r.phone_number_id;
  end loop;
end $$;

commit;
