"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2, Check } from "lucide-react";
import { Button, Field, inputClass, cn } from "@/components/spa-panel/ui";

type Persona = {
  dias: string[];
  inicio: string;
  fin: string;
  sabadoDistinto: boolean;
  sabInicio: string;
  sabFin: string;
};

type Respuestas = {
  personas: Record<"carla" | "kelly" | "daniela" | "nicol", Persona>;
  reglas: {
    prioridadManos: string;
    danielaPies: string;
    retiros: string;
    serviciosCombinados: string;
    confirmacion: string;
    confirmacionDetalle: string;
  };
  servicios: Record<"cejasSola" | "cejasHenna" | "hidralips", string>;
  duraciones: Record<string, string>;
  negocio: {
    lvAbre: string;
    lvCierra: string;
    sabAbre: string;
    sabCierra: string;
    domingo: string;
    abre8am: string;
    abre8amDetalle: string;
    festivos: string;
    tiempoCancelacion: string;
    cobroCancelacion: string;
    montoCancelacion: string;
  };
};

const DIAS_SEMANA = [
  { k: "lun", l: "L" },
  { k: "mar", l: "M" },
  { k: "mie", l: "X" },
  { k: "jue", l: "J" },
  { k: "vie", l: "V" },
  { k: "sab", l: "S" },
];

const TODOS_LOS_DIAS = DIAS_SEMANA.map((d) => d.k);

function personaDefault(inicio: string, fin: string, sabadoDistinto: boolean, sabInicio: string, sabFin: string): Persona {
  return { dias: TODOS_LOS_DIAS, inicio, fin, sabadoDistinto, sabInicio, sabFin };
}

const DEFAULTS: Respuestas = {
  personas: {
    carla: personaDefault("09:00", "19:00", true, "09:00", "18:00"),
    kelly: personaDefault("09:00", "19:00", true, "09:00", "18:00"),
    daniela: personaDefault("14:00", "19:00", false, "14:00", "18:00"),
    nicol: personaDefault("15:00", "19:00", true, "09:00", "18:00"),
  },
  reglas: {
    prioridadManos: "carla_primero",
    danielaPies: "no",
    retiros: "mismo",
    serviciosCombinados: "paralelo",
    confirmacion: "si",
    confirmacionDetalle: "",
  },
  servicios: { cejasSola: "daniela", cejasHenna: "daniela", hidralips: "daniela" },
  duraciones: {
    semiManos: "60",
    semiPies: "60",
    pressOn: "",
    dipping: "",
    baseRubber: "",
    forradoGel: "120",
    forradoAcrilico: "120",
    acrilicas: "210",
    retoqueForrado: "",
    cejasSolaMin: "",
    cejasHennaMin: "",
    hidralipsMin: "",
  },
  negocio: {
    lvAbre: "09:00",
    lvCierra: "19:00",
    sabAbre: "09:00",
    sabCierra: "18:00",
    domingo: "cerrado",
    abre8am: "no",
    abre8amDetalle: "",
    festivos: "cerrado",
    tiempoCancelacion: "",
    cobroCancelacion: "no",
    montoCancelacion: "",
  },
};

function mergeRespuestas(base: Respuestas, guardado: Partial<Respuestas> | null): Respuestas {
  if (!guardado) return base;
  return {
    personas: { ...base.personas, ...(guardado.personas ?? {}) },
    reglas: { ...base.reglas, ...(guardado.reglas ?? {}) },
    servicios: { ...base.servicios, ...(guardado.servicios ?? {}) },
    duraciones: { ...base.duraciones, ...(guardado.duraciones ?? {}) },
    negocio: { ...base.negocio, ...(guardado.negocio ?? {}) },
  };
}

function DayPills({ value, onChange }: { value: string[]; onChange: (dias: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {DIAS_SEMANA.map((d) => {
        const checked = value.includes(d.k);
        return (
          <button
            key={d.k}
            type="button"
            onClick={() => onChange(checked ? value.filter((x) => x !== d.k) : [...value, d.k])}
            className={cn(
              "flex h-8 min-w-[38px] items-center justify-center rounded-full border px-2 text-[12px] font-semibold transition-colors",
              checked ? "border-lime bg-lime text-lime-fg" : "border-edge bg-ink text-mist"
            )}
          >
            {d.l}
          </button>
        );
      })}
    </div>
  );
}

function RadioGroup({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-xl border px-3.5 py-3 text-left text-[13.5px] leading-relaxed transition-colors",
            value === o.value ? "border-lime bg-lime-soft text-fg" : "border-edge bg-ink text-fg/90"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <div className="mb-4 rounded-xl border border-lime/25 bg-lime-soft px-3.5 py-3 text-[13px] leading-relaxed text-fg">{children}</div>;
}

function Card({ n, title, desc, children }: { n: number; title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 rounded-2xl border border-edge bg-card p-5">
      <div className="mb-1 flex items-baseline gap-2.5">
        <span className="font-mono text-[13px] font-semibold text-lime-text">{n}</span>
        <h2 className="font-semibold text-[17px] text-fg">{title}</h2>
      </div>
      {desc && <p className="mb-4 text-[13px] leading-relaxed text-mist">{desc}</p>}
      {children}
    </section>
  );
}

function PersonaBlock({
  nombre,
  persona,
  onChange,
}: {
  nombre: string;
  persona: Persona;
  onChange: (p: Persona) => void;
}) {
  return (
    <div className="border-t border-edge pt-4 first:border-t-0 first:pt-0 [&:not(:first-child)]:mt-4">
      <p className="mb-2.5 font-semibold text-[15px] text-fg">{nombre}</p>
      <Field label="Días que trabaja">
        <DayPills value={persona.dias} onChange={(dias) => onChange({ ...persona, dias })} />
      </Field>
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <Field label="Entra">
          <input type="time" className={inputClass} value={persona.inicio} onChange={(e) => onChange({ ...persona, inicio: e.target.value })} />
        </Field>
        <Field label="Sale">
          <input type="time" className={inputClass} value={persona.fin} onChange={(e) => onChange({ ...persona, fin: e.target.value })} />
        </Field>
      </div>
      <label className="mt-3 flex items-center gap-2 text-[13px] text-fg">
        <input
          type="checkbox"
          checked={persona.sabadoDistinto}
          onChange={(e) => onChange({ ...persona, sabadoDistinto: e.target.checked })}
          className="size-4 accent-lime"
        />
        El sábado es diferente
      </label>
      {persona.sabadoDistinto && (
        <div className="mt-2.5 grid grid-cols-2 gap-2.5">
          <Field label="Entra sábado">
            <input type="time" className={inputClass} value={persona.sabInicio} onChange={(e) => onChange({ ...persona, sabInicio: e.target.value })} />
          </Field>
          <Field label="Sale sábado">
            <input type="time" className={inputClass} value={persona.sabFin} onChange={(e) => onChange({ ...persona, sabFin: e.target.value })} />
          </Field>
        </div>
      )}
    </div>
  );
}

const SERVICIOS_DURACION: { key: keyof Respuestas["duraciones"]; label: string; placeholder?: string }[] = [
  { key: "semiManos", label: "Semipermanente en manos" },
  { key: "semiPies", label: "Semipermanente en pies" },
  { key: "pressOn", label: "Press on", placeholder: "90" },
  { key: "dipping", label: "Dipping", placeholder: "90" },
  { key: "baseRubber", label: "Base Rubber", placeholder: "90" },
  { key: "forradoGel", label: "Forrado en gel" },
  { key: "forradoAcrilico", label: "Forrado en acrílico" },
  { key: "acrilicas", label: "Acrílicas" },
  { key: "retoqueForrado", label: "Retoque de forrado", placeholder: "60" },
  { key: "cejasSolaMin", label: "Cejas — depilación sola", placeholder: "15" },
  { key: "cejasHennaMin", label: "Cejas — con henna", placeholder: "25" },
  { key: "hidralipsMin", label: "Hidralips", placeholder: "45" },
];

export default function ConfigBotPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [datos, setDatos] = useState<Respuestas | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [guardadoEn, setGuardadoEn] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/config-bot/${token}`)
      .then(async (res) => ({ ok: res.ok, data: await res.json() }))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error ?? "No se pudo cargar");
        setDatos(mergeRespuestas(DEFAULTS, data.respuestas));
        if (data.actualizado_en) setGuardadoEn(data.actualizado_en);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Error cargando el formulario"))
      .finally(() => setCargando(false));
  }, [token]);

  async function guardar() {
    if (!datos) return;
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch(`/api/config-bot/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ respuestas: datos }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo guardar");
      setGuardadoEn(data.actualizado_en);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar, intenta de nuevo");
    } finally {
      setGuardando(false);
    }
  }

  if (cargando) {
    return (
      <div className="spa-scope flex min-h-screen items-center justify-center bg-ink">
        <Loader2 className="size-6 animate-spin text-mist" />
      </div>
    );
  }

  if (!datos) {
    return (
      <div className="spa-scope flex min-h-screen items-center justify-center bg-ink px-6 text-center">
        <p className="text-sm text-mist">{error ?? "Link inválido"}</p>
      </div>
    );
  }

  const setPersona = (key: keyof Respuestas["personas"]) => (p: Persona) =>
    setDatos({ ...datos, personas: { ...datos.personas, [key]: p } });
  const setReglas = (patch: Partial<Respuestas["reglas"]>) => setDatos({ ...datos, reglas: { ...datos.reglas, ...patch } });
  const setServicio = (key: keyof Respuestas["servicios"]) => (v: string) =>
    setDatos({ ...datos, servicios: { ...datos.servicios, [key]: v } });
  const setDuracion = (key: string) => (v: string) => setDatos({ ...datos, duraciones: { ...datos.duraciones, [key]: v } });
  const setNegocio = (patch: Partial<Respuestas["negocio"]>) => setDatos({ ...datos, negocio: { ...datos.negocio, ...patch } });

  return (
    <div className="spa-scope min-h-screen bg-ink pb-28">
      <div className="mx-auto max-w-[640px] px-4 pt-8">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-wide text-lime-text">DuLabs · Daniela Manco Nails Spa</p>
        <h1 className="mt-2 text-[28px] font-semibold leading-tight text-fg">Reglas del bot</h1>
        <p className="mt-2.5 max-w-[52ch] text-[14px] leading-relaxed text-mist">
          Responde esto de una sola vez y quedan resueltas todas las dudas que ha tenido el bot esta semana. Puedes guardar
          en cualquier momento, y volver a entrar a corregir cuando quieras — este link se queda tal cual como lo dejaste.
        </p>

        {guardadoEn && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-success-text/20 bg-success px-3.5 py-2.5 text-[13px] font-medium text-success-text">
            <Check className="size-4 shrink-0" />
            Guardado el {new Date(guardadoEn).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}
          </div>
        )}
        {error && (
          <div className="mt-4 rounded-xl border border-danger-text/20 bg-danger px-3.5 py-2.5 text-[13px] text-danger-text">{error}</div>
        )}

        <div className="mt-6">
          <Card n={1} title="Horario de cada quien" desc="Marca los días que trabaja cada una y su horario. Si el sábado es distinto, actívalo.">
            <PersonaBlock nombre="Carla" persona={datos.personas.carla} onChange={setPersona("carla")} />
            <PersonaBlock nombre="Kelly" persona={datos.personas.kelly} onChange={setPersona("kelly")} />
            <PersonaBlock nombre="Daniela (tú)" persona={datos.personas.daniela} onChange={setPersona("daniela")} />
            <PersonaBlock nombre="Nicol (pestañas)" persona={datos.personas.nicol} onChange={setPersona("nicol")} />
          </Card>

          <Card n={2} title="Citas de manos, después de las 2pm">
            <Note>Antes de las 2pm la cita de manos siempre es con Carla — tú no trabajas en la mañana, eso no cambia.</Note>
            <p className="mb-3 text-[13px] text-mist">Después de las 2pm, cuando las dos podrían atender, ¿cómo prefieres que se asigne?</p>
            <RadioGroup
              value={datos.reglas.prioridadManos}
              onChange={(v) => setReglas({ prioridadManos: v })}
              options={[
                { value: "daniela_primero", label: "Primero se intenta contigo; si no tienes espacio, pasa a Carla" },
                { value: "carla_primero", label: "Primero se intenta con Carla; solo pasa a ti si Carla no tiene NINGÚN espacio ese día" },
                { value: "cualquiera", label: "No importa, la que tenga cupo primero a esa hora" },
              ]}
            />
          </Card>

          <Card n={3} title="Citas de pies">
            <Note>
              Ya quedó configurado: Kelly es la fija de pies. Solo se pasa a Carla si Kelly no tiene ningún espacio libre en
              todo el día — no solo a esa hora puntual.
            </Note>
            <p className="mb-3 text-[13px] text-mist">¿Tú alguna vez puedes atender pies, como último recurso si Kelly y Carla están llenas?</p>
            <RadioGroup
              value={datos.reglas.danielaPies}
              onChange={(v) => setReglas({ danielaPies: v })}
              options={[
                { value: "no", label: "No, nunca hago pies" },
                { value: "si", label: "Sí, como último recurso" },
              ]}
            />
          </Card>

          <Card n={4} title="Servicios sin asignar" desc="Estos no están asignados a nadie todavía.">
            {([
              ["cejasSola", "Cejas — depilación sola"],
              ["cejasHenna", "Cejas — con henna"],
              ["hidralips", "Hidralips"],
            ] as const).map(([key, label]) => (
              <div key={key} className="mb-2.5 flex items-center justify-between gap-3">
                <label className="text-[13.5px] text-fg">{label}</label>
                <select
                  className={cn(inputClass, "w-[150px]")}
                  value={datos.servicios[key]}
                  onChange={(e) => setServicio(key)(e.target.value)}
                >
                  <option value="carla">Carla</option>
                  <option value="kelly">Kelly</option>
                  <option value="daniela">Daniela</option>
                  <option value="nicol">Nicol</option>
                  <option value="cualquiera">Cualquiera</option>
                </select>
              </div>
            ))}
            <p className="mb-2.5 mt-4 text-[13px] text-mist">Retiros (quitar trabajo anterior):</p>
            <RadioGroup
              value={datos.reglas.retiros}
              onChange={(v) => setReglas({ retiros: v })}
              options={[
                { value: "mismo", label: "Solo quien va a hacer el servicio nuevo" },
                { value: "cualquiera", label: "Cualquiera puede hacerlo" },
              ]}
            />
          </Card>

          <Card
            n={5}
            title="Duración real de cada servicio"
            desc="Ya puse lo que tenía anotado. Ajusta lo que esté mal y llena lo que falta — así el sistema no bloquea más o menos tiempo del que toma de verdad."
          >
            {SERVICIOS_DURACION.map((s) => (
              <div key={s.key} className="mb-2.5 flex items-center justify-between gap-3">
                <label className="text-[13.5px] text-fg">{s.label}</label>
                <div className="relative w-[110px]">
                  <input
                    type="number"
                    min={0}
                    step={5}
                    placeholder={s.placeholder}
                    className={cn(inputClass, "pr-10 text-right")}
                    value={datos.duraciones[s.key] ?? ""}
                    onChange={(e) => setDuracion(s.key)(e.target.value)}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-mist">min</span>
                </div>
              </div>
            ))}
            <p className="mt-1 text-[12px] text-mist">Acrílicas tenías anotado &quot;3-4 horas&quot; — dejé el promedio (210 min). Cámbialo si prefieres siempre el máximo.</p>
          </Card>

          <Card n={6} title="Dos servicios en la misma cita" desc="Por ejemplo pies y manos el mismo día, como pasó esta semana.">
            <RadioGroup
              value={datos.reglas.serviciosCombinados}
              onChange={(v) => setReglas({ serviciosCombinados: v })}
              options={[
                { value: "misma_persona", label: "La misma persona hace los dos, uno seguido del otro" },
                { value: "paralelo", label: "Dos personas distintas, al mismo tiempo (cada quien su especialidad)" },
              ]}
            />
          </Card>

          <Card n={7} title="Horario del negocio" desc="Esto es lo que tengo anotado. Corrígelo si algo cambió.">
            <div className="grid grid-cols-2 gap-2.5">
              <Field label="L-V abre">
                <input type="time" className={inputClass} value={datos.negocio.lvAbre} onChange={(e) => setNegocio({ lvAbre: e.target.value })} />
              </Field>
              <Field label="L-V cierra">
                <input type="time" className={inputClass} value={datos.negocio.lvCierra} onChange={(e) => setNegocio({ lvCierra: e.target.value })} />
              </Field>
              <Field label="Sábado abre">
                <input type="time" className={inputClass} value={datos.negocio.sabAbre} onChange={(e) => setNegocio({ sabAbre: e.target.value })} />
              </Field>
              <Field label="Sábado cierra">
                <input type="time" className={inputClass} value={datos.negocio.sabCierra} onChange={(e) => setNegocio({ sabCierra: e.target.value })} />
              </Field>
            </div>

            <p className="mb-2 mt-4 text-[13px] font-medium text-mist">Domingo</p>
            <RadioGroup
              value={datos.negocio.domingo}
              onChange={(v) => setNegocio({ domingo: v })}
              options={[
                { value: "cerrado", label: "Cerrado" },
                { value: "abierto", label: "Trabajamos" },
              ]}
            />

            <p className="mb-2 mt-4 text-[13px] font-medium text-mist">
              Tenía anotado &quot;a veces abrimos desde las 8am si hay citas tempranas&quot; — ¿es real?
            </p>
            <RadioGroup
              value={datos.negocio.abre8am}
              onChange={(v) => setNegocio({ abre8am: v })}
              options={[
                { value: "no", label: "No, quítalo — el horario fijo es el de arriba" },
                { value: "si", label: "Sí, es real" },
              ]}
            />
            {datos.negocio.abre8am === "si" && (
              <div className="mt-2.5">
                <Field label="¿Cuándo aplica exactamente?">
                  <textarea
                    className={cn(inputClass, "min-h-[70px] resize-y")}
                    value={datos.negocio.abre8amDetalle}
                    onChange={(e) => setNegocio({ abre8amDetalle: e.target.value })}
                    placeholder="Ej: cuando una clienta pide cita antes de las 9 con al menos un día de anticipación"
                  />
                </Field>
              </div>
            )}

            <p className="mb-2 mt-4 text-[13px] font-medium text-mist">Festivos</p>
            <RadioGroup
              value={datos.negocio.festivos}
              onChange={(v) => setNegocio({ festivos: v })}
              options={[
                { value: "cerrado", label: "Cerramos" },
                { value: "normal", label: "Trabajamos normal" },
              ]}
            />
          </Card>

          <Card n={8} title="Confirmación de citas">
            <Note>
              Carla, Kelly y tú: la cita se confirma sola apenas hay espacio, sin que nadie la apruebe a mano. Nicol: la cita
              queda pendiente hasta que ella misma la apruebe.
            </Note>
            <RadioGroup
              value={datos.reglas.confirmacion}
              onChange={(v) => setReglas({ confirmacion: v })}
              options={[
                { value: "si", label: "Sigue siendo así" },
                { value: "no", label: "Quiero cambiar algo (te explico abajo)" },
              ]}
            />
            {datos.reglas.confirmacion === "no" && (
              <div className="mt-2.5">
                <textarea
                  className={cn(inputClass, "min-h-[70px] resize-y")}
                  value={datos.reglas.confirmacionDetalle}
                  onChange={(e) => setReglas({ confirmacionDetalle: e.target.value })}
                  placeholder="Cuéntame qué quieres cambiar"
                />
              </div>
            )}
          </Card>

          <Card n={9} title="Cancelaciones">
            <Field label="Tiempo mínimo para avisar si cancelan o cambian la hora">
              <input
                type="text"
                className={inputClass}
                value={datos.negocio.tiempoCancelacion}
                onChange={(e) => setNegocio({ tiempoCancelacion: e.target.value })}
                placeholder="Ej: 2 horas antes, o 'sin restricción'"
              />
            </Field>
            <p className="mb-2 mt-4 text-[13px] font-medium text-mist">¿Se cobra algo por cancelar tarde o no presentarse?</p>
            <RadioGroup
              value={datos.negocio.cobroCancelacion}
              onChange={(v) => setNegocio({ cobroCancelacion: v })}
              options={[
                { value: "no", label: "No se cobra nada" },
                { value: "si", label: "Sí se cobra" },
              ]}
            />
            {datos.negocio.cobroCancelacion === "si" && (
              <div className="mt-2.5">
                <Field label="¿Cuánto?">
                  <input
                    type="text"
                    className={inputClass}
                    value={datos.negocio.montoCancelacion}
                    onChange={(e) => setNegocio({ montoCancelacion: e.target.value })}
                    placeholder="Ej: $10.000"
                  />
                </Field>
              </div>
            )}
          </Card>
        </div>

        <p className="mt-2 text-center text-[12px] text-mist">Puedes guardar las veces que quieras — cada vez se actualiza con lo último.</p>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 flex justify-center bg-gradient-to-t from-ink via-ink/95 to-transparent px-4 pb-5 pt-8">
        <Button onClick={guardar} loading={guardando} className="w-full max-w-[608px]" size="md">
          Guardar respuestas
        </Button>
      </div>
    </div>
  );
}
