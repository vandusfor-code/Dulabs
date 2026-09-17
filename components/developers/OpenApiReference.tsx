import { OPENAPI_DEVELOPER_V1 } from "@/lib/developers/openapi";

// DuLabs Developer V1 -- Fase 14.2. Render ligero (sin dependencias externas)
// del OpenAPI como referencia legible. La fuente de verdad es lib/developers/
// openapi.ts; esto solo lo presenta.

type Schema = { type?: string | string[]; properties?: Record<string, Schema>; required?: string[]; enum?: readonly unknown[]; description?: string; $ref?: string; items?: Schema; format?: string; default?: unknown };
type Param = { name?: string; in?: string; required?: boolean; schema?: Schema; description?: string; $ref?: string };
type Operation = { summary?: string; description?: string; parameters?: Param[]; requestBody?: { content: Record<string, { schema: Schema }> }; responses: Record<string, { description?: string; content?: Record<string, { schema: Schema }> }> };
type PathItem = { get?: Operation; post?: Operation };
type Doc = {
  servers: { url: string }[];
  components: { schemas: Record<string, Schema>; parameters: Record<string, Param>; securitySchemes: Record<string, { scheme?: string; description?: string }> };
  paths: Record<string, PathItem>;
};

const doc = OPENAPI_DEVELOPER_V1 as unknown as Doc;

function nombreDeRef(ref?: string): string | null {
  return ref ? ref.split("/").pop() ?? null : null;
}
function resolverSchema(s?: Schema): { nombre: string | null; schema: Schema | null } {
  if (!s) return { nombre: null, schema: null };
  if (s.$ref) {
    const nombre = nombreDeRef(s.$ref);
    return { nombre, schema: nombre ? doc.components.schemas[nombre] ?? null : null };
  }
  return { nombre: null, schema: s };
}
function tipoTexto(s?: Schema): string {
  if (!s) return "";
  if (s.$ref) return nombreDeRef(s.$ref) ?? "object";
  const t = Array.isArray(s.type) ? s.type.join(" | ") : s.type ?? (s.enum ? "enum" : "object");
  if (s.enum) return `${t} (${s.enum.map((e) => JSON.stringify(e)).join(", ")})`;
  if (s.type === "array" && s.items) return `${nombreDeRef(s.items.$ref) ?? s.items.type ?? "object"}[]`;
  return String(t);
}

function TablaSchema({ schema }: { schema: Schema | null }) {
  if (!schema?.properties) return null;
  const req = new Set(schema.required ?? []);
  return (
    <table className="mt-2 w-full text-left text-xs">
      <thead>
        <tr className="border-b border-edge text-[10px] uppercase tracking-wide text-mist">
          <th className="py-1 pr-3">Campo</th><th className="py-1 pr-3">Tipo</th><th className="py-1 pr-3">Req.</th><th className="py-1">Descripción</th>
        </tr>
      </thead>
      <tbody className="text-mist">
        {Object.entries(schema.properties).map(([k, v]) => (
          <tr key={k} className="border-b border-edge/50">
            <td className="py-1 pr-3 font-mono text-fg">{k}</td>
            <td className="py-1 pr-3">{tipoTexto(v)}</td>
            <td className="py-1 pr-3">{req.has(k) ? "sí" : "—"}</td>
            <td className="py-1">{v.description ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Operacion({ metodo, ruta, op }: { metodo: string; ruta: string; op: Operation }) {
  const params = (op.parameters ?? []).map((p) => (p.$ref ? doc.components.parameters[nombreDeRef(p.$ref)!] ?? p : p));
  const body = op.requestBody?.content?.["application/json"]?.schema;
  const bodyResuelto = resolverSchema(body);
  return (
    <div className="mt-6 rounded-lg border border-edge bg-card p-4">
      <div className="flex items-center gap-2">
        <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${metodo === "POST" ? "bg-dev-accent-soft text-dev-accent" : "bg-success text-success-text"}`}>{metodo}</span>
        <code className="text-sm text-fg">{ruta}</code>
      </div>
      {op.summary ? <p className="mt-2 text-sm font-medium text-fg">{op.summary}</p> : null}
      {op.description ? <p className="mt-1 text-xs text-mist">{op.description}</p> : null}

      {params.length ? (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-mist">Parámetros</p>
          <ul className="mt-1 space-y-0.5 text-xs text-mist">
            {params.map((p) => (
              <li key={p.name}><code className="text-fg">{p.name}</code> <span className="text-[10px]">({p.in}{p.required ? ", requerido" : ""})</span>{p.description ? ` — ${p.description}` : ""}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {bodyResuelto.schema ? (
        <div className="mt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-mist">Cuerpo {bodyResuelto.nombre ? `(${bodyResuelto.nombre})` : ""}</p>
          <TablaSchema schema={bodyResuelto.schema} />
        </div>
      ) : null}

      <div className="mt-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-mist">Respuestas</p>
        <ul className="mt-1 space-y-0.5 text-xs text-mist">
          {Object.entries(op.responses).map(([status, r]) => {
            const s = resolverSchema(r.content?.["application/json"]?.schema);
            return <li key={status}><code className="text-fg">{status}</code> — {r.description ?? ""}{s.nombre ? ` (${s.nombre})` : ""}</li>;
          })}
        </ul>
      </div>
    </div>
  );
}

export function OpenApiReference() {
  return (
    <div>
      <div className="rounded-lg border border-edge bg-card p-4 text-sm text-mist">
        <p><span className="font-semibold text-fg">Base URL:</span> <code className="text-fg">{doc.servers[0].url}</code></p>
        <p className="mt-1"><span className="font-semibold text-fg">Auth:</span> <code className="text-fg">Authorization: Bearer dl_live_…</code> (API key)</p>
        <p className="mt-1">Spec OpenAPI: <a href="/api/developers/openapi" className="text-dev-accent hover:underline">/api/developers/openapi</a></p>
      </div>

      {Object.entries(doc.paths).map(([ruta, item]) => (
        <div key={ruta}>
          {item.get ? <Operacion metodo="GET" ruta={ruta} op={item.get} /> : null}
          {item.post ? <Operacion metodo="POST" ruta={ruta} op={item.post} /> : null}
        </div>
      ))}
    </div>
  );
}
