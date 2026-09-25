# Pasos manuales pendientes en producción

## PENDIENTE — Registros de módulo: respaldo y conciliación de `registrar_en_modulo` (genérico)

Migración `supabase/migrations/20261121000000_dulabs_registros_modulo.sql`. **Aditiva**: crea la
tabla `dulabs_registros_modulo` (RLS activo, sin acceso anon/authenticated) y las funciones
`dulabs_registro_modulo_abrir`, `_resolver`, `_reclamar`, `_resumen` y `_reencolar` (solo
`service_role`). No toca ninguna tabla existente. Genérica: sirve a cualquier módulo que use
`registrar_en_modulo`.

**Para qué sirve:** antes de registrar (p. ej. una solicitud de Publi Bordados) el motor deja una
fila "pendiente"; si el registro falla por un error transitorio queda pendiente y el conciliador
(cron diario `/api/cron/registros-modulo`, botón "Reprocesar ahora" y apertura del dashboard) la
reprocesa con los datos de la ejecución original, sin duplicar. Los pendientes/fallidos se ven en
el dashboard del módulo.

Sin esta migración el registro funciona igual, pero un fallo solo quedaría en los logs; por eso
`scripts/_publicar-publibordados.mts --publicar` se niega a publicar la v3 si falta.

Verificación local (PostgreSQL 16): `supabase/tests/20261121000000_dulabs_registros_modulo.test.sql`
y `supabase/tests/20261121000000_dulabs_registros_modulo.concurrencia.sh`.

1. Correr el archivo completo en el SQL Editor (idempotente).
2. Verificar (esperado `5`):
   ```sql
   select count(*) from pg_proc where proname like 'dulabs_registro_modulo_%';
   ```

## ✅ APLICADA (25-sep-2026, verificada `8`) — Publi Bordados: Clientes → N Solicitudes

Migración `supabase/migrations/20261120000000_dulabs_pb_solicitudes.sql`. **Aditiva y no
destructiva**: crea la tabla `dulabs_pb_solicitudes` (RLS activo, sin acceso anon/authenticated),
su trigger de integridad y las funciones `dulabs_pb_registrar_solicitud`,
`dulabs_pb_listar_solicitudes`, `dulabs_pb_listar_clientes`, `dulabs_pb_obtener_cliente`,
`dulabs_pb_obtener_solicitud`, `dulabs_pb_actualizar_solicitud` y `dulabs_pb_solicitud_json`
(solo `service_role`). No modifica ni borra datos existentes; los `custom_fields.pb_*` históricos
se muestran como "datos anteriores" del cliente y **no** se convierten en solicitudes.

Sin la migración el flow sigue funcionando: la acción `registrar_en_modulo` falla con
`migracion_pendiente` y el cliente se transfiere igual. El script
`scripts/_publicar-publibordados.mts --publicar` se niega a publicar la v3 si falta.

Verificación local (PostgreSQL 16): `supabase/tests/20261120000000_dulabs_pb_solicitudes.test.sql`
(con su `.prelude.sql`) y `supabase/tests/20261120000000_dulabs_pb_solicitudes.concurrencia.sh`.

1. Correr el archivo completo en el SQL Editor (idempotente).
2. Verificar (esperado `8`: 7 funciones + la del trigger):
   ```sql
   select count(*) from pg_proc where proname like 'dulabs_pb_%solicitud%' or proname in ('dulabs_pb_listar_clientes','dulabs_pb_obtener_cliente');
   ```
3. Publicar el flow v3:
   `npx tsx scripts/_publicar-publibordados.mts --tenant=<tenant> --numero=<phone_number_id> --publicar --activar`

## PENDIENTE — Publi Bordados, Fase 2A: observador shadow de Coexistence

Migración `supabase/migrations/20261119000000_dulabs_pb_observador.sql`. **Aditiva**: crea
`dulabs_pb_config`, `dulabs_pb_observaciones` y `dulabs_pb_mensajes_enviados` (vacía en 2A), y las
funciones `dulabs_pb_observar`, `dulabs_pb_clave_conversacion` y `dulabs_pb_observaciones_purgar`.
Solo `service_role`. No toca ninguna tabla existente.

Sin esta migración el código es inerte: el observador solo corre con `PUBLIBORDADOS_ENABLED=true`
**y** una fila habilitada en `dulabs_pb_config`. Activación, comprobación e interpretación:
`docs/agente-publibordados/05-SHADOW-OBSERVER.md`. Verificación local:
`supabase/tests/20261119000000_dulabs_pb_observador.test.sql`.

## PENDIENTE (opcional, recomendada) — Bloque 21: índice del historial de pedidos

Migración `supabase/migrations/20261118000000_dulabs_catalogo_pedidos_historial.sql`. **Solo crea
un índice parcial** sobre `dulabs_catalogo_pedidos` (filas en estado final). No toca datos,
funciones, triggers, permisos ni RLS, ni nada fuera del catálogo.

**Para qué sirve:** el panel de pedidos tiene ahora un **historial** de pedidos cerrados, paginado
por cursor.

| Con 100.000 pedidos cerrados | Tiempo por página |
| --- | --- |
| Sin el índice | ~23–26 ms (recorre y ordena todos los cerrados del negocio; crece con el volumen) |
| Con el índice | ~0,1 ms, en la primera página o en la número mil |

Sin la migración el historial funciona igual, con el mismo resultado; solo es más lento cuando
haya muchos pedidos.

Validada contra PostgreSQL 16 local:

- prueba SQL 3/3, aplicada dos veces: usa el índice, y el cursor recorre todo el historial sin
  repetir ni saltar, incluso con miles de pedidos en el mismo instante;
- recorrido real por PostgREST: 356 de 356 pedidos en 15 páginas.

1. Correr el archivo completo en el SQL Editor (idempotente).
2. Verificar (esperado `1`):
   ```sql
   select count(*) from pg_indexes where indexname = 'dulabs_catalogo_pedidos_historial_idx';
   ```

Rollback: `drop index if exists public.dulabs_catalogo_pedidos_historial_idx;`

**Sin migración nueva:** el límite de tasa de las páginas del catálogo (Bloque 21) reutiliza
`dulabs_rate_limit_incrementar`, que ya está en producción desde la Fase 11.

## ✅ APLICADA (24-sep-2026, verificada `1 | 1 | 1 | 0 | 0`) — Bloque 20: búsqueda del catálogo indexada (rendimiento con miles de referencias)

Migración `supabase/migrations/20261117000000_dulabs_catalogo_busqueda_indice.sql`. **Aditiva**.
Crea la tabla propia del catálogo `dulabs_catalogo_busqueda_doc`, con dos cosas por producto:

- el documento de búsqueda ya calculado;
- la clave normalizada del nombre.

La tabla tiene índices GIN y btree, y dos triggers la mantienen sola (se escribe en la misma
transacción que el producto). Solo se indexan negocios con el módulo **Catálogo** habilitado. No
agrega columnas ni índices a la tabla de productos, ni toca nada de otros módulos.

Además:

- reemplaza `dulabs_catalogo_buscar` con **la misma firma y el mismo resultado**;
- agrega `dulabs_catalogo_por_nombre`, que resuelve el nombre exacto por índice;
- solo `service_role` tiene acceso.

**Por qué:** medido con datos sintéticos (`scripts/perf`), la búsqueda recalculaba el documento de
cada producto en cada consulta. Tiempos antes y después:

| Productos | Antes | Después |
| --- | ---: | ---: |
| 2.000 | ~100 ms | ~12–16 ms |
| 10.000 | ~450 ms | ~17–23 ms |

Con 50 búsquedas simultáneas sobre 10.000 productos se pasó de 8/s a 110/s. La herramienta del
agente `resolve_product_by_attributes` dejó de leer el catálogo entero: con 10.000 productos
bajó de 2,1 MB a 53 KB por llamada.

**Incluye las funciones base del Bloque 10** (`dulabs_catalogo_normalizar`, `dulabs_catalogo_documento`,
idénticas): en producción faltaban (error 42883 al aplicarla el 24-sep), así que esta migración
funciona con o sin la del Bloque 10 aplicada.

**Orden seguro:** el código ya desplegado funciona sin la migración (la búsqueda sigue igual, solo
más lenta, y la herramienta lee como antes). Al aplicarla, el backfill indexa los negocios con
Catálogo en la misma transacción: 10.000 productos tardaron menos de 1 s en local.

Validada contra PostgreSQL 16 local:

- prueba SQL 7/7, aplicada dos veces;
- la prueba del Bloque 10 sigue 10/10 con la función nueva;
- paridad de 22 búsquedas antes/después con **0 diferencias**, con 2.000 y con 10.000 productos.

1. Correr el archivo completo en el SQL Editor (idempotente).
2. Verificar (esperado `1 | 1 | 1 | 0 | 0`):
   ```sql
   select
     (select count(*) from information_schema.tables where table_name = 'dulabs_catalogo_busqueda_doc') as tabla,
     (select count(*) from pg_trigger where tgname = 'dulabs_catalogo_busqueda_doc_producto') as trigger_productos,
     (select count(*) from pg_proc where proname = 'dulabs_catalogo_por_nombre') as funcion_nombre,
     (select count(*) from information_schema.routine_privileges
       where routine_name in ('dulabs_catalogo_por_nombre', 'dulabs_catalogo_buscar', 'dulabs_catalogo_busqueda_indexar')
         and grantee in ('anon', 'authenticated')) as permisos_publicos,
     (select count(*) from public.dulabs_inventario_productos p
       join public.dulabs_tenant_modulos m on m.id_tenant = p.id_tenant and m.modulo = 'catalogo' and m.habilitado
       where not exists (select 1 from public.dulabs_catalogo_busqueda_doc d where d.producto_id = p.id)) as productos_sin_indexar;
   ```

Rollback: al inicio del archivo de la migración.

## ✅ APLICADA (24-sep-2026) — Bloque 19: reserva de stock al confirmar pedidos del catálogo

Migración `supabase/migrations/20261116000000_dulabs_catalogo_reservas_stock.sql`. **Aditiva**:
tabla `dulabs_catalogo_reservas`, funciones de reserva/cierre/vencimiento y un trigger nuevo sobre
`dulabs_catalogo_pedidos`. Reemplaza `dulabs_catalogo_pedido_transicion_valida` agregando una sola
transición (`confirmed -> expired`, sistema). No toca datos existentes ni nada fuera del catálogo.

Regla: **confirmar aparta el stock** (todo o nada, nunca negativo); **venta cerrada** lo consume;
**cancelar** o **vencer** (72 h sin cerrar; los pedidos con asesora no vencen solos) lo devuelven.
Lo aplica la BD en la misma transacción del cambio de estado, sea quien sea el que lo cambie.
Pedidos confirmados ANTES de la migración no tienen reserva (no se descuenta nada retroactivo).

**Orden seguro:** el código ya desplegado funciona sin la migración (confirma como antes, sin
apartar). Al aplicarla, la reserva empieza a regir de inmediato.

Validada contra PostgreSQL 16 local: prueba SQL 12/12 (aplicada dos veces) y concurrencia REAL
4/4 (30 confirmaciones simultáneas por 5 unidades => exactamente 5; líneas cruzadas sin deadlocks;
la misma confirmación 10 veces => un descuento; cancelaciones y confirmaciones mezcladas cuadran).

1. Correr el archivo completo en el SQL Editor (idempotente).
2. Verificar (esperado `1 | 2 | true | 0`):
   ```sql
   select
     (select count(*) from information_schema.tables where table_name = 'dulabs_catalogo_reservas') as tabla,
     (select count(*) from pg_trigger where tgname in ('dulabs_catalogo_pedido_reservas', 'dulabs_catalogo_pedido_reservas_insert')) as triggers,
     (select public.dulabs_catalogo_pedido_transicion_valida('confirmed', 'expired', 'system')) as vencimiento,
     (select count(*) from information_schema.routine_privileges
       where routine_name like 'dulabs_catalogo_reserva%' and grantee in ('anon', 'authenticated')) as permisos_publicos;
   ```

Rollback: al inicio del archivo de la migración.

## ✅ APLICADA (24-sep-2026) — Bloque 17: el diagnóstico del agente muestra la intención y el motivo de la asesora

Migración `supabase/migrations/20261115000000_dulabs_agente_diagnostico_intencion.sql`.
**No crea tablas ni toca filas**: reemplaza la función `dulabs_agente_diagnosticar` (Bloque 13)
agregando tres columnas: `intencion` (buscar, ver_mas, similares, detalle, carrito, pedido,
confirmar, fotos, asesora, link_catalogo, conversacion), `asesora_motivo`
(cliente_pidio_asesora, problema_pedido, pago_o_entrega, reclamo, fuera_de_alcance, otro,
fallas_del_asistente, limite_uso_cliente, limite_uso_negocio, sin_detalle) y `asesora_origen`
(cliente, asistente, sistema). Lista cerrada: un valor desconocido sale como
`desconocida` / `sin_detalle`. Sigue siendo solo `service_role` y de UN negocio.

**No bloquea nada**: el Inbox ya muestra el motivo sin esta migración (lo lee de la traza), y
sin ella la intención y el motivo siguen consultables en la columna `traza`.

Validada contra PostgreSQL 16 local: prueba SQL 5/5 (aplicada dos veces) y la prueba del
Bloque 13 sigue 6/6 con la función nueva.

1. Correr el archivo completo en el SQL Editor (idempotente).
2. Verificar (esperado `1 | true | 0`):
   ```sql
   select
     (select count(*) from pg_proc where proname = 'dulabs_agente_diagnosticar') as funcion,
     (select 'asesora_motivo' = any (proargnames) from pg_proc where proname = 'dulabs_agente_diagnosticar') as columnas_nuevas,
     (select count(*) from information_schema.routine_privileges
       where routine_name = 'dulabs_agente_diagnosticar' and grantee in ('anon', 'authenticated')) as permisos_publicos;
   ```
3. Uso: `select creado, resultado, intencion, asesora_motivo, asesora_origen, herramientas
   from dulabs_agente_diagnosticar('<id_tenant>', '<teléfono del cliente>', 30);`

Rollback: al inicio del archivo de la migración.

## ✅ APLICADA (24-sep-2026) — Bloque 14: topes de costo y abuso del agente

Migración `supabase/migrations/20261114000000_dulabs_agente_limites.sql`.
**Aditiva**; requiere la del Bloque 13 (el consumo se lee de las trazas).

- `dulabs_agente_runtime_config.limites` (jsonb, opcional; vacío = por defecto:
  8 turnos/minuto y 300 turnos/día por cliente, 20 millones de tokens/día por negocio).
- `dulabs_agente_consumo(negocio, número, contact_ref)`: turnos con modelo del cliente
  (último minuto / 24 h) y tokens del negocio (24 h). Solo `service_role`.

Al superar un tope: ritmo por minuto => el agente no llama al modelo ni responde ese
mensaje; tope del día (cliente o negocio) => pasa la conversación a una asesora. Si el
consumo no se puede medir, el agente sigue normal (no frena ventas).

El código lee la configuración tolerando que falte la columna: el orden deploy/migración
no importa (nunca cae a otro bot).

Validada contra PostgreSQL 16 local (prueba SQL 3/3, aplicada dos veces).

1. Correr el archivo completo en el SQL Editor (idempotente).
2. Verificar (esperado `1 | 1 | 0`):
   ```sql
   select
     (select count(*) from information_schema.columns where table_name = 'dulabs_agente_runtime_config' and column_name = 'limites') as columna,
     (select count(*) from pg_proc where proname = 'dulabs_agente_consumo') as funcion,
     (select count(*) from information_schema.routine_privileges
       where routine_name = 'dulabs_agente_consumo' and grantee in ('anon', 'authenticated')) as permisos_publicos;
   ```
3. (Opcional) otros topes para Delacour, p. ej.:
   `update dulabs_agente_runtime_config set limites = '{"tokens_por_dia_negocio": 40000000}' where id_tenant = '<id_tenant>';`

Rollback: al inicio del archivo de la migración.

## ✅ APLICADA (24-sep-2026) — Bloque 13: trazas persistentes del agente y diagnóstico

Migración `supabase/migrations/20261113000000_dulabs_agente_trazas.sql`.
**100 % aditiva** (tabla y funciones nuevas del agente):

- `dulabs_agente_trazas`: una fila por turno del agente (y por error de su frontera) con
  qué entró (sin el texto), el contexto, las herramientas y lo que validó el backend, la
  respuesta y la entrega. **Nunca** teléfono (solo `contact_ref`, un hash), texto del
  cliente, tokens ni secretos.
- `dulabs_agente_diagnosticar(id_tenant, teléfono opcional, límite)`: cada turno con el
  estado REAL de entrega de Meta (entregado / leído / fallido + código) del texto y de
  cada foto. El teléfono se convierte en el mismo hash; no se guarda.
- `dulabs_agente_trazas_purgar(días)`: borra trazas viejas (mínimo 7 días; sugerido 90).

Requiere las columnas `error_codigo`/`error_detalle` de `dulabs_mensajes_log`
(migración 20260827020000, ya aplicada en producción).

Validada contra PostgreSQL 16 local (prueba SQL 6/6, aplicada dos veces) y de punta a
punta con el webhook real: turnos guardados y una foto rechazada por Meta (131053)
visible en el diagnóstico.

1. Correr el archivo completo en el SQL Editor (idempotente). No hay pasos posteriores.
2. Verificar (esperado `1 | 2 | 0`):
   ```sql
   select
     (select count(*) from information_schema.tables where table_name = 'dulabs_agente_trazas') as tablas,
     (select count(*) from pg_proc where proname in ('dulabs_agente_diagnosticar', 'dulabs_agente_trazas_purgar')) as funciones,
     (select count(*) from information_schema.role_table_grants
       where table_name = 'dulabs_agente_trazas' and grantee in ('anon', 'authenticated')) as permisos_publicos;
   ```
3. Uso: `select * from dulabs_agente_diagnosticar('<id_tenant>', '<teléfono>', 20);`

Rollback: al inicio del archivo de la migración.

## ✅ APLICADA (24-sep-2026) — Bloque 11: un solo turno del agente a la vez por conversación

Migración `supabase/migrations/20261112000000_dulabs_agente_buzon.sql`.
**100 % aditiva** (tablas y funciones nuevas del agente):

- `dulabs_agente_buzon`: cada mensaje para el agente (único por wamid, con la foto
  citada). El texto se borra al procesarse (ya vive en `dulabs_mensajes_log`).
- `dulabs_agente_turno` + `dulabs_agente_tomar_turno` / `dulabs_agente_soltar_turno`:
  un solo proceso atiende la conversación a la vez; atiende la ráfaga completa y no
  suelta el turno si llegó algo más (atómico). Un turno caído vence solo.

Sin la migración el agente funciona como antes (un turno por mensaje).

Validada contra PostgreSQL 16 local: prueba SQL (6/6), aplicada dos veces sin error,
y concurrencia real vía PostgREST (20 procesos por el turno => 1 dueño; 30 mensajes
en paralelo => los 30 atendidos una sola vez, nunca dos turnos a la vez).

1. Correr el archivo completo en el SQL Editor (idempotente). No hay pasos posteriores.
2. Verificar (esperado `2 | 2 | 0`):
   ```sql
   select
     (select count(*) from information_schema.tables where table_name in ('dulabs_agente_buzon', 'dulabs_agente_turno')) as tablas,
     (select count(*) from pg_proc where proname in ('dulabs_agente_tomar_turno', 'dulabs_agente_soltar_turno')) as funciones,
     (select count(*) from information_schema.role_table_grants
       where table_name in ('dulabs_agente_buzon', 'dulabs_agente_turno') and grantee in ('anon', 'authenticated')) as permisos_publicos;
   ```

Rollback: al inicio del archivo de la migración.

## ✅ APLICADA (24-sep-2026) — Bloque 10: búsqueda del catálogo para el agente (miles de referencias)

Migración `supabase/migrations/20261111000000_dulabs_catalogo_busqueda.sql`.
> Nota (24-sep-2026): sus funciones no estaban en producción (error 42883 al aplicar el
> Bloque 20). Quedaron creadas por la migración del Bloque 20, que las incluye idénticas y
> reemplaza `dulabs_catalogo_buscar` por su versión indexada. No hace falta correr esta.
**100 % aditiva**: solo funciones nuevas. **No** agrega columnas a
`dulabs_inventario_productos` (compartida con AMORE) ni cambia la tienda pública.

- `dulabs_catalogo_buscar`: búsqueda de texto completo en español para el agente
  (sin tildes, plural/singular, prefijos; nombre, color, material, categoría y
  descripción), filtros y precio del canal en SQL, paginada, solo productos
  activos del negocio indicado. Solo `service_role` puede ejecutarla.

Sin la migración el agente usa la búsqueda anterior (el nombre contiene el texto).

Validada contra PostgreSQL 16 local con ~2.000 productos:
`supabase/tests/20261111000000_dulabs_catalogo_busqueda.test.sql` (10/10;
~40 ms por búsqueda), aplicada dos veces sin error.

1. Correr el archivo completo en el SQL Editor (idempotente).
2. Verificar (esperado `1 | 0`):
   ```sql
   select
     (select count(*) from pg_proc where proname = 'dulabs_catalogo_buscar') as funciones,
     (select count(*) from information_schema.routine_privileges
       where routine_name = 'dulabs_catalogo_buscar' and grantee in ('anon', 'authenticated')) as permisos_publicos;
   ```

**Después de que el deploy de este bloque esté en producción (NO antes):**
habilitar `more_products` ("muéstrame más") y `similar_products` ("¿algo parecido?")
en el agente de Delacour. Si se hace antes, el código anterior no conoce las
herramientas y el agente queda en silencio (fail-closed).

```sql
update public.dulabs_agente_runtime_config
   set herramientas = (select array_agg(distinct h) from unnest(herramientas || array['more_products', 'similar_products']) h),
       updated_at = now()
 where phone_number_id = (select phone_number_id from public.dulabs_clientes_config
                           where id_tenant = '0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4');
```

Rollback: al inicio del archivo de la migración.

## ✅ APLICADA (24-sep-2026) — Fase 9: fotos citables y link del catálogo en el agente

**Estado: migración aplicada en Supabase de producción por el responsable del
proyecto** (verificación: `tablas = 1`, `permisos_publicos = 0`). También se
habilitó `get_catalog_link` en el agente de Delacour y su catálogo está
publicado (verificación: `tiene_link_catalogo = true`, `catalogo_publicado = true`).

Migración `supabase/migrations/20261110000000_dulabs_agente_medios.sql`.
**100 % aditiva** (no toca tablas existentes):

- `dulabs_agente_medios_enviados`: cada foto de producto que envía el agente
  queda ligada a su wamid (negocio, número, cliente, referencia, id interno del
  producto, canal). Cuando el cliente **responde a una foto** ("quiero este"),
  el backend sabe de qué producto habla sin adivinar. RLS activado, solo backend.

Sin la tabla el agente funciona igual, pero una respuesta a una foto no se
puede resolver y el agente pregunta cuál producto es.

Validada contra PostgreSQL 16 local:
`supabase/tests/20261110000000_dulabs_agente_medios.test.sql` (5/5), aplicada
dos veces sin error.

1. Correr el archivo completo en el SQL Editor (idempotente).
2. Verificar (esperado `1 | 0`):
   ```sql
   select
     (select count(*) from information_schema.tables where table_name = 'dulabs_agente_medios_enviados') as tablas,
     (select count(*) from information_schema.role_table_grants
       where table_name = 'dulabs_agente_medios_enviados' and grantee in ('anon', 'authenticated')) as permisos_publicos;
   ```

**Después de que el deploy de esta fase esté en producción (NO antes):**
habilitar la herramienta nueva `get_catalog_link` en el agente de Delacour.
Si se hace antes del deploy, el código anterior no conoce la herramienta, marca
la configuración como inválida y el agente queda en silencio (fail-closed).

```sql
update public.dulabs_agente_runtime_config
   set herramientas = array_append(herramientas, 'get_catalog_link'), updated_at = now()
 where phone_number_id = (select phone_number_id from public.dulabs_clientes_config
                           where id_tenant = '0d3ae22d-0c38-4fd6-ba48-fb9e29b7cdb4')
   and not ('get_catalog_link' = any(herramientas));
```

Las fotos salen por la URL pública del catálogo (`/catalogo/{slug}/productos/{ref}/whatsapp.jpg`):
el catálogo de Delacour debe estar **publicado** para que el agente envíe fotos.

Rollback: al inicio del archivo de la migración.

## ✅ APLICADA (24-sep-2026) — Fase 8: agente conversacional (Gemini) por número de WhatsApp

**Estado: migración aplicada en Supabase de producción por el responsable del
proyecto.** Verificación en el SQL Editor: `tablas = 2`, `configuraciones = 0`,
`permisos_publicos = 0`. Aún no hay ningún agente configurado: el webhook se
comporta exactamente como antes. **Pendiente:** el piloto de Delacour (pasos de
activación más abajo), cuando esté su GEMINI_KEY.

Migración `supabase/migrations/20261109000000_dulabs_agente_runtime.sql`.
**100 % aditiva** (no toca tablas existentes):

- `dulabs_agente_runtime_config`: agente por número con proveedor, modelo y
  referencia a la credencial **obligatorios** (sin default), herramientas
  permitidas, canal y configuración del negocio. Nunca guarda el secreto.
- `dulabs_agente_conversaciones`: memoria de corto plazo estructurada por
  conversación (compare-and-set por versión). Sin precios ni stock.

**Aplicarla no activa nada**: sin filas en `dulabs_agente_runtime_config`, el
webhook sigue exactamente igual.

Validada contra PostgreSQL 16 local:
`supabase/tests/20261109000000_dulabs_agente_runtime.test.sql` (5/5), aplicada
dos veces sin error.

1. Correr el archivo completo en el SQL Editor (idempotente).
2. Verificar (esperado 2):
   ```sql
   select count(*) from information_schema.tables
    where table_name in ('dulabs_agente_runtime_config', 'dulabs_agente_conversaciones');
   ```

**Activación del piloto de Delacour (NO antes de tener su GEMINI_KEY):**

1. En Vercel: variable `GEMINI_KEY_DELACOUR` con la key propia de Delacour y redesplegar.
2. Insertar la configuración (la plantilla está en `lib/agente/README.md`):
   `proveedor='gemini'`, `modelo='gemini-3.6-flash'`,
   `credencial_ref='env:GEMINI_KEY_DELACOUR'`, herramientas, `habilitado=true`.
3. `ia_restringida_a` = números de prueba en `dulabs_clientes_config`.
4. Solo al final `ia_pausada = false`.

⚠️ Poner `ia_pausada = false` SIN la fila del agente haría responder a la IA
legacy (Claude). Con la fila presente (aunque esté apagada o sin key) el número
nunca cae a otro bot.

Rollback: al inicio del archivo de la migración.

## ✅ APLICADA (23-sep-2026) — Catálogo DuLabs, Fase 7 (pedidos estructurados: WhatsApp + agente)

**Estado: aplicada en Supabase de producción por el responsable del proyecto.**
Verificación en el SQL Editor: `tablas = 2`, `funciones = 3`,
`permisos_publicos = 0` (consulta del paso 2, combinada en una sola fila).

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

