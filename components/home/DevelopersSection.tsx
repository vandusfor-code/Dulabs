import type { CSSProperties } from "react";
import { DEVELOPER_API_BASE_URL } from "@/lib/developers/api-base";
import { DEVELOPER_DOCS_HREF, DEVELOPER_PLATFORM_HREF } from "@/lib/home/links";
import { BOTON_PRIMARIO, ENLACE_FLECHA, HomeSection, SectionHeader } from "./atoms";
import { TrackedLink } from "./TrackedLink";

// Developers: la entrada a DuLabs Developers desde la home, mostrada como lo que es -- infraestructura real. El bloque de código usa el
// contrato público documentado (POST /api/v1/messages, Bearer dl_live_, Idempotency-Key, 201 con jobId, webhooks message.received /
// message.status firmados), el mismo que muestran /developer-platform y /developers. Los identificadores van truncados (…): son ejemplos.
// Al entrar en pantalla el ciclo request -> accepted -> sent -> webhook se ilumina una sola vez (CSS, data-fx).
const CICLO = [
  { k: "request", d: "POST /messages" },
  { k: "accepted", d: "201 · created" },
  { k: "sent", d: "WhatsApp Cloud API" },
  { k: "webhook", d: "message.status" },
] as const;

const CAPACIDADES = ["WhatsApp Cloud API", "Webhooks", "Flows", "API keys", "Eventos", "Multi-tenant"];

const d = (i: number): CSSProperties => ({ ["--fx-d" as string]: `${400 + i * 550}ms` });

export function DevelopersSection() {
  return (
    <HomeSection id="developers" titleId="developers-titulo">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-center lg:gap-16 xl:gap-24">
        <div>
          <SectionHeader eyebrow="DuLabs Developers" titleId="developers-titulo" title="Construye sobre DuLabs.">
            <p>
              Conecta WhatsApp, crea flows, usa nuestra API y lleva automatizaciones conversacionales a tus propios productos — sobre la misma infraestructura que ya opera DuLabs.
            </p>
          </SectionHeader>
          <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 font-mono text-[11.5px] text-white/60" aria-label="Incluye">
            {CAPACIDADES.map((c) => (
              <li key={c} className="flex items-center gap-2">
                <span aria-hidden className="size-1 rounded-full bg-white/40" />
                {c}
              </li>
            ))}
          </ul>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
            <TrackedLink href={DEVELOPER_PLATFORM_HREF} source="developers_plataforma" className={BOTON_PRIMARIO}>
              Explorar DuLabs Developers
              <span aria-hidden>→</span>
            </TrackedLink>
            <TrackedLink href={DEVELOPER_DOCS_HREF} source="developers_docs" className={ENLACE_FLECHA}>
              Ver documentación
              <span aria-hidden className="transition-transform group-hover/enlace:translate-x-0.5">→</span>
            </TrackedLink>
          </div>
        </div>

        <figure data-fx className="home-codigo" aria-label="Ejemplo de envío de un mensaje con la API de DuLabs y su webhook">
          <div className="home-codigo-barra">
            <span className="text-site-fg">POST</span>
            <span className="min-w-0 truncate">/api/v1/messages</span>
            <span className="ml-auto hidden rounded border border-site-border px-1.5 py-0.5 sm:inline">Bearer dl_live_</span>
          </div>
          <pre className="home-codigo-pre">
            <code>
              <span className="text-white/40">{"# "}</span>
              <span className="text-white/40">{DEVELOPER_API_BASE_URL}/messages</span>
              {"\n"}
              <span className="text-site-muted-fg">Authorization:</span> Bearer dl_live_tu_api_key{"\n"}
              <span className="text-site-muted-fg">Idempotency-Key:</span> 8f2a1c…{"\n"}
              {"\n"}
              {"{\n"}
              {"  "}
              <span className="home-codigo-clave">&quot;whatsappNumberId&quot;</span>: &quot;wn_01HX8Z…&quot;,{"\n"}
              {"  "}
              <span className="home-codigo-clave">&quot;to&quot;</span>: &quot;573000000000&quot;,{"\n"}
              {"  "}
              <span className="home-codigo-clave">&quot;type&quot;</span>: &quot;text&quot;,{"\n"}
              {"  "}
              <span className="home-codigo-clave">&quot;text&quot;</span>: {"{ "}
              <span className="home-codigo-clave">&quot;body&quot;</span>: &quot;Hola desde DuLabs&quot;{" }\n"}
              {"}"}
            </code>
          </pre>
          <div className="home-codigo-respuesta">
            <span className="rounded border border-white/25 px-1.5 py-0.5 text-site-fg">201</span>
            <span className="text-site-muted-fg">Created</span>
            <code className="min-w-0 truncate text-white/75">{`{ "jobId": "job_01HX8Z…", "status": "created" }`}</code>
          </div>
          <ol className="home-codigo-ciclo" aria-label="Ciclo de vida del mensaje">
            {CICLO.map((c, i) => (
              <li key={c.k} className="home-codigo-paso" style={d(i)}>
                <span aria-hidden className="home-codigo-punto" />
                <span className="text-site-fg">{c.k}</span>
                <span className="text-site-muted-fg">{c.d}</span>
              </li>
            ))}
          </ol>
          <figcaption className="border-t border-site-border px-4 py-3 font-mono text-[10.5px] leading-relaxed text-site-muted-fg sm:px-5">
            Webhooks firmados (HMAC-SHA256) en tu endpoint: <span className="text-white/75">message.received</span> ·{" "}
            <span className="text-white/75">message.status</span>
          </figcaption>
        </figure>
      </div>
    </HomeSection>
  );
}
