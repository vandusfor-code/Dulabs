# Pasos manuales pendientes en producción

## PENDIENTE — DuLabs Developer V1, Fase 2 (data model + security)

La migración `20261007000000_dulabs_developer_v1_fase2_data_model.sql`
(6 tablas nuevas: `dulabs_dev_api_keys`, `dulabs_dev_whatsapp_numbers`,
`dulabs_dev_webhook_configs`, `dulabs_dev_jobs`, `dulabs_dev_usage_ledger`,
`dulabs_dev_events` -- todas aisladas del esquema de Business) **todavía no
se ha corrido**. Sin ella, toda la suite E2E de Fase 2
(`lib/developer/*-store.e2e.test.ts`, `lib/developer/rls-isolation.e2e.test.ts`)
falla con un error claro de Postgres ("no existe la tabla"), no
silenciosamente. Correr el archivo completo en el SQL Editor de Supabase
antes de dar Fase 2 por cerrada.

> Verificado el 14-sep-2026: la migración `20261006000000_dulabs_developer_v1_fase1.sql`
> (Fase 1, tabla `dulabs_dev_idempotency_keys`) ya está aplicada -- el
> suite completo `lib/developer/idempotency.e2e.test.ts` (7/7) corrió
> contra ella y pasó real. La sección que la daba por pendiente se eliminó.

## PENDIENTE — F16.2 (Onboarding comercial: pago → conectar WhatsApp con Meta → plantilla)

La migración `20261005000000_dulabs_onboarding_meta_bienvenida.sql`
(columnas `bienvenida_meta_enviada_at` / `bienvenida_meta_error` /
`bienvenida_meta_intentado_at` en `dulabs_onboarding_sesiones`) **todavía
no se ha corrido en producción**. Sin ella:

- `lib/onboarding-meta-template.e2e.test.ts` falla con un error de Postgres
  ("column does not exist"), no silenciosamente.
- El envío real de `bienvenida_dulabs` al conectar WhatsApp con Meta
  fallará en producción (error controlado, registrado, no rompe la
  conexión del número -- ver `lib/onboarding-meta-template.ts`).

Correr el archivo completo en el SQL Editor de Supabase antes de dar F16.2
por cerrado en producción.

> Verificado el 14-sep-2026 (F16.1, Dunning): la migración
> `20261004000000_dulabs_dunning.sql` (tablas `dulabs_dunning_ciclos` /
> `dulabs_dunning_eventos` + función `dulabs_dunning_reclamar_reintento`)
> ya está aplicada -- el suite completo `lib/flow/f16-1-dunning.e2e.test.ts`
> (14/14) corrió contra ella y pasó real. La sección que la daba por
> pendiente se eliminó.

Los archivos en `supabase/migrations/` son la fuente de verdad del esquema,
pero aplicarlos a la base de datos real de producción es un paso manual
aparte (vía el SQL Editor de Supabase) — no ocurre automáticamente al hacer
`git push` o desplegar en Vercel.

> Verificado el 25-ago-2026 consultando la base real: `botones` en
> `dulabs_plantillas`, `nombre_participante` en `dulabs_survey_sessions` y
> `dulabs_fallos_ia` ya existen. Las secciones que las daban por pendientes
> estaban desactualizadas y se eliminaron.

> Verificado el 14-sep-2026 (Fase 11, Debt Zero) consultando la base real:
> `cancelar_al_vencer` en `dulabs_suscripciones` (de
> `20260825150000_cancelar_suscripcion.sql`) ya existe. La sección que la
> daba por pendiente estaba desactualizada y se eliminó.

---

> Verificado el 07-sep-2026 consultando la base real: la migración
> `20260918000000_agenda_v2_gestion_citas.sql` (Agenda V2, Fase 8 — gestión de
> citas existentes) ya está aplicada. `dulabs_agenda_v2_citas_nylas` existe,
> `cita_objetivo_id`/`accion_gestion` existen en `dulabs_agenda_v2_sesiones`,
> y el CHECK de `step` ya acepta los 3 valores nuevos de Fase 8. La sección
> que la daba por pendiente se eliminó.

---

> Verificado el 07-sep-2026 consultando la base real: la migración
> `20260919000000_amore_entrada_conversacional.sql` (AMORE, Fase 9 — entrada
> conversacional + puente Gemini -> Agenda V2) ya está aplicada.
> `dulabs_amore_entrada` existe y el CHECK de `modo` acepta `inicio`/`gemini`
> (insert/update/delete de prueba OK). La sección que la daba por pendiente
> se eliminó.

## Variables de entorno que también son paso manual

| Variable | Para qué | Dónde |
|---|---|---|
| `ALERTAS_PHONE_NUMBER_ID` | Número que envía las alertas internas de WhatsApp | Vercel |
| `ALERTAS_META_TOKEN` | Token del System User de Meta con acceso a ese número | Vercel |
| `ALERTAS_DESTINO` | Número que recibe las alertas (solo dígitos) | Vercel |
| `DUMO_ADMIN_EMAILS` | Correos separados por coma que pueden ver/usar DuMo. **Sin esto, DuMo queda oculto para todos** (incluido el operador) | Vercel |

## Plantilla de correo de bienvenida

`supabase/correos/bienvenida.html` no se aplica solo: hay que pegarlo en
**Supabase → Authentication → Emails → "Confirm signup"**, con el asunto
`Confirma tu cuenta de Du Labs`.
