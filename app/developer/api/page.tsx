"use client";

import { useState } from "react";
import { PageHeader } from "@/components/developer/PageHeader";
import { StatusBadge } from "@/components/developer/StatusBadge";
import { useDeveloper } from "@/lib/dev-dashboard/developer-session";
import { useDevResource } from "@/lib/dev-dashboard/use-dev-resource";
import { puedeGestionarRecursos } from "@/lib/dev-dashboard/dev-permissions";
import { tonoEstadoNumero } from "@/lib/dev-dashboard/dev-format";
import { DevApiError } from "@/lib/dev-dashboard/dev-client";
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

// "Probar envío de WhatsApp": el usuario solo pone destino + mensaje. El
// whatsappNumberId (número conectado del workspace), la API key y la
// Idempotency-Key se resuelven server-side (ver app/api/developer/whatsapp/
// test-send/route.ts) -- nada de eso llega al navegador.
function ProbarEnvio() {
  const { client, rol, selectedWorkspaceId } = useDeveloper();
  const puede = puedeGestionarRecursos(rol);
  const { data: numeros } = useDevResource(selectedWorkspaceId, async () =>
    selectedWorkspaceId ? (await client.numbers.list()).numbers : null
  );
  const conectado = (numeros ?? []).find((n) => n.status === "conectado") ?? null;

  const [to, setTo] = useState("");
  const [text, setText] = useState("🚀 Prueba real desde DuLabs Developer. Si recibes este mensaje, la API está funcionando.");
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);

  async function enviar() {
    setEnviando(true);
    setResultado(null);
    try {
      const r = await client.whatsapp.testSend({ to: to.trim(), text });
      setResultado({ ok: true, texto: `Enviado ✓  jobId: ${r.jobId ?? "—"} · estado: ${r.status}` });
    } catch (e) {
      const msg = e instanceof DevApiError ? e.detalle ?? e.code ?? "No se pudo enviar" : e instanceof Error ? e.message : "No se pudo enviar";
      setResultado({ ok: false, texto: msg });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="rounded-lg border border-edge bg-card p-5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-fg">Probar envío de WhatsApp</h2>
        {conectado ? <StatusBadge tono={tonoEstadoNumero(conectado.status)}>{conectado.status}</StatusBadge> : null}
      </div>
      {conectado ? (
        <p className="text-xs text-mist">
          Número conectado: <span className="font-mono text-fg">{conectado.displayName ?? conectado.phoneNumberId}</span>
        </p>
      ) : (
        <p className="text-xs text-warning-text">
          No hay un número conectado. Conéctalo en{" "}
          <a className="underline" href="/developer/whatsapp">WhatsApp Numbers</a> para poder probar.
        </p>
      )}

      {!puede ? (
        <p className="mt-3 text-xs text-mist">Solo OWNER/ADMIN pueden enviar mensajes de prueba.</p>
      ) : (
        <div className="mt-3 space-y-3">
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wider text-mist">Número de destino</label>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="573148127388"
              inputMode="numeric"
              className="w-full rounded-md border border-edge bg-ink px-3 py-2 font-mono text-sm text-fg outline-none focus:border-dev-accent/50"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wider text-mist">Mensaje</label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              maxLength={4096}
              className="w-full rounded-md border border-edge bg-ink px-3 py-2 text-sm text-fg outline-none focus:border-dev-accent/50"
            />
          </div>
          <button
            onClick={enviar}
            disabled={enviando || !conectado || !to.trim() || !text.trim()}
            className="rounded-md bg-dev-accent px-3 py-1.5 text-sm font-medium text-dev-accent-fg hover:bg-dev-accent-hover disabled:opacity-50"
          >
            {enviando ? "Enviando…" : "Enviar mensaje"}
          </button>
          {resultado ? <p className={`text-xs ${resultado.ok ? "text-success-text" : "text-danger-text"}`}>{resultado.texto}</p> : null}
          <p className="text-[11px] text-mist">
            No necesitas API key ni UUID: se resuelven de forma segura en el servidor. <code className="font-mono">201</code> con{" "}
            <code className="font-mono">jobId</code> = aceptado; el estado final se ve en{" "}
            <a className="underline" href="/developer/jobs">Jobs/Logs</a>.
          </p>
        </div>
      )}
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
        <ProbarEnvio />
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
