# Pasos manuales pendientes en producción

Los archivos en `supabase/migrations/` son la fuente de verdad del esquema,
pero aplicarlos a la base de datos real de producción es un paso manual
aparte (vía el SQL Editor de Supabase) — no ocurre automáticamente al hacer
`git push` o desplegar en Vercel.

> Verificado el 25-ago-2026 consultando la base real: `botones` en
> `dulabs_plantillas`, `nombre_participante` en `dulabs_survey_sessions` y
> `dulabs_fallos_ia` ya existen. Las secciones que las daban por pendientes
> estaban desactualizadas y se eliminaron.

## `20260825150000_cancelar_suscripcion.sql` — PENDIENTE

Agrega la columna `cancelar_al_vencer` (boolean, default false) a
`dulabs_suscripciones`. Es lo que permite cancelar un plan desde
**Cuenta → Plan y facturación**: la cancelación es diferida (el cliente
conserva el servicio hasta `fecha_proximo_cobro` y el cron cierra la
suscripción en vez de volver a cobrar).

**Cómo aplicarla:**
1. Entra a tu proyecto en [supabase.com](https://supabase.com/dashboard) → **SQL Editor**.
2. Pega el contenido de `supabase/migrations/20260825150000_cancelar_suscripcion.sql`.
3. Ejecuta (**Run**).

**Es seguro desplegar el código antes de correr esto**, con una salvedad: hasta
que la columna exista, el botón "Cancelar suscripción" devolverá un error de
Postgres al pulsarlo, y el cron de cobro mensual fallará su consulta diaria
(no cobrará de más — simplemente no procesará). Corre la migración el mismo
día del despliegue.

Después de aplicarla, borra esta sección (o el archivo completo si no queda
ninguna migración pendiente).

---

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
