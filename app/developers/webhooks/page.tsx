import { CodeSample } from "@/components/developers/CodeSample";

// DuLabs Developer V1 -- Fase 14.5/14.3. Webhooks entrantes + verificación de
// firma (derivado de lib/developer/webhook-signature.ts y worker-inbound).

const VERIFY_JS = `import crypto from "node:crypto";

// Verifica un webhook de DuLabs. \`rawBody\` DEBE ser el cuerpo crudo (sin
// re-serializar). Rechaza si la firma no coincide o el evento es viejo.
export function verificarWebhookDuLabs(req, secret, toleranciaSeg = 300) {
  const firma = req.headers["x-dulabs-signature"];
  const ts = Number(req.headers["x-dulabs-timestamp"]);
  if (!firma || !Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > toleranciaSeg) return false; // replay viejo

  const esperado = crypto.createHmac("sha256", secret)
    .update(\`\${ts}.\${req.rawBody}\`)
    .digest("hex");
  const a = Buffer.from(esperado, "utf8");
  const b = Buffer.from(String(firma), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}`;

const VERIFY_CURL = `# El endpoint de tu webhook recibe cada evento con estas cabeceras:
#   X-DuLabs-Signature: <hex HMAC-SHA256 de "{timestamp}.{cuerpo-crudo}">
#   X-DuLabs-Timestamp: <unix segundos>
#   X-DuLabs-Event-ID:  <id único del evento>
#
# Recalcula HMAC-SHA256("{timestamp}.{cuerpo-crudo}") con tu whsec_… y compáralo
# en tiempo constante con X-DuLabs-Signature. Rechaza si difiere o si el
# timestamp está fuera de una ventana de ~5 minutos.`;

export default function WebhooksDocsPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold text-fg">Webhooks & eventos</h1>
      <p className="mt-3 text-sm text-mist">
        DuLabs hace <code className="text-fg">POST</code> a tu endpoint cuando ocurre un evento en un número conectado. Configura la URL por número (dashboard o <code className="text-fg">POST /webhooks</code>); el secreto de firma se muestra una sola vez.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-fg">Tipos de evento</h2>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-mist">
        <li><code className="text-fg">message.received</code> — llegó un mensaje entrante.</li>
        <li><code className="text-fg">message.status</code> — cambió el estado de un mensaje enviado (sent / delivered / read / failed).</li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold text-fg">Entrega, reintentos y deduplicación</h2>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-mist">
        <li>Responde <code className="text-fg">2xx</code> para confirmar. Si no, DuLabs reintenta con backoff exponencial acotado y, tras agotar los intentos, mueve el evento a <strong>DLQ</strong>.</li>
        <li>Entrega <strong>at-least-once</strong>: puedes recibir un evento más de una vez. <strong>Deduplica por</strong> <code className="text-fg">X-DuLabs-Event-ID</code>.</li>
        <li>Puedes reintentar manualmente entregas en DLQ/fallidas desde el dashboard (Events).</li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold text-fg">Verificar la firma</h2>
      <p className="mt-3 text-sm text-mist">
        Cada request incluye <code className="text-fg">X-DuLabs-Signature</code>, <code className="text-fg">X-DuLabs-Timestamp</code> y <code className="text-fg">X-DuLabs-Event-ID</code>. La firma es <code className="text-fg">HMAC-SHA256</code> (hex) de <code className="text-fg">{`{timestamp}.{cuerpo-crudo}`}</code> con tu secreto <code className="text-fg">whsec_…</code>. Verifica siempre antes de procesar, con comparación en tiempo constante.
      </p>
      <CodeSample curl={VERIFY_CURL} js={VERIFY_JS} titulo="Verificación (Node/TS)" />
      <p className="mt-2 text-xs text-mist">Firma el <strong>timestamp junto al cuerpo</strong> (no solo el cuerpo): así cada envío tiene una firma distinta y puedes rechazar reenvíos viejos. Usa el cuerpo <strong>crudo</strong>, no el JSON re-serializado.</p>

      <h2 className="mt-8 text-lg font-semibold text-fg">Forma del evento</h2>
      <pre className="my-4 overflow-x-auto rounded-lg border border-edge bg-ink p-4 text-[12px] text-fg"><code>{`{
  "type": "message.received",
  "eventId": "…",            // deduplica con X-DuLabs-Event-ID
  "workspaceId": "…",
  "whatsappNumberId": "…"
  // + datos del evento
}`}</code></pre>
    </>
  );
}
