# Delacour — aprovisionamiento del CMS comercial (Bloque 29)

Todo se corre **a mano** en el SQL Editor de Supabase (nada se ejecuta solo). Cada script se puede repetir sin efectos nuevos y trae su reversa.

| Script | Para qué | Cambia datos |
|---|---|---|
| `01_verificar_cms_comercial_solo_lectura.sql` | Mira el estado (migración, permisos, módulo, cuántos elementos hay) | No |
| `02_habilitar_cms_comercial.sql` | Enciende el módulo `cms_comercial` para Delacour | Una fila en `dulabs_tenant_modulos` |
| `03_sembrar_vitrina_actual.sql` | Publica la portada y el banner que la tienda ya muestra hoy como contenido del CMS (la tienda se ve IDÉNTICA) | Una página principal en el CMS (versión 1) |
| `03_sembrar_vitrina_actual.reversa.sql` | Deshace la siembra: despublica la página (la tienda vuelve a la portada del código; nada se borra) | Estado de esa página |

## Orden

1. Fusionar y desplegar el PR 1 (código inerte: sin el módulo y sin la migración, el CMS «no existe» y nada cambia).
2. Correr `supabase/migrations/20261210000000_dulabs_cms_comercial.sql` (idempotente; su reversa está en `supabase/rollbacks/`).
3. Correr `01_verificar_cms_comercial_solo_lectura.sql`: `migracion_aplicada`, `rls_activa`, `funciones_solo_service` y `tienda_unica` en verdadero; `modulo_habilitado` en falso.
4. Correr `02_habilitar_cms_comercial.sql`.
5. Volver a correr el `01`: ahora `modulo_habilitado` en verdadero y todo en 0 (nada publicado todavía).

6. (PR 3, después de desplegar el código de la tienda) Correr `03_sembrar_vitrina_actual.sql`. Es un solo bloque, se niega si el módulo no está habilitado o si ya existe una página principal (no pisa nada) y firma como «Siembra inicial». Volver a correr el `01`: `publicados` = 1.
7. Abrir la tienda: se ve exactamente igual que antes. En el Dashboard (Tienda → Página principal) la administradora ya encuentra su portada y su banner para editar; «Ver mi tienda» abre la tienda pública.

Reversa de la siembra: `03_sembrar_vitrina_actual.reversa.sql` (despublica la página; se niega si la administradora ya publicó cambios, salvo `set dulabs.confirmar_reversa_siembra = 'si';`).

Los 03 los GENERA el código (`lib/cms-comercial/siembra-vitrina.ts`): una prueba los regenera y los compara; no se editan a mano.

Los pasos siguientes (precio efectivo y ARIA) llegan con los PRs 4 y 5.
