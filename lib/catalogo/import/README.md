# Carga masiva del Catálogo (Fases 4 y 5)

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
| `codigo`       | no          | Tu código interno, SOLO para encontrar fotos (`AN-014.jpg`). No se guarda |
| `imagenes`     | no          | Opcional (ver §2). Nombres de archivo por coma; «sin foto» = ninguna |

- Los encabezados se reconocen sin importar mayúsculas, tildes, guiones o
  paréntesis, y con sinónimos: «Precio», «Cantidad», «Fotos»… (`columnas.ts`).
- **No hay columna de referencia.** Si el archivo trae `referencia`, `ref` o
  `id`, se ignoran con un aviso. La referencia (`DL-000XXX`) la asigna
  siempre la BD. `codigo`/`sku` se leen solo para relacionar fotos.
- El CSV de Excel en español (separado por `;`) y el guardado en Windows-1252
  se leen correctamente.

**Por qué el servidor lee la planilla:** es un archivo pequeño (≤ 4 MB,
límite de Vercel) y así el navegador nunca decide qué contiene. Se reutiliza
`exceljs`, que el proyecto ya usa (AMORE y contactos).

## 2. Fotografías — decisión (Fase 5)

¿Cómo se relaciona cada producto del Excel con sus fotos? Opciones evaluadas:

| Opción | Fricción | Errores | Windows | 100–2.000 productos |
| --- | --- | --- | --- | --- |
| A. ZIP con Excel + fotos | Alta: crear el ZIP es un paso técnico | Bajos | Bien | Se lee **entero en memoria** (tope 600 MB) |
| B. Selección múltiple | Media: miles de archivos en un diálogo | Bajos | Bien | Bien (referencias, no memoria) |
| C. **Seleccionar la carpeta** | **Mínima: la carpeta ya existe** | Bajos | **Nativo** (`webkitdirectory`, Chrome/Edge/Firefox) | **Bien: el navegador guarda referencias; cada foto se lee al procesarla** |
| D. Arrastrar fotos sobre filas | Muy alta con cientos de productos | Medios | Bien | Inviable |
| E. Combinación | — | — | — | — |

**Elegido: UN solo sistema de asociación (`asociacion.ts`) y UNA forma
recomendada de entregar las fotos: la carpeta (C).** Selección múltiple,
.zip y arrastrar siguen funcionando porque son solo *formas de entregar
archivos* a la misma regla, no sistemas distintos. Para corregir casos
puntuales hay un selector de fotos por fila en el preview (no arrastrar).

### Regla determinista (nunca por parecido)

Cada fila toma sus fotos de UNA fuente, en este orden:

1. **Elegidas en el preview** (`RawRow.photos`, ids exactos).
2. **Columna `imagenes`**: ruta exacta, final de ruta, nombre, nombre sin
   extensión o nombre "slug"; o el nombre de una carpeta. «sin foto» = ninguna.
3. **Automática por nombre**, con la clave slug (`photoKey`: sin tildes,
   mayúsculas ni signos) del `codigo`, de nombre + color, o del nombre (la
   primera que encuentre algo):
   - `anillo-corazon.jpg` → principal de «Anillo Corazón»;
   - `anillo-corazon-2.jpg`, `Anillo Corazón (3).jpg` → galería por número;
   - carpeta `Anillo Corazón/` → todas sus fotos (la que se llama como el
     producto primero, luego orden natural: `2.jpg` antes que `10.jpg`).

**Si hay duda, no se asigna nada** y la fila muestra «Tenemos varias imágenes
posibles para este producto» con los candidatos para elegir: misma foto en
dos formatos o carpetas, dos carpetas con el nombre del producto, fotos
sueltas además de la carpeta, una foto que coincide con dos filas (se indica
cuál), o `1.jpg` en varias carpetas. Una foto indicada expresamente por otra
fila nunca se asigna sola. Las filas con error o repetidas en el archivo no
compiten por fotos.

**La identidad de una foto es su ruta relativa** (`Fotos/Anillo/1.jpg`): dos
`1.jpg` en carpetas distintas son dos fotos.

### El preview se congela al confirmar

El servidor analiza por lotes de 20 filas; sin más, una duda entre filas de
lotes distintos podría "resolverse sola" al procesar. Por eso, al confirmar,
cada fila viaja con sus fotos exactas (`photos`), y cada lote lleva solo los
metadatos de SUS fotos (no los de miles).

### Validación (sin decodificar: 2.000 fotos en segundos)

En el navegador, por foto: firma real (JPG/PNG/WEBP; HEIC y GIF se
explican), peso, **dimensiones leídas del encabezado** (SOF de JPEG, IHDR de
PNG, VP8/VP8L/VP8X de WEBP; se leen 64 KB, y solo si hace falta hasta 4 MB) y
**archivos dañados** (firma válida pero encabezado roto o cortado). No se
exige el marcador final del JPEG: las "fotos en movimiento" de los celulares
agregan un video al final y son válidas. Menos de 200 px (lado mayor) o más
de 16.384 px / 100 MP → no se usa; menos de 600 px → se usa con aviso de
baja resolución. Un daño en el cuerpo de la foto (no en el encabezado) se
detecta al optimizarla y se informa como «imagen inválida».

### Variantes optimizadas (misma galería del catálogo)

Se optimizan en el navegador (canvas, orientación EXIF respetada, proporción
intacta) y suben directo a Storage con URLs firmadas; el servidor verifica
tamaño, tipo y magic bytes antes de registrarlas:

| Variante | Lado mayor | Tope | Uso |
| --- | --- | --- | --- |
| principal | 2048 px | 3 MB | original optimizado (respaldo) |
| **detail** (nueva) | 1200 px | 600 KB | ficha del producto y vista previa al compartir |
| thumb | 400 px | 400 KB | tarjetas, carrito, miniaturas de la galería |

- `detail` vive junto a la principal por convención (`…/u_detail.webp`): sin
  migración ni cambio de RPC. Las fotos anteriores sin `detail` caen a la
  principal automáticamente.
- Una sola miniatura de 400 px sirve para tarjetas (≈ 180 px en pantalla × 2
  de densidad) y miniaturas: una de 160 px ahorraría poco y duplicaría
  subidas.
- **WebP** si el navegador lo codifica; si no (Safari), JPEG. **AVIF no**: la
  codificación AVIF por canvas no está disponible de forma confiable en los
  navegadores actuales.

### Completar fotos de productos ya importados

Si un producto vino de una carga masiva anterior y **no tiene fotos**, y la
nueva carga trae sus fotos, el preview lo ofrece («Agregar sus fotos»), fila
por fila o todos a la vez. Es una acción explícita: sin elegirla, la fila se
omite como siempre. Nunca se cambian datos, precio, stock ni referencia, y un
producto creado a mano o por AMORE nunca recibe fotos por esta vía.

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
| Filas por importación         | 2.000         |
| Fotos por importación         | 6.000         |
| Foto original                 | 30 MB         |
| Suma de fotos                 | 20 GB (desde una carpeta no se cargan en memoria) |
| ZIP (se lee en memoria)       | 600 MB        |
| Fotos por producto            | 12            |
| Lote de filas / de fotos      | 20 / 10       |

## Archivos

```
limites.ts, columnas.ts, types.ts   contrato compartido
csv.ts, planilla.ts                 lectura (servidor; exceljs bajo demanda)
analisis.ts                         análisis puro (usa productCreateSchema)
fotos.ts                            firma, dimensiones, daños, claves (puro)
asociacion.ts                       regla fila <-> fotos (pura, determinista)
zip.ts, navegador.ts                ZIP y carpetas con su ruta (navegador)
resultado.ts                        resultado por motivos (puro)
servicio.ts, esquemas.ts, http.ts   casos de uso + validación + adaptador HTTP
plantilla.ts                        plantilla XLSX/CSV
proceso.ts                          orquestación por lotes (navegador)
```

Rutas: `app/api/dashboard/catalogo/importaciones/*`. UI:
`app/dashboard/catalogo/importar` y `components/dashboard/catalogo/importar/*`.
Migración: `20261107000000_dulabs_catalogo_importaciones.sql`.

## Activación

**Estado:** el responsable del proyecto confirmó que la migración
`20261107000000` se ejecutó en Supabase de producción (ver
`PENDING_MIGRATIONS.md`). La Fase 5 no requiere migraciones nuevas.

El código convive igual con una base **sin** la migración:

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
| Fase 5: encabezados reales (JPEG/PNG/WEBP), dañadas, dimensiones, identidad por ruta, asociación automática y dudas, columna, selector, volumen 2.000 × 6.000 | `fotos-asociacion.test.ts` | No |
| Fase 5 de punta a punta: 1 foto, varias, 100 productos, preview congelado entre lotes, faltantes/inválidas/fallidas, duplicados, completar fotos sin tocar datos, multi-tenant, variante detail, progreso y tiempo restante | `fase5-flujo.test.ts` (servicio real + repositorio en memoria) | No |
| **Integración real** con Supabase de producción (PostgREST, Storage, RLS, triggers reales) | Revisión en producción por el responsable | **Sí** |
