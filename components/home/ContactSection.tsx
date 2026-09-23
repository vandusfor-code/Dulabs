"use client";

import { useRef, useState, type FormEvent } from "react";
import { CREAR_AGENTE_HREF, HABLAR_ESPECIALISTA_HREF } from "@/lib/home/links";
import { trackConversion } from "@/lib/site-analytics";
import { BOTON_PRIMARIO, ENLACE_FLECHA, HomeSection } from "./atoms";
import { TrackedLink } from "./TrackedLink";

// Contacto: el formulario REAL de proyectos (mismo endpoint /api/enterprise/contacto, mismos campos obligatorios y mismos eventos de
// analítica que EnterpriseContactSection), en una composición editorial en vez de una tarjeta de formulario. Campos con línea inferior y foco
// blanco; sin colores fuertes. Es el cierre de la home: para quien prefiere empezar solo queda el enlace a "Crea tu agente".
type Estado = "listo" | "enviando" | "exito" | "error";

const NECESIDADES = ["IA & Automatización", "Software a medida", "Integraciones", "Datos & Operaciones", "Otro"];

export function ContactSection() {
  const [estado, setEstado] = useState<Estado>("listo");
  const [error, setError] = useState<string | null>(null);
  const iniciado = useRef(false);

  const alEnfocar = () => {
    if (iniciado.current) return;
    iniciado.current = true;
    trackConversion("form_enterprise_start");
  };

  const enviar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const datos = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    setEstado("enviando");
    setError(null);
    try {
      const res = await fetch("/api/enterprise/contacto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: datos.nombre,
          empresa: datos.empresa,
          correo: datos.correo,
          telefono: datos.telefono,
          necesidad: datos.necesidad,
          detalle: datos.detalle,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "No se pudo enviar la solicitud.");
      trackConversion("form_enterprise_submit");
      setEstado("exito");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error enviando la solicitud.");
      setEstado("error");
    }
  };

  return (
    <HomeSection id="contacto" titleId="contacto-titulo">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-20 xl:gap-28">
        <div>
          <p className="flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.18em] text-site-muted-fg">
            <span aria-hidden className="h-px w-5 bg-white/30" />
            Contacto
          </p>
          <h2 id="contacto-titulo" className="mt-5 text-balance text-[36px] font-medium leading-[1.02] tracking-[-0.035em] text-site-fg sm:text-[48px] lg:text-[56px] 2xl:text-[64px]">
            Cuéntanos qué necesitas.
          </h2>
          <p className="mt-6 max-w-[30rem] text-[16px] leading-[1.65] text-site-muted-fg md:text-[17px]">
            Nuestro equipo revisará tu proyecto y te contactará para entender el alcance y proponerte la mejor solución.
          </p>

          <dl className="mt-10 grid gap-5 border-t border-site-border pt-6 text-[15px] sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <div>
              <dt className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-site-muted-fg">Correo</dt>
              <dd className="mt-1.5">
                <a href="mailto:contacto@dulabs.co" className="inline-flex min-h-11 items-center text-site-fg underline-offset-4 hover:underline">
                  contacto@dulabs.co
                </a>
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-site-muted-fg">WhatsApp</dt>
              <dd className="mt-1.5">
                <TrackedLink href={HABLAR_ESPECIALISTA_HREF} event="cta_enterprise" source="contacto" className={ENLACE_FLECHA}>
                  Hablar con DuLabs
                  <span aria-hidden className="transition-transform group-hover/enlace:translate-x-0.5">→</span>
                </TrackedLink>
              </dd>
            </div>
          </dl>

          <p className="mt-10 text-[14px] leading-relaxed text-site-muted-fg">
            ¿Prefieres empezar tú mismo?{" "}
            <TrackedLink href={CREAR_AGENTE_HREF} event="cta_crear_agente" source="contacto" className="text-site-fg underline-offset-4 hover:underline">
              Crea tu agente →
            </TrackedLink>
          </p>
        </div>

        <div className="home-form">
          {estado === "exito" ? (
            <div role="status" className="flex min-h-[22rem] flex-col justify-center border-t border-site-border pt-8">
              <p className="flex items-center gap-3 text-[22px] font-medium tracking-tight text-site-fg">
                <span aria-hidden className="home-form-ok" />
                Listo. Ya recibimos tu solicitud.
              </p>
              <p className="mt-3 text-[15px] text-site-muted-fg">Te contactaremos para entender el alcance de tu proyecto.</p>
            </div>
          ) : (
            <form onSubmit={enviar} onFocus={alEnfocar} className="grid gap-x-8 gap-y-7 sm:grid-cols-2">
              <Campo nombre="nombre" etiqueta="Nombre" requerido autoComplete="name" placeholder="Tu nombre" />
              <Campo nombre="empresa" etiqueta="Empresa" requerido autoComplete="organization" placeholder="Nombre de tu empresa" />
              <Campo nombre="correo" etiqueta="Correo" tipo="email" requerido autoComplete="email" placeholder="tu@empresa.com" />
              <Campo nombre="telefono" etiqueta="WhatsApp" tipo="tel" autoComplete="tel" placeholder="+57 300 000 0000" />

              <label className="home-campo sm:col-span-2">
                <span className="home-campo-etiqueta">¿Qué necesitas?</span>
                <select name="necesidad" required defaultValue="" className="home-campo-control home-campo-select">
                  <option value="" disabled>
                    Selecciona una opción
                  </option>
                  {NECESIDADES.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>

              <label className="home-campo sm:col-span-2">
                <span className="home-campo-etiqueta">Cuéntanos brevemente sobre tu proyecto</span>
                <textarea name="detalle" rows={3} className="home-campo-control resize-none" placeholder="¿Qué te gustaría resolver o automatizar?" />
              </label>

              {estado === "error" && error ? (
                <p role="alert" className="text-[14px] text-site-destructive sm:col-span-2">
                  {error}
                </p>
              ) : null}

              <div className="flex flex-col gap-4 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[12.5px] text-site-muted-fg">Nombre, empresa, correo y qué necesitas son obligatorios.</p>
                <button type="submit" disabled={estado === "enviando"} className={`${BOTON_PRIMARIO} disabled:cursor-not-allowed disabled:opacity-60`}>
                  {estado === "enviando" ? "Enviando…" : "Enviar solicitud"}
                  <span aria-hidden>→</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </HomeSection>
  );
}

function Campo({
  nombre,
  etiqueta,
  tipo = "text",
  requerido = false,
  autoComplete,
  placeholder,
}: {
  nombre: string;
  etiqueta: string;
  tipo?: string;
  requerido?: boolean;
  autoComplete?: string;
  placeholder?: string;
}) {
  return (
    <label className="home-campo">
      <span className="home-campo-etiqueta">{etiqueta}</span>
      <input name={nombre} type={tipo} required={requerido} autoComplete={autoComplete} placeholder={placeholder} className="home-campo-control" />
    </label>
  );
}
