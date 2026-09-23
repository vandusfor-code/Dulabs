# Importación masiva del Catálogo — contrato técnico

> **Estado: NO implementada.** Este documento y `types.ts` fijan el contrato
> para que la implementación futura no tenga que redefinir reglas. Ninguna
> ruta, parser ni tabla existe todavía.

Principio: nunca "subir archivo => crear 2.000 productos". Siempre
**Parse → Normalize → Validate → Preview → Confirm → Job → Products**, y cada
producto se crea por `CatalogService.createProduct` (mismo camino que el
formulario: misma validación, auditoría y referencia asignada por la BD).

## 1. Entrada

Un lote = **una hoja** (CSV UTF-8 o XLSX, primera hoja) + opcionalmente **un
ZIP de imágenes**.

| Límite             | Valor propuesto |
| ------------------ | --------------- |
| Filas por lote     | 2.000           |
| Tamaño de la hoja  | 5 MB            |
| Tamaño del ZIP     | 200 MB          |
| Imagen individual  | 15 MB (se optimiza a WebP como en la carga manual) |

## 2. Columnas (encabezados en la primera fila, sin importar mayúsculas/tildes)

| Columna        | Obligatoria | Regla                                                                  |
| -------------- | ----------- | ---------------------------------------------------------------------- |
| `nombre`       | sí          | 1–120 caracteres                                                       |
| `categoria`    | no          | Nombre de la categoría; si no existe se **propone crearla** en el preview |
| `precio_detal` | sí          | Entero COP. Se aceptan `35000`, `35.000`, `$35.000`; nunca decimales   |
| `precio_mayor` | no          | Mismo formato; vacío = sin precio mayorista (advertencia)             |
| `stock`        | sí          | Entero ≥ 0 (0 = agotado). Negativo o decimal => error de la fila       |
| `material`     | no          | ≤ 80                                                                   |
| `color`        | no          | ≤ 80                                                                   |
| `descripcion`  | no          | ≤ 1.000                                                                |
| `imagen`       | no          | Nombre del archivo dentro del ZIP (`dije-corazon.jpg`)                 |

**No hay columna de referencia.** La referencia (`DL-000XXX`) la asigna
siempre la BD al crear. Si el archivo trae una columna `referencia`, se
ignora y el preview lo advierte: una referencia nunca se importa ni se
reasigna.

## 3. Imágenes

- Se emparejan por **nombre de archivo exacto** (sin distinguir mayúsculas)
  entre la columna `imagen` y las entradas del ZIP. No se infiere por nombre del
  producto.
- Formatos: JPG, PNG y WebP. Cada imagen pasa por la misma optimización de la
  carga manual (principal ≤ 2048 px + miniatura ≤ 400 px, WebP) y se guarda en
  el bucket existente con la ruta `{tenant}/{producto}/{uuid}.webp`. No se
  cambia la infraestructura de almacenamiento.
- `imagen` con un archivo que no está en el ZIP => advertencia
  `image_not_in_zip` (el producto se puede crear sin foto).
- Archivos del ZIP no referenciados => se listan en el preview y se ignoran.

## 4. Validación y duplicados

- Cada fila se normaliza a `ImportCandidate` y se valida con las **mismas
  reglas del dominio** (`productCreateSchema`).
- **Duplicado dentro del archivo** (`duplicate_in_file`): mismo nombre
  normalizado + misma categoría + mismo color. Solo se importa la primera; las
  demás quedan como error de su fila.
- **Posible duplicado en el catálogo** (`possible_duplicate_in_catalog`): ya
  existe un producto ACTIVO con el mismo nombre normalizado en la misma
  categoría. Es una **advertencia**: el preview lo muestra y la usuaria decide
  (por defecto se omite la fila).

## 5. Preview (nada se escribe todavía)

`ImportPreview`: total, válidas, con error, sin imagen, sin precio mayor,
categorías nuevas y la lista de `ImportIssue` por fila (`error` bloquea la
fila; `warning` la deja pasar). La interfaz muestra las primeras filas con su
estado y permite descargar un CSV de errores.

## 6. Confirmación y procesamiento

1. La usuaria confirma (opcional: "omitir posibles duplicados", "crear
   categorías nuevas").
2. Se crea un `ImportJob` (tabla aditiva nueva, en la misma migración que la
   primera implementación) con estado `confirmed`.
3. El job se procesa en segundo plano (QStash, ya presente en el proyecto) por
   lotes de ~25 filas; cada fila es independiente.
4. **Errores parciales:** una fila que falla (validación tardía, imagen
   corrupta, error de red) queda `failed` en `ImportRowResult` y el lote
   continúa. Si falla la foto, el producto se conserva sin foto (igual que en
   el formulario).
5. Idempotencia: cada fila lleva una clave `(job_id, source_index)`; reintentar
   un lote nunca crea el producto dos veces.
6. Al terminar: `completed` con el resumen (creados, omitidos, fallidos) y las
   referencias asignadas por fila.

## 7. Seguridad

- Solo admin del tenant con el módulo `catalogo` (mismo `withCatalog`).
- `tenantId` siempre de la sesión; nunca del archivo.
- El ZIP se lee en streaming con límites de tamaño y de número de entradas;
  se ignoran rutas con `..` y archivos que no sean imágenes por firma (magic
  bytes), no por extensión.
