// DuLabs Business — Agent Compiler (Fase 1), Pilar 1 (Step 3).
//
// Puerto (interfaz) del repositorio de catálogo. La lógica del persister
// depende de esta abstracción (inyección de dependencias), NO de Supabase
// directo, para poder probarse sin una base real. El adapter de producción
// (catalog-repository-supabase.ts) reutiliza las abstracciones existentes de
// DuLabs Business (lib/amore-inventario para productos; insert directo a
// dulabs_servicios para servicios). No define tablas nuevas.

import type { CatalogItemType } from "@/lib/agent-compiler/types";

/** Fila existente del catálogo del tenant (proyección mínima para idempotencia). */
export interface ExistingCatalogEntry {
  id: string;
  type: CatalogItemType;
  name: string;
  priceCop: number | null;
}

/** Ítem ya validado, listo para persistir. Sin `tenantId`: lo aporta el caller. */
export interface PersistableCatalogItem {
  type: CatalogItemType;
  name: string;
  priceCop: number | null;
  durationMin?: number;
  category?: string | null;
  description?: string | null;
  stock?: number;
}

/**
 * Puerto de persistencia. TODAS las operaciones son tenant-scoped: el
 * `tenantId` viene del contexto autenticado del servidor y el adapter lo aplica
 * como filtro/valor de `id_tenant` en cada consulta. Ninguna operación acepta
 * un tenant embebido en el contenido del ítem.
 */
export interface CatalogRepository {
  /** Ítems existentes del tenant (servicios + productos). Solo de ESE tenant. */
  listExisting(tenantId: string): Promise<ExistingCatalogEntry[]>;
  /** Inserta un ítem nuevo (id_tenant = tenantId). Devuelve su id. */
  insert(tenantId: string, item: PersistableCatalogItem): Promise<{ id: string }>;
  /** Actualiza SOLO el precio de un ítem existente del tenant. */
  updatePrice(tenantId: string, ref: { id: string; type: CatalogItemType }, priceCop: number | null): Promise<void>;
}

/** Normaliza un nombre para comparar identidad (idempotencia). Nunca para mostrar. */
export function normalizeCatalogName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
