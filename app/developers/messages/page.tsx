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
if (res.status === 201) {
  const { jobId } = await res.json(); // encolado
}`;

const STATUS_CURL = `curl ${OPENAPI_BASE_URL}/messages/JOB_ID \\
  -H "Authorization: Bearer dl_live_tu_api_key"`;

const STATUS_JS = `const res = await fetch(\`${OPENAPI_BASE_URL}/messages/\${jobId}\`, {
  headers: { Authorization: \`Bearer \${process.env.DULABS_API_KEY}\` },
});
const msg = await res.json(); // { id, status, to, whatsappNumberId, createdAt, updatedAt }`;

export default function MessagesPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold text-fg">Enviar mensajes</h1>
      <p className="mt-3 text-sm text-mist">
        <code className="text-fg">POST /messages</code> encola un mensaje de texto. En V1 solo <code className="text-fg">type: &quot;text&quot;</code>.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-fg">Cuerpo</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-edge text-xs uppercase tracking-wide text-mist">
              <th className="py-2 pr-4">Campo</th><th className="py-2 pr-4">Tipo</th><th className="py-2">Descripción</th>
            </tr>
          </thead>
          <tbody className="text-mist">
            <tr className="border-b border-edge/60"><td className="py-2 pr-4 font-mono text-xs text-fg">whatsappNumberId</td><td className="py-2 pr-4">uuid</td><td className="py-2">Número conectado (de GET /whatsapp-numbers). Requerido.</td></tr>
            <tr className="border-b border-edge/60"><td className="py-2 pr-4 font-mono text-xs text-fg">to</td><td className="py-2 pr-4">string</td><td className="py-2">Destinatario E.164 (solo dígitos), máx. 32. Requerido.</td></tr>
            <tr className="border-b border-edge/60"><td className="py-2 pr-4 font-mono text-xs text-fg">type</td><td className="py-2 pr-4">&quot;text&quot;</td><td className="py-2">Opcional; por defecto text.</td></tr>
            <tr className="border-b border-edge/60"><td className="py-2 pr-4 font-mono text-xs text-fg">text.body</td><td className="py-2 pr-4">string</td><td className="py-2">1–4096 caracteres. Requerido.</td></tr>
          </tbody>
        </table>
      </div>
      <CodeSample curl={SEND_CURL} js={SEND_JS} titulo="POST /messages" />
      <p className="mt-2 text-sm text-mist"><code className="text-fg">201</code> → <code className="text-fg">{`{ jobId, status: "created" }`}</code>. Reintento idéntico → <code className="text-fg">200</code> <code className="text-fg">duplicado_identico</code>. Ver <Link href="/developers/rate-limits" className="text-dev-accent hover:underline">idempotencia</Link>.</p>

      <h2 className="mt-8 text-lg font-semibold text-fg">Estado de un mensaje</h2>
      <p className="mt-2 text-sm text-mist">
        <code className="text-fg">GET /messages/&#123;id&#125;</code> devuelve <code className="text-fg">status</code>: <code className="text-fg">queued</code> · <code className="text-fg">processing</code> · <code className="text-fg">sent</code> · <code className="text-fg">failed</code>. <code className="text-fg">processing</code> no implica confirmación de Meta. Para tiempo real usa <Link href="/developers/webhooks" className="text-dev-accent hover:underline">webhooks</Link>.
      </p>
      <CodeSample curl={STATUS_CURL} js={STATUS_JS} titulo="GET /messages/{id}" />
    </>
  );
}
