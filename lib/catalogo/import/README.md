# Carga masiva del Catálogo (Fase 4)

Objetivo: que una joyería pase de «tengo 100 productos en mi computador» a
«ya están cargados en mi catálogo» de forma rápida, segura y sin errores
técnicos. Dashboard → Catálogo → **Carga masiva**
(`/dashboard/catalogo/importar`).

```
Preparar archivo → Subir → Analizar (servidor) → Validar → Preview
  → Confirmar → Procesar por lotes → Resultado (+ historial)
```

Nada se crea hasta confirmar. Lo que es válido lo decide el backend.

## 1. Formato

**Planilla XLSX o CSV** (plantilla descargable, con ejemplos, instrucciones y
las categorías reales del catálogo como lista sugerida):

| Columna        | Obligatoria | Regla                                                              |
| -------------- | ----------- | ------------------------------------------------------------------ |
| `nombre`       | sí          | 1–120 caracteres                                                   |
| `categoria`    | no          | Si no existe: crear / usar una existente / sin categoría (preview) |
| `precio_detal` | sí          | Pesos enteros: `129900`, `129.900`, `$ 129,900`. Nunca decimales   |
| `precio_mayor` | no          | Mismo formato                                                      |
| `stock`        | sí          | Entero ≥ 0 (0 = agotado)                                           |
| `material`     | no          | ≤ 80                                                               |
| `color`        | no          | ≤ 80                                                               |
| `descripcion`  | no          | ≤ 1.000                                                            |
| `imagenes`     | no          | Nombres de archivo, separados por coma. La 1.ª es la principal     |

- Los encabezados se reconocen sin importar mayúsculas, tildes, guiones o
  paréntesis, y con sinónimos: «Precio», «Cantidad», «Fotos»… (`columnas.ts`).
- **No hay columna de referencia.** Si el archivo trae `referencia`, `sku`,
  `codigo` o `id`, se ignoran con un aviso. La referencia (`DL-000XXX`) la
  asigna siempre la BD.
- El CSV de Excel en español (separado por `;`) y el guardado en Windows-1252
  se leen correctamente.

**Por qué el servidor lee la planilla:** es un archivo pequeño (≤ 4 MB,
límite de Vercel) y así el navegador nunca decide qué contiene. Se reutiliza
`exceljs`, que el proyecto ya usa (AMORE y contactos).

## 2. Imágenes — decisión

Opciones evaluadas: ZIP con Excel + fotos, Excel + selección múltiple,
arrastrar la carpeta, una foto por fila, varias por fila.

**Elegido: la persona elige la planilla y sus fotos de la forma que le sea
natural, y el sistema las relaciona por nombre de archivo:**

- selección múltiple de fotos, **carpeta completa** (botón o arrastrando la
  carpeta) o un **.zip** (planilla y fotos adentro);
- en la celda `imagenes`, el nombre del archivo. Coincidencia exacta sin
  distinguir mayúsculas. Si hay una sola foto con ese nombre base, también
  sin extensión o con otra (`anillo-corazon` → `anillo-corazon.jpeg`). Nunca
  por parecido con el nombre del producto (sería frágil);
- **varias fotos** separadas por coma: la primera es la **principal** y las
  demás van a la **galería existente** (`dulabs_catalogo_media`). No hay un
  sistema paralelo. Máximo 12 por producto.

**Por qué no solo ZIP:** crear un ZIP es un paso técnico extra y lento para
una persona no técnica. Seleccionar o arrastrar la carpeta que ya tiene es lo
más natural. El ZIP sigue soportado (lector nativo `zip.ts` con
`DecompressionStream`, sin dependencias).

**Las fotos nunca pasan por una función de Vercel.** Se validan por su firma
real (JPG/PNG/WEBP; HEIC de iPhone se detecta y se explica). Se optimizan en
el navegador con el mismo pipeline de la carga individual: principal ≤ 2048
px + miniatura ≤ 400 px, en WebP (o JPEG en Safari). Suben directo a Storage
con URLs firmadas y el servidor las verifica (tamaño, tipo y magic bytes)
antes de registrarlas. El catálogo móvil nunca descarga originales.

## 3. Referencias

Las asigna el trigger existente `dulabs_catalogo_asignar_referencia`, con un
contador por tenant bloqueado por fila. Probado localmente con PostgreSQL 16:
12 importaciones simultáneas × 30 productos dieron 362 referencias distintas,
sin huecos. Nunca dependen del Excel, del nombre ni del navegador.

## 4. Repetidos — cómo se decide cada fila

No se asume «mismo nombre = mismo producto» **por parecido**: la comparación
es por **igualdad exacta** de la clave

```
nombre + categoría + color + material   (sin tildes, sin mayúsculas, espacios colapsados)
```

«Anillo corazón» y «Anillo corazón grande» son productos distintos. También lo
son «Anillo corazón» dorado y plateado.

| Caso | Cómo se detecta | Resultado |
| ---- | --------------- | --------- |
| **Producto nuevo** | Sin errores y su clave no coincide con ninguna fila anterior del archivo ni con ningún producto del negocio | Se crea (`created`), con referencia de la BD |
| **Fila con error** | Falta nombre/precio/stock, número inválido, texto demasiado largo… (mismas reglas que el formulario, `productCreateSchema`) | No se crea (`error`). Se corrige en el preview o se descarga el CSV de errores |
| **Fila repetida** (en el archivo) | Misma clave que una fila ANTERIOR del mismo archivo | Error en la fila repetida (la primera sí se importa) |
| **Producto ya importado** | Misma clave que un producto que vino de una carga masiva anterior (`importacion_id` no nulo) | Se omite (`skipped`), con su referencia: «ya se cargó en una importación anterior (DL-…)». Así, **volver a subir el mismo archivo no crea duplicados** |
| **Posible repetido** | Misma clave que un producto creado a mano o por otro camino | Se omite por defecto, mostrando su referencia. La persona puede marcar «Importarlo de todas formas» |
| **Reintento del mismo lote** | Misma importación + misma fila (`UNIQUE (id_tenant, importacion_id, importacion_fila)`) | Devuelve el producto ya creado, nunca uno nuevo (red caída, doble clic, respuesta perdida) |

Sin la migración aplicada no se puede distinguir «ya importado» de «posible
repetido»: ambos se muestran como posible repetido y se omiten igual.

No se agregó un `codigo_externo`: nadie lo llenaría hoy. Si más adelante se
necesita «actualizar productos existentes», su identidad natural es la
referencia DL-…, y será una capacidad explícita aparte. **Hoy la importación
solo CREA: nunca actualiza ni borra.**

## 5. Categorías

- Coinciden sin tildes ni mayúsculas: «Anillos», «anillos», «ANILLOS» y
  «Anillós» son **una sola**. La BD ya tenía UNIQUE por `lower(btrim(nombre))`.
- Singular/plural de una existente («Anillo» → «Anillos»): se **sugiere**
  usar la existente, y la persona decide.
- Categoría nueva: crear (una sola vez, aunque aparezca en varios lotes), usar
  una existente o dejar sin categoría.

## 6. Errores

Cada problema es un texto listo para mostrar, con su fila de Excel:
«Fila 24: el precio detal es obligatorio.»,
«Fila 31: no encontramos la imagen «anillo3.jpg». …».

- **Error:** la fila no se importa.
- **Advertencia:** se importa, por ejemplo sin foto o con una foto inválida.

En el preview se puede corregir la fila en línea, quitarla, agregar fotos que
faltaban o descargar las filas con error en CSV. Un error del servidor nunca
se muestra crudo.

## 7. Procesamiento — decisión

**Lotes cortos orquestados por el navegador** (`proceso.ts`), con este ciclo
por lote:

1. 20 filas por lote → `createProduct` (misma regla que el formulario);
2. 10 fotos por lote → optimizar → URLs firmadas → subir a Storage →
   confirmar (principal primero).

Reintentos con espera ante 429/red/5xx; progreso real; aviso al cerrar la
pestaña. **Sin colas externas (Redis/QStash):** no hacen falta, porque las
fotos solo se pueden optimizar en el navegador, cada petición es corta (sin
timeouts de Vercel) y el servidor es idempotente. La carga masiva usa su
propia cubeta de rate limit (`catalogo_importacion`).

**Importación parcial:** cada fila es independiente. Una con error (o un fallo
de BD en una) no detiene las demás. Si falla una foto, el producto se
conserva y la foto se lista en el resultado.

## 8. Multi-tenant

- `tenantId` sale SIEMPRE de la sesión (`withCatalog` → `requireCatalogo`).
  Ningún body acepta tenant, negocio ni publicación (zod `.strict()`).
- Una importación solo existe dentro de su tenant. La FK compuesta
  `(id_tenant, importacion_id)` impide que un producto apunte a la importación
  de otro negocio.
- Las fotos solo se pueden adjuntar a productos creados por **esa**
  importación.
- Solo administradores importan.

## 9. Estados (`estados.ts`, dominio central)

- **Pantalla:** `draft → analyzing → ready → processing → completed | completed_with_errors | failed`,
  con transiciones validadas (`canTransition`). La persona ve 3 pasos: «Sube
  tus productos · Revisa los resultados · Confirma la importación».
- **Guardado en la BD:** solo `procesando` | `completada` (el CHECK de la
  migración). El resultado fino se **deriva** de los contadores
  (`outcomeOf`/`finalOutcome`): completada, completada con correcciones
  pendientes, fallida (no se creó nada y hubo errores) o interrumpida (sigue
  «procesando» más de 1 hora). Así no hace falta otra migración para agregar
  matices, y un estado guardado nunca puede contradecir los números.

## 10. Historial

`dulabs_catalogo_importaciones`: fecha, usuario, archivo, filas, creados
(contados por la BD), omitidos, errores, fotos y estado. Lo que quedó
«procesando» más de una hora se muestra como «Interrumpida». Se decidió
guardarlo porque la misma tabla ancla la idempotencia. El costo marginal fue
mínimo.

## 11. Límites (`limites.ts`, única fuente)

| Límite                        | Valor         |
| ----------------------------- | ------------- |
| Planilla                      | 4 MB (Vercel) |
| Filas por importación         | 1.000         |
| Fotos por importación         | 3.000         |
| Foto original                 | 30 MB         |
| Suma de fotos                 | 3 GB          |
| ZIP (se lee en memoria)       | 600 MB        |
| Fotos por producto            | 12            |
| Lote de filas / de fotos      | 20 / 10       |

## Archivos

```
limites.ts, columnas.ts, types.ts   contrato compartido
csv.ts, planilla.ts                 lectura (servidor; exceljs bajo demanda)
analisis.ts                         análisis puro (usa productCreateSchema)
fotos.ts, zip.ts, navegador.ts      fotos/ZIP/carpetas (navegador)
servicio.ts, esquemas.ts, http.ts   casos de uso + validación + adaptador HTTP
plantilla.ts                        plantilla XLSX/CSV
proceso.ts                          orquestación por lotes (navegador)
```

Rutas: `app/api/dashboard/catalogo/importaciones/*`. UI:
`app/dashboard/catalogo/importar` y `components/dashboard/catalogo/importar/*`.
Migración: `20261107000000_dulabs_catalogo_importaciones.sql`.

## Activación — REQUISITO PARA ACTIVACIÓN EN PRODUCCIÓN

El código ya está desplegado y convive con la base **sin** la migración:

- `GET /api/dashboard/catalogo/importaciones` responde `{ available, imports }`.
  `available` sale de una sonda (`repository.importsAvailable`: la tabla y las
  dos columnas existen). Sin la migración, responde `available: false` (no es
  un error).
- La pantalla deja subir, analizar, revisar y corregir el archivo. Muestra
  «La carga masiva estará disponible muy pronto…» y el botón de importar
  queda deshabilitado.
- Aunque alguien llame la API directamente, `start` verifica la disponibilidad
  ANTES de crear nada y responde un mensaje claro (`FEATURE_UNAVAILABLE`).
- El resto del catálogo no toca estas columnas: la creación manual y la
  tienda pública funcionan igual.

**Único paso pendiente:** aplicar y verificar
`supabase/migrations/20261107000000_dulabs_catalogo_importaciones.sql` en la
base de producción (ver `PENDING_MIGRATIONS.md`). En cuanto exista, la sonda
devuelve `available: true` y el botón se habilita. No hay que desplegar
código ni cambiar configuración.

## Qué está probado y cómo

| Qué | Cómo | Requiere producción |
| --- | ---- | ------------------- |
| Lectura CSV/XLSX, análisis, repetidos, categorías, fotos, ZIP, estados | Tests unitarios (`importacion.test.ts`) | No |
| Servicio: creación, referencias secuenciales, parcial, reintento idempotente, multi-tenant, «ya importado», sin migración → activación | Tests con repositorio EN MEMORIA que emula las reglas de la BD | No |
| Repositorio Supabase: convivencia sin migración (códigos PGRST205/42703), fallback de columnas, errores genéricos | Tests con un cliente Supabase SIMULADO | No |
| Migración: constraints, FK compuesta entre tenants, UNIQUE de reintentos, inmutabilidad de referencia, concurrencia (12×30 → 362 referencias únicas) | PostgreSQL 16 LOCAL (`supabase/tests/20261107000000_…test.sql`) | No |
| Flujo completo en el navegador (plantilla → preview → corrección → importar → fotos → historial) | Playwright contra un Supabase SIMULADO local | No |
| **Integración real** con Supabase de producción (PostgREST, Storage, RLS, triggers reales) | — | **Sí: NO verificada todavía** |
