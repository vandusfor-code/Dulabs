/**
 * Bloque 25 — fuentes REALES del enriquecimiento del panel de pedidos (ver PanelFuentes en panel.ts).
 * Solo lectura, siempre acotadas al negocio de la sesión (los contactos salen de SUS pedidos).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseCatalogRepository } from "@/lib/catalogo/repository";
import { createSupabaseCustomerChannelStore, type CustomerChannel } from "@/lib/agente/clasificacion";
import type { PanelFuentes } from "@/lib/catalogo/pedidos/panel";

type Contacto = { phoneNumberId: string; waId: string };
const clave = (pn: string, wa: string) => `${pn}|${wa}`;
const porNumero = (contactos: readonly Contacto[]) => {
  const m = new Map<string, string[]>();
  for (const c of contactos) m.set(c.phoneNumberId, [...(m.get(c.phoneNumberId) ?? []), c.waId]);
  return m;
};

export function productionPanelFuentes(supabase: SupabaseClient): PanelFuentes {
  const canales = createSupabaseCustomerChannelStore(supabase);
  const repo = createSupabaseCatalogRepository(supabase);
  return {
    async nombres(_tenantId, contactos) {
      const out = new Map<string, string>();
      for (const [pn, was] of porNumero(contactos)) {
        const { data, error } = await supabase.from("dulabs_clientes_conocidos").select("telefono_cliente, nombre").eq("phone_number_id", pn).in("telefono_cliente", was);
        if (error) throw new Error(`nombres ${error.code ?? "?"}`);
        for (const r of (data ?? []) as Array<{ telefono_cliente: string; nombre: string | null }>) if (r.nombre?.trim()) out.set(clave(pn, r.telefono_cliente), r.nombre.trim().slice(0, 80));
      }
      return out;
    },
    async canales(tenantId, contactos) {
      const out = new Map<string, CustomerChannel>();
      for (const [pn, was] of porNumero(contactos)) {
        for (const [wa, c] of await canales.getMany({ tenantId, phoneNumberId: pn, waIds: was })) out.set(clave(pn, wa), c);
      }
      return out;
    },
    async confirmados(tenantId, orderIds) {
      const { data, error } = await supabase
        .from("dulabs_catalogo_pedido_eventos")
        .select("pedido_id, created_at")
        .eq("id_tenant", tenantId)
        .eq("estado_hacia", "confirmed")
        .in("pedido_id", [...orderIds].slice(0, 200));
      if (error) throw new Error(`confirmados ${error.code ?? "?"}`);
      const out = new Map<string, string>();
      // Si se confirmó más de una vez (re-propuesta), cuenta la última.
      for (const r of (data ?? []) as Array<{ pedido_id: string; created_at: string }>) if (!out.has(r.pedido_id) || out.get(r.pedido_id)! < r.created_at) out.set(r.pedido_id, r.created_at);
      return out;
    },
    async asignadas(tenantId, contactos) {
      const out = new Map<string, string>();
      const numeros = [...porNumero(contactos).keys()];
      if (numeros.length === 0) return out;
      const [{ data: asig, error: e1 }, { data: miembros, error: e2 }] = await Promise.all([
        supabase.from("dulabs_conversacion_asignaciones").select("phone_number_id, telefono_cliente, miembro_id").in("phone_number_id", numeros),
        supabase.from("dulabs_miembros_equipo").select("id, nombre, email").eq("tenant_id", tenantId),
      ]);
      if (e1 || e2) throw new Error(`asignadas ${(e1 ?? e2)?.code ?? "?"}`);
      const nombre = new Map(((miembros ?? []) as Array<{ id: number; nombre: string | null; email: string | null }>).map((m) => [m.id, (m.nombre?.trim() || m.email || "").slice(0, 80)]));
      const buscados = new Set(contactos.map((c) => clave(c.phoneNumberId, c.waId)));
      for (const a of (asig ?? []) as Array<{ phone_number_id: string; telefono_cliente: string; miembro_id: number | null }>) {
        const k = clave(a.phone_number_id, a.telefono_cliente);
        const n = a.miembro_id !== null ? nombre.get(a.miembro_id) : undefined;
        if (buscados.has(k) && n) out.set(k, n);
      }
      return out;
    },
    async fotos(tenantId, references) {
      const out = new Map<string, string | null>();
      for (const p of await repo.getProductsByReferences(tenantId, [...references].slice(0, 300))) out.set(p.reference, p.primaryImage?.thumbUrl ?? null);
      return out;
    },
  };
}
