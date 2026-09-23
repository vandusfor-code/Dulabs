# Catálogo DuLabs

Fuente de verdad de los productos de un negocio. El HTML, la IA y el frontend
**no** son fuentes de verdad: leen o representan lo que vive aquí.

## Capas

```
app/dashboard/catalogo/*            UI (grid, nuevo, detalle/edición)
lib/catalogo-client.ts              cliente HTTP del navegador (+ subida directa a Storage)
app/api/dashboard/catalogo/*        adaptadores HTTP delgados (withCatalog)
lib/catalogo/http.ts                auth + rate limit + errores -> envelope
lib/catalogo/auth.ts                sesión + rol + módulo "catalogo" (tenant SIEMPRE de la membresía)
lib/catalogo/service.ts             casos de uso
lib/catalogo/domain.ts              modelo + reglas + validación (puro, sin I/O)
lib/catalogo/repository.ts          ÚNICO acceso a tablas y Storage
```

Datos: `dulabs_inventario_productos` (tabla compartida con AMORE, el Business
Agent y la cotización del agente, evolucionada de forma aditiva),
`dulabs_catalogo_{categorias,media,secuencias,eventos}`, `dulabs_tenant_modulos`.
Imágenes: bucket existente `inventario-productos`, ruta
`{id_tenant}/{producto_id}/{uuid}.{ext}` (+ `_thumb`).

## Reglas protegidas en la base de datos

- `referencia` (DL-000001…) la asigna un trigger con contador por tenant
  bloqueado por fila: segura ante concurrencia, única por tenant (UNIQUE),
  inmutable. Vale para cualquier camino de escritura.
- Auditoría append-only (`dulabs_catalogo_eventos`) por trigger, en la misma
  transacción del cambio. `escritura_id` evita atribuir a un usuario cambios
  hechos por otros caminos (AMORE, ventas, Business Agent).
- Media: principal única, `foto_url` sincronizada, ruta obligatoriamente bajo
  el tenant/producto dueños (RPC atómicas `dulabs_catalogo_adjuntar_media` /
  `dulabs_catalogo_eliminar_media`).
- `controla_stock`: `true` por defecto (comportamiento histórico). El Catálogo
  crea productos con `false`: la cotización no marca "agotado" ni stock
  insuficiente para ellos.

## Fronteras futuras (no implementadas en la Fase 1)

- `lib/catalogo/import/` — importación masiva: Parse → Normalize → Validate →
  Preview → Confirm → ImportJob (QStash) → Products. Contratos en
  `import/types.ts`. Cada formato (CSV/XLSX, HTML) es un adaptador que solo
  produce `ImportCandidate`; nunca toca el dominio ni la BD.
- `lib/catalogo/export/html` — generar el catálogo HTML **desde** la BD (el
  HTML es una representación, nunca la fuente).
- Herramienta del agente `search_products()` sobre `CatalogService`: consulta
  bajo demanda y devuelve producto + referencia + precio + `image_url` reales.
  La IA nunca recibe el catálogo completo en el prompt ni inventa precios,
  referencias ni imágenes.
