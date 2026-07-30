# Pasos manuales pendientes en producción

Los archivos en `supabase/migrations/` son la fuente de verdad del esquema,
pero aplicarlos a la base de datos real de producción es un paso manual
aparte (vía el SQL Editor de Supabase) — no ocurre automáticamente al hacer
`git push` o desplegar en Vercel.

## `20260731090000_plantillas_botones.sql` — pendiente

Agrega la columna `botones` (jsonb) a `dulabs_plantillas`, para guardar los
textos de los botones QUICK_REPLY de cada plantilla. Puramente aditiva.

**Cómo aplicarla:**
1. Entra a tu proyecto en [supabase.com](https://supabase.com/dashboard) → **SQL Editor**.
2. Pega el contenido completo de `supabase/migrations/20260731090000_plantillas_botones.sql`.
3. Ejecuta (**Run**).

**Es seguro desplegar el código antes de correr esto.** Sin la columna,
crear/editar una plantilla seguirá funcionando (el `insert`/`update` con un
campo `botones` que la tabla no tiene fallaría con un error claro de Postgres
al intentar guardar botones — pero solo si el formulario envía botones; sin
botones, todo sigue igual). En cuanto corras esta migración, guardar
plantillas con botones queda disponible sin necesidad de otro deploy.

Después de aplicarla, borra esta sección (o el archivo completo si no queda
ninguna migración pendiente).
