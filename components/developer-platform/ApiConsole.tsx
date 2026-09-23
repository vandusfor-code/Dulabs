"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { API_BASE_URL } from "./constants";
import { MOTION, hexDe } from "./motion";

// DuLabs Developer -- consola del API. El request real (cURL / JavaScript / TypeScript) contra la Base URL canónica, con la respuesta
// real del gateway (201 + X-Request-Id + { jobId, status: "created" }). Al entrar en pantalla la consola imprime el request línea a línea,
// lo «envía» y muestra la respuesta; «Ejecutar» lo repite (simulado: no sale ninguna llamada de la página). Copiar -> ✓ Copiado.
// El estado de la secuencia vive en el bloque (DevApi) porque el ciclo de vida de al lado es el MISMO request.

const SEND_CURL = `curl ${API_BASE_URL}/messages \\
  -H "Authorization: Bearer dl_live_your_api_key" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" \\
  -d '{
    "whatsappNumberId": "00000000-0000-0000-0000-000000000000",
    "to": "573000000000",
    "type": "text",
    "text": { "body": "Hola desde DuLabs" }
  }'`;

const SEND_JS = `const res = await fetch("${API_BASE_URL}/messages", {
  method: "POST",
  headers: {
    "Authorization": "Bearer dl_live_your_api_key",
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
const { jobId, status } = await res.json(); // 201 { jobId, status: "created" }`;

const SEND_TS = `type SendMessageAccepted = { jobId: string; status: "created" };

const res = await fetch("${API_BASE_URL}/messages", {
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
if (!res.ok) throw new Error(\`DuLabs \${res.status} · \${res.headers.get("X-Request-Id")}\`);
const { jobId }: SendMessageAccepted = await res.json();`;

const LENGUAJES = [
  { id: "curl", k: "cURL", codigo: SEND_CURL },
  { id: "js", k: "JavaScript", codigo: SEND_JS },
  { id: "ts", k: "TypeScript", codigo: SEND_TS },
] as const;
type Lenguaje = (typeof LENGUAJES)[number]["id"];

export function ApiConsole({ impreso, enviando, respondido, vuelta, onEjecutar }: { impreso: boolean; enviando: boolean; respondido: boolean; vuelta: number; onEjecutar: () => void }) {
  const { t } = useI18n();
  const [lang, setLang] = useState<Lenguaje>("curl");
  const [copiado, setCopiado] = useState(false);
  const codigo = LENGUAJES.find((l) => l.id === lang)!.codigo;
  const requestId = `${hexDe(vuelta, 4)}…${hexDe(vuelta + 91, 4)}`;
  const jobId = `${hexDe(vuelta + 7, 8)}-…-${hexDe(vuelta + 13, 4)}`;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 1600);
    } catch {
      // Sin portapapeles (contexto inseguro): no es crítico.
    }
  }

  return (
    <div className="dp-panel dp-revela min-w-0 overflow-hidden rounded-dp-lg border border-dp-border bg-dp-surface">
      <div className="flex items-center justify-between gap-3 border-b border-dp-border pl-4 pr-3">
        <div role="tablist" aria-label={t("Lenguaje", "Language")} className="flex min-w-0">
          {LENGUAJES.map((l) => (
            <button
              key={l.id}
              type="button"
              role="tab"
              aria-selected={lang === l.id}
              aria-controls="dp-api-codigo"
              onClick={() => setLang(l.id)}
              className={`dp-link relative py-3 pr-4 font-mono text-[12px] sm:pr-5 ${lang === l.id ? "text-dp-text" : "text-dp-muted hover:text-dp-text-2"}`}
            >
              {l.k}
              {lang === l.id ? <span aria-hidden className="absolute bottom-0 left-0 right-4 h-px bg-dp-text sm:right-5" /> : null}
            </button>
          ))}
        </div>
        <div className="flex flex-none items-center gap-2">
          <button
            type="button"
            onClick={copiar}
            {...(copiado ? { "data-copiado": "" } : {})}
            className="dp-copia dp-link relative grid h-7 place-items-center rounded-dp border border-dp-border px-2.5 font-mono text-[11px] text-dp-text-2 hover:border-dp-border-strong hover:text-dp-text"
          >
            <span className="col-start-1 row-start-1">{t("Copiar", "Copy")}</span>
            <span className="col-start-1 row-start-1 text-dp-ok">✓ {t("Copiado", "Copied")}</span>
          </button>
          <span className="sr-only" aria-live="polite">
            {copiado ? t("Código copiado", "Code copied") : ""}
          </span>
        </div>
      </div>

      <pre
        key={lang}
        id="dp-api-codigo"
        role="tabpanel"
        {...(impreso ? { "data-impreso": "" } : {})}
        className="dp-cruce overflow-x-auto px-4 py-5 font-mono text-[12px] leading-[1.7] text-dp-text md:text-[12.5px]"
        tabIndex={0}
        aria-label={t("Request de ejemplo", "Example request")}
      >
        <code>
          {codigo.split("\n").map((linea, i) => (
            <span key={i} className="dp-linea block" style={{ ["--l" as string]: i }}>
              {linea || " "}
            </span>
          ))}
        </code>
      </pre>

      {/* Respuesta (simulada): se «envía» y llega el 201 con su X-Request-Id. */}
      <div className="relative border-t border-dp-border px-4 py-4 font-mono text-[12px]">
        <span aria-hidden {...(enviando ? { "data-activo": "" } : {})} className="dp-enviando absolute inset-x-0 top-[-1px] h-px bg-dp-signal" />
        <div className="flex items-center justify-between gap-3">
          <span className="text-[10.5px] uppercase tracking-[0.16em] text-dp-muted">
            {enviando ? t("Enviando…", "Sending…") : t("Respuesta · simulada", "Response · simulated")}
          </span>
          <button
            type="button"
            onClick={onEjecutar}
            aria-label={t("Ejecutar de nuevo el request de ejemplo (simulado)", "Run the example request again (simulated)")}
            className="dp-link rounded-dp px-1.5 py-0.5 text-[11px] text-dp-text-2 hover:text-dp-text"
          >
            ▸ {t("Ejecutar", "Run")}
          </button>
        </div>
        <div {...(respondido ? { "data-visible": "" } : {})} className="dp-respuesta mt-2">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-dp-ok">201 Created</span>
            <span key={requestId} className="text-dp-muted">
              X-Request-Id: <span className="text-dp-text-2">{requestId}</span>
            </span>
          </p>
          <pre className="mt-1.5 overflow-x-auto text-dp-text-2">{`{ "jobId": "${jobId}", "status": "created" }`}</pre>
        </div>
      </div>
    </div>
  );
}

/** Duraciones de la secuencia del bloque API (ms): imprimir · enviando · 201 · queued · processing · sent · delivered (reposo). */
export const PASOS_API = [1100, MOTION.sistema, 700, 700, 900, 900, 2800] as const;
