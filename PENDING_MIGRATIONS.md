# Pasos manuales pendientes en producción

## Variables de entorno — QStash (`encuestas-seguimiento`) — pendiente

`/api/cron/encuestas-seguimiento` ya no tiene cron nativo de Vercel (se quitó
de `vercel.json` — el plan Hobby solo permite 1 disparo/día, insuficiente
para recordatorios/reanudaciones oportunos). Ahora lo dispara **QStash**
(console.upstash.com → QStash → Schedules), que sí es preciso y no depende
del plan de Vercel.

**Falta en Vercel** (Project Settings → Environment Variables):
- `QSTASH_CURRENT_SIGNING_KEY`
- `QSTASH_NEXT_SIGNING_KEY`

Ambas se copian de console.upstash.com → QStash → **Signing Keys**. Sin
ellas, la ruta sigue aceptando el `Authorization: Bearer $CRON_SECRET` de
siempre como respaldo (curl manual o disparo alternativo), así que no hay
riesgo de romper nada mientras las agregas — el bot de encuestas simplemente
no recibirá el disparo automático de QStash hasta entonces.

**Schedule en QStash** (Create schedule):
- Destination URL: `https://www.dulabs.co/api/cron/encuestas-seguimiento`
- Method: `GET`
- Cron: `0 * * * *` (cada hora)

Después de agregar las variables, redeploy (cualquier push a `main` sirve)
para que la función las recoja.

# Migraciones pendientes de aplicar en producción

Los archivos en `supabase/migrations/` son la fuente de verdad del esquema,
pero aplicarlos a la base de datos real de producción es un paso manual
aparte (vía el SQL Editor de Supabase o `supabase db push` con el proyecto
enlazado) — no ocurre automáticamente al hacer `git push` o desplegar en
Vercel.

## `20260730090000_survey_bot.sql` — pendiente

Crea `dulabs_survey_bot_config` y `dulabs_survey_sessions` (bot de encuestas
predeterminado). Es puramente aditiva: no toca ninguna tabla existente.

**Cómo aplicarla:**
1. Entra a tu proyecto en [supabase.com](https://supabase.com/dashboard) → **SQL Editor**.
2. Pega el contenido completo de `supabase/migrations/20260730090000_survey_bot.sql`.
3. Ejecuta (**Run**).

**Es seguro desplegar el código antes de correr esto.** Todo el código que
usa estas tablas (`lib/survey-bot-store.ts`, el webhook, el cron) atrapa el
error de "tabla no existe" y simplemente trata el bot de encuestas como
inactivo — el resto de la app (agente de IA normal, campañas, etc.) sigue
funcionando exactamente igual. En cuanto corras esta migración, el bot se
activa solo, sin necesidad de un nuevo deploy.

Después de aplicarla, borra esta sección (o el archivo completo si no queda
ninguna migración pendiente).
