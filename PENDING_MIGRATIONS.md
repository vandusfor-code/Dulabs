# Pasos manuales pendientes en producción

> **F16.1 (Dunning, autorizado) -- pendiente de aplicar**: la migración
> `20261004000000_dulabs_dunning.sql` (tablas `dulabs_dunning_ciclos` /
> `dulabs_dunning_eventos` + función `dulabs_dunning_reclamar_reintento`)
> todavía NO está aplicada -- este entorno no tiene acceso a una conexión
> Postgres directa ni a la Management API de Supabase (solo a
> SUPABASE_SERVICE_ROLE_KEY, que no ejecuta DDL). Aplicarla vía el SQL
> Editor de Supabase antes de habilitar F16.1 en producción -- es 100%
> aditiva (`create table if not exists`), no toca ninguna tabla existente.

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
