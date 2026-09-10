-- AMORE (autorizado) — la comisión deja de configurarse por especialista
-- (dulabs_comisiones_especialista, Fase 10, nunca tuvo UI real -- por eso
-- Contabilidad siempre mostraba "No configurada") y pasa a configurarse
-- DIRECTAMENTE en cada servicio: cada cita completada calcula su propia
-- comisión real según el servicio (o los servicios, si es multi-servicio)
-- que de verdad se realizó, no según una tarifa fija por profesional.
--
-- Genérico por diseño (igual que el resto de dulabs_servicios): cualquier
-- tenant puede configurar la comisión de su propio servicio, nunca exclusivo
-- de AMORE. Aditivo y 100% retrocompatible: ambas columnas nullable, default
-- NULL -- todo servicio existente (de cualquier tenant) queda exactamente
-- como "comisión no configurada", cero cambio de comportamiento hasta que
-- alguien la configure a propósito. dulabs_comisiones_especialista NO se
-- borra (evita perder datos ya escritos), simplemente deja de leerse -- ver
-- lib/contabilidad/comisiones.ts.

alter table public.dulabs_servicios
  add column if not exists comision_tipo text check (comision_tipo in ('porcentaje', 'valor_fijo'));

alter table public.dulabs_servicios
  add column if not exists comision_valor numeric check (comision_valor >= 0);

-- "porcentaje" sin un valor entre 0 y 100 no tiene sentido real -- la
-- aplicación ya lo valida al guardar, pero la base de datos es la última
-- barrera real (mismo criterio que el resto del esquema, nunca confiar solo
-- en la validación de aplicación).
alter table public.dulabs_servicios
  add constraint dulabs_servicios_comision_porcentaje_valido
  check (comision_tipo is distinct from 'porcentaje' or (comision_valor >= 0 and comision_valor <= 100));

comment on column public.dulabs_servicios.comision_tipo is
  'Comisión de este servicio (autorizado, genérico): "porcentaje" (comision_valor es un % 0-100 del precio) o "valor_fijo" (comision_valor es un monto COP fijo, sin importar el precio). NULL = comisión no configurada -- nunca se asume un valor.';
comment on column public.dulabs_servicios.comision_valor is
  'Valor de la comisión -- porcentaje (0-100) o monto COP fijo según comision_tipo. NULL junto con comision_tipo = no configurada.';
