# Delacour — aprovisionamiento del CMS comercial (Bloque 29)

Todo se corre **a mano** en el SQL Editor de Supabase (nada se ejecuta solo). Cada script se puede repetir sin efectos nuevos y trae su reversa.

| Script | Para qué | Cambia datos |
|---|---|---|
| `01_verificar_cms_comercial_solo_lectura.sql` | Mira el estado (migración, permisos, módulo, cuántos elementos hay) | No |
| `02_habilitar_cms_comercial.sql` | Enciende el módulo `cms_comercial` para Delacour | Una fila en `dulabs_tenant_modulos` |

## Orden

1. Fusionar y desplegar el PR 1 (código inerte: sin el módulo y sin la migración, el CMS «no existe» y nada cambia).
2. Correr `supabase/migrations/20261210000000_dulabs_cms_comercial.sql` (idempotente; su reversa está en `supabase/rollbacks/`).
3. Correr `01_verificar_cms_comercial_solo_lectura.sql`: `migracion_aplicada`, `rls_activa`, `funciones_solo_service` y `tienda_unica` en verdadero; `modulo_habilitado` en falso.
4. Correr `02_habilitar_cms_comercial.sql`.
5. Volver a correr el `01`: ahora `modulo_habilitado` en verdadero y todo en 0 (nada publicado todavía).

Los pasos siguientes (portada y contenido semilla, tienda, precio efectivo y ARIA) llegan con los PRs 2 a 5.
