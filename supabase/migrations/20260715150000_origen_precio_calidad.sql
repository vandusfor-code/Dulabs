-- Origen real de cada mensaje saliente (ia | campaña | manual) para poder
-- calcular una tasa de automatización real, categoría de precio de Meta por
-- mensaje (para mostrar consumo real en vez de un costo inventado), soporte
-- de borrador local en plantillas, y estado operativo real del número
-- (calidad, límite de mensajería, verificación) sincronizado desde Meta.

alter table public.dulabs_mensajes_log
  add column if not exists origen text not null default 'manual', -- ia | campaña | manual | entrante
  add column if not exists pricing_categoria text;

comment on column public.dulabs_mensajes_log.origen is
  'Quién generó este mensaje saliente: ia (respuesta automática), campaña (envío masivo) o manual (el dueño respondió desde su celular). Los entrantes usan "entrante".';
comment on column public.dulabs_mensajes_log.pricing_categoria is
  'Categoría de precio que reportó Meta en el webhook de estado (utility, marketing, authentication, service, etc.), para mostrar consumo real sin inventar un costo en dólares.';

alter table public.dulabs_plantillas
  add column if not exists borrador boolean not null default false;

comment on column public.dulabs_plantillas.borrador is
  'true si se guardó localmente sin someterla todavía a revisión de Meta (no tiene meta_template_id).';

alter table public.dulabs_clientes_config
  add column if not exists calidad text,
  add column if not exists limite_mensajeria text,
  add column if not exists estado_verificacion text,
  add column if not exists estado_nombre_visible text,
  add column if not exists ultima_sincronizacion_meta timestamptz;

comment on column public.dulabs_clientes_config.calidad is
  'quality_rating real reportado por Meta para este número (GREEN/YELLOW/RED/UNKNOWN).';
comment on column public.dulabs_clientes_config.limite_mensajeria is
  'messaging_limit_tier real de Meta (ej. TIER_1K, TIER_10K, TIER_UNLIMITED).';
comment on column public.dulabs_clientes_config.estado_verificacion is
  'code_verification_status real de Meta para el número.';
comment on column public.dulabs_clientes_config.estado_nombre_visible is
  'name_status real de Meta para el nombre público del negocio (display name).';
