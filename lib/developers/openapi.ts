// DuLabs Developer V1 -- Fase 14 (autorizado). OpenAPI 3.1 de la API PÚBLICA
// (`/api/v1/*`, auth por API key). Fuente ÚNICA de verdad de la DOCUMENTACIÓN,
// versionada en el repo. El comportamiento real sigue siendo el del gateway
// (services/gateway/*): este spec se DERIVA de esos handlers, no al revés, y un
// test de conformidad (lib/developers/openapi.conformidad.test.ts) verifica que
// no documente rutas inexistentes ni superficie interna.
//
// NO incluye /api/v1/dev/* (sesión Supabase, uso del dashboard), ni la callback
// de Meta (/api/v1/webhooks/meta), ni endpoints internos. Sin secretos.

export const OPENAPI_BASE_URL = "https://api.dulabs.co/api/v1";

// Rutas públicas documentadas (relativas a la Base URL). El test de conformidad
// las contrasta contra el ruteo real del gateway.
export const RUTAS_PUBLICAS = [
  "/messages",
  "/messages/{id}",
  "/whatsapp-numbers",
  "/whatsapp-numbers/{id}",
  "/usage",
  "/me",
  "/webhooks",
] as const;

const ERROR_RESPONSE = {
  description: "Error uniforme de la API.",
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
};

export const OPENAPI_DEVELOPER_V1 = {
  openapi: "3.1.0",
  info: {
    title: "DuLabs Developer API",
    version: "1.0.0",
    description:
      "API pública de DuLabs Developer para enviar mensajes de WhatsApp, consultar estado, gestionar números y configurar webhooks. Autenticación por API key. Meta factura los mensajes directamente al dueño de la WABA; DuLabs no cobra sobre eso.",
  },
  servers: [{ url: OPENAPI_BASE_URL, description: "Producción" }],
  security: [{ apiKey: [] }],
  tags: [
    { name: "Messages", description: "Envío y estado de mensajes." },
    { name: "Numbers", description: "Números de WhatsApp conectados (solo lectura)." },
    { name: "Webhooks", description: "Configuración del webhook de eventos entrantes." },
    { name: "Account", description: "Cuenta, uso y verificación de la API key." },
  ],
  paths: {
    "/messages": {
      post: {
        tags: ["Messages"],
        summary: "Enviar un mensaje",
        description: "Encola un mensaje de WhatsApp. Requiere la cabecera `Idempotency-Key` para reintentos seguros (sin doble envío).",
        parameters: [
          { $ref: "#/components/parameters/IdempotencyKey" },
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/SendMessageRequest" } } },
        },
        responses: {
          "201": { description: "Mensaje encolado.", content: { "application/json": { schema: { $ref: "#/components/schemas/SendMessageAccepted" } } } },
          "200": { description: "Idempotente: réplica exacta de un envío ya aceptado.", content: { "application/json": { schema: { $ref: "#/components/schemas/SendMessageDuplicate" } } } },
          "400": ERROR_RESPONSE,
          "401": ERROR_RESPONSE,
          "403": ERROR_RESPONSE,
          "409": { description: "Misma Idempotency-Key con payload distinto (`idempotency_conflict`).", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "429": { description: "Rate limit o cuota mensual agotada. Incluye `Retry-After` en rate limit.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "500": ERROR_RESPONSE,
        },
      },
    },
    "/messages/{id}": {
      get: {
        tags: ["Messages"],
        summary: "Estado de un mensaje",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" }, description: "jobId devuelto al enviar." }],
        responses: {
          "200": { description: "Estado del mensaje.", content: { "application/json": { schema: { $ref: "#/components/schemas/Message" } } } },
          "401": ERROR_RESPONSE,
          "404": ERROR_RESPONSE,
        },
      },
    },
    "/whatsapp-numbers": {
      get: {
        tags: ["Numbers"],
        summary: "Listar números conectados",
        responses: {
          "200": { description: "Números del workspace.", content: { "application/json": { schema: { $ref: "#/components/schemas/NumbersList" } } } },
          "401": ERROR_RESPONSE,
        },
      },
    },
    "/whatsapp-numbers/{id}": {
      get: {
        tags: ["Numbers"],
        summary: "Obtener un número",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": { description: "Número.", content: { "application/json": { schema: { $ref: "#/components/schemas/Number" } } } },
          "401": ERROR_RESPONSE,
          "404": ERROR_RESPONSE,
        },
      },
    },
    "/usage": {
      get: {
        tags: ["Account"],
        summary: "Uso y cuota del período",
        description: "Uso mensual del plan (mensajes y números). No expone precios.",
        responses: {
          "200": { description: "Uso del período actual.", content: { "application/json": { schema: { $ref: "#/components/schemas/Usage" } } } },
          "401": ERROR_RESPONSE,
        },
      },
    },
    "/me": {
      get: {
        tags: ["Account"],
        summary: "Verificar la API key",
        description: "Confirma que la API key funciona y a qué workspace pertenece. Nunca devuelve la key completa.",
        responses: {
          "200": { description: "Identidad de la API key.", content: { "application/json": { schema: { $ref: "#/components/schemas/Me" } } } },
          "401": ERROR_RESPONSE,
        },
      },
    },
    "/webhooks": {
      get: {
        tags: ["Webhooks"],
        summary: "Listar webhooks configurados",
        responses: {
          "200": { description: "Webhooks del workspace.", content: { "application/json": { schema: { $ref: "#/components/schemas/WebhookList" } } } },
          "401": ERROR_RESPONSE,
        },
      },
      post: {
        tags: ["Webhooks"],
        summary: "Configurar el webhook de un número",
        description: "Crea o reemplaza el webhook del número. Devuelve el secreto de firma UNA sola vez (guárdalo). La URL se valida contra SSRF.",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/ConfigureWebhookRequest" } } },
        },
        responses: {
          "201": { description: "Webhook configurado (secreto mostrado una vez).", content: { "application/json": { schema: { $ref: "#/components/schemas/ConfigureWebhookResponse" } } } },
          "400": ERROR_RESPONSE,
          "401": ERROR_RESPONSE,
          "404": ERROR_RESPONSE,
        },
      },
    },
  },
  // Eventos que DuLabs ENVÍA al webhook del developer (OpenAPI 3.1 webhooks).
  webhooks: {
    "message.received": {
      post: {
        summary: "Mensaje entrante",
        description: "DuLabs hace POST a tu webhook cuando llega un mensaje. Firmado con HMAC (ver guía de verificación). Responde 2xx para confirmar; DuLabs reintenta con backoff y DLQ.",
        requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/InboundEvent" } } } },
        responses: { "200": { description: "Recibido." } },
      },
    },
    "message.status": {
      post: {
        summary: "Estado de un mensaje (sent/delivered/read/failed)",
        requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/InboundEvent" } } } },
        responses: { "200": { description: "Recibido." } },
      },
    },
  },
  components: {
    securitySchemes: {
      apiKey: { type: "http", scheme: "bearer", description: "API key con prefijo `dl_live_`. Créala en el dashboard (API Keys)." },
    },
    parameters: {
      IdempotencyKey: {
        name: "Idempotency-Key",
        in: "header",
        required: true,
        schema: { type: "string", maxLength: 255 },
        description: "Clave única por operación (p. ej. un UUID). Reintentar con la misma clave y el mismo payload no duplica el envío.",
      },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          error: {
            type: "object",
            properties: {
              code: { type: "string", enum: ["missing_api_key", "invalid_api_key", "invalid_request", "invalid_whatsapp_number", "forbidden", "not_found", "idempotency_conflict", "rate_limit_exceeded", "monthly_message_limit_exceeded", "service_unavailable", "internal_error"] },
              message: { type: "string" },
              request_id: { type: "string" },
            },
            required: ["code", "message", "request_id"],
          },
        },
        required: ["error"],
      },
      SendMessageRequest: {
        type: "object",
        required: ["whatsappNumberId", "to", "text"],
        properties: {
          whatsappNumberId: { type: "string", format: "uuid", description: "Id del número conectado (de GET /whatsapp-numbers)." },
          to: { type: "string", maxLength: 32, description: "Destinatario en E.164 (solo dígitos), p. ej. 573000000000." },
          type: { type: "string", enum: ["text"], default: "text", description: "Solo `text` en V1." },
          text: { type: "object", required: ["body"], properties: { body: { type: "string", minLength: 1, maxLength: 4096 } } },
        },
      },
      SendMessageAccepted: { type: "object", properties: { jobId: { type: "string", format: "uuid" }, status: { type: "string", enum: ["created"] } }, required: ["jobId", "status"] },
      SendMessageDuplicate: { type: "object", properties: { jobId: { type: "string", format: "uuid" }, status: { type: "string", enum: ["duplicado_identico"] } }, required: ["jobId", "status"] },
      Message: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          status: { type: "string", enum: ["queued", "processing", "sent", "failed"], description: "`processing` no implica confirmación de Meta." },
          to: { type: ["string", "null"] },
          whatsappNumberId: { type: "string", format: "uuid" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      Number: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          phoneNumberId: { type: "string", description: "phone_number_id de Meta." },
          displayName: { type: ["string", "null"] },
          status: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      NumbersList: { type: "object", properties: { numbers: { type: "array", items: { $ref: "#/components/schemas/Number" } } } },
      Usage: {
        type: "object",
        properties: {
          plan: { type: "string" },
          period: { type: "string", description: "YYYY-MM (hora de Colombia)." },
          reserved: { type: "integer" },
          confirmed: { type: "integer" },
          released: { type: "integer" },
          messages: { type: "object", properties: { included: { type: ["integer", "null"] }, reserved: { type: "integer" }, confirmed: { type: "integer" }, available: { type: ["integer", "null"] } } },
          numbers: { type: "object", properties: { included: { type: ["integer", "null"] }, used: { type: "integer" }, available: { type: ["integer", "null"] } } },
          limits: { type: "object", properties: { messagesPerSecondPerNumber: { type: ["integer", "null"] } } },
        },
      },
      Me: {
        type: "object",
        properties: { workspaceId: { type: "string", format: "uuid" }, apiKeyId: { type: "string" }, apiKeyPrefix: { type: "string" }, apiKeyName: { type: "string" } },
      },
      WebhookList: {
        type: "object",
        properties: { webhooks: { type: "array", items: { type: "object", properties: { whatsappNumberId: { type: "string", format: "uuid" }, url: { type: "string" }, status: { type: "string", enum: ["activo", "pausado"] }, updatedAt: { type: "string", format: "date-time" } } } } },
      },
      ConfigureWebhookRequest: {
        type: "object",
        required: ["whatsappNumberId", "url"],
        properties: { whatsappNumberId: { type: "string", format: "uuid" }, url: { type: "string", format: "uri", description: "HTTPS público; validado contra SSRF." } },
      },
      ConfigureWebhookResponse: {
        type: "object",
        properties: { whatsappNumberId: { type: "string", format: "uuid" }, url: { type: "string" }, status: { type: "string" }, secret: { type: "string", description: "Secreto de firma. Se muestra UNA sola vez." } },
      },
      InboundEvent: {
        type: "object",
        description: "Evento normalizado que DuLabs envía a tu webhook (más el raw de Meta).",
        properties: {
          type: { type: "string", enum: ["message.received", "message.status"] },
          eventId: { type: "string", description: "Id único; usa el header X-DuLabs-Event-ID para deduplicar." },
          workspaceId: { type: "string", format: "uuid" },
          whatsappNumberId: { type: "string", format: "uuid" },
        },
      },
    },
  },
} as const;
