/**
 * HERRAMIENTAS DEL AGENTE para catálogo y pedidos — contratos cerrados.
 *
 * Qué PUEDE hacer la IA: buscar y consultar productos por referencia,
 * consultar disponibilidad, crear/validar/consultar/confirmar un pedido de SU
 * conversación y pasar la conversación a una asesora.
 *
 * Qué NO puede (no existe forma de pedirlo): ejecutar SQL, tocar Supabase,
 * cambiar stock o precios, crear productos, elegir entre varios candidatos,
 * fijar precio/subtotal/total, negocio, canal o id de producto. Los esquemas
 * de entrada son ESTRICTOS: un campo de más (p. ej. "price", "business_id",
 * "channel", "total") => INVALID_INPUT, no se ignora en silencio.
 *
 * Alcance (lo pone el BACKEND en el contexto, nunca la IA):
 *   - tenant: el negocio dueño del número de WhatsApp que recibió el mensaje;
 *   - canal: el de la conversación (hoy detal: el mayorista solo se autoriza
 *     con el link del catálogo mayorista, y ese pedido ya trae su canal);
 *   - conversación: (phone_number_id, wa_id). Los pedidos solo se ven y se
 *     tocan desde la conversación a la que pertenecen.
 *
 * Todas responden { ok: true, data } o { ok: false, error: { code, message } }
 * con códigos deterministas (ORDER_ERROR_CODES) y mensajes aptos para el
 * cliente. Las salidas se validan con su esquema (estricto): si alguna vez
 * se colara un id interno, la respuesta falla en vez de filtrarlo.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PUBLIC_STOCK_VISIBLE, REFERENCE_PATTERN } from "@/lib/catalogo/domain";
import { ORDER_MAX_LINES, ORDER_MAX_QUANTITY } from "@/lib/catalogo/pedido";
import type { CatalogRepository } from "@/lib/catalogo/repository";
import { SEARCH_MAX, createResolucionCatalogo, type ProductoResuelto } from "@/lib/catalogo/resolucion";
import { ORDER_STATUSES, publicView, type Order, type OrderChannel } from "@/lib/catalogo/pedidos/contrato";
import { ORDER_ERROR_CODES, OrderError, conversationKey, nextStepOf, type OrderEngine, type OrderErrorCode } from "@/lib/catalogo/pedidos/motor";
import { contactRef, logOrderOperation, type OrderLogger } from "@/lib/catalogo/pedidos/log";
import type { OrderContact } from "@/lib/catalogo/pedidos/repositorio";

/** Contexto que arma el BACKEND (webhook/runtime). Nada de esto sale del modelo. */
export interface AgentToolContext {
  tenantId: string;
  channel: OrderChannel;
  conversation: OrderContact | null;
  requestId: string;
}

export interface AgentToolDeps {
  engine: OrderEngine;
  catalog: CatalogRepository;
  /** ¿Este phone_number_id es de este negocio? (defensa si un caller arma mal el contexto). */
  ownsPhoneNumber: (tenantId: string, phoneNumberId: string) => Promise<boolean>;
  log?: OrderLogger;
}

export type AgentToolResult = { ok: true; data: unknown } | { ok: false; error: { code: OrderErrorCode; message: string; details?: Record<string, unknown> } };

// ---------------------------------------------------------------------------
// Esquemas
// ---------------------------------------------------------------------------

const reference = z
  .string()
  .trim()
  .max(24)
  .transform((s) => s.toUpperCase())
  .refine((s) => REFERENCE_PATTERN.test(s), { message: "Referencia inválida (ej. DL-000184)." });
const orderId = z.string().regex(/^DL-ORD-[0-9A-HJKMNP-TV-Z]{6}$/);
const quantity = z.number().int().min(1).max(ORDER_MAX_QUANTITY);
const money = z.number().int().min(0).nullable();

const productOut = z
  .object({
    reference: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    category: z.string().nullable(),
    material: z.string().nullable(),
    color: z.string().nullable(),
    unit_price: money,
    currency: z.literal("COP"),
    availability: z.enum(["available", "low", "sold_out"]),
    /** Solo si es pequeño (stock discreto, igual que la tienda). */
    max_quantity: z.number().int().min(0).nullable(),
  })
  .strict();

const orderOut = z
  .object({
    order_id: orderId,
    channel: z.enum(["retail", "wholesale"]),
    status: z.enum(ORDER_STATUSES),
    lines: z.array(z.object({ reference: z.string(), product_name: z.string(), quantity: z.number().int(), unit_price: money, subtotal: money }).strict()),
    total_units: z.number().int().min(0),
    total: z.number().int().min(0),
    unpriced_units: z.number().int().min(0),
    currency: z.literal("COP"),
    issues: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
    confirmation: z.object({ id: z.string(), total: z.number().int(), expires_at: z.string() }).strict().nullable(),
    created_at: z.string(),
    next_step: z.enum(["confirm", "resolve_issues", "wait_human", "none"]),
  })
  .strict();

type ToolSpec<I extends z.ZodType, O extends z.ZodType> = {
  description: string;
  input: I;
  output: O;
  /** Lectura del catálogo | pedidos de la conversación | traspaso. Documenta el efecto; ninguna toca stock ni precios. */
  permission: "catalog:read" | "orders:read" | "orders:write" | "conversation:handoff";
  /** Exige una conversación (los pedidos pertenecen a una). */
  requiresConversation: boolean;
  run: (ctx: AgentToolContext & { conversation: OrderContact }, input: z.output<I>, deps: AgentToolDeps) => Promise<z.input<O>>;
};

function tool<I extends z.ZodType, O extends z.ZodType>(spec: ToolSpec<I, O>): ToolSpec<I, O> {
  return spec;
}

function discreetMax(p: ProductoResuelto): number | null {
  if (p.status !== "ACTIVE" || p.availability === "sold_out") return 0;
  return p.maxQuantity !== null && p.maxQuantity <= PUBLIC_STOCK_VISIBLE ? p.maxQuantity : null;
}

/** Vista de un producto para el agente: solo el precio del canal y el stock discreto (reutilizada por lib/agente). */
export function productView(p: ProductoResuelto, channel: OrderChannel): z.input<typeof productOut> {
  return {
    reference: p.reference,
    name: p.name,
    description: p.description,
    category: p.categoryName,
    material: p.material,
    color: p.color,
    // Solo el precio del canal de la conversación: el del otro canal nunca sale.
    unit_price: channel === "wholesale" ? p.prices.wholesale : p.prices.retail,
    currency: "COP",
    availability: p.availability,
    max_quantity: discreetMax(p),
  };
}

const orderView = (o: Order): z.input<typeof orderOut> => ({ ...publicView(o), next_step: nextStepOf(o) });

const resolucionDe = (deps: AgentToolDeps) => createResolucionCatalogo({ repo: deps.catalog });

// ---------------------------------------------------------------------------
// Registro
// ---------------------------------------------------------------------------

export const AGENT_TOOLS = {
  search_products: tool({
    description:
      "Busca productos ACTIVOS cuyo nombre o referencia contiene el texto. Devuelve CANDIDATOS (máx. 10), nunca una selección: pregunta al cliente cuál quiere y usa su referencia.",
    input: z.object({ query: z.string().trim().min(1).max(80), limit: z.number().int().min(1).max(SEARCH_MAX).optional() }).strict(),
    output: z.object({ status: z.literal("candidates"), query: z.string(), candidates: z.array(productOut) }).strict(),
    permission: "catalog:read",
    requiresConversation: false,
    async run(ctx, input, deps) {
      const r = await resolucionDe(deps).searchProducts(ctx.tenantId, input.query, input.limit);
      return { status: "candidates" as const, query: r.query, candidates: r.candidates.map((p) => productView(p, ctx.channel)) };
    },
  }),

  resolve_product: tool({
    description:
      "Identifica UN producto por nombre exacto (y opcionalmente color, material, categoría), sin tildes ni mayúsculas. Si hay varios devuelve AMBIGUOUS con candidatos: pregunta al cliente; nunca elijas tú.",
    input: z
      .object({
        name: z.string().trim().min(1).max(120),
        color: z.string().trim().max(60).optional(),
        material: z.string().trim().max(60).optional(),
        category: z.string().trim().max(60).optional(),
      })
      .strict(),
    output: z.object({ status: z.literal("found"), product: productOut }).strict(),
    permission: "catalog:read",
    requiresConversation: false,
    async run(ctx, input, deps) {
      const r = await resolucionDe(deps).resolveByExactAttributes(ctx.tenantId, input);
      if (r.status === "not_found") throw new OrderError("NOT_FOUND", r.message);
      if (r.status === "ambiguous") {
        const activos = r.candidates.filter((p) => p.status === "ACTIVE");
        if (activos.length === 1) return { status: "found" as const, product: productView(activos[0], ctx.channel) };
        if (activos.length === 0) throw new OrderError("PRODUCT_UNAVAILABLE", "Ese producto ya no está disponible.");
        throw new OrderError("AMBIGUOUS", "Hay varios productos que coinciden. Pregunta al cliente cuál quiere (por referencia, color o material).", {
          candidates: activos.map((p) => ({ reference: p.reference, name: p.name, color: p.color, material: p.material })),
        });
      }
      if (r.product.status !== "ACTIVE") throw new OrderError("PRODUCT_UNAVAILABLE", `La referencia ${r.product.reference} ya no está disponible.`);
      return { status: "found" as const, product: productView(r.product, ctx.channel) };
    },
  }),

  get_product_by_reference: tool({
    description: "Consulta un producto por su referencia EXACTA (ej. DL-000184): nombre, precio del canal y disponibilidad.",
    input: z.object({ reference }).strict(),
    output: z.object({ status: z.literal("found"), product: productOut }).strict(),
    permission: "catalog:read",
    requiresConversation: false,
    async run(ctx, input, deps) {
      const r = await resolucionDe(deps).resolveByReference(ctx.tenantId, input.reference);
      if (r.status !== "found") throw new OrderError("REFERENCE_NOT_FOUND", `No encontramos la referencia ${input.reference}.`);
      if (r.product.status !== "ACTIVE") throw new OrderError("PRODUCT_UNAVAILABLE", `La referencia ${r.product.reference} ya no está disponible.`);
      return { status: "found" as const, product: productView(r.product, ctx.channel) };
    },
  }),

  get_product_availability: tool({
    description:
      "Disponibilidad de una referencia. `quantity` es exacta solo si es pequeña (≤10); si envías la cantidad deseada, `can_fulfill` dice si alcanza. No reserva nada.",
    input: z.object({ reference, quantity: quantity.optional() }).strict(),
    output: z
      .object({
        reference: z.string(),
        available: z.boolean(),
        status: z.enum(["available", "low", "sold_out", "unavailable"]),
        quantity: z.number().int().min(0).nullable(),
        can_fulfill: z.boolean().nullable(),
      })
      .strict(),
    permission: "catalog:read",
    requiresConversation: false,
    async run(ctx, input, deps) {
      const r = await resolucionDe(deps).resolveByReference(ctx.tenantId, input.reference);
      if (r.status !== "found") throw new OrderError("REFERENCE_NOT_FOUND", `No encontramos la referencia ${input.reference}.`);
      const p = r.product;
      const status = p.status !== "ACTIVE" ? ("unavailable" as const) : p.availability;
      const available = status === "available" || status === "low";
      const canFulfill = input.quantity === undefined ? null : available && (p.maxQuantity === null || input.quantity <= p.maxQuantity);
      return { reference: p.reference, available, status, quantity: available ? discreetMax(p) : 0, can_fulfill: canFulfill };
    },
  }),

  get_order: tool({
    description: "Consulta un pedido de ESTA conversación (por order_id, o el abierto más reciente si no lo envías).",
    input: z.object({ order_id: orderId.optional() }).strict(),
    output: orderOut,
    permission: "orders:read",
    requiresConversation: true,
    async run(ctx, input, deps) {
      return orderView(await deps.engine.getOrder({ tenantId: ctx.tenantId, contact: ctx.conversation, orderId: input.order_id, requestId: ctx.requestId }));
    },
  }),

  validate_order: tool({
    description:
      "Vuelve a validar el pedido con el catálogo ACTUAL (precios, stock, productos activos). Si todo está bien, el backend emite una propuesta (confirmation.id + total) que el cliente debe aceptar; si no, devuelve los problemas.",
    input: z.object({ order_id: orderId }).strict(),
    output: orderOut,
    permission: "orders:write",
    requiresConversation: true,
    async run(ctx, input, deps) {
      return orderView(await deps.engine.validateOrder({ tenantId: ctx.tenantId, contact: ctx.conversation, orderId: input.order_id, actor: "agent", requestId: ctx.requestId }));
    },
  }),

  create_order: tool({
    description:
      "Crea un pedido de esta conversación con referencias y cantidades (1–99). El backend resuelve productos, precios, subtotales y total. `idempotency_key` evita duplicados: repite la MISMA clave al reintentar el mismo pedido.",
    input: z
      .object({
        items: z.array(z.object({ reference, quantity }).strict()).min(1).max(ORDER_MAX_LINES),
        idempotency_key: z.string().regex(/^[A-Za-z0-9_.:-]{8,64}$/),
      })
      .strict(),
    output: orderOut.extend({ created: z.boolean() }).strict(),
    permission: "orders:write",
    requiresConversation: true,
    async run(ctx, input, deps) {
      const r = await deps.engine.createOrder({
        tenantId: ctx.tenantId,
        channel: ctx.channel,
        source: "agent",
        contact: ctx.conversation,
        items: input.items,
        idempotencyKey: conversationKey("agent", ctx.conversation, input.idempotency_key),
        requestId: ctx.requestId,
      });
      return { ...orderView(r.order), created: r.created };
    },
  }),

  confirm_order: tool({
    description:
      "Confirma la propuesta vigente del pedido. Úsala SOLO cuando el cliente aceptó explícitamente ESE pedido y ESE total; exige el confirmation_id que emitió el backend. Un 'sí' suelto no basta.",
    input: z.object({ order_id: orderId, confirmation_id: z.string().regex(/^cf_[0-9a-z]{16}$/) }).strict(),
    output: orderOut,
    permission: "orders:write",
    requiresConversation: true,
    async run(ctx, input, deps) {
      return orderView(
        await deps.engine.confirmOrder({
          tenantId: ctx.tenantId,
          contact: ctx.conversation,
          orderId: input.order_id,
          confirmationId: input.confirmation_id,
          actor: "agent",
          requestId: ctx.requestId,
        }),
      );
    },
  }),

  handoff_to_human: tool({
    description: "Pasa la conversación (y el pedido, si lo indicas) a una asesora. La IA deja de responder en este chat.",
    input: z
      .object({
        reason: z.string().trim().min(3).max(300),
        context: z.string().trim().max(500).optional(),
        order_id: orderId.optional(),
      })
      .strict(),
    output: z.object({ handed_off: z.literal(true), order: orderOut.nullable() }).strict(),
    permission: "conversation:handoff",
    requiresConversation: true,
    async run(ctx, input, deps) {
      const r = await deps.engine.requestHandoff({
        tenantId: ctx.tenantId,
        contact: ctx.conversation,
        reason: input.reason,
        context: input.context ?? null,
        orderId: input.order_id,
        actor: "agent",
        requestId: ctx.requestId,
      });
      return { handed_off: true as const, order: r.order ? orderView(r.order) : null };
    },
  }),
} as const;

export type AgentToolName = keyof typeof AGENT_TOOLS;
export const AGENT_TOOL_NAMES = Object.keys(AGENT_TOOLS) as AgentToolName[];

/** Definiciones para el modelo (nombre, descripción y JSON Schema de entrada). */
export function agentToolDefinitions() {
  return AGENT_TOOL_NAMES.map((name) => ({ name, description: AGENT_TOOLS[name].description, input_schema: z.toJSONSchema(AGENT_TOOLS[name].input, { io: "input" }) }));
}

const contextSchema = z
  .object({
    tenantId: z.uuid(),
    channel: z.enum(["retail", "wholesale"]),
    conversation: z.object({ phoneNumberId: z.string().min(1).max(64), waId: z.string().regex(/^\d{6,20}$/) }).nullable(),
    requestId: z.string().min(1).max(100),
  })
  .strict();

const fallo = (code: OrderErrorCode, message: string, details?: Record<string, unknown>): AgentToolResult => ({
  ok: false,
  error: { code, message, ...(details ? { details } : {}) },
});

/**
 * Ejecuta una herramienta: contexto del backend -> alcance -> entrada estricta
 * -> ejecución -> salida validada. Nunca lanza: todo termina en un resultado.
 */
export async function runAgentTool(name: string, rawInput: unknown, ctx: AgentToolContext, deps: AgentToolDeps): Promise<AgentToolResult> {
  const log = deps.log ?? logOrderOperation;
  const started = Date.now();
  const requestId = typeof ctx?.requestId === "string" && ctx.requestId ? ctx.requestId : randomUUID();
  const finish = (result: AgentToolResult): AgentToolResult => {
    log({
      request_id: requestId,
      business_id: typeof ctx?.tenantId === "string" ? ctx.tenantId : "?",
      operation: `tool:${name.slice(0, 40)}`,
      result: result.ok ? "ok" : "error",
      duration_ms: Date.now() - started,
      ...(result.ok ? {} : { error_code: result.error.code }),
      ...(ctx?.conversation?.waId ? { contact_ref: contactRef(ctx.conversation.waId) } : {}),
    });
    return result;
  };

  if (!Object.hasOwn(AGENT_TOOLS, name)) return finish(fallo("INVALID_INPUT", `Herramienta desconocida: ${name.slice(0, 40)}.`));
  const spec = AGENT_TOOLS[name as AgentToolName] as unknown as ToolSpec<z.ZodType, z.ZodType>;

  const context = contextSchema.safeParse(ctx);
  if (!context.success) return finish(fallo("FORBIDDEN", "Contexto de la conversación inválido."));
  try {
    if (!(await deps.catalog.isModuleEnabled(ctx.tenantId))) return finish(fallo("FORBIDDEN", "El catálogo no está habilitado para este negocio."));
    if (spec.requiresConversation && !ctx.conversation) return finish(fallo("FORBIDDEN", "Esta acción solo está disponible dentro de una conversación."));
    if (ctx.conversation && !(await deps.ownsPhoneNumber(ctx.tenantId, ctx.conversation.phoneNumberId))) {
      return finish(fallo("FORBIDDEN", "La conversación no pertenece a este negocio."));
    }

    const input = spec.input.safeParse(rawInput);
    if (!input.success) {
      // Solo rutas y tipos de error: nunca se devuelven (ni registran) los valores recibidos.
      return finish(fallo("INVALID_INPUT", "Los datos de la herramienta no son válidos.", { fields: input.error.issues.map((i) => ({ path: i.path.join("."), code: i.code })) }));
    }
    const data = await spec.run(ctx as AgentToolContext & { conversation: OrderContact }, input.data, deps);
    const out = spec.output.safeParse(data);
    if (!out.success) {
      console.error(`[catalogo/herramientas] salida inválida de ${name}`);
      return finish(fallo("UNAVAILABLE", "No pudimos completar la operación."));
    }
    return finish({ ok: true, data: out.data });
  } catch (err) {
    if (err instanceof OrderError && (ORDER_ERROR_CODES as readonly string[]).includes(err.code)) return finish(fallo(err.code, err.message, err.details));
    console.error(`[catalogo/herramientas] ${name} falló:`, err instanceof Error ? err.message : err);
    return finish(fallo("UNAVAILABLE", "No pudimos completar la operación. Intenta de nuevo."));
  }
}
