import { ArrowLeft } from "lucide-react";
import { AMORE, serifAmore } from "./tema";

// AMORE (Fase 3 del portal, autorizado) — header compartido de las
// pantallas del portal de AMORE. `negocio` viene SIEMPRE del dato real que
// devuelve /api/reservar/[tenant] (nunca hardcodeado) -- mismo criterio que
// PortalHeader.tsx de Daniela, con identidad visual propia.
//
// Logo: no existe todavía ningún archivo de logo de AMORE en el proyecto
// (verificado antes de escribir esto) -- se deja un monograma tipográfico
// ("A") como placeholder. Reemplazar por <img src="/amore-logo.png" .../>
// aquí mismo en cuanto el logo real exista; ningún otro archivo necesita
// cambiar para eso.
function MonogramaAmore() {
  return (
    <div
      className="flex size-9 items-center justify-center rounded-full text-[15px] font-semibold"
      style={{ backgroundColor: AMORE.burdeos, color: "#fff", ...serifAmore }}
    >
      A
    </div>
  );
}

export function PortalHeaderAmore({ negocio, onVolver }: { negocio: string; onVolver?: () => void }) {
  return (
    <header className="flex items-center justify-between">
      {onVolver ? (
        <button
          type="button"
          onClick={onVolver}
          aria-label="Volver"
          className="flex size-9 items-center justify-center rounded-full"
          style={{ color: AMORE.texto }}
        >
          <ArrowLeft className="size-5" strokeWidth={1.75} />
        </button>
      ) : (
        <MonogramaAmore />
      )}
      <p className="max-w-[220px] truncate text-[15px] font-semibold uppercase tracking-[0.15em]" style={{ ...serifAmore, color: AMORE.texto }}>
        {negocio}
      </p>
      <span className="w-9" />
    </header>
  );
}
