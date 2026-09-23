# Pasos manuales pendientes en producción

## ⏳ PENDIENTE — Catálogo DuLabs, Fase 7 (pedidos estructurados: WhatsApp + agente)

Migración `supabase/migrations/20261108000000_dulabs_catalogo_pedidos.sql`.
**100 % aditiva** (no toca tablas existentes):

- crea `dulabs_catalogo_pedidos` (pedido canónico; RLS activado, solo backend;
  UNIQUE por negocio de la clave de idempotencia y del `DL-ORD-…`);
- crea `dulabs_catalogo_pedido_eventos` (bitácora inmutable de eventos v2,
  `event_id` único, FK compuesta pedido+negocio);
- crea las funciones transaccionales `dulabs_catalogo_pedido_crear`,
  `dulabs_catalogo_pedido_transicion` y `dulabs_catalogo_pedido_transicion_valida`
  (EXECUTE solo para `service_role`; revocado explícitamente a `anon` y
  `authenticated`).

**Mientras no se aplique (convivencia segura):** la tienda sigue generando la
solicitud y el link de WhatsApp exactamente como hoy; el webhook no registra
pedidos y las herramientas de pedido del agente responden `UNAVAILABLE`. Nada
existente cambia (AMORE, Business Agent, Flow, IA).

**Al aplicarla:** se activa sola (sonda del backend), sin desplegar código.

Validada contra PostgreSQL 16 local emulando los privilegios por defecto de
Supabase: `supabase/tests/20261108000000_dulabs_catalogo_pedidos.test.sql`
(17/17), aplicada dos veces sin error (idempotente); 20 creaciones
concurrentes con la misma clave => 1 pedido y 1 evento; 20 transiciones
concurrentes => 1 gana (compare-and-set), 1 contacto, 1 evento.

1. Correr el archivo completo en el SQL Editor (idempotente).
2. Verificar (esperado 2, 3, 0):
   ```sql
   select count(*) from information_schema.tables
    where table_name in ('dulabs_catalogo_pedidos', 'dulabs_catalogo_pedido_eventos');
   select count(*) from pg_proc where proname in
    ('dulabs_catalogo_pedido_crear', 'dulabs_catalogo_pedido_transicion', 'dulabs_catalogo_pedido_transicion_valida');
   select count(*) from information_schema.role_routine_grants
    where routine_name like 'dulabs_catalogo_pedido%' and grantee in ('anon', 'authenticated');
   ```

Rollback: al inicio del archivo de la migración.

## ✅ APLICADA (según confirmación del responsable, 23-sep-2026) — Catálogo DuLabs, Fase 4 (carga masiva)

**Estado: el responsable del proyecto confirmó que la migración se ejecutó
en Supabase de producción.** El resultado de las consultas de verificación no
se registró aquí. Si hubiera dudas, la pantalla de carga masiva lo muestra: sin
la estructura aparece «estará disponible muy pronto» y el botón de importar
queda deshabilitado (la sonda `importsAvailable` del backend).

Migración `supabase/migrations/20261107000000_dulabs_catalogo_importaciones.sql`
(requiere la Fase 1 ya aplicada). **100 % aditiva:**

- crea `dulabs_catalogo_importaciones` (historial por tenant, RLS activado,
  solo backend);
- agrega a `dulabs_inventario_productos` dos columnas **nullable**
  (`importacion_id`, `importacion_fila`), un CHECK «ambas o ninguna», una FK
  compuesta al historial del mismo tenant y un índice UNIQUE parcial
  (idempotencia por importación + fila). Para todo lo existente quedan en
  NULL: AMORE, el Business Agent y la cotización no cambian.

**Mientras no se aplique (convivencia segura, ya desplegada):** la pantalla
de carga masiva permite subir, analizar y revisar el archivo. Muestra «La
carga masiva estará disponible muy pronto» y el botón de importar queda
deshabilitado (`GET /api/dashboard/catalogo/importaciones` → `available:
false`). El resto del catálogo funciona igual.

**Al aplicarla:** se activa sola. No hace falta desplegar código ni cambiar
configuración.

Validada contra PostgreSQL 16 local:
`supabase/tests/20261107000000_dulabs_catalogo_importaciones.test.sql`
(10/10), aplicada dos veces sin error (idempotente) y 12 importaciones
concurrentes × 30 productos = 362 referencias únicas.

1. Correr el archivo completo en el SQL Editor (es idempotente: si ya se
   corrió, volver a correrlo no cambia nada).
2. Verificar (esperado 1, 2, 1):
   ```sql
   select count(*) from information_schema.tables where table_name = 'dulabs_catalogo_importaciones';
   select count(*) from information_schema.columns where table_name = 'dulabs_inventario_productos'
     and column_name in ('importacion_id', 'importacion_fila');
   select count(*) from pg_indexes where indexname = 'dulabs_inventario_productos_importacion_fila_uq';
   ```
3. Alternativa sin SQL: con sesión de administrador, entrar a Catálogo →
   Carga masiva. Si el aviso «estará disponible muy pronto» **no** aparece y
   el botón de importar está habilitado, la sonda del backend encontró la
   estructura.

Rollback: al inicio del archivo de la migración.

## ✅ APLICADA (23-sep-2026) — Catálogo DuLabs, Fase 1 (módulo Catálogo, cliente inicial Delacour & Orus)

Las migraciones `20261105000000_dulabs_catalogo_fase1.sql` y
`20261106000000_dulabs_catalogo_publicacion.sql` **ya se corrieron en
producción**, junto con los pasos 3 (módulo `catalogo` habilitado para
Delacour) y 4 (publicación `slug = delacour`). Verificación posterior:

- Estructura 9/9 OK: `dulabs_tenant_modulos`, `dulabs_catalogo_categorias`,
  `dulabs_catalogo_secuencias`, `dulabs_catalogo_eventos`,
  `dulabs_catalogo_media`, `dulabs_catalogo_publicacion`, las 9 columnas
  nuevas de `dulabs_inventario_productos`, sus 3 triggers y las 2 RPC de media.
- Datos: 4 productos, 4 con referencia (backfill completo), 0 eventos de
  auditoría, módulo de Delacour `habilitado = true`, publicación
  `delacour` con `publicado = true`.

No hay nada pendiente en la base de datos para esta fase. Se conservan
abajo los pasos (referencia histórica), el rollback y la deuda técnica.

**Qué hace (100 % aditiva):** evoluciona `dulabs_inventario_productos` (la
fuente de verdad que ya usan AMORE, el Business Agent y la cotización del
agente) con columnas nuevas nullable/default (`referencia`, `precio_mayor`,
`material`, `color`, `categoria_id`, `controla_stock` default `true`,
`created_by`, `updated_by`, `escritura_id`), crea
`dulabs_tenant_modulos`, `dulabs_catalogo_categorias`,
`dulabs_catalogo_media`, `dulabs_catalogo_secuencias`,
`dulabs_catalogo_eventos`, y triggers de referencia automática (segura
ante concurrencia), inmutabilidad de referencia y auditoría append-only.
No renombra, elimina ni cambia el tipo de ninguna columna existente. Los
productos existentes reciben su referencia (`DL-000001`, … por tenant, en
orden de creación) y conservan `controla_stock = true` (mismo
comportamiento de stock que hoy).

**Riesgo operativo (bajo):** es una sola transacción; mientras corre, el
primer `ALTER TABLE` bloquea `dulabs_inventario_productos` (lecturas y
escrituras de AMORE/Business Agent esperan, con el volumen actual son
milisegundos). Si algo falla, se revierte todo (no queda estado a medias).
Validada contra PostgreSQL 16 local con el esquema real de AMORE (productos
+ ventas): ver `supabase/tests/20261105000000_dulabs_catalogo_fase1.test.sql`.

1. **Antes** (SQL Editor, solo lectura) — confirmar el punto de partida:
   ```sql
   select column_name from information_schema.columns
   where table_schema = 'public' and table_name = 'dulabs_inventario_productos'
   order by ordinal_position;
   -- Esperado: id, id_tenant, nombre, descripcion, precio, stock, categoria,
   -- foto_url, activo, created_at, updated_at (sin 'referencia').
   select id_tenant, count(*) from public.dulabs_inventario_productos group by 1;
   ```
2. Correr el archivo completo `20261105000000_dulabs_catalogo_fase1.sql`.
3. Habilitar el módulo para Delacour & Orus (dato, no código — el módulo se
   habilita por tenant, nunca por nombre en el código):
   ```sql
   insert into public.dulabs_tenant_modulos (id_tenant, modulo, habilitado)
   values ('0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4', 'catalogo', true)
   on conflict (id_tenant, modulo) do update set habilitado = true, updated_at = now();
   ```
4. Correr `20261106000000_dulabs_catalogo_publicacion.sql` (links públicos del
   catálogo: detal y mayor) y crear el link de Delacour con su nombre público:
   ```sql
   insert into public.dulabs_catalogo_publicacion (id_tenant, slug, nombre_publico)
   values ('0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4', 'delacour', 'Delacour & Orus Joyería')
   on conflict (id_tenant) do nothing;
   ```
   Detal: `https://www.dulabs.co/catalogo/delacour`. Mayor: el link con token
   secreto aparece en el dashboard (Catálogo → Links del catálogo), solo para
   administradores. Si no se inserta, el dashboard lo crea solo la primera vez
   que un admin abre el Catálogo (slug derivado del nombre del negocio).
5. **Después** — verificar:
   ```sql
   select id_tenant, count(*) as productos, count(referencia) as con_referencia,
          count(*) filter (where controla_stock) as controla_stock
   from public.dulabs_inventario_productos group by 1;   -- con_referencia = productos = controla_stock
   select * from public.dulabs_catalogo_secuencias;       -- ultimo_numero = productos por tenant
   select count(*) from public.dulabs_catalogo_eventos;   -- 0 (el backfill no genera eventos)
   ```
6. **Rollback / mitigación** (de menor a mayor; usar el nivel más bajo que
   resuelva el problema). Probado de punta a punta en PostgreSQL 16 local con el
   esquema de AMORE: tras el nivel 3 la tabla vuelve EXACTAMENTE a sus 11
   columnas e índices originales, conserva todos los productos y ventas, AMORE
   inserta y vende normalmente, y las dos migraciones se pueden volver a correr.
   Un error a mitad revierte la transacción completa (no queda estado a medias).

   **Nivel 1 — apagar sin tocar el esquema** (inmediato, reversible):
   ```sql
   update public.dulabs_catalogo_publicacion set publicado = false, updated_at = now()
   where id_tenant = '0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4';        -- links públicos (y fotos) => 404
   update public.dulabs_tenant_modulos set habilitado = false, updated_at = now()
   where id_tenant = '0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4' and modulo = 'catalogo';  -- oculta el módulo
   ```
   **Nivel 2 — neutralizar la BD sin borrar datos** (si un trigger afectara las
   escrituras de AMORE / Business Agent; aplicar junto con el nivel 1). Los productos nuevos quedan con
   `referencia` NULL; volver a correr la migración fase 1 les asigna la suya
   (verificado):
   ```sql
   begin;
   drop trigger if exists dulabs_catalogo_asignar_referencia on public.dulabs_inventario_productos;
   drop trigger if exists dulabs_catalogo_proteger_producto on public.dulabs_inventario_productos;
   drop trigger if exists dulabs_catalogo_auditar_producto on public.dulabs_inventario_productos;
   alter table public.dulabs_inventario_productos alter column referencia drop not null;
   commit;
   ```
   **Nivel 3 — rollback completo** (⚠️ BORRA los datos del Catálogo:
   categorías, fotos registradas, auditoría, links, referencias y precios
   mayoristas; NUNCA toca productos, stock, fotos legadas ni ventas de AMORE).
   Solo con aprobación explícita y después de un backup
   (`create table … as select` de las tablas del catálogo). Los archivos del
   bucket no se borran:
   ```sql
   begin;
   drop trigger if exists dulabs_catalogo_asignar_referencia on public.dulabs_inventario_productos;
   drop trigger if exists dulabs_catalogo_proteger_producto on public.dulabs_inventario_productos;
   drop trigger if exists dulabs_catalogo_auditar_producto on public.dulabs_inventario_productos;
   drop function if exists public.dulabs_catalogo_adjuntar_media(uuid, uuid, text, text, text, integer, integer, integer, boolean, uuid, text);
   drop function if exists public.dulabs_catalogo_eliminar_media(uuid, uuid, uuid, text);
   drop function if exists public.dulabs_catalogo_asignar_referencia();
   drop function if exists public.dulabs_catalogo_proteger_producto();
   drop function if exists public.dulabs_catalogo_auditar_producto();
   drop function if exists public.dulabs_catalogo_formatear_referencia(text, bigint);
   drop table if exists public.dulabs_catalogo_publicacion;
   drop table if exists public.dulabs_catalogo_media;
   drop table if exists public.dulabs_catalogo_eventos;
   alter table public.dulabs_inventario_productos drop constraint if exists dulabs_inventario_productos_categoria_fk;
   alter table public.dulabs_inventario_productos drop constraint if exists dulabs_inventario_productos_referencia_formato;
   drop index if exists public.dulabs_inventario_productos_referencia_uq;
   drop index if exists public.dulabs_inventario_productos_tenant_created_idx;
   drop index if exists public.dulabs_inventario_productos_tenant_categoria_idx;
   alter table public.dulabs_inventario_productos
     drop column if exists referencia,
     drop column if exists precio_mayor,
     drop column if exists material,
     drop column if exists color,
     drop column if exists categoria_id,
     drop column if exists controla_stock,
     drop column if exists created_by,
     drop column if exists updated_by,
     drop column if exists escritura_id;
   drop table if exists public.dulabs_catalogo_categorias;
   drop table if exists public.dulabs_catalogo_secuencias;
   drop table if exists public.dulabs_tenant_modulos;
   drop function if exists public.dulabs_catalogo_eventos_inmutables();
   commit;
   ```

**Deuda técnica / hardening futuro (riesgos conocidos y aceptados en la
Fase 1; NO se resuelven ahora):**

- **Caché de fotos de productos desactivados (hasta ~1 día).** Las fotos
  públicas (`/catalogo/{slug}/productos/{referencia}/{main|thumb}.webp`)
  llevan `s-maxage=86400, stale-while-revalidate=604800`. Al desactivar un
  producto sale de la vitrina al instante, pero su foto puede seguir
  respondiendo por URL directa hasta que venza la copia del CDN (~1 día,
  más una revalidación). Opciones futuras: bajar `s-maxage` o purgar el CDN
  al desactivar.
- **Bucket `inventario-productos` público (heredado de AMORE).** El
  catálogo público ya no publica rutas de Storage, pero quien conozca una
  ruta completa (`{tenant}/{producto}/{archivo}`) puede abrir la foto
  directo en Supabase. Hacer el bucket privado hoy rompería la tienda de
  AMORE, el inventario y el envío de fotos del Business Agent (usan
  `foto_url` directa). Requiere migrar esos consumidores primero.
- **Código del link mayorista.** Va en la ruta
  (`/catalogo/{slug}/mayor/{código}`), así que aparece en los logs de
  peticiones de Vercel y en el historial del navegador de quien lo abre. Se
  guarda en texto plano en `dulabs_catalogo_publicacion.token_mayor` porque
  el administrador necesita verlo y copiarlo. Mitigación actual: 244–256
  bits de entropía, comparación en tiempo constante, `referrer: no-referrer`
  y regeneración inmediata desde el dashboard. Opciones futuras: guardar
  solo un hash (mostrando el código una sola vez al generarlo) y/o expirar
  links.

## PENDIENTE — DuLabs Developer V1, GitHub Integration (Fase 1)

La migración `20261104000000_dulabs_developer_v1_github_integration.sql`
(4 tablas nuevas: `dulabs_dev_github_installations`, `dulabs_dev_github_repos`,
`dulabs_dev_github_connect_states`, `dulabs_dev_github_webhook_deliveries` —
todas con RLS por `workspace_id` vía el helper existente
`public.dulabs_dev_workspaces_del_usuario()`, aisladas del esquema de Business)
**todavía no se ha corrido en producción**. Sin ella, la página
`/developer/github` y las rutas `/api/developer/github/*` responden un error
controlado (500 `internal_error`) porque las tablas no existen — nada más se
rompe (es aditivo y aislado). Correr el archivo completo en el **SQL Editor de
Supabase** antes de dar la integración por VERIFIED en producción.

Variables de entorno de la GitHub App (ya configuradas en Vercel por el
operador el 21-sep-2026): `GITHUB_APP_ID` (5026938), `GITHUB_APP_SLUG`
(`dulabs-developer`), `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`. Se
verifican en runtime: `GET /api/developer/github` devuelve `configured: true`
cuando las cuatro están presentes.


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

---

> Aplicada el 15-sep-2026 (corrida manualmente por el operador en el SQL
> Editor de Supabase, "Success. No rows returned"): la migración
> `20261006000000_dulabs_agenda_v2_intentos_fallidos.sql` (AMORE Agenda V2,
> CASO 5 — columna `intentos_fallidos_consecutivos` en
> `dulabs_agenda_v2_sesiones`) ya está aplicada. La protección anti-bucle
> queda activa en producción. La sección que la daba por pendiente se
> eliminó.

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

