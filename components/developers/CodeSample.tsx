"use client";

import { useState } from "react";

// DuLabs Developer V1 -- Fase 14. Bloque de código con pestañas cURL / JS-TS y
// botón de copiar. Ejemplos SIEMPRE con placeholders (dl_live_…), nunca claves
// reales. Sin dependencias externas.

type Lenguaje = "curl" | "js";

export function CodeSample({ curl, js, titulo }: { curl: string; js?: string; titulo?: string }) {
  const tieneJs = typeof js === "string" && js.length > 0;
  const [lang, setLang] = useState<Lenguaje>("curl");
  const [copiado, setCopiado] = useState(false);
  const codigo = lang === "js" && tieneJs ? js! : curl;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      // clipboard no disponible -- no crítico
    }
  }

  return (
    // min-w-0 + max-w-full: el bloque nunca impone su ancho natural a un contenedor flex/grid; el código hace scroll dentro del <pre>.
    <div className="my-4 min-w-0 max-w-full overflow-hidden rounded-lg border border-edge bg-ink">
      <div className="flex items-center justify-between gap-2 border-b border-edge px-3 py-2">
        <div className="flex min-w-0 items-center gap-1">
          <button onClick={() => setLang("curl")} className={`rounded px-2 py-0.5 text-xs ${lang === "curl" ? "bg-dev-accent text-dev-accent-fg" : "text-mist hover:text-fg"}`}>cURL</button>
          {tieneJs ? <button onClick={() => setLang("js")} className={`rounded px-2 py-0.5 text-xs ${lang === "js" ? "bg-dev-accent text-dev-accent-fg" : "text-mist hover:text-fg"}`}>JavaScript</button> : null}
          {titulo ? <span className="ml-2 min-w-0 truncate text-xs text-mist">{titulo}</span> : null}
        </div>
        <button onClick={copiar} className="shrink-0 rounded border border-edge px-2 py-0.5 text-xs text-mist hover:text-fg">{copiado ? "Copiado" : "Copiar"}</button>
      </div>
      <pre className="overflow-x-auto p-4 text-[12px] leading-relaxed text-fg"><code>{codigo}</code></pre>
    </div>
  );
}
