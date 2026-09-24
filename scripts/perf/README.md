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
