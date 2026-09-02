-- Completa el editor de plantillas (app/dashboard/plantillas) para poder
-- crear, desde Dulabs, lo mismo que ya se puede crear directo en el
-- Administrador de Meta: encabezado (texto o media), variables del BODY con
-- su ejemplo (Meta las exige para aprobar la plantilla), y botones de
-- llamada a la acción (URL / llamar), además de los QUICK_REPLY que ya
-- existían. Migración puramente aditiva -- no toca ninguna columna existente.

-- Encabezado de TEXTO (con o sin una variable {{1}}) -- header_formato ya
-- existía para IMAGE/VIDEO/DOCUMENT (ver 20260826234500_plantillas_header_media.sql);
-- ahora también puede valer 'TEXT', y este campo guarda su contenido.
alter table public.dulabs_plantillas
  add column if not exists header_texto text;

-- Valores de ejemplo para las variables {{1}}, {{2}}… del BODY -- Meta exige
-- un "example.body_text" para aprobar una plantilla con variables; se
-- guardan también para poder re-mostrarlos al editar un borrador.
alter table public.dulabs_plantillas
  add column if not exists variables_ejemplo jsonb not null default '[]';

-- Ejemplo de la variable del header de TEXTO (si header_formato='TEXT' y
-- header_texto tiene {{1}}) -- Meta exige su propio "example.header_text".
alter table public.dulabs_plantillas
  add column if not exists header_ejemplo text;

-- Botones de llamada a la acción (URL / llamar) -- independientes de la
-- columna `botones` ya existente (que sigue siendo solo los textos de los
-- QUICK_REPLY, sin tocar: lib/campaign-lead-engine.ts y
-- dulabs_campaign_bot_config dependen de esa forma exacta). Un mismo
-- template puede tener AMBOS tipos de botón a la vez, tal como permite Meta.
alter table public.dulabs_plantillas
  add column if not exists botones_cta jsonb not null default '[]';

comment on column public.dulabs_plantillas.header_texto is
  'Contenido del encabezado cuando header_formato = TEXT (puede tener una variable {{1}}).';
comment on column public.dulabs_plantillas.variables_ejemplo is
  'Array de strings: valor de ejemplo de cada variable {{1}},{{2}}… del BODY, en orden -- lo exige Meta (example.body_text) para aprobar plantillas con variables.';
comment on column public.dulabs_plantillas.header_ejemplo is
  'Valor de ejemplo de la variable {{1}} del encabezado de texto, si la tiene -- lo exige Meta (example.header_text).';
comment on column public.dulabs_plantillas.botones_cta is
  'Array de {tipo: "URL"|"PHONE_NUMBER", texto, valor} -- botones de llamada a la acción, además de los QUICK_REPLY de la columna botones.';
