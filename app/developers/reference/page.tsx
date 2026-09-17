import { OpenApiReference } from "@/components/developers/OpenApiReference";

// DuLabs Developer V1 -- Fase 14.2. Página de API Reference, renderizada desde
// el OpenAPI versionado (fuente única de docs).

export default function ReferencePage() {
  return (
    <>
      <h1 className="text-2xl font-semibold text-fg">API Reference</h1>
      <p className="mt-3 text-sm text-mist">Endpoints públicos del API (auth por API key). Generado desde el OpenAPI del repositorio.</p>
      <div className="mt-4">
        <OpenApiReference />
      </div>
    </>
  );
}
