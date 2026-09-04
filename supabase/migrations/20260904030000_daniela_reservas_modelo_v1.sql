-- Fase 1 del sistema de reservas de Daniela (autorizado) — SOLO modelo de
-- datos. Extiende el sistema real ya existente (dulabs_especialistas /
-- dulabs_citas_especialista / dulabs_clientes_conocidos, ver
-- 20260825200000_especialistas_agenda.sql y siguientes) -- no crea un
-- segundo sistema paralelo, no toca dulabs_marketplace_citas (modelo de
-- concurrencia distinto, otros tenants), no modifica el constraint
-- dulabs_citas_especialista_sin_solape existente.
--
-- Todo lo de este archivo es ADITIVO: ninguna tabla/columna/constraint
-- existente se elimina, renombra ni cambia de comportamiento. Los
-- horarios/bloqueos que se crean acá son solo la FUENTE DE DATOS nueva --
-- el motor de disponibilidad hardcodeado (ventanaAtencion, pestanasDisponible,
-- danielaDisponible en lib/especialista-solicitud-ia.ts y
-- lib/especialistas-flow-adaptador.ts) sigue intacto hasta la Fase 2.
--
-- Aislamiento multi-tenant: siguiendo el mismo patrón ya usado por
-- dulabs_flow_versions (20260828100000_dulabs_flow_store.sql) -- FK
-- COMPUESTA (id_tenant, especialista_id) contra dulabs_especialistas
-- (id_tenant, id), nunca solo especialista_id -- así Postgres mismo, no la
-- aplicación, impide asociar un servicio/horario/bloqueo de un tenant con
-- un especialista de otro tenant. dulabs_especialistas usaba hasta ahora
-- solo "id" como PK; se agrega un UNIQUE(id_tenant, id) adicional
-- (no destructivo, id sigue siendo PK) para poder anclar esas FKs.

alter table public.dulabs_especialistas
  add constraint dulabs_especialistas_tenant_id_key unique (id_tenant, id);

-- ---------------------------------------------------------------------------
-- 1. dulabs_servicios
-- ---------------------------------------------------------------------------
-- categoria es texto libre a propósito en V1 (instruido) -- no se asume
-- todavía una tabla de categorías separada.

create table public.dulabs_servicios (
  id uuid not null default gen_random_uuid(),
  id_tenant uuid not null,
  categoria text,
  nombre text not null,
  descripcion text,
  -- Mismo tipo que dulabs_suscripciones.precio_cop (20260714120000): pesos
  -- colombianos enteros, sin decimales. Nullable -- algunos servicios reales
  -- de Daniela ("Acrílicas... el valor final se define en el spa") no tienen
  -- un precio fijo único.
  precio integer,
  duracion_min integer not null check (duracion_min > 0),
  imagen_url text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id_tenant, id)
);

create index dulabs_servicios_tenant_idx
  on public.dulabs_servicios (id_tenant);

-- Índice parcial: las consultas reales siempre son "servicios activos de
-- este tenant" (para mostrarlos en el portal/panel); las filas inactivas
-- nunca se listan, así que no hace falta indexarlas.
create index dulabs_servicios_tenant_activo_idx
  on public.dulabs_servicios (id_tenant)
  where activo;

comment on table public.dulabs_servicios is
  'Catálogo de servicios de Daniela (nombre, precio, duración) -- fuente de datos nueva para el sistema de reservas. No reemplaza el texto libre "servicio" que ya usa dulabs_especialistas/dulabs_citas_especialista; conviven hasta que una fase futura decida migrar.';

-- ---------------------------------------------------------------------------
-- 2. dulabs_servicio_especialista (servicio <-> especialista, N a N)
-- ---------------------------------------------------------------------------
-- id_tenant se agrega en la fila del puente (más allá de los "campos
-- mínimos" pedidos) porque es la única forma de anclar DOS FKs compuestas
-- (una a dulabs_servicios, otra a dulabs_especialistas) que garanticen,
-- a nivel de Postgres, que ambos lados pertenecen al mismo tenant --
-- sin este campo acá, esa garantía solo podría vivir en la aplicación.

create table public.dulabs_servicio_especialista (
  id_tenant uuid not null,
  servicio_id uuid not null,
  especialista_id bigint not null,
  created_at timestamptz not null default now(),
  primary key (servicio_id, especialista_id),
  constraint dulabs_servicio_especialista_servicio_fk
    foreign key (id_tenant, servicio_id)
    references public.dulabs_servicios (id_tenant, id)
    on delete cascade,
  constraint dulabs_servicio_especialista_especialista_fk
    foreign key (id_tenant, especialista_id)
    references public.dulabs_especialistas (id_tenant, id)
    on delete cascade
);

create index dulabs_servicio_especialista_especialista_idx
  on public.dulabs_servicio_especialista (especialista_id);

comment on table public.dulabs_servicio_especialista is
  'Qué especialistas pueden realizar cada servicio. La PK (servicio_id, especialista_id) ya es el UNIQUE pedido -- no hace falta una columna id aparte. Las dos FK compuestas por id_tenant garantizan que nunca se pueda vincular un servicio de un tenant con un especialista de otro.';

-- ---------------------------------------------------------------------------
-- 3. dulabs_horario_especialista
-- ---------------------------------------------------------------------------
-- Convención de dia_semana verificada contra el código real ya existente:
-- lib/especialistas.ts (ventanaAtencion) y lib/parse-fecha-colombia.ts usan
-- Date.getDay() de JavaScript -- 0=domingo ... 6=sábado -- exactamente la
-- convención propuesta. Se reutiliza tal cual, no se inventa una nueva.
--
-- IMPORTANTE: crear filas acá todavía NO cambia ninguna disponibilidad real
-- -- ventanaAtencion() y las funciones hardcodeadas de horarios NO leen esta
-- tabla todavía (eso es Fase 2). Esta tabla es solo la fuente de datos.

create table public.dulabs_horario_especialista (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  especialista_id bigint not null,
  dia_semana smallint not null,
  hora_inicio time not null,
  hora_fin time not null,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dulabs_horario_especialista_dia_valido check (dia_semana between 0 and 6),
  constraint dulabs_horario_especialista_rango_valido check (hora_fin > hora_inicio),
  constraint dulabs_horario_especialista_especialista_fk
    foreign key (id_tenant, especialista_id)
    references public.dulabs_especialistas (id_tenant, id)
    on delete cascade
);

create index dulabs_horario_especialista_especialista_dia_idx
  on public.dulabs_horario_especialista (especialista_id, dia_semana)
  where activo;

create index dulabs_horario_especialista_tenant_idx
  on public.dulabs_horario_especialista (id_tenant);

comment on table public.dulabs_horario_especialista is
  'Horario laboral por especialista y día de la semana (0=domingo..6=sábado, igual que Date.getDay() ya usado en lib/especialistas.ts). Fuente de datos nueva -- el cálculo de disponibilidad real (Fase 2) todavía usa ventanaAtencion() hardcodeado, no esta tabla.';

-- ---------------------------------------------------------------------------
-- 4. dulabs_bloqueos
-- ---------------------------------------------------------------------------
-- especialista_id NULL = bloqueo general del tenant (ej. el spa cierra un
-- día completo). Postgres no valida una FK compuesta cuando la columna
-- opcional es NULL (comportamiento estándar MATCH SIMPLE), así que esto
-- funciona sin ningún caso especial: con especialista_id, se exige que
-- pertenezca al mismo id_tenant; sin él, no hay nada que validar.
--
-- TEXT + CHECK en vez de un tipo ENUM propio, seguido el mismo criterio ya
-- usado para "estado" en dulabs_citas_especialista -- más simple de
-- extender después con un ALTER CONSTRAINT aditivo, sin migración de tipo.

create table public.dulabs_bloqueos (
  id bigint generated always as identity primary key,
  id_tenant uuid not null,
  especialista_id bigint,
  tipo text not null,
  inicio timestamptz not null,
  fin timestamptz not null,
  motivo text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dulabs_bloqueos_tipo_valido
    check (tipo in ('almuerzo', 'vacaciones', 'incapacidad', 'reunion', 'manual')),
  constraint dulabs_bloqueos_rango_valido check (fin > inicio),
  constraint dulabs_bloqueos_especialista_fk
    foreign key (id_tenant, especialista_id)
    references public.dulabs_especialistas (id_tenant, id)
    on delete cascade
);

create index dulabs_bloqueos_especialista_rango_idx
  on public.dulabs_bloqueos (especialista_id, inicio, fin)
  where activo;

create index dulabs_bloqueos_tenant_rango_idx
  on public.dulabs_bloqueos (id_tenant, inicio, fin)
  where activo;

comment on table public.dulabs_bloqueos is
  'Bloqueos de disponibilidad (almuerzo, vacaciones, incapacidad, reunión, manual) por especialista o generales del tenant (especialista_id NULL). Fase 1: solo el dato queda modelado -- el motor de disponibilidad (Fase 2) todavía no los consulta.';

-- ---------------------------------------------------------------------------
-- 5. Estados de cita -- extensión ADITIVA del CHECK existente
-- ---------------------------------------------------------------------------
-- Investigado antes de tocar nada: NINGÚN código actual (legacy IA, Flow no
-- activado, API /api/agenda/[token], cron de recordatorios, componentes del
-- panel) escribe hoy 'completada' ni 'no_show' -- por lo tanto agregarlos a
-- la lista permitida no cambia ningún comportamiento existente, solo
-- habilita que código futuro (Fase 2+) los use. 'rechazada' y 'propuesta'
-- se conservan intactos -- cumplen una función real hoy (rechazo
-- administrativo y flujo de reagendamiento propuesto) y no se tocan.
--
-- Mismo patrón exacto ya usado una vez antes en este archivo para agregar
-- 'propuesta' (20260825210000_reagendamiento.sql): drop + re-create del
-- CHECK con la lista ampliada. El EXCLUDE anti-solape (sin_solape) NO se
-- toca -- su propia cláusula WHERE ya solo nombra
-- ('pendiente','confirmada','propuesta'), así que agregar 'completada'/
-- 'no_show' al CHECK general no la afecta en absoluto: una cita completada
-- o no-show sigue sin bloquear el horario, que es el comportamiento correcto.

alter table public.dulabs_citas_especialista
  drop constraint dulabs_citas_especialista_estado_valido;
alter table public.dulabs_citas_especialista
  add constraint dulabs_citas_especialista_estado_valido
  check (estado in ('pendiente', 'confirmada', 'rechazada', 'cancelada', 'propuesta', 'completada', 'no_show'));

-- ---------------------------------------------------------------------------
-- 6. dulabs_clientes_conocidos -- campo aditivo
-- ---------------------------------------------------------------------------
-- created_at/updated_at YA existían (20260825250000_clientes_conocidos.sql)
-- -- no se tocan. Único campo nuevo real: correo, nullable, para cuando el
-- portal de reservas (Fase 4) lo pida como campo opcional -- evita otra
-- migración solo para esto más adelante. No es CRM: sigue siendo un
-- registro plano por número de WhatsApp.

alter table public.dulabs_clientes_conocidos
  add column correo text;

-- ---------------------------------------------------------------------------
-- RLS: mismo patrón que dulabs_especialistas/dulabs_citas_especialista --
-- habilitado, sin policy explícita (el acceso real es siempre vía backend
-- con service role, igual que todo /api/agenda/[token] hoy).
-- ---------------------------------------------------------------------------

alter table public.dulabs_servicios enable row level security;
alter table public.dulabs_servicio_especialista enable row level security;
alter table public.dulabs_horario_especialista enable row level security;
alter table public.dulabs_bloqueos enable row level security;
