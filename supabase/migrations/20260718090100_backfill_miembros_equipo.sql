-- Backfill: cada id_tenant existente hoy en dulabs_clientes_config o
-- dulabs_suscripciones (las dos rutas por las que un id_tenant se establece
-- por primera vez) se convierte en su propio equipo de un solo miembro,
-- rol admin, estado activo — preserva 100% del comportamiento actual.
insert into public.dulabs_miembros_equipo (tenant_id, user_id, email, rol, estado)
select u.id, u.id, u.email, 'admin', 'activo'
from auth.users u
where u.id in (
  select id_tenant from public.dulabs_clientes_config where id_tenant is not null
  union
  select id_tenant from public.dulabs_suscripciones where id_tenant is not null
)
on conflict (user_id) do nothing;
