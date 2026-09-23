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

## 4. Repetidos — decisión

Sin una referencia del usuario, se evaluaron:

- nombre + negocio (frágil: «Aretes argolla» dorados y plateados son distintos);
- SKU/código externo (Delacour no los usa hoy: una columna que nadie llena);
- hash de importación.

**Elegido:**

1. **Idempotencia por importación + fila** (`importacion_id`,
   `importacion_fila`, UNIQUE): un reintento (red caída, doble clic) nunca
   duplica. Devuelve el producto ya creado.
2. **Repetido en el archivo:** mismo nombre + categoría + color + material
   (sin tildes ni mayúsculas) → error en la fila repetida.
3. **Posible repetido en el catálogo:** misma clave que un producto existente
   → se **omite por defecto**, mostrando su referencia. La persona puede
   marcar «Importarlo de todas formas».

Así, volver a subir el mismo archivo corregido solo crea lo que falta. Un
`codigo_externo` no se agrega ahora. Si más adelante se necesita
«actualizar productos existentes», su identidad natural es la referencia
DL-…, y será una capacidad explícita aparte. **Hoy la importación solo CREA:
nunca actualiza ni borra.**

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

## 9. Historial

`dulabs_catalogo_importaciones`: fecha, usuario, archivo, filas, creados
(contados por la BD), omitidos, errores, fotos y estado. Lo que quedó
«procesando» más de una hora se muestra como «Interrumpida». Se decidió
guardarlo porque la misma tabla ancla la idempotencia. El costo marginal fue
mínimo.

## 10. Límites (`limites.ts`, única fuente)

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
