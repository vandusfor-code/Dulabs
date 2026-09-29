/**
 * Bloque 33 — acceso a datos del módulo Clientes. Supabase (RPC de listado + consultas acotadas por
 * negocio) y memoria (pruebas; misma semántica que la función SQL). Siempre filtra por negocio.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderChannel } from "@/lib/catalogo/pedidos/contrato";
import type { CustomerChannelOrigin } from "@/lib/agente/clasificacion";
import type { ClienteFila, FiltroClientes, NotaCliente, PedidoDeCliente } from "@/lib/catalogo/clientes/modelo";

export interface ClientesRepo {
  listar(tenantId: string, q: { q: string | null; filtro: FiltroClientes; limite: number; offset: number }): Promise<{ total: number; filas: ClienteFila[] }>;
  pedidos(tenantId: string, phoneNumberId: string, waId: string, limite?: number): Promise<PedidoDeCliente[]>;
  nota(tenantId: string, phoneNumberId: string, waId: string): Promise<NotaCliente | null>;
  notas(tenantId: string, claves: ReadonlyArray<{ phoneNumberId: string; waId: string }>): Promise<Map<string, string>>;
  /** Compare-and-set: `version` 0 = crearla; si otra persona la cambió antes, null (conflicto). */
  guardarNota(tenantId: string, phoneNumberId: string, waId: string, texto: string, version: number, miembroId: number | null): Promise<NotaCliente | null>;
  /** Bloque 34: números de WhatsApp del negocio (donde puede escribir un cliente). */
  numerosDelNegocio(tenantId: string): Promise<string[]>;
  /** Bloque 34: nombre conocido del contacto (el mismo que usa el asistente). */
  guardarNombre(tenantId: string, phoneNumberId: string, waId: string, nombre: string): Promise<void>;
  /** Bloque 34: ficha del equipo (cliente antiguo / registrado). */
  guardarFicha(tenantId: string, phoneNumberId: string, waId: string, cambios: { yaCompro?: boolean; registrado?: boolean }, miembroId: number | null): Promise<void>;
  /** Bloque 34: ¿es cliente antiguo (ya compró fuera del bot)? */
  yaCompro(tenantId: string, phoneNumberId: string, waId: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

type FilaDb = {
  phone_number_id: string;
  wa_id: string;
  canal: OrderChannel | null;
  origen: CustomerChannelOrigin | null;
  nombre: string | null;
  pedidos: number;
  compras: number;
  total_comprado: number;
  ultimo_pedido: string | null;
  ultimo_estado: string | null;
  ultima_etapa: string | null;
  ultimo_pedido_at: string | null;
  ciudad: string | null;
  primer_contacto: string | null;
  ultimo_contacto: string | null;
  tiene_nota: boolean | null;
  ya_compro?: boolean | null;
  registrado?: boolean | null;
};

export const filaDeDb = (r: FilaDb): ClienteFila => ({
  phoneNumberId: r.phone_number_id,
  waId: r.wa_id,
  canal: r.canal,
  origen: r.origen,
  nombre: r.nombre,
  pedidos: Number(r.pedidos ?? 0),
  compras: Number(r.compras ?? 0),
  totalComprado: Number(r.total_comprado ?? 0),
  ultimoPedido: r.ultimo_pedido,
  ultimoEstado: r.ultimo_estado,
  ultimaEtapa: r.ultima_etapa,
  ultimoPedidoAt: r.ultimo_pedido_at,
  ciudad: r.ciudad,
  primerContacto: r.primer_contacto,
  ultimoContacto: r.ultimo_contacto,
  tieneNota: r.tiene_nota === true,
  yaCompro: r.ya_compro === true,
  registrado: r.registrado === true,
});

type NotaDb = { nota: string; version: number; actualizado_por: number | null; updated_at: string };
const notaDeDb = (r: NotaDb): NotaCliente => ({ texto: r.nota, version: r.version, actualizadoPor: r.actualizado_por === null ? null : Number(r.actualizado_por), actualizadoAt: r.updated_at });

const fail = (op: string, error: { code?: string; message?: string }) => {
  throw new Error(`[catalogo/clientes] ${op}: ${error.code ?? "?"}`);
};

export function createSupabaseClientesRepo(supabase: SupabaseClient): ClientesRepo {
  const notas = () => supabase.from("dulabs_catalogo_clientes_notas");
  return {
    async listar(tenantId, q) {
      const { data, error } = await supabase.rpc("dulabs_catalogo_clientes_listar", { p_tenant: tenantId, p_q: q.q, p_filtro: q.filtro, p_limite: q.limite, p_offset: q.offset });
      if (error) fail("listar", error);
      const r = (data ?? {}) as { total?: number; filas?: FilaDb[] };
      return { total: Number(r.total ?? 0), filas: (r.filas ?? []).map(filaDeDb) };
    },

    async pedidos(tenantId, phoneNumberId, waId, limite = 50) {
      const { data, error } = await supabase
        .from("dulabs_catalogo_pedidos")
        .select("pedido_publico, estado, etapa, estado_pago, canal, total, tipo_entrega, ciudad, created_at, confirmado_at")
        .eq("id_tenant", tenantId)
        .eq("contacto_phone_number_id", phoneNumberId)
        .eq("contacto_wa_id", waId)
        .not("estado", "in", "(draft,validated)")
        .order("created_at", { ascending: false })
        .limit(Math.min(Math.max(limite, 1), 200));
      if (error) fail("pedidos", error);
      return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        pedido: String(r.pedido_publico),
        estado: String(r.estado),
        etapa: (r.etapa as string | null) ?? null,
        estadoPago: (r.estado_pago as string | null) ?? null,
        canal: r.canal as OrderChannel,
        total: Number(r.total ?? 0),
        entrega: (r.tipo_entrega as string | null) ?? null,
        ciudad: (r.ciudad as string | null) ?? null,
        creado: String(r.created_at),
        confirmado: (r.confirmado_at as string | null) ?? null,
      }));
    },

    async nota(tenantId, phoneNumberId, waId) {
      const { data, error } = await notas().select("nota, version, actualizado_por, updated_at").eq("id_tenant", tenantId).eq("phone_number_id", phoneNumberId).eq("wa_id", waId).maybeSingle();
      if (error) fail("nota", error);
      return data ? notaDeDb(data as NotaDb) : null;
    },

    async notas(tenantId, claves) {
      const out = new Map<string, string>();
      const was = [...new Set(claves.map((c) => c.waId))];
      for (let i = 0; i < was.length; i += 500) {
        const { data, error } = await notas().select("phone_number_id, wa_id, nota").eq("id_tenant", tenantId).in("wa_id", was.slice(i, i + 500));
        if (error) fail("notas", error);
        for (const r of (data ?? []) as Array<{ phone_number_id: string; wa_id: string; nota: string }>) out.set(`${r.phone_number_id}_${r.wa_id}`, r.nota);
      }
      return out;
    },

    async numerosDelNegocio(tenantId) {
      const { data, error } = await supabase.from("dulabs_clientes_config").select("phone_number_id").eq("id_tenant", tenantId);
      if (error) fail("numeros", error);
      return ((data ?? []) as Array<{ phone_number_id: string | null }>).map((r) => r.phone_number_id).filter((x): x is string => !!x);
    },

    async guardarNombre(tenantId, phoneNumberId, waId, nombre) {
      const { error } = await supabase
        .from("dulabs_clientes_conocidos")
        .upsert({ id_tenant: tenantId, phone_number_id: phoneNumberId, telefono_cliente: waId, nombre, updated_at: new Date().toISOString() }, { onConflict: "phone_number_id,telefono_cliente" });
      if (error) fail("guardar nombre", error);
    },

    async guardarFicha(tenantId, phoneNumberId, waId, cambios, miembroId) {
      const { data, error } = await supabase.from("dulabs_catalogo_clientes_ficha").select("ya_compro, registrado").eq("id_tenant", tenantId).eq("phone_number_id", phoneNumberId).eq("wa_id", waId).maybeSingle();
      if (error) fail("leer ficha", error);
      const actual = (data ?? { ya_compro: false, registrado: false }) as { ya_compro: boolean; registrado: boolean };
      const { error: e2 } = await supabase.from("dulabs_catalogo_clientes_ficha").upsert(
        {
          id_tenant: tenantId,
          phone_number_id: phoneNumberId,
          wa_id: waId,
          ya_compro: cambios.yaCompro ?? actual.ya_compro,
          registrado: cambios.registrado ?? actual.registrado,
          actualizado_por: miembroId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id_tenant,phone_number_id,wa_id" },
      );
      if (e2) fail("guardar ficha", e2);
    },

    async yaCompro(tenantId, phoneNumberId, waId) {
      const { data, error } = await supabase.from("dulabs_catalogo_clientes_ficha").select("ya_compro").eq("id_tenant", tenantId).eq("phone_number_id", phoneNumberId).eq("wa_id", waId).maybeSingle();
      if (error) fail("ya compro", error);
      return (data as { ya_compro?: boolean } | null)?.ya_compro === true;
    },

    async guardarNota(tenantId, phoneNumberId, waId, texto, version, miembroId) {
      if (version === 0) {
        const { data, error } = await notas()
          .insert({ id_tenant: tenantId, phone_number_id: phoneNumberId, wa_id: waId, nota: texto, version: 1, actualizado_por: miembroId })
          .select("nota, version, actualizado_por, updated_at")
          .maybeSingle();
        if (error) {
          if (error.code === "23505") return null; // otra persona la creó primero
          fail("crear nota", error);
        }
        return data ? notaDeDb(data as NotaDb) : null;
      }
      const { data, error } = await notas()
        .update({ nota: texto, version: version + 1, actualizado_por: miembroId, updated_at: new Date().toISOString() })
        .eq("id_tenant", tenantId)
        .eq("phone_number_id", phoneNumberId)
        .eq("wa_id", waId)
        .eq("version", version)
        .select("nota, version, actualizado_por, updated_at")
        .maybeSingle();
      if (error) fail("guardar nota", error);
      return data ? notaDeDb(data as NotaDb) : null;
    },
  };
}

// ---------------------------------------------------------------------------
// Memoria (pruebas): misma semántica que dulabs_catalogo_clientes_listar
// ---------------------------------------------------------------------------

export interface PedidoMem {
  tenantId: string;
  pedido: string;
  phoneNumberId: string | null;
  waId: string | null;
  estado: string;
  etapa?: string | null;
  estadoPago?: string | null;
  canal: OrderChannel;
  total: number;
  nombre?: string | null;
  ciudad?: string | null;
  entrega?: string | null;
  creado: string;
  actualizado?: string;
  confirmado?: string | null;
}

export function createMemoryClientesRepo(now: () => number = Date.now) {
  const canales: Array<{ tenantId: string; phoneNumberId: string; waId: string; canal: OrderChannel; origen: CustomerChannelOrigin; creado: string; actualizado: string }> = [];
  const pedidos: PedidoMem[] = [];
  const conocidos: Array<{ tenantId: string; phoneNumberId: string; waId: string; nombre: string }> = [];
  const mensajes: Array<{ phoneNumberId: string; waId: string; at: string }> = [];
  const notas = new Map<string, NotaDb & { tenantId: string }>();
  const fichas = new Map<string, { yaCompro: boolean; registrado: boolean; actualizadoPor: number | null }>();
  const numeros: Record<string, string[]> = {};
  const k = (t: string, pn: string, wa: string) => `${t}|${pn}|${wa}`;
  const max = (...xs: Array<string | null | undefined>) => xs.filter((x): x is string => !!x).sort().at(-1) ?? null;
  const min = (...xs: Array<string | null | undefined>) => xs.filter((x): x is string => !!x).sort()[0] ?? null;

  function filas(tenantId: string): ClienteFila[] {
    const contactos = new Map<string, { pn: string; wa: string }>();
    for (const c of canales) if (c.tenantId === tenantId) contactos.set(`${c.phoneNumberId}|${c.waId}`, { pn: c.phoneNumberId, wa: c.waId });
    for (const p of pedidos) if (p.tenantId === tenantId && p.waId && p.phoneNumberId) contactos.set(`${p.phoneNumberId}|${p.waId}`, { pn: p.phoneNumberId, wa: p.waId });
    for (const key of fichas.keys()) {
      const [t, pn, wa] = key.split("|");
      if (t === tenantId) contactos.set(`${pn}|${wa}`, { pn, wa });
    }
    return [...contactos.values()].map(({ pn, wa }) => {
      const cc = canales.find((c) => c.tenantId === tenantId && c.phoneNumberId === pn && c.waId === wa) ?? null;
      const ps = pedidos.filter((p) => p.tenantId === tenantId && p.phoneNumberId === pn && p.waId === wa).sort((a, b) => b.creado.localeCompare(a.creado));
      const compras = ps.filter((p) => p.estado === "confirmed" || p.estado === "completed");
      const ult = ps.find((p) => p.estado !== "draft" && p.estado !== "validated") ?? null;
      const nota = notas.get(k(tenantId, pn, wa));
      return {
        phoneNumberId: pn,
        waId: wa,
        canal: cc?.canal ?? ult?.canal ?? null,
        origen: cc?.origen ?? null,
        nombre: conocidos.find((c) => c.tenantId === tenantId && c.phoneNumberId === pn && c.waId === wa)?.nombre ?? ps.find((p) => p.nombre)?.nombre ?? null,
        pedidos: ps.filter((p) => p.confirmado).length,
        compras: compras.length,
        totalComprado: compras.reduce((s, p) => s + p.total, 0),
        ultimoPedido: ult?.pedido ?? null,
        ultimoEstado: ult?.estado ?? null,
        ultimaEtapa: ult?.etapa ?? null,
        ultimoPedidoAt: ult?.creado ?? null,
        ciudad: ps.find((p) => p.ciudad)?.ciudad ?? null,
        primerContacto: min(cc?.creado, ps.at(-1)?.creado),
        ultimoContacto: max(...mensajes.filter((m) => m.phoneNumberId === pn && m.waId === wa).map((m) => m.at), ...ps.map((p) => p.actualizado ?? p.creado), cc?.actualizado),
        tieneNota: !!nota && nota.nota !== "",
        yaCompro: fichas.get(k(tenantId, pn, wa))?.yaCompro ?? false,
        registrado: fichas.get(k(tenantId, pn, wa))?.registrado ?? false,
      };
    });
  }

  const repo: ClientesRepo = {
    async listar(tenantId, q) {
      const texto = q.q?.trim().toLowerCase() ?? "";
      const digitos = (q.q ?? "").replace(/\D/g, "");
      const out = filas(tenantId).filter(
        (f) =>
          (q.filtro === "todos" ||
            (q.filtro === "detal" && f.canal === "retail") ||
            (q.filtro === "mayorista" && f.canal === "wholesale") ||
            (q.filtro === "compraron" && (f.compras > 0 || f.yaCompro)) ||
            (q.filtro === "sin_compras" && f.compras === 0 && !f.yaCompro) ||
            (q.filtro === "registrados" && f.registrado)) &&
          (!texto || (f.nombre ?? "").toLowerCase().includes(texto) || (digitos !== "" && f.waId.includes(digitos))),
      );
      out.sort((a, b) => (b.ultimoContacto ?? "").localeCompare(a.ultimoContacto ?? "") || a.waId.localeCompare(b.waId));
      return { total: out.length, filas: out.slice(q.offset, q.offset + q.limite) };
    },
    async pedidos(tenantId, pn, wa) {
      return pedidos
        .filter((p) => p.tenantId === tenantId && p.phoneNumberId === pn && p.waId === wa && p.estado !== "draft" && p.estado !== "validated")
        .sort((a, b) => b.creado.localeCompare(a.creado))
        .map((p) => ({ pedido: p.pedido, estado: p.estado, etapa: p.etapa ?? null, estadoPago: p.estadoPago ?? null, canal: p.canal, total: p.total, entrega: p.entrega ?? null, ciudad: p.ciudad ?? null, creado: p.creado, confirmado: p.confirmado ?? null }));
    },
    async nota(tenantId, pn, wa) {
      const n = notas.get(k(tenantId, pn, wa));
      return n ? notaDeDb(n) : null;
    },
    async notas(tenantId, claves) {
      const out = new Map<string, string>();
      for (const c of claves) {
        const n = notas.get(k(tenantId, c.phoneNumberId, c.waId));
        if (n) out.set(`${c.phoneNumberId}_${c.waId}`, n.nota);
      }
      return out;
    },
    async numerosDelNegocio(tenantId) {
      return numeros[tenantId] ?? [];
    },
    async guardarNombre(tenantId, pn, wa, nombre) {
      const i = conocidos.findIndex((c) => c.phoneNumberId === pn && c.waId === wa);
      if (i >= 0) conocidos[i] = { tenantId, phoneNumberId: pn, waId: wa, nombre };
      else conocidos.push({ tenantId, phoneNumberId: pn, waId: wa, nombre });
    },
    async guardarFicha(tenantId, pn, wa, cambios, miembroId) {
      const actual = fichas.get(k(tenantId, pn, wa)) ?? { yaCompro: false, registrado: false, actualizadoPor: null };
      fichas.set(k(tenantId, pn, wa), { yaCompro: cambios.yaCompro ?? actual.yaCompro, registrado: cambios.registrado ?? actual.registrado, actualizadoPor: miembroId });
    },
    async yaCompro(tenantId, pn, wa) {
      return fichas.get(k(tenantId, pn, wa))?.yaCompro === true;
    },
    async guardarNota(tenantId, pn, wa, texto, version, miembroId) {
      const actual = notas.get(k(tenantId, pn, wa));
      if ((actual?.version ?? 0) !== version) return null;
      const n = { tenantId, nota: texto, version: version + 1, actualizado_por: miembroId, updated_at: new Date(now()).toISOString() };
      notas.set(k(tenantId, pn, wa), n);
      return notaDeDb(n);
    },
  };
  return { repo, canales, pedidos, conocidos, mensajes, notas, fichas, numeros };
}
