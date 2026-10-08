# Delacour — aprovisionamiento del CMS comercial (Bloque 29)

Todo se corre **a mano** en el SQL Editor de Supabase (nada se ejecuta solo). Cada script se puede repetir sin efectos nuevos y trae su reversa.
Ningún script lleva datos de ningún negocio (ni ids ni teléfonos ni textos): el negocio sale del slug de su tienda publicada y los textos de ARIA se leen de la base al correr.

| Script | Para qué | Cambia datos |
|---|---|---|
| `01_verificar_cms_comercial_solo_lectura.sql` | Mira el estado (migración, permisos, módulo, cuántos elementos hay) | No |
| `02_habilitar_cms_comercial.sql` | Enciende el módulo `cms_comercial` para Delacour | Una fila en `dulabs_tenant_modulos` |
| `03_sembrar_vitrina_actual.sql` | Publica la portada y el banner que la tienda ya muestra hoy como contenido del CMS (la tienda se ve IDÉNTICA) | Una página principal en el CMS (versión 1) |
| `03_sembrar_vitrina_actual.reversa.sql` | Deshace la siembra: despublica la página (la tienda vuelve a la portada del código; nada se borra) | Estado de esa página |
| `04_migrar_textos_a_borradores.sql` | Copia los 22 textos comerciales del prompt de ARIA al CMS como **borradores** (nunca publicados) | 22 borradores en el CMS |
| `04_migrar_textos_a_borradores.reversa.sql` | Archiva los borradores que nadie ha tocado | Estado de esos borradores |
| `05_habilitar_herramientas_comerciales.sql` | Agrega a ARIA las 4 herramientas de lectura del CMS (y con ellas la guarda de anclaje comercial) **solo para el piloto**: los números que indiques con `set dulabs.piloto_comercial = '57…';` (todos los demás clientes siguen exactamente como hoy) | `herramientas` y `negocio.comercial_piloto` de la fila de ARIA |
| `05_habilitar_herramientas_comerciales.reversa.sql` | Quita esas 4 herramientas y el piloto (ARIA vuelve a ser la de antes, para todos) | `herramientas` y `negocio.comercial_piloto` de la fila de ARIA |
| `05b_abrir_herramientas_comerciales_a_todos.sql` | Termina el piloto: desde ese momento **todos** los clientes del número reciben las herramientas y la guarda | Quita `negocio.comercial_piloto` |
| `06_retirar_textos_del_prompt.sql` | Retira del prompt, **tema por tema**, los textos que ya viven publicados en el CMS | `negocio.conocimiento` de la fila de ARIA |
| `06_retirar_textos_del_prompt.reversa.sql` | Devuelve al prompt el texto publicado hoy en el CMS de los temas indicados | `negocio.conocimiento` de la fila de ARIA |
| `07_estado_migracion_textos_solo_lectura.sql` | Muestra, tema por tema, dónde vive cada texto (prompt, CMS o ambos), cuántas herramientas están habilitadas y si siguen en piloto (con los últimos 4 dígitos de cada número) o abiertas a todos | No |

## Orden (cada paso se niega a correr si el anterior no está)

1. Fusionar y desplegar el PR 1 (código inerte: sin el módulo y sin la migración, el CMS «no existe» y nada cambia).
2. Correr `supabase/migrations/20261210000000_dulabs_cms_comercial.sql` (idempotente; su reversa está en `supabase/rollbacks/`).
3. Correr `01_verificar_cms_comercial_solo_lectura.sql`: `migracion_aplicada`, `rls_activa`, `funciones_solo_service` y `tienda_unica` en verdadero; `modulo_habilitado` en falso.
4. Correr `02_habilitar_cms_comercial.sql`.
5. Volver a correr el `01`: ahora `modulo_habilitado` en verdadero y todo en 0 (nada publicado todavía).
6. (PR 3, después de desplegar el código de la tienda) Correr `03_sembrar_vitrina_actual.sql`. Es un solo bloque, se niega si el módulo no está habilitado o si ya existe una página principal (no pisa nada) y firma como «Siembra inicial». Volver a correr el `01`: `publicados` = 1.
7. Abrir la tienda: se ve exactamente igual que antes. En el Dashboard (Tienda → Página principal) la administradora ya encuentra su portada y su banner para editar; «Ver mi tienda» abre la tienda pública.

### ARIA (PR 5) — migrar los textos del prompt al CMS, sin apagar nada de golpe

Antes de empezar: **fusionar y desplegar el PR 5 y el del piloto por número (PR 6)** (el código es inerte mientras el número de ARIA no tenga las herramientas comerciales en su lista: el prompt, la guarda y la traza quedan exactamente como hoy). **Espera a que el despliegue termine antes del paso 11**: el código anterior al piloto no conoce `negocio.comercial_piloto` y, si corres el `05` antes, la configuración de ARIA le parecería inválida y ARIA dejaría de responder hasta que corras la reversa del `05`.

8. Correr `07_estado_migracion_textos_solo_lectura.sql`: todos los temas «en el prompt», «no migrado»; `0 de 4 habilitadas`.
9. Correr `04_migrar_textos_a_borradores.sql`. Crea los borradores (tema, audiencia y orden de la tabla; el mínimo mayorista escrito a mano pasa a la variable `{{minimo_mayorista}}`). No publica nada ni toca ARIA. Volver a correr el `07`: los 22 temas en «borrador».
10. La administradora abre **Tienda → Contenido**, revisa cada texto (sobre todo «Venta al por mayor» y «Emprendimiento», que nacen con audiencia **mayorista**: si solo explican cómo funciona y el mínimo, puede abrirlos a «todos»; si traen precios mayoristas, que se queden en «mayorista») y **publica los que estén bien**. El `07` muestra `prompt+cms` en los publicados.
11. En la **misma sesión**: `set dulabs.piloto_comercial = '57XXXXXXXXXX';` (tu número: 57 + el celular, solo dígitos; varios separados por coma, hasta 20) y `05_habilitar_herramientas_comerciales.sql`. Se niega sin números (nunca abre al público por sí solo), con un número mal escrito (por ejemplo un celular sin el 57), mientras no haya ningún texto publicado, si quedó sin publicar alguno de los temas críticos (promociones, venta al por mayor, envíos, medios de pago, garantías, cambios y devoluciones, horario y ubicación) y si las herramientas ya están abiertas a todos (para volver a un piloto, primero la reversa). **Solo esos números** reciben las herramientas, la guarda anti-invención y la sección «información comercial» del prompt: ARIA consulta lo publicado y deja de dejar pasar una promoción, un descuento, una vigencia, un combo o una política que el sistema no respalde. **Todos los demás clientes siguen EXACTAMENTE como hoy.** Los textos siguen también en el prompt.
12. **Verificar con conversaciones reales** (el dueño, con su número de piloto) que ARIA responde bien: promociones, garantía, horario, envíos, mayoristas, y que ante algo que el CMS no tiene ofrece una asesora en vez de inventar. Para cambiar los números del piloto basta repetir el paso 11 con los nuevos.
13. Cuando esté bien: `05b_abrir_herramientas_comerciales_a_todos.sql` (un solo bloque). Quita el piloto: desde ese momento **todos** los clientes del número reciben las herramientas. Se niega si las herramientas no están habilitadas, si no queda ningún texto publicado o si quedó sin publicar un tema crítico. Volver a correr el `07`: «abiertas a TODOS los clientes».
14. Solo entonces, de a pocos temas: `set dulabs.retirar_temas = 'promociones,envios';` y correr `06_retirar_textos_del_prompt.sql`. Se niega mientras las herramientas sigan en piloto (los demás clientes se quedarían sin esa información), si no están habilitadas o si el tema no está publicado. Desde ese momento la única fuente de esos textos es el CMS publicado.

Reversas (cada una de su paso, en orden inverso): `06_…reversa.sql` (`set dulabs.restaurar_temas = '…';` devuelve al prompt el texto publicado hoy), `05_…reversa.sql` (quita las herramientas y el piloto; se niega si un tema crítico ya solo vive en el CMS, salvo `set dulabs.confirmar_reversa_herramientas = 'si';`), `04_…reversa.sql`, `03_…reversa.sql` (se niega si la administradora ya publicó cambios, salvo `set dulabs.confirmar_reversa_siembra = 'si';`). Para volver de «abiertas a todos» a un piloto: `05_…reversa.sql` y luego el `05` otra vez con tu número.

Los `03` a `07` los GENERA el código (`lib/cms-comercial/siembra-vitrina.ts` y `lib/cms-comercial/migracion-textos.ts`): una prueba los regenera y los compara; no se editan a mano. Para regenerarlos: `ACTUALIZAR_SQL=1 npx tsx --test lib/cms-comercial/siembra-vitrina.test.ts lib/cms-comercial/migracion-textos.test.ts`.
