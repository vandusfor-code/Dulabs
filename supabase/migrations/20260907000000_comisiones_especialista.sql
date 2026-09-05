-- AMORE / DuLabs (Fase 10, Contabilidad, autorizado) — configuración
-- GENÉRICA de comisión por especialista (no exclusiva de salones). Sin fila
-- para ningún especialista de AMORE todavía -- se configura manualmente en
-- una subfase posterior; el módulo de Contabilidad debe mostrar "Comisión
-- no configurada" mientras no exista, nunca asumir un porcentaje.
--
-- No se crea ninguna tabla de "movimientos": Contabilidad deriva los
-- movimientos de dulabs_citas_especialista + dulabs_servicios +
-- dulabs_especialistas (estado='completada'), sin duplicar datos.

create table if not exists public.dulabs_comisiones_especialista (
  id_tenant uuid not null,
  especialista_id bigint not null,
  tipo text not null check (tipo in ('porcentaje', 'valor_fijo')),
  valor numeric not null check (valor >= 0),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id_tenant, especialista_id),
  constraint dulabs_comisiones_especialista_especialista_fk
    foreign key (id_tenant, especialista_id)
    references public.dulabs_especialistas (id_tenant, id)
    on delete cascade
);

alter table public.dulabs_comisiones_especialista enable row level security;

comment on table public.dulabs_comisiones_especialista is
  'Configuración de comisión por especialista (Fase 10, Contabilidad). Genérica -- cualquier tenant puede configurar la suya. Sin fila = comisión no configurada (la UI nunca debe asumir un porcentaje).';
comment on column public.dulabs_comisiones_especialista.tipo is
  '"porcentaje": valor es un % (0-100) del ingreso generado. "valor_fijo": valor es un monto COP fijo por servicio completado, sin importar el precio del servicio.';
