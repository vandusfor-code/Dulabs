"use client";

import { PageHeader } from "@/components/developer/PageHeader";
import { DEVELOPER_API_BASE_URL } from "@/lib/developers/api-base";

// DuLabs Developer V1 -- Fase 9 (autorizado). Quick start estático (no ejecuta
// código del usuario). La documentación completa es Fase 14.

const EJEMPLO = `curl ${DEVELOPER_API_BASE_URL}/messages \\
  -H "Authorization: Bearer dl_live_your_api_key" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" \\
  -d '{
    "whatsappNumberId": "<your-number-id>",
    "to": "573000000000",
    "type": "text",
    "text": { "body": "Hello from DuLabs" }
  }'`;

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-edge bg-card p-5">
      <h2 className="text-sm font-semibold text-fg">{titulo}</h2>
      <div className="mt-2 text-sm text-mist">{children}</div>
    </section>
  );
}

export default function ApiPage() {
  return (
    <>
      <PageHeader title="API" description="Send WhatsApp messages programmatically with the DuLabs Developer API." />
      <div className="space-y-4">
        <Bloque titulo="Base URL">
          <code className="font-mono text-xs text-fg">{DEVELOPER_API_BASE_URL}</code>
        </Bloque>
        <Bloque titulo="Authentication">
          <p>Every request is authenticated with an API key sent as a Bearer token:</p>
          <code className="mt-2 block font-mono text-xs text-fg">Authorization: Bearer dl_live_…</code>
          <p className="mt-2">Create and manage keys in <a className="text-dev-accent hover:underline" href="/developer/api-keys">API Keys</a>. Keys are shown once — store them securely.</p>
        </Bloque>
        <Bloque titulo="Send a message">
          <pre className="mt-1 overflow-x-auto rounded-md border border-edge bg-ink p-3 font-mono text-xs leading-relaxed text-fg">{EJEMPLO}</pre>
          <p className="mt-2">Include an <code className="font-mono text-xs">Idempotency-Key</code> to safely retry without duplicating sends.</p>
        </Bloque>
        <Bloque titulo="Full documentation">
          <p>
            Guides and the complete API reference live in the{" "}
            <a className="text-dev-accent hover:underline" href="/developers">Developer Portal</a>{" "}
            — quickstart, authentication, webhooks, errors and the OpenAPI reference.
          </p>
        </Bloque>
      </div>
    </>
  );
}
