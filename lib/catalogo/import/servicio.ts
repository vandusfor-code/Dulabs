/**
 * Carga masiva — CASOS DE USO. Orquesta el análisis puro, el repositorio y el
 * CatalogService EXISTENTE:
 *   - los productos se crean con `catalog.createProduct` (misma validación,
 *     auditoría y referencia asignada por la BD que el formulario);
 *   - las categorías nuevas, con `catalog.createCategory`;
 *   - las fotos, con `catalog.requestImageUpload` / `catalog.confirmImage`
 *     (misma galería: la primera foto de la fila es la principal).
 *
 * Seguridad: el tenant es SIEMPRE el del actor autenticado; una importación
 * solo se ve y se usa dentro de su tenant, y solo adjunta fotos a productos
 * que vinieron de una carga masiva: los que ELLA creó y, si la persona lo
 * elige fila por fila, los ya importados que siguen SIN fotos. Nunca cambia
 * datos, precios, stock ni referencias de un producto existente, ni lo borra.
 */
import type { CatalogCategory, ImageConfirmInput, ImageUploadRequest } from "@/lib/catalogo/domain";
import { CatalogError, isCatalogError } from "@/lib/catalogo/errors";
import { analyzeImport, normalizeText } from "@/lib/catalogo/import/analisis";
import { PERSISTED_STATUS, outcomeOf } from "@/lib/catalogo/import/estados";
import { IMPORT_LIMITS } from "@/lib/catalogo/import/limites";
import type { CategoryDecision, ImageInfo, ImportAnalysis, ImportAvailability, ImportHistoryItem, ImportRecord, ImportRowResult, RawRow } from "@/lib/catalogo/import/types";
import type { CatalogRepository, ImportCounts } from "@/lib/catalogo/repository";
import type { CatalogActor, CatalogService, ImageUploadTicket } from "@/lib/catalogo/service";

export interface AnalyzeRequest {
  rows: RawRow[];
  images: ImageInfo[];
  decisions: Record<string, CategoryDecision>;
  force: number[];
  /** Filas ya importadas sin fotos a las que se les agregan las fotos (decisión explícita, fila por fila). */
  attach?: number[];
}

export type PhotoTicketResult = { productId: string; ok: true; upload: ImageUploadTicket } | { productId: string; ok: false; message: string };
export type PhotoConfirmResult = { productId: string; uploadId: string; ok: true; imageId: string } | { productId: string; uploadId: string; ok: false; message: string };

const HISTORY_LIMIT = 20;

function messageOf(err: unknown, fallback: string): string {
  if (isCatalogError(err) && err.code !== "INTERNAL_ERROR") return err.message;
  if (!isCatalogError(err)) console.error("[catalogo/importacion] error inesperado:", err instanceof Error ? err.message : err);
  return fallback;
}

export function createCatalogImportService({ repo, catalog }: { repo: CatalogRepository; catalog: CatalogService }) {
  async function context(actor: CatalogActor) {
    const [categories, existing] = await Promise.all([repo.listCategories(actor.tenantId), repo.listProductKeys(actor.tenantId)]);
    return { categories, existing };
  }

  async function requireOpenImport(actor: CatalogActor, importId: string): Promise<ImportRecord> {
    const imp = await repo.getImport(actor.tenantId, importId);
    if (!imp) throw new CatalogError("NOT_FOUND", "La importación no existe.");
    if (imp.status === PERSISTED_STATUS.completed) throw new CatalogError("CONFLICT", "Esta importación ya terminó. Inicia una nueva.");
    return imp;
  }

  /**
   * Productos a los que una importación puede adjuntar fotos: los que vinieron
   * de una carga masiva de ESTE tenant (los creados ahora y los ya importados
   * que la persona eligió completar). Un producto creado a mano o por AMORE
   * nunca recibe fotos por esta vía.
   */
  async function requireImportedProducts(actor: CatalogActor, productIds: string[]): Promise<Set<string>> {
    return new Set(await repo.bulkImportedProductIds(actor.tenantId, [...new Set(productIds)]));
  }

  /**
   * Categoría para una clave nueva: si ya existe (otro lote la creó o alguien
   * la creó mientras tanto) se reutiliza; si no, se crea. Nunca duplica.
   */
  async function ensureCategory(actor: CatalogActor, cache: CatalogCategory[], key: string, label: string): Promise<CatalogCategory> {
    const find = (list: CatalogCategory[]) => list.find((c) => normalizeText(c.name) === key);
    const known = find(cache);
    if (known) return known;
    try {
      const created = await catalog.createCategory(actor, { name: label });
      cache.push(created);
      return created;
    } catch (err) {
      if (!isCatalogError(err) || err.code !== "CONFLICT") throw err;
      const fresh = await repo.listCategories(actor.tenantId);
      cache.splice(0, cache.length, ...fresh);
      const again = find(fresh) ?? fresh.find((c) => c.name.trim().toLowerCase() === label.trim().toLowerCase());
      if (!again) throw err;
      return again;
    }
  }

  return {
    /** Preview: nada se escribe. */
    async analyze(actor: CatalogActor, req: AnalyzeRequest): Promise<ImportAnalysis> {
      const ctx = await context(actor);
      return analyzeImport({ ...req, ...ctx });
    },

    /**
     * ¿Está activa la carga masiva? (false = falta la migración 20261107000000).
     * La interfaz lo consulta para habilitar "Importar"; el análisis no depende de esto.
     */
    async availability(): Promise<ImportAvailability> {
      return { available: await repo.importsAvailable() };
    },

    async start(actor: CatalogActor, input: { fileName: string; totalRows: number }): Promise<ImportRecord> {
      // Se verifica ANTES de crear nada: con la migración a medias no debe
      // quedar una importación iniciada que luego falle fila por fila.
      if (!(await repo.importsAvailable())) {
        throw new CatalogError("FEATURE_UNAVAILABLE", "La carga masiva todavía no está activada. Puedes revisar tu archivo; la importación estará disponible pronto.");
      }
      return repo.insertImport(actor.tenantId, actor.userId, input);
    },

    /**
     * Crea un LOTE de filas. Cada fila se vuelve a analizar aquí (el preview
     * del navegador no es la verdad) y es independiente: una fila con error no
     * detiene las demás. Idempotente: si una fila ya se creó en un intento
     * anterior de esta importación, se devuelve ese producto.
     */
    async createRows(actor: CatalogActor, importId: string, req: AnalyzeRequest): Promise<ImportRowResult[]> {
      if (req.rows.length > IMPORT_LIMITS.rowsPerBatch) throw new CatalogError("VALIDATION_ERROR", `Máximo ${IMPORT_LIMITS.rowsPerBatch} filas por lote.`);
      await requireOpenImport(actor, importId);

      const already = new Map((await repo.getProductsByImportRows(actor.tenantId, importId, req.rows.map((r) => r.row))).map((x) => [x.row, x.product]));
      const ctx = await context(actor);
      // Lo que esta misma importación ya creó no cuenta como "repetido" de sí mismo.
      const ownRefs = new Set([...already.values()].map((p) => p.reference));
      const analysis = analyzeImport({ ...req, categories: ctx.categories, existing: ctx.existing.filter((p) => !ownRefs.has(p.reference)) });
      const categories = [...ctx.categories];

      const results: ImportRowResult[] = [];
      for (const a of analysis.rows) {
        const images = a.images.map((m) => m.file).filter((f): f is string => f !== null);
        const done = already.get(a.row);
        if (done) {
          results.push({ row: a.row, status: "created", reference: done.reference, productId: done.id, name: done.name, message: null, images });
          continue;
        }
        if (a.status === "error" || !a.product) {
          const errors = a.issues.filter((i) => i.severity === "error").map((i) => i.message);
          results.push({ row: a.row, status: "error", reference: null, productId: null, name: a.values.name ?? null, message: errors.join(" ") || `Fila ${a.row}: no se pudo validar.`, images: [] });
          continue;
        }
        if (a.attach && a.duplicateOf?.kind === "catalog") {
          // Solo fotos: el producto existente no se toca (ni datos, ni precio, ni stock, ni referencia).
          results.push({ row: a.row, status: "attached", reference: a.duplicateOf.reference, productId: a.duplicateOf.productId, name: a.duplicateOf.name, message: null, images });
          continue;
        }
        if (a.status === "duplicate") {
          const dup = a.issues.find((i) => i.code === "duplicate_in_catalog" || i.code === "already_imported");
          results.push({ row: a.row, status: "skipped", reference: null, productId: null, name: a.product.name, message: dup?.message ?? `Fila ${a.row}: omitida.`, images: [] });
          continue;
        }

        const p = a.product;
        try {
          let categoryId: string | null = null;
          if (p.category.kind === "existing") categoryId = p.category.id;
          else if (p.category.kind === "new") categoryId = (await ensureCategory(actor, categories, p.category.key, p.category.label)).id;
          const input = {
            name: p.name,
            categoryId,
            description: p.description,
            material: p.material,
            color: p.color,
            retailPrice: p.retailPrice,
            wholesalePrice: p.wholesalePrice,
            stock: p.stock,
          };
          let created;
          try {
            created = await catalog.createProduct(actor, input, { importId, row: a.row });
          } catch (err) {
            // Carrera con un reintento simultáneo de la misma fila: el UNIQUE de la BD lo frenó.
            if (!isCatalogError(err) || err.code !== "CONFLICT") throw err;
            const again = (await repo.getProductsByImportRows(actor.tenantId, importId, [a.row]))[0]?.product;
            if (!again) throw err;
            created = again;
          }
          results.push({ row: a.row, status: "created", reference: created.reference, productId: created.id, name: created.name, message: null, images });
        } catch (err) {
          results.push({
            row: a.row,
            status: "error",
            reference: null,
            productId: null,
            name: p.name,
            message: `Fila ${a.row}: ${messageOf(err, "no se pudo crear el producto. Intenta de nuevo.")}`,
            images: [],
          });
        }
      }
      return results;
    },

    /** URLs firmadas para un lote de fotos (una por foto; la BD y Storage deciden la ruta). */
    async photoUploadUrls(actor: CatalogActor, importId: string, items: Array<ImageUploadRequest & { productId: string }>): Promise<PhotoTicketResult[]> {
      await requireOpenImport(actor, importId);
      const own = await requireImportedProducts(
        actor,
        items.map((i) => i.productId),
      );
      const out: PhotoTicketResult[] = [];
      for (const item of items) {
        if (!own.has(item.productId)) {
          out.push({ productId: item.productId, ok: false, message: "Solo se pueden agregar fotos a productos cargados de forma masiva." });
          continue;
        }
        try {
          const upload = await catalog.requestImageUpload(actor, item.productId, { mimeType: item.mimeType, bytes: item.bytes, thumbBytes: item.thumbBytes, detailBytes: item.detailBytes });
          out.push({ productId: item.productId, ok: true, upload });
        } catch (err) {
          out.push({ productId: item.productId, ok: false, message: messageOf(err, "No se pudo preparar la subida de la foto.") });
        }
      }
      return out;
    },

    /** Confirma un lote de fotos YA subidas (en orden: la principal primero). */
    async confirmPhotos(actor: CatalogActor, importId: string, items: Array<ImageConfirmInput & { productId: string }>): Promise<PhotoConfirmResult[]> {
      await requireOpenImport(actor, importId);
      const own = await requireImportedProducts(
        actor,
        items.map((i) => i.productId),
      );
      const out: PhotoConfirmResult[] = [];
      for (const item of items) {
        const { productId, ...confirm } = item;
        if (!own.has(productId)) {
          out.push({ productId, uploadId: item.uploadId, ok: false, message: "Solo se pueden agregar fotos a productos cargados de forma masiva." });
          continue;
        }
        try {
          const image = await catalog.confirmImage(actor, productId, confirm);
          out.push({ productId, uploadId: item.uploadId, ok: true, imageId: image.id });
        } catch (err) {
          out.push({ productId, uploadId: item.uploadId, ok: false, message: messageOf(err, "No se pudo registrar la foto.") });
        }
      }
      return out;
    },

    async finish(actor: CatalogActor, importId: string, counts: ImportCounts): Promise<ImportRecord> {
      const imp = await repo.getImport(actor.tenantId, importId);
      if (!imp) throw new CatalogError("NOT_FOUND", "La importación no existe.");
      if (imp.status === PERSISTED_STATUS.completed) return imp;
      const done = await repo.finishImport(actor.tenantId, importId, counts);
      if (!done) throw new CatalogError("NOT_FOUND", "La importación no existe.");
      return done;
    },

    /** Historial con el resultado ya derivado. Sin la migración: vacío (no es un error para la persona). */
    async history(actor: CatalogActor, now = Date.now()): Promise<ImportHistoryItem[]> {
      if (!(await repo.importsAvailable())) return [];
      const items = await repo.listImports(actor.tenantId, HISTORY_LIMIT);
      return items.map((r) => ({ ...r, outcome: outcomeOf(r, now) }));
    },
  };
}

export type CatalogImportService = ReturnType<typeof createCatalogImportService>;
