/**
 * HERRAMIENTAS DEL AGENTE — la ÚNICA interfaz entre el modelo y el backend.
 *
 * Reutiliza las herramientas de la Fase 7 (lib/catalogo/pedidos/herramientas.ts:
 * esquemas estrictos, alcance de tenant/canal/conversación, salidas validadas,
 * errores deterministas) y agrega las que dependen de la conversación
 * (carrito, contexto del cliente, fotos), con GUARDAS deterministas:
 *
 *   - Procedencia: al carrito o a las fotos solo entran referencias que el
 *     cliente escribió o que una herramienta devolvió en esta conversación.
 *   - Elección obligatoria: si una consulta de ESTE turno devolvió varias
 *     opciones, ninguna se puede agregar en el mismo turno (el cliente aún no
 *     eligió): "Encontré varias opciones… ¿cuál?".
 *   - Confirmación ligada: confirm_order exige la propuesta vigente, ya
 *     mostrada al cliente en un turno ANTERIOR, con su confirmation_id.
 *   - Selección del cliente: con varias opciones ya mostradas, solo entra al
 *     carrito la que el cliente SEÑALÓ (foto citada, posición, referencia o
 *     nombre inequívoco; ver lib/agente/seleccion.ts). "Quiero este" sin más
 *     => CHOICE_REQUIRED y el agente pregunta.
 *   - Productos inactivos o agotados no entran al carrito.
 *   - El carrito guarda referencias y cantidades; precios, subtotales, total
 *     y stock los calcula SIEMPRE el motor (engine.evaluate) al consultarlo.
 *   - Enlaces (catálogo) y fotos los arma el backend con la publicación del
 *     negocio: el modelo nunca escribe ni recibe una URL de Storage.
 *
 * Nunca lanza: cada llamada termina en { ok, data } o { ok:false, error }.
 */
import { z } from "zod";
import type { AIToolDeclaration } from "@/lib/ia-proveedores/contrato";
import { formatCop } from "@/lib/business-agent-quote";
import { ORDER_MAX_QUANTITY } from "@/lib/catalogo/pedido";
import { REFERENCE_PATTERN } from "@/lib/catalogo/domain";
import { productPathIn, retailPath, wholesalePath, whatsappImagePath } from "@/lib/catalogo/publicacion";
import { createResolucionCatalogo } from "@/lib/catalogo/resolucion";
import { siteUrl } from "@/lib/site-url";
import type { OrderChannel } from "@/lib/catalogo/pedidos/contrato";
import { productView, runAgentTool, type AgentToolDeps as CatalogToolDeps } from "@/lib/catalogo/pedidos/herramientas";
import { OrderError, conversationKey, requestFingerprint, type OrderErrorCode } from "@/lib/catalogo/pedidos/motor";
import { MAX_CART_LINES, MAX_SHOWN, isKnownReference, rememberReferences, type ConversationState } from "@/lib/agente/estado";
import { AGENT_TOOL_NAMES, type AgentToolName } from "@/lib/agente/nombres-herramientas";
import { isExplicitConfirmation } from "@/lib/agente/etapa";
import { HANDOFF_MOTIVES, type HandoffMotive } from "@/lib/agente/intencion";

export type AgentToolErrorCode =
  | OrderErrorCode
  | "TOOL_NOT_ALLOWED"
  | "REFERENCE_NOT_ALLOWED"
  | "CHOICE_REQUIRED"
  | "CONFIRMATION_NOT_PRESENTED"
  | "CONFIRMATION_NOT_EXPLICIT"
  | "CART_EMPTY"
  | "TOOL_LIMIT";

export type AgentToolOutcome = { ok: true; data: Record<string, unknown> } | { ok: false; error: { code: AgentToolErrorCode; message: string; details?: Record<string, unknown> } };

/** Foto que el BACKEND decidió enviar (el modelo nunca ve ni escribe URLs). */
export interface QueuedImage {
  reference: string;
  /** Id interno del producto (registro de fotos enviadas); nunca se envía ni se muestra. */
  productId: string | null;
  /** URL pública JPEG (/catalogo/{slug}/productos/{ref}/whatsapp.jpg): sin ids internos. */
  url: string;
  caption: string;
}

/** Contexto de UN turno: lo arma el runtime a partir del webhook. Nada de esto viene del modelo. */
export interface AgentTurnToolContext {
  tenantId: string;
  phoneNumberId: string;
  waId: string;
  channel: OrderChannel;
  requestId: string;
  wamid: string;
  /** Turno actual (el mismo número que state.turn). */
  turn: number;
  /** Estado de la conversación; las herramientas de estado lo reemplazan en `state`. */
  state: ConversationState;
  /** Referencias con varias opciones surgidas EN ESTE TURNO (el cliente aún no las vio). */
  pendingChoice: Set<string>;
  /** Lo que el cliente señaló de forma determinista en este mensaje (o en el anterior). Ver seleccion.ts. */
  designated: Set<string>;
  /** Texto del cliente en este turno (solo para guardas deterministas, p. ej. la confirmación explícita). */
  customerText: string;
  images: QueuedImage[];
  /** true si esta llamada ejecutó un traspaso a una asesora. */
  handedOff: boolean;
  /** Motivo CERRADO del traspaso que pidió el modelo (va a la traza; el texto libre no). */
  handoffMotive: HandoffMotive | null;
  /** Pedido creado/validado en este turno cuya propuesta aún no se le mostró al cliente. */
  newProposal: { orderId: string; confirmationId: string; total: number } | null;
  /** Pedido confirmado en este turno (la etapa de salida lo refleja). */
  confirmedOrderId?: string | null;
}

export interface AgentToolsDeps extends CatalogToolDeps {
  /** Nombre conocido del cliente (dulabs_clientes_conocidos); null si no hay. */
  customerName?: (input: { tenantId: string; phoneNumberId: string; waId: string }) => Promise<string | null>;
  /** Timeout por herramienta (ms). */
  toolTimeoutMs?: number;
  /** Origen público del sitio (pruebas); por defecto NEXT_PUBLIC_SITE_URL. */
  siteUrl?: () => string;
}

const MAX_IMAGES_PER_TURN = 5;
/** Candidatos por página: pocos y claros; para ver muchos, el catálogo (get_catalog_link). */
const SEARCH_PAGE = 5;

const reference = z
  .string()
  .trim()
  .max(24)
  .transform((s) => s.toUpperCase())
  .refine((s) => REFERENCE_PATTERN.test(s), { message: "Referencia inválida (ej. DL-000184)." });
const orderId = z.string().regex(/^DL-ORD-[0-9A-HJKMNP-TV-Z]{6}$/);

interface ToolSpec<I extends z.ZodType> {
  description: string;
  input: I;
  /** read: solo consulta | state: cambia la memoria de la conversación | write: cambia pedidos o la conversación (máx. 1 por turno). */
  kind: "read" | "state" | "write";
  run(ctx: AgentTurnToolContext, input: z.output<I>, deps: AgentToolsDeps): Promise<AgentToolOutcome>;
}
const spec = <I extends z.ZodType>(s: ToolSpec<I>) => s;

const fail = (code: AgentToolErrorCode, message: string, details?: Record<string, unknown>): AgentToolOutcome => ({ ok: false, error: { code, message, ...(details ? { details } : {}) } });

function catalogCtx(ctx: AgentTurnToolContext) {
  return { tenantId: ctx.tenantId, channel: ctx.channel, conversation: { phoneNumberId: ctx.phoneNumberId, waId: ctx.waId }, requestId: ctx.requestId };
}

/** Llama una herramienta de la Fase 7 y traduce su resultado. */
async function catalog(name: Parameters<typeof runAgentTool>[0], input: unknown, ctx: AgentTurnToolContext, deps: AgentToolsDeps): Promise<AgentToolOutcome> {
  const r = await runAgentTool(name, input, catalogCtx(ctx), deps);
  return r.ok ? { ok: true, data: r.data as Record<string, unknown> } : { ok: false, error: r.error };
}

type ProductView = { reference: string; name: string; description: string | null; category: string | null; material: string | null; color: string | null; unit_price: number | null; currency: string; availability: string; max_quantity: number | null };

const compact = (p: ProductView) => ({ ...p, description: p.description ? p.description.slice(0, 200) : null });

/**
 * Registra lo que el cliente va a ver. Solo una LISTA de opciones reemplaza
 * "últimos mostrados" (la base de "el segundo"): consultar el detalle de un
 * producto no debe renumerar la lista que el cliente tiene en pantalla.
 */
function show(ctx: AgentTurnToolContext, products: Array<{ reference: string; name: string; color?: string | null; material?: string | null }>, list: boolean) {
  const refs = products.map((p) => p.reference);
  ctx.state = rememberReferences(ctx.state, refs, "tool");
  if (!list || products.length === 0) return;
  // Nombre + color/material: lo que distingue una opción de otra ("el dorado").
  const label = (p: (typeof products)[number]) => {
    const extra = [p.color, p.material].filter((x): x is string => !!x && x.trim() !== "").join(", ");
    return (extra ? `${p.name} (${extra})` : p.name).slice(0, 160);
  };
  ctx.state = { ...ctx.state, lastShown: products.slice(0, MAX_SHOWN).map((p) => ({ reference: p.reference, name: label(p) })) };
  if (refs.length > 1) {
    for (const r of refs) ctx.pendingChoice.add(r);
    ctx.state = { ...ctx.state, ambiguity: { references: refs.slice(0, MAX_SHOWN), createdTurn: ctx.turn, presentedTurn: null } };
  }
}

/** ¿Puede esta referencia entrar al carrito / pedir fotos en este turno? */
function checkProvenance(ctx: AgentTurnToolContext, ref: string, forCart: boolean): AgentToolOutcome | null {
  if (!isKnownReference(ctx.state, ref)) {
    return fail("REFERENCE_NOT_ALLOWED", `La referencia ${ref} no ha salido en esta conversación. Búscala primero con las herramientas o pídesela al cliente.`);
  }
  if (forCart && ctx.pendingChoice.has(ref)) {
    return fail("CHOICE_REQUIRED", "Hay varias opciones y el cliente todavía no eligió. Muéstrale las opciones y pregúntale cuál quiere.");
  }
  // Opciones ya mostradas y abiertas (hasta que se muestre otra lista): solo la que el cliente señaló
  // (foto citada, posición, referencia o nombre). Cambiar la cantidad de algo ya elegido no exige señalarlo otra vez.
  const open = ctx.state.ambiguity;
  if (forCart && open && open.presentedTurn !== null && open.references.includes(ref) && !ctx.designated.has(ref) && !ctx.state.cart.some((c) => c.reference === ref)) {
    return fail("CHOICE_REQUIRED", "El cliente no indicó cuál de las opciones quiere. Pregúntale cuál (por número, referencia, o que responda a la foto).");
  }
  return null;
}

/** Enlaces públicos del catálogo del negocio (null si no está publicado o el módulo está apagado). */
async function publication(ctx: AgentTurnToolContext, deps: AgentToolsDeps) {
  const [pub, enabled] = await Promise.all([deps.catalog.getPublication(ctx.tenantId), deps.catalog.isModuleEnabled(ctx.tenantId)]);
  if (!pub || !pub.published || !enabled) return null;
  const origin = (deps.siteUrl ?? siteUrl)().replace(/\/+$/, "");
  const base = ctx.channel === "wholesale" ? wholesalePath(pub.slug, pub.wholesaleToken) : retailPath(pub.slug);
  return { slug: pub.slug, origin, base };
}

async function evaluateCart(ctx: AgentTurnToolContext, deps: AgentToolsDeps) {
  const ev = await deps.engine.evaluate(ctx.tenantId, ctx.channel, ctx.state.cart);
  return {
    lines: ev.lines.map((l) => ({ reference: l.reference, product_name: l.productName, quantity: l.quantity, unit_price: l.unitPrice, subtotal: l.subtotal })),
    total_units: ev.totalUnits,
    total: ev.total,
    unpriced_units: ev.unpricedUnits,
    currency: "COP",
    issues: ev.issues.map((i) => ({ code: i.code, message: i.message })),
  };
}

type SearchCursor = Omit<NonNullable<ConversationState["lastSearch"]>, "offset" | "total" | "relaxed">;

/** Palabras que describen un producto para buscar "parecidos" (nombre + color + material). */
function similarQuery(p: { name: string; color: string | null; material: string | null }): string {
  return [p.name, p.color, p.material].filter(Boolean).join(" ").slice(0, 120);
}

/**
 * Una página de resultados (búsqueda o parecidos) con el precio del canal. El cursor queda
 * en el estado (lo usa more_products). Los "parecidos" comparten categoría con el producto
 * base (si la tiene) y lo excluyen; si en su categoría no hay nada, se busca en todo el catálogo.
 */
async function searchPage(ctx: AgentTurnToolContext, deps: AgentToolsDeps, cursor: SearchCursor, offset: number): Promise<AgentToolOutcome> {
  // Defensa en profundidad (igual que las herramientas de la Fase 7): el número debe ser de este negocio.
  if (!(await deps.catalog.isModuleEnabled(ctx.tenantId))) return fail("FORBIDDEN", "El catálogo no está habilitado para este negocio.");
  if (!(await deps.ownsPhoneNumber(ctx.tenantId, ctx.phoneNumberId))) return fail("FORBIDDEN", "Esta conversación no pertenece a este negocio.");
  const resolucion = createResolucionCatalogo({ repo: deps.catalog });
  const input = { query: cursor.query, channel: ctx.channel, offset, limit: SEARCH_PAGE, category: cursor.category, color: cursor.color, material: cursor.material, maxPrice: cursor.maxPrice };
  let r;
  if (cursor.similarTo) {
    const base = await deps.catalog.getProductByReference(ctx.tenantId, cursor.similarTo);
    const similar = { ...input, mode: "any" as const, exclude: [cursor.similarTo] };
    r = await resolucion.buscarCatalogo(ctx.tenantId, { ...similar, categoryId: base?.categoryId ?? null });
    if (r.total === 0 && base?.categoryId) r = await resolucion.buscarCatalogo(ctx.tenantId, similar);
  } else {
    r = await resolucion.buscarCatalogo(ctx.tenantId, input);
  }
  const candidates = r.candidates.map((p) => compact(productView(p, ctx.channel) as ProductView));
  show(ctx, candidates, true);
  ctx.state = { ...ctx.state, lastSearch: { ...cursor, offset, total: r.total, relaxed: r.relaxed } };
  const hasMore = offset + candidates.length < r.total;
  const note =
    candidates.length === 0
      ? "Sin coincidencias en el catálogo. Dilo con claridad y pide más detalles u ofrece el catálogo (get_catalog_link)."
      : r.relaxed
        ? "No hubo coincidencia con TODAS las palabras: estos son los más cercanos. Dilo así; el cliente debe elegir."
        : "Candidatos: el cliente debe elegir.";
  return {
    ok: true,
    data: { status: "candidates", count: candidates.length, total: r.total, page_start: offset + 1, has_more: hasMore, relaxed: r.relaxed, candidates, note },
  };
}

// ---------------------------------------------------------------------------

export const AGENT_TOOLS = {
  search_products: spec({
    description:
      "Busca productos ACTIVOS del catálogo (nombre, color, material, categoría o descripción; sin importar tildes ni plurales) y, opcionalmente, filtra por categoría, color, material y precio máximo. Devuelve una PÁGINA de candidatos (máx. 5) y el total; nunca una elección: si hay varios, preséntalos numerados y pregunta cuál quiere el cliente.",
    input: z
      .object({
        query: z.string().trim().min(1).max(80),
        category: z.string().trim().max(60).optional(),
        color: z.string().trim().max(60).optional(),
        material: z.string().trim().max(60).optional(),
        max_price: z.number().int().min(1).max(100_000_000).optional(),
      })
      .strict(),
    kind: "read",
    async run(ctx, input, deps) {
      const cursor = { query: input.query, category: input.category ?? null, color: input.color ?? null, material: input.material ?? null, maxPrice: input.max_price ?? null, similarTo: null };
      return searchPage(ctx, deps, cursor, 0);
    },
  }),

  more_products: spec({
    description:
      "Muestra la SIGUIENTE página de la última búsqueda o de los parecidos (\"muéstrame más\", \"quiero ver otros\", \"¿qué más tienes?\"). No recibe parámetros: el sistema recuerda qué se buscó y qué ya se mostró.",
    input: z.object({}).strict(),
    kind: "read",
    async run(ctx, _input, deps) {
      const last = ctx.state.lastSearch;
      if (!last) return fail("NOT_FOUND", "No hay una búsqueda anterior en esta conversación. Pregúntale al cliente qué busca.");
      const next = last.offset + SEARCH_PAGE;
      if (next >= last.total) {
        return { ok: true, data: { status: "candidates", count: 0, total: last.total, has_more: false, candidates: [], note: "Ya se mostraron todos los resultados de esta búsqueda. Ofrece el catálogo completo (get_catalog_link) o pregunta por otra cosa." } };
      }
      return searchPage(ctx, deps, last, next);
    },
  }),

  similar_products: spec({
    description:
      "Productos PARECIDOS a uno ya mostrado en la conversación (misma categoría y nombre/color/material cercanos), excluyendo ese producto. Úsalo para \"¿tienes algo parecido?\" o \"otro como este\".",
    input: z.object({ reference }).strict(),
    kind: "read",
    async run(ctx, input, deps) {
      const blocked = checkProvenance(ctx, input.reference, false);
      if (blocked) return blocked;
      const base = await deps.catalog.getProductByReference(ctx.tenantId, input.reference);
      if (!base) return fail("REFERENCE_NOT_FOUND", `No encontramos la referencia ${input.reference}.`);
      return searchPage(ctx, deps, { query: similarQuery(base), category: null, color: null, material: null, maxPrice: null, similarTo: input.reference }, 0);
    },
  }),

  resolve_product_by_reference: spec({
    description: "Consulta UN producto por su referencia exacta (ej. DL-000184): nombre, precio del canal y disponibilidad.",
    input: z.object({ reference }).strict(),
    kind: "read",
    async run(ctx, input, deps) {
      const r = await catalog("get_product_by_reference", { reference: input.reference }, ctx, deps);
      if (!r.ok) return r;
      const product = compact(r.data.product as ProductView);
      show(ctx, [product], false);
      return { ok: true, data: { status: "found", product } };
    },
  }),

  resolve_product_by_attributes: spec({
    description:
      "Identifica UN producto por nombre exacto (y opcionalmente color, material, categoría). Si hay varios devuelve CHOICE_REQUIRED/AMBIGUOUS con las opciones: pregúntale al cliente, nunca elijas.",
    input: z
      .object({
        name: z.string().trim().min(1).max(120),
        color: z.string().trim().max(60).optional(),
        material: z.string().trim().max(60).optional(),
        category: z.string().trim().max(60).optional(),
      })
      .strict(),
    kind: "read",
    async run(ctx, input, deps) {
      const r = await catalog("resolve_product", input, ctx, deps);
      if (!r.ok) {
        const candidates = (r.error.details?.candidates as Array<{ reference: string; name: string; color?: string | null; material?: string | null }> | undefined) ?? [];
        if (r.error.code === "AMBIGUOUS" && candidates.length > 0) show(ctx, candidates, true);
        return r;
      }
      const product = compact(r.data.product as ProductView);
      show(ctx, [product], false);
      return { ok: true, data: { status: "found", product } };
    },
  }),

  get_product_details: spec({
    description: "Detalle de un producto por referencia y su disponibilidad actual. Si envías la cantidad deseada, dice si alcanza (can_fulfill). La cantidad exacta solo se muestra cuando es pequeña.",
    input: z.object({ reference, quantity: z.number().int().min(1).max(ORDER_MAX_QUANTITY).optional() }).strict(),
    kind: "read",
    async run(ctx, input, deps) {
      const p = await catalog("get_product_by_reference", { reference: input.reference }, ctx, deps);
      if (!p.ok) return p;
      const a = await catalog("get_product_availability", { reference: input.reference, ...(input.quantity ? { quantity: input.quantity } : {}) }, ctx, deps);
      if (!a.ok) return a;
      const product = compact(p.data.product as ProductView);
      show(ctx, [product], false);
      return { ok: true, data: { status: "found", product, availability: a.data } };
    },
  }),

  get_cart: spec({
    description: "Muestra la selección actual de la conversación con precios, subtotales, total y problemas calculados por el sistema.",
    input: z.object({}).strict(),
    kind: "read",
    async run(ctx, _input, deps) {
      if (ctx.state.cart.length === 0) return { ok: true, data: { lines: [], total: 0, total_units: 0, unpriced_units: 0, currency: "COP", issues: [], empty: true } };
      return { ok: true, data: { ...(await evaluateCart(ctx, deps)), empty: false } };
    },
  }),

  update_cart: spec({
    description:
      "Agrega, cambia o quita productos de la selección: cantidad 0 = quitar. Solo referencias que el cliente eligió (escritas por él o mostradas antes por las herramientas). Devuelve la selección con los totales del sistema.",
    input: z
      .object({ items: z.array(z.object({ reference, quantity: z.number().int().min(0).max(ORDER_MAX_QUANTITY) }).strict()).min(1).max(10) })
      .strict(),
    kind: "state",
    async run(ctx, input, deps) {
      const additions = input.items.filter((i) => i.quantity > 0).map((i) => i.reference);
      for (const ref of additions) {
        const blocked = checkProvenance(ctx, ref, true);
        if (blocked) return blocked;
      }
      // La referencia debe existir en ESTE negocio (una de otro negocio simplemente no existe), activa y con stock.
      if (additions.length > 0) {
        const lote = await createResolucionCatalogo({ repo: deps.catalog }).resolverReferencias(ctx.tenantId, additions);
        if (lote.unknown.length > 0 || lote.invalid.length > 0) {
          const ref = lote.unknown[0] ?? String(lote.invalid[0]);
          return fail("REFERENCE_NOT_FOUND", `No encontramos la referencia ${ref}.`);
        }
        for (const p of lote.items) {
          if (p.status !== "ACTIVE") return fail("PRODUCT_UNAVAILABLE", `${p.name} (${p.reference}) ya no está disponible.`, { reference: p.reference });
          if (p.availability === "sold_out") return fail("OUT_OF_STOCK", `${p.name} (${p.reference}) está agotado.`, { reference: p.reference });
        }
      }
      const cart = [...ctx.state.cart];
      for (const item of input.items) {
        const i = cart.findIndex((c) => c.reference === item.reference);
        if (item.quantity === 0) {
          if (i >= 0) cart.splice(i, 1);
        } else if (i >= 0) cart[i] = { reference: item.reference, quantity: item.quantity };
        else cart.push({ reference: item.reference, quantity: item.quantity });
      }
      if (cart.length > MAX_CART_LINES) return fail("INVALID_INPUT", `La selección admite máximo ${MAX_CART_LINES} productos distintos.`);
      // La lista sigue abierta: "quiero este" más adelante también debe señalar cuál.
      ctx.state = { ...ctx.state, cart };
      return { ok: true, data: { ...(await evaluateCart(ctx, deps)), empty: cart.length === 0 } };
    },
  }),

  resolve_order: spec({
    description: "Revisa la selección contra el catálogo actual SIN crear pedido: precios vigentes, stock, productos activos, total y si está lista para solicitar.",
    input: z.object({}).strict(),
    kind: "read",
    async run(ctx, _input, deps) {
      if (ctx.state.cart.length === 0) return fail("CART_EMPTY", "La selección está vacía.");
      const view = await evaluateCart(ctx, deps);
      return { ok: true, data: { ...view, ready: view.issues.length === 0 && view.lines.length > 0 } };
    },
  }),

  create_order_request: spec({
    description:
      "Crea la solicitud de pedido con la selección actual. El sistema valida todo y, si está bien, devuelve una PROPUESTA (confirmation.id + total) que debes mostrarle al cliente para que la acepte en su próximo mensaje.",
    input: z.object({}).strict(),
    kind: "write",
    async run(ctx, _input, deps) {
      if (ctx.state.cart.length === 0) return fail("CART_EMPTY", "La selección está vacía.");
      const contact = { phoneNumberId: ctx.phoneNumberId, waId: ctx.waId };
      try {
        const r = await deps.engine.createOrder({
          tenantId: ctx.tenantId,
          channel: ctx.channel,
          source: "agent",
          contact,
          items: ctx.state.cart,
          // Idempotente por mensaje + contenido: un reintento del mismo mensaje no crea otro pedido.
          idempotencyKey: conversationKey("agent", contact, `${ctx.wamid}|${requestFingerprint(ctx.channel, ctx.state.cart)}`),
          requestId: ctx.requestId,
        });
        const o = r.order;
        ctx.state = { ...ctx.state, activeOrderId: o.orderId };
        if (o.status === "pending_confirmation" && o.confirmation) {
          ctx.newProposal = { orderId: o.orderId, confirmationId: o.confirmation.id, total: o.confirmation.total };
          ctx.state = { ...ctx.state, cart: [], proposal: { orderId: o.orderId, confirmationId: o.confirmation.id, presentedTurn: null } };
        }
        return {
          ok: true,
          data: {
            order_id: o.orderId,
            status: o.status,
            lines: o.lines.map((l) => ({ reference: l.reference, product_name: l.productName, quantity: l.quantity, unit_price: l.unitPrice, subtotal: l.subtotal })),
            total: o.total,
            unpriced_units: o.unpricedUnits,
            currency: "COP",
            issues: o.issues.map((i) => ({ code: i.code, message: i.message })),
            confirmation: o.confirmation ? { id: o.confirmation.id, total: o.confirmation.total, expires_at: o.confirmation.expiresAt } : null,
          },
        };
      } catch (err) {
        if (err instanceof OrderError) return fail(err.code, err.message, err.details);
        throw err;
      }
    },
  }),

  validate_order: spec({
    description: "Vuelve a validar el pedido activo (o el indicado) con el catálogo actual; si está bien, el sistema renueva la propuesta (nuevo confirmation.id).",
    input: z.object({ order_id: orderId.optional() }).strict(),
    kind: "write",
    async run(ctx, input, deps) {
      const id = input.order_id ?? ctx.state.activeOrderId;
      if (!id) return fail("NOT_FOUND", "No hay un pedido activo en esta conversación.");
      const r = await catalog("validate_order", { order_id: id }, ctx, deps);
      if (!r.ok) return r;
      const confirmation = r.data.confirmation as { id: string; total: number } | null;
      if (r.data.status === "pending_confirmation" && confirmation) {
        const same = ctx.state.proposal?.confirmationId === confirmation.id;
        ctx.state = { ...ctx.state, activeOrderId: id, proposal: { orderId: id, confirmationId: confirmation.id, presentedTurn: same ? (ctx.state.proposal?.presentedTurn ?? null) : null } };
        if (!same) ctx.newProposal = { orderId: id, confirmationId: confirmation.id, total: confirmation.total };
      } else {
        ctx.state = { ...ctx.state, activeOrderId: id, proposal: null };
      }
      return r;
    },
  }),

  confirm_order: spec({
    description:
      "Confirma la propuesta vigente. SOLO cuando el cliente, en su mensaje actual, aceptó explícitamente la propuesta que ya le mostraste (mismo pedido y total). Exige order_id y confirmation_id de esa propuesta.",
    input: z.object({ order_id: orderId, confirmation_id: z.string().regex(/^cf_[0-9a-z]{16}$/) }).strict(),
    kind: "write",
    async run(ctx, input, deps) {
      const p = ctx.state.proposal;
      if (!p || p.orderId !== input.order_id || p.confirmationId !== input.confirmation_id || p.presentedTurn === null || p.presentedTurn >= ctx.turn) {
        return fail("CONFIRMATION_NOT_PRESENTED", "Primero muéstrale al cliente la propuesta vigente (productos y total) y espera su aceptación.");
      }
      // El BACKEND decide qué significa el mensaje: solo un sí explícito, sin condiciones ni cambios, confirma.
      if (!isExplicitConfirmation(ctx.customerText)) {
        return fail("CONFIRMATION_NOT_EXPLICIT", "El cliente no aceptó la propuesta de forma explícita en este mensaje. Pregúntale si confirma el pedido tal como está (productos y total) o qué quiere cambiar.");
      }
      const r = await catalog("confirm_order", input, ctx, deps);
      if (r.ok) {
        // Pedido confirmado: se cierran la propuesta, la selección y las opciones abiertas.
        ctx.state = { ...ctx.state, proposal: null, cart: [], ambiguity: null };
        ctx.confirmedOrderId = input.order_id;
      }
      else if (["PRICE_CHANGED", "OUT_OF_STOCK", "PRODUCT_UNAVAILABLE", "CONFIRMATION_EXPIRED", "ORDER_HAS_ISSUES"].includes(r.error.code)) ctx.state = { ...ctx.state, proposal: null };
      return r;
    },
  }),

  get_customer_context: spec({
    description: "Contexto del cliente: nombre conocido, canal de precios de la conversación, selección y pedido activo (según el sistema).",
    input: z.object({}).strict(),
    kind: "read",
    async run(ctx, _input, deps) {
      const name = deps.customerName ? await deps.customerName({ tenantId: ctx.tenantId, phoneNumberId: ctx.phoneNumberId, waId: ctx.waId }).catch(() => null) : null;
      const order = await catalog("get_order", {}, ctx, deps);
      return {
        ok: true,
        data: {
          customer_name: name,
          channel: ctx.channel,
          cart_items: ctx.state.cart.length,
          active_order: order.ok ? order.data : null,
        },
      };
    },
  }),

  request_product_images: spec({
    description:
      "Pide al sistema enviar las fotos reales de productos ya mostrados en la conversación (máx. 5), en el orden en que las quieres mostrar. El sistema decide qué fotos son válidas y las envía después de tu mensaje, cada una con su nombre, referencia y precio; no escribas enlaces.",
    input: z.object({ references: z.array(reference).min(1).max(MAX_IMAGES_PER_TURN) }).strict(),
    kind: "state",
    async run(ctx, input, deps) {
      const queued: string[] = [];
      const skipped: Array<{ reference: string; reason: string }> = [];
      const refs = [...new Set(input.references)];
      const allowed = refs.filter((r) => {
        const blocked = checkProvenance(ctx, r, false);
        if (blocked) skipped.push({ reference: r, reason: "not_in_conversation" });
        return !blocked;
      });
      // Las fotos salen por la URL PÚBLICA del catálogo (JPEG, sin ids internos): sin catálogo publicado no hay fotos.
      const pub = allowed.length > 0 ? await publication(ctx, deps) : null;
      if (allowed.length > 0 && !pub) for (const r of allowed) skipped.push({ reference: r, reason: "catalog_not_published" });
      if (allowed.length > 0 && pub) {
        const lote = await createResolucionCatalogo({ repo: deps.catalog }).resolverReferencias(ctx.tenantId, allowed);
        const shown: Array<{ reference: string; name: string; color: string | null; material: string | null }> = [];
        for (const r of allowed) {
          const p = lote.items.find((x) => x.reference === r);
          if (!p) skipped.push({ reference: r, reason: "not_found" });
          else if (p.status !== "ACTIVE") skipped.push({ reference: r, reason: "unavailable" });
          else if (!p.image) skipped.push({ reference: r, reason: "no_photo" });
          else if (ctx.images.length >= MAX_IMAGES_PER_TURN) skipped.push({ reference: r, reason: "limit" });
          else if (!ctx.images.some((i) => i.reference === r)) {
            const product = await deps.catalog.getProductByReference(ctx.tenantId, r);
            const price = ctx.channel === "wholesale" ? p.prices.wholesale : p.prices.retail;
            const stock = p.availability === "sold_out" ? " · agotado" : "";
            ctx.images.push({
              reference: r,
              productId: product?.id ?? null,
              url: `${pub.origin}${whatsappImagePath(pub.slug, r, p.image.storagePath)}`,
              caption: `${p.name} · ${r} · ${price === null ? "precio a consultar" : formatCop(price)}${stock}`,
            });
            queued.push(r);
            shown.push({ reference: r, name: p.name, color: p.color, material: p.material });
          }
        }
        // Las fotos son lo último que ve el cliente: "la segunda" = la segunda foto enviada.
        if (shown.length > 1) show(ctx, shown, true);
      }
      return { ok: true, data: { queued, skipped, note: queued.length > 0 ? "El sistema enviará estas fotos después de tu mensaje." : "No hay fotos para enviar." } };
    },
  }),

  get_catalog_link: spec({
    description:
      "Devuelve el enlace OFICIAL del catálogo del negocio para el canal de esta conversación (y, si indicas una referencia ya mostrada, el de la ficha de ese producto). Úsalo cuando el cliente quiera ver todo el catálogo o elegir varios productos. Copia el enlace exacto; nunca armes uno.",
    input: z.object({ reference: reference.optional() }).strict(),
    kind: "read",
    async run(ctx, input, deps) {
      const pub = await publication(ctx, deps);
      if (!pub) return fail("UNAVAILABLE", "El catálogo en línea no está disponible en este momento.");
      if (input.reference) {
        const blocked = checkProvenance(ctx, input.reference, false);
        if (blocked) return blocked;
        const product = await deps.catalog.getProductByReference(ctx.tenantId, input.reference);
        if (!product || product.status !== "ACTIVE") return fail("PRODUCT_UNAVAILABLE", `El producto ${input.reference} no está disponible.`);
        return { ok: true, data: { url: `${pub.origin}${productPathIn(pub.base, input.reference)}`, kind: "product", reference: input.reference } };
      }
      return { ok: true, data: { url: `${pub.origin}${pub.base}`, kind: "catalog", channel: ctx.channel === "wholesale" ? "mayorista" : "detal" } };
    },
  }),

  handoff_to_human: spec({
    description:
      "Pasa la conversación (y el pedido activo, si lo indicas) a una asesora. motive: customer_request (el cliente lo pidió), order_issue (problema con el pedido), payment_or_delivery (pago, envío o entrega), complaint (reclamo), out_of_scope (algo que no puedes resolver con el catálogo), other. Después de esto no respondas más que una despedida breve.",
    input: z
      .object({
        reason: z.string().trim().min(3).max(300),
        motive: z.enum(HANDOFF_MOTIVES).optional(),
        context: z.string().trim().max(500).optional(),
        order_id: orderId.optional(),
      })
      .strict(),
    kind: "write",
    async run(ctx, input, deps) {
      const { motive, ...handoff } = input;
      const r = await catalog("handoff_to_human", handoff, ctx, deps);
      if (r.ok) {
        ctx.handedOff = true;
        ctx.handoffMotive = motive ?? "other";
      }
      return r;
    },
  }),
} as const satisfies Record<AgentToolName, ToolSpec<z.ZodType>>;

/** Declaraciones para el modelo, SOLO de las herramientas permitidas (allowlist del agente). */
export function agentToolDeclarations(allowed: readonly AgentToolName[]): AIToolDeclaration[] {
  return AGENT_TOOL_NAMES.filter((n) => allowed.includes(n)).map((name) => ({
    name,
    description: AGENT_TOOLS[name].description,
    parameters: z.toJSONSchema(AGENT_TOOLS[name].input, { io: "input" }) as Record<string, unknown>,
  }));
}

export function toolKind(name: AgentToolName): "read" | "state" | "write" {
  return AGENT_TOOLS[name].kind;
}

/**
 * Ejecuta una herramienta pedida por el modelo. El nombre debe estar en la
 * allowlist; los argumentos se validan estrictos; timeout por herramienta.
 * Nunca lanza.
 */
export async function executeAgentTool(
  name: string,
  rawArgs: unknown,
  allowed: readonly AgentToolName[],
  ctx: AgentTurnToolContext,
  deps: AgentToolsDeps,
): Promise<AgentToolOutcome> {
  if (!(allowed as readonly string[]).includes(name) || !Object.hasOwn(AGENT_TOOLS, name)) {
    return fail("TOOL_NOT_ALLOWED", "Esa herramienta no está disponible.");
  }
  const tool = AGENT_TOOLS[name as AgentToolName] as unknown as ToolSpec<z.ZodType>;
  const parsed = tool.input.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return fail("INVALID_INPUT", "Los datos de la herramienta no son válidos.", { fields: parsed.error.issues.map((i) => ({ path: i.path.join("."), code: i.code })) });
  }
  const timeoutMs = deps.toolTimeoutMs ?? 5_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      tool.run(ctx, parsed.data, deps),
      new Promise<AgentToolOutcome>((resolve) => {
        timer = setTimeout(() => resolve(fail("UNAVAILABLE", "La consulta tardó demasiado. Intenta de nuevo.")), timeoutMs);
      }),
    ]);
  } catch (err) {
    console.error(`[agente/herramientas] ${name} falló:`, err instanceof Error ? err.message : err);
    return fail("UNAVAILABLE", "No pudimos completar la operación. Intenta de nuevo.");
  } finally {
    if (timer) clearTimeout(timer);
  }
}
