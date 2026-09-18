// DuLabs Business — Agent Compiler (Fase 1), Pilar 1 (Step 3).
//
// Persistencia IDEMPOTENTE del catálogo extraído hacia las tablas estructuradas
// existentes (dulabs_servicios / dulabs_inventario_productos), vía el puerto
// CatalogRepository (inyección de dependencias). Lógica pura y testeable sin
// base real. Garantías:
//  - tenant-scoped: el tenantId viene del contexto autenticado del servidor,
//    NUNCA del contenido del LLM/PDF (el ítem no lleva tenantId).
//  - idempotente: recompilar el mismo prompt no duplica (match por nombre
//    normalizado dentro del tenant); un precio distinto ACTUALIZA, no inserta.
//  - validación determinista previa: ambiguo / precio inválido / moneda no
//    soportada / precio ausente requerido / conflicto de identidad impiden
//    persistir ESE registro y dejan evidencia diagnóstica.
//  - resiliencia a error parcial: cada ítem se procesa aislado; un fallo no
//    aborta el resto, y por idempotencia re-ejecutar converge sin duplicar.

import type {
  CatalogExtractionResult,
  CatalogPersistEntry,
  CatalogPersistenceReport,
  CompilerIssue,
  ExtractedCatalogItem,
} from "@/lib/agent-compiler/types";
import {
  normalizeCatalogName,
  type CatalogRepository,
  type ExistingCatalogEntry,
  type PersistableCatalogItem,
} from "@/lib/agent-compiler/catalog-repository";

const DURACION_MIN_DEFECTO = 60; // dulabs_servicios.duracion_min es NOT NULL > 0

type ValidacionItem =
  | { ok: true; persistable: PersistableCatalogItem }
  | { ok: false; issue: CompilerIssue };

/** Validación determinista de UN ítem antes de persistir (defensa en profundidad). */
function validarItem(item: ExtractedCatalogItem): ValidacionItem {
  const name = item.name?.trim();
  if (!name) {
    return { ok: false, issue: { code: "COMPILER_INPUT_INVALID", severity: "block", message: "Ítem sin nombre." } };
  }
  if (item.currency !== "COP") {
    return {
      ok: false,
      issue: { code: "CATALOG_INVALID_CURRENCY", severity: "block", message: `"${name}" en moneda no soportada (${item.currency}).`, subject: normalizeCatalogName(name) },
    };
  }
  if (item.priceCop !== undefined && (!Number.isInteger(item.priceCop) || item.priceCop < 0)) {
    return {
      ok: false,
      issue: { code: "CATALOG_ITEM_MISSING_PRICE", severity: "block", message: `Precio inválido para "${name}" (${item.priceCop}).`, subject: normalizeCatalogName(name) },
    };
  }
  const durationMin = item.type === "service" ? (item.durationMin && item.durationMin > 0 ? item.durationMin : DURACION_MIN_DEFECTO) : undefined;
  return {
    ok: true,
    persistable: {
      type: item.type,
      name,
      priceCop: item.priceCop ?? null,
      durationMin,
      category: item.category ?? null,
      description: item.description ?? null,
      stock: item.type === "product" ? (item.stock ?? 0) : undefined,
    },
  };
}

function rechazo(item: ExtractedCatalogItem, issue: CompilerIssue): CatalogPersistEntry {
  return { name: item.name, type: item.type, outcome: "rejected", issue };
}

/**
 * Persiste el catálogo extraído de forma idempotente y tenant-scoped.
 * `tenantId` DEBE provenir del contexto autenticado del servidor.
 */
export async function persistCatalog(
  repo: CatalogRepository,
  tenantId: string,
  extraction: CatalogExtractionResult,
): Promise<CatalogPersistenceReport> {
  // Nombres bloqueados por la extracción (ambiguo/duplicado/moneda/precio) —
  // ese registro NO se persiste aunque haya llegado en `items`.
  const bloqueados = new Set(
    extraction.issues.filter((i) => i.severity === "block" && i.subject).map((i) => i.subject as string),
  );

  const existentes = await repo.listExisting(tenantId);
  const porTipoNombre = new Map<string, ExistingCatalogEntry>();
  const porNombre = new Map<string, ExistingCatalogEntry>();
  for (const e of existentes) {
    const n = normalizeCatalogName(e.name);
    porTipoNombre.set(`${e.type}:${n}`, e);
    if (!porNombre.has(n)) porNombre.set(n, e);
  }

  const entries: CatalogPersistEntry[] = [];

  for (const item of extraction.items) {
    const norm = normalizeCatalogName(item.name);

    if (bloqueados.has(norm)) {
      entries.push(
        rechazo(item, { code: "AMBIGUOUS_CATALOG_ITEM", severity: "block", message: `"${item.name}" bloqueado por la validación de extracción; no se persiste.`, subject: norm }),
      );
      continue;
    }

    const v = validarItem(item);
    if (!v.ok) {
      entries.push(rechazo(item, v.issue));
      continue;
    }

    // Conflicto de identidad: mismo nombre normalizado existe con OTRO tipo.
    const mismoNombre = porNombre.get(norm);
    if (mismoNombre && mismoNombre.type !== item.type) {
      entries.push(
        rechazo(item, { code: "CATALOG_DUPLICATE_ITEM", severity: "block", message: `Conflicto de identidad: "${item.name}" ya existe como ${mismoNombre.type}.`, subject: norm }),
      );
      continue;
    }

    const existente = porTipoNombre.get(`${item.type}:${norm}`);
    try {
      if (existente) {
        const precioActual = existente.priceCop ?? null;
        const precioNuevo = v.persistable.priceCop ?? null;
        if (precioActual === precioNuevo) {
          entries.push({ name: item.name, type: item.type, outcome: "unchanged", id: existente.id });
        } else {
          await repo.updatePrice(tenantId, { id: existente.id, type: item.type }, precioNuevo);
          entries.push({ name: item.name, type: item.type, outcome: "updated", id: existente.id });
        }
      } else {
        const { id } = await repo.insert(tenantId, v.persistable);
        // Registrar en los índices para desduplicar dentro del mismo batch.
        const entry: ExistingCatalogEntry = { id, type: item.type, name: v.persistable.name, priceCop: v.persistable.priceCop };
        porTipoNombre.set(`${item.type}:${norm}`, entry);
        if (!porNombre.has(norm)) porNombre.set(norm, entry);
        entries.push({ name: item.name, type: item.type, outcome: "inserted", id });
      }
    } catch (err) {
      // Resiliencia a error parcial: no aborta el resto; re-ejecutar converge.
      entries.push({
        name: item.name,
        type: item.type,
        outcome: "failed",
        issue: { code: "COMPILER_INPUT_INVALID", severity: "block", message: `Fallo al persistir "${item.name}": ${err instanceof Error ? err.message : String(err)}`, subject: norm },
      });
    }
  }

  const cuenta = (o: CatalogPersistEntry["outcome"]) => entries.filter((e) => e.outcome === o).length;
  return {
    entries,
    inserted: cuenta("inserted"),
    updated: cuenta("updated"),
    unchanged: cuenta("unchanged"),
    rejected: cuenta("rejected"),
    failed: cuenta("failed"),
    issues: entries.filter((e) => e.issue).map((e) => e.issue as CompilerIssue),
  };
}
