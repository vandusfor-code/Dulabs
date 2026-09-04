import { ArrowLeft, Heart } from "lucide-react";

// Fase 8A.10 (autorizado) — header compartido de las 5 pantallas del portal
// de cliente. Extraído acá para que el nombre del negocio deje de estar
// hardcodeado ("Daniela Manco Nails Spa") en cada pantalla por separado --
// viene SIEMPRE del prop `negocio` (el mismo dato real que ya devuelve
// /api/reservar/[tenant], ver app/reservar/[tenant]/page.tsx). El diseño
// queda preparado para cualquier otro tenant sin tocar el componente.
//
// Sin `onVolver`: variante de la landing (hamburguesa a la izquierda, sin
// flecha). Con `onVolver`: variante del resto de pantallas (flecha atrás).

const TEXTO = "#111111";
const ROSA = "#C94B78";

const serif = { fontFamily: "var(--font-cormorant-daniela), 'Cormorant Garamond', serif" };

function Hamburguesa() {
  return (
    <button type="button" aria-label="Menú" className="flex flex-col justify-center gap-[9px]" style={{ width: 26 }}>
      <span className="block h-[2px] w-full rounded-full" style={{ backgroundColor: TEXTO }} />
      <span className="block h-[2px] w-full rounded-full" style={{ backgroundColor: TEXTO }} />
      <span className="block h-[2px] w-full rounded-full" style={{ backgroundColor: TEXTO }} />
    </button>
  );
}

export function PortalHeader({ negocio, onVolver }: { negocio: string; onVolver?: () => void }) {
  return (
    <header className="flex items-start justify-between">
      {onVolver ? (
        <button type="button" onClick={onVolver} aria-label="Volver" className="flex size-9 items-center justify-center rounded-full" style={{ color: TEXTO }}>
          <ArrowLeft className="size-5" strokeWidth={1.75} />
        </button>
      ) : (
        <Hamburguesa />
      )}
      <div className="flex flex-col items-center gap-1 text-center">
        <Heart className="size-3.5 shrink-0" style={{ color: ROSA }} strokeWidth={1.5} />
        <p className="max-w-[220px] truncate text-[17px] font-semibold" style={{ ...serif, color: TEXTO }}>
          {negocio}
        </p>
      </div>
      <span className="w-9" />
    </header>
  );
}
