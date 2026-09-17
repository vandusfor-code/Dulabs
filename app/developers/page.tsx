import Link from "next/link";
import { CodeSample } from "@/components/developers/CodeSample";
import { OPENAPI_BASE_URL } from "@/lib/developers/openapi";

const SEND_CURL = `curl ${OPENAPI_BASE_URL}/messages \\
  -H "Authorization: Bearer dl_live_tu_api_key" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" \\
  -d '{
    "whatsappNumberId": "00000000-0000-0000-0000-000000000000",
    "to": "573000000000",
    "type": "text",
    "text": { "body": "Hola desde DuLabs" }
  }'`;

const SEND_JS = `const res = await fetch("${OPENAPI_BASE_URL}/messages", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.DULABS_API_KEY}\`,
    "Idempotency-Key": crypto.randomUUID(),
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    whatsappNumberId: "00000000-0000-0000-0000-000000000000",
    to: "573000000000",
    type: "text",
    text: { body: "Hola desde DuLabs" },
  }),
});
const data = await res.json(); // { jobId, status: "created" }`;

export default function DevelopersHome() {
  return (
    <>
      <h1 className="text-2xl font-semibold text-fg">DuLabs Developer API</h1>
      <p className="mt-3 text-sm text-mist">
        Envía y recibe mensajes de WhatsApp de forma programática. Autenticación por API key, idempotencia, webhooks firmados y estados de entrega. Los mensajes los factura Meta directamente a tu WABA; DuLabs no cobra sobre eso.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-fg">Base URL</h2>
      <pre className="my-3 overflow-x-auto rounded-lg border border-edge bg-ink p-3 text-[12px] text-fg"><code>{OPENAPI_BASE_URL}</code></pre>

      <h2 className="mt-8 text-lg font-semibold text-fg">1. Consigue una API key</h2>
      <p className="mt-2 text-sm text-mist">Crea una key en el <Link href="/developer/api-keys" className="text-dev-accent hover:underline">dashboard → API Keys</Link>. Tiene el prefijo <code className="text-fg">dl_live_</code> y se muestra una sola vez.</p>

      <h2 className="mt-8 text-lg font-semibold text-fg">2. Envía tu primer mensaje</h2>
      <p className="mt-2 text-sm text-mist">Usa el <code className="text-fg">id</code> de un número conectado (de <code className="text-fg">GET /whatsapp-numbers</code>) e incluye una <code className="text-fg">Idempotency-Key</code>.</p>
      <CodeSample curl={SEND_CURL} js={SEND_JS} titulo="POST /messages" />

      <h2 className="mt-8 text-lg font-semibold text-fg">3. Sigue el estado y recibe eventos</h2>
      <p className="mt-2 text-sm text-mist">
        Consulta <code className="text-fg">GET /messages/&#123;id&#125;</code> o configura un <Link href="/developers/webhooks" className="text-dev-accent hover:underline">webhook</Link> para recibir <code className="text-fg">message.received</code> y <code className="text-fg">message.status</code> firmados.
      </p>

      <div className="mt-8 rounded-lg border border-edge bg-card p-4 text-sm text-mist">
        Siguiente: <Link href="/developers/authentication" className="text-dev-accent hover:underline">Autenticación</Link> · <Link href="/developers/messages" className="text-dev-accent hover:underline">Enviar mensajes</Link> · <Link href="/developers/reference" className="text-dev-accent hover:underline">API Reference</Link>
      </div>
    </>
  );
}
