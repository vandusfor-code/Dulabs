# Rendimiento del catálogo (Bloque 20)

Pruebas **reproducibles** de rendimiento y concurrencia del catálogo, los pedidos y las
herramientas del agente, contra una BD **LOCAL** con datos **SINTÉTICOS**. Nunca contra Supabase
ni con datos reales de Delacour.

`bench.ts` ejecuta el **código real** de estas piezas: servicio público, resolución, motor de
pedidos y `executeAgentTool`. Las consultas pasan por el mismo cliente Supabase, apuntado a un
PostgREST local.

## Qué se mide

Para cada operación se mide:

- latencia p50, p95 y máximo;
- **consultas HTTP por operación**, para detectar N+1;
- KB recibidos de la BD;
- en las herramientas del agente, además, los **KB que recibiría Gemini**.

Después se corren estos escenarios concurrentes:

- 50 búsquedas a la vez;
- 50 carritos a la vez;
- 30 confirmaciones de productos distintos;
- 20 clientes por la **última unidad** (debe confirmarse exactamente 1).

## Preparación (PostgreSQL 16 + PostgREST locales)

```bash
P="psql -h <socket> -p <puerto> -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "create database perf"
$P -d perf <<'SQL'
create role service_role bypassrls; create role anon; create role authenticated;
create role authenticator login noinherit; grant service_role to authenticator;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to service_role;
grant usage on schema public to anon, authenticated, service_role;
create schema storage; create table storage.buckets (id text primary key, name text, public boolean);
SQL
$P -d perf -f scripts/perf/00-base.sql
for m in 20260923000000_amore_inventario_productos 20261105000000_dulabs_catalogo_fase1 \
         20261106000000_dulabs_catalogo_publicacion 20261108000000_dulabs_catalogo_pedidos \
         20261111000000_dulabs_catalogo_busqueda 20261116000000_dulabs_catalogo_reservas_stock; do
  $P -d perf -f supabase/migrations/$m.sql
done
# 2.000 productos del negocio medido + 20.000 de OTRO negocio en la misma tabla (multi-tenant)
$P -d perf -v n_negocio=2000 -v n_ruido=20000 -f scripts/perf/01-sinteticos.sql
```

`20260923000000_amore_inventario_productos` es la migración que crea la tabla física de
productos que usa el catálogo. Se aplica **solo** en esta BD local. No se toca nada de AMORE.

Para agregar un **segundo negocio con Catálogo** (mismas referencias `DL-…`, nombres con « Q»), usado
en las pruebas de varios negocios a la vez:

```bash
psql -d perf -v n_negocio=0 -v n_ruido=0 -v n_segundo=2000 -f scripts/perf/01-sinteticos.sql
```

Para 10.000 productos, clona la base y agrega 8.000 más:

```bash
createdb -T perf perf10k
psql -d perf10k -v n_negocio=8000 -v n_ruido=0 -f scripts/perf/01-sinteticos.sql
```

Levanta PostgREST con `postgrest.conf.example`. Ajusta en ese archivo el socket, la base y el
puerto.

## Medir antes y después de una migración

```bash
PERF_REST=http://127.0.0.1:54440 npx tsx scripts/perf/bench.ts --rondas 20 --json 2k-antes.json
psql -d perf -v fase=antes -f scripts/perf/02-paridad-busqueda.sql
psql -d perf -f supabase/migrations/20261117000000_dulabs_catalogo_busqueda_indice.sql
psql -d perf -c "notify pgrst, 'reload schema'"
psql -d perf -v fase=despues -v comparar=1 -f scripts/perf/02-paridad-busqueda.sql   # DIFERENCIAS = 0
PERF_REST=http://127.0.0.1:54440 npx tsx scripts/perf/bench.ts --rondas 20 --json 2k-despues.json
node scripts/perf/comparar.mjs 2k-antes.json 2k-despues.json 10k-antes.json 10k-despues.json
```

`02-paridad-busqueda.sql` guarda los resultados de 22 búsquedas que combinan varias cosas:

- modos `all` y `any`;
- canal detal y mayorista;
- páginas profundas;
- filtros de categoría, color, material y precio;
- exclusiones;
- búsquedas sin tildes.

En la fase `despues` compara referencia por referencia y posición por posición. Si hay alguna
diferencia, falla.

Las confirmaciones escriben en la BD. Para repetir la medición desde cero, vuelve a crear la base
desde el paso de preparación.

## Resultados (24-sep-2026)

Medido con PostgreSQL 16 y PostgREST locales, con p50 en ms y 20 rondas. El entorno es un
contenedor: los valores absolutos son orientativos, y lo que importa es la comparación relativa.

| Operación | 2.000 antes | 2.000 después | 10.000 antes | 10.000 después |
| --- | ---: | ---: | ---: | ---: |
| búsqueda: una palabra (anillo) | 110 | 16 | 478 | 23 |
| búsqueda: nombre (aretes luna) | 102 | 12 | 438 | 17 |
| búsqueda: sin coincidencia total (amplía) | 224 | 22 | 1.036 | 59 |
| búsqueda: página 5 (oro) | 153 | 17 | 698 | 53 |
| gemini: search_products | 100 | 10 | 464–504 | 16 |
| gemini: resolve_product_by_attributes | 37 | 11 | 162 (15 consultas, 2,1 MB) | 14 (5 consultas, 53 KB) |
| concurrente: 50 búsquedas | 1.603 | 386 | 5.438 (8/s) | 435 (110/s) |

Con cualquier tamaño de catálogo, estas operaciones ya se mantenían planas y no cambiaron:

| Operación | Tiempo o volumen | Consultas |
| --- | --- | ---: |
| listado | 15–27 ms | 6 |
| ficha | 8–9 ms | 4 |
| carrito de 60 referencias | 11 ms | 4 |
| validar y guardar un pedido | 22 ms | 10 |
| confirmar con reserva atómica | ~16 ms | 4 |
| panel con 100 pedidos | ~12 ms y 108 KB | 3 |

En los escenarios concurrentes con 10.000 productos:

- carritos: 313/s;
- confirmaciones: 104/s;
- última unidad: 1 confirmado, 19 rechazados por agotado y stock final 0.

## La app compilada, de punta a punta (Bloque 20, segunda parte)

`bench.ts` mide el código del servidor. Para medir lo que recibe el navegador se levanta la app
**compilada** contra un "Supabase" local. `proxy-supabase.mjs` cumple ese papel:

- envía `/rest/v1` al PostgREST local;
- responde `/storage/v1/object/public` con fotos WebP sintéticas de tamaño realista;
- cuenta las consultas de cada petición en `GET /__stats`.

```bash
PERF_REST=http://127.0.0.1:54441 node scripts/perf/proxy-supabase.mjs &
npx next build
SUPABASE_URL=http://127.0.0.1:54450 SUPABASE_SERVICE_ROLE_KEY=local npx next start -p 3100 &
node scripts/perf/paginas.mjs --rondas 8                    # HTML, fotos, consultas por página, concurrencia
PLAYWRIGHT_MODULE=/ruta/a/playwright node scripts/perf/movil.mjs   # celular con 4G lenta (Chromium real)
```

### Resultados con 10.000 productos (24-sep-2026)

Las páginas se midieron en un solo proceso, sin CDN adelante:

| Página | p50 ms | HTML gzip | Fotos en el HTML (diferidas) | Consultas BD |
| --- | ---: | ---: | ---: | ---: |
| inicio | 61 | 10,9 KB | 8 (4) | 8 |
| todo el catálogo, página 1 (48 productos) | 49 | 18,6 KB | 43 (39) | 6 |
| todo el catálogo, página 100 | 55 | 18,7 KB | 42 (39) | 6 |
| búsqueda "aretes dorados" | 45 | 13,3 KB | 17 (13) | 7 |
| ficha de producto | 21 | 8,1 KB | 1 | 6 |
| carrito de 60 referencias (API) | 22 | 11,8 KB | — | 5 |
| foto (miniatura / principal) | 16 / 19 | 43 / 148 KB | — | 4 |
| foto para WhatsApp (conversión a JPEG) | 240 | 123 KB | — | 4 |

El navegador nunca recibe el catálogo completo: el listado trae 48 productos y ningún dato
interno (ni ids, ni negocio, ni stock exacto). Next deduplica en la misma petición las lecturas
repetidas del layout y de la página.

Con 50 clientes a la vez en un solo proceso:

| Escenario | Por segundo |
| --- | ---: |
| listado | 32 |
| búsquedas distintas | 41 |
| fichas | 67 |
| carritos | 129 |

El límite es la CPU del render, no la base de datos. En Vercel, cada instancia atiende en paralelo
y la plataforma escala horizontalmente.

### Celular (390×844, 4G lenta de 1,6 Mbps con 150 ms de latencia, CPU ×4)

| Página | LCP antes | LCP después | Fotos descargadas al abrir / en la página |
| --- | ---: | ---: | ---: |
| inicio | 3.184 ms | 1.896 ms | 6 / 8 |
| todo el catálogo | 3.228 ms | 2.176 ms | 11 / 43 |
| búsqueda | 3.288 ms | 1.852 ms | 10 / 17 |
| ficha | 2.596 ms | 2.644 ms | 1 / 1 |

Antes, el LCP era la primera foto: estaba marcada como diferida y el navegador la descubría tarde.
Ahora las 4 primeras tarjetas cargan de inmediato, y la primera fila con prioridad alta
(`cargaDeFoto`). El resto sigue diferido.

### Fotos con `v` inventada (cache-busting)

| | Antes | Después |
| --- | --- | --- |
| 30 `whatsapp.jpg?v=<aleatorio>` a la vez | 200 × 30: 30 conversiones, 3,6 MB, 14/s (CPU saturada) | 307 × 30: 0 conversiones, 0 KB |
| 100 `main.webp?v=<aleatorio>` | 200 × 100: 14,8 MB leídos de Storage | 307 × 100: 0 KB |

La ruta solo sirve la URL canónica; cualquier otra `v` redirige a ella sin abrir Storage
(`lib/catalogo/foto-http.ts`).

### Varios negocios a la vez (`bench.ts`, con el segundo negocio)

Los dos negocios tienen las mismas referencias. En todas las pruebas hubo **0 fugas** entre ellos:

- **Búsquedas intercaladas:** 60, a 170 por segundo.
- **Carritos intercalados:** 60, a 517 por segundo.
- **Última unidad:** con stock 1 en ambos negocios para la misma referencia, 20 clientes por
  negocio confirmaron a la vez. Resultado: exactamente 1 confirmado por negocio y stock final 0 en
  ambos.

### Panel administrativo y agente (10.000 productos)

| Operación | p50 ms | Consultas | Otros datos |
| --- | ---: | ---: | --- |
| admin: listado página 1 | 14 | 2 | |
| admin: listado página 100 | 21 | 2 | |
| admin: buscar "luna" | 26 | 2 | |
| admin: ficha | 7 | 3 | |
| admin: vista previa de importación (lee todas las claves) | 114 | 12 | 2 MB con 10.000 productos (~400 KB con 2.000) |
| gemini: `request_product_images` (3 fotos) | 14 | 7 → 5 | |

La vista previa de importación es una acción puntual de administración. Con
`request_product_images` ya no hay una consulta por foto. Gemini recibe entre 0,1 y 1,9 KB por
herramienta.

## Límite de tasa de las páginas contra Postgres real (Bloque 21)

Este script prueba que el contador distribuido es exacto bajo concurrencia. Necesita la migración
`20261001000000_dulabs_rate_limit.sql` aplicada en la BD local.

```bash
PERF_REST=http://127.0.0.1:54440 npx tsx scripts/perf/limite-concurrencia.ts
```

Resultado esperado:

- de 700 peticiones simultáneas del mismo cliente se permiten exactamente 600;
- otro cliente no se ve afectado;
- de 150 búsquedas se permiten exactamente 120.

Con la app compilada, 650 páginas en menos de un minuto desde una IP dieron 600 respuestas 200 y
50 respuestas 429 (con `Retry-After` y `no-store`). En ese mismo momento otra IP recibió 200, y
las fotos quedaron fuera del límite.

Medido en local, el costo del límite es una consulta más por página (~3–7 ms). Las precargas del
listado bajaron de 53 a 2 (`EnlaceIntencion`).

## Pedidos abandonados contra Postgres real (Bloque 23)

`abandonados-real.ts` corre el motor de pedidos REAL (`expireAbandonedOrders`) contra PostgREST +
PostgreSQL locales (se niega a correr contra otra URL), con el reloj adelantado 4 días y **dos
crons a la vez**:

    SUPABASE_URL=http://127.0.0.1:54452 SUPABASE_SERVICE_ROLE_KEY=local npx tsx scripts/perf/abandonados-real.ts

Resultado (24-sep-2026, copia desechable de la base `perf`): `{"cron1":73,"cron2":229,"total":302,"segunda_pasada":0}`.
Los 302 pedidos de conversación sin confirmar (95 borradores + 207 propuestas) vencieron
exactamente una vez (302 eventos `abandoned`, uno por pedido); los 33 confirmados, los 2 con
asesora y las 174 solicitudes del catálogo sin contacto quedaron intactos.
