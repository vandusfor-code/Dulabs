-- Activación en cortesía del Marketplace desde el Panel de Operaciones (ver
-- lib/marketplace-store.ts `activarMarketplaceCortesia`). Migración
-- puramente aditiva: no toca ninguna columna existente ni el flujo de compra
-- normal (app/api/dashboard/marketplace/activar/route.ts, sin cambios).
--
-- Una activación de cortesía es una fila normal de dulabs_marketplace_activaciones
-- (mismo estado 'activa', misma columna marketplace_activacion_id en
-- dulabs_clientes_config) con precio_cop=0, tipo_plan='recurrente' y
-- fecha_proximo_cobro=null -- el cron de cobro mensual (app/api/wompi/cobro-mensual)
-- ya se salta cualquier fila con fecha_proximo_cobro null, así que una
-- cortesía nunca se cobra ni expira sola: solo un admin de DuLabs puede
-- desactivarla (mismo botón/endpoint ya existente de desactivar).

alter table public.dulabs_marketplace_activaciones
  add column if not exists es_cortesia boolean not null default false;

alter table public.dulabs_marketplace_activaciones
  add column if not exists cortesia_activada_por uuid;

alter table public.dulabs_marketplace_activaciones
  add column if not exists cortesia_motivo text;

comment on column public.dulabs_marketplace_activaciones.es_cortesia is
  'true si esta activación fue otorgada gratis desde el Panel de Operaciones (nunca se cobra ni se recobra vía Wompi).';
comment on column public.dulabs_marketplace_activaciones.cortesia_activada_por is
  'user_id (auth.users) del admin de DuLabs que otorgó la cortesía. Null para activaciones normales pagadas.';
comment on column public.dulabs_marketplace_activaciones.cortesia_motivo is
  'Motivo corto en texto libre que el admin escribió al otorgar la cortesía (ej. "Incluido en implementación").';
