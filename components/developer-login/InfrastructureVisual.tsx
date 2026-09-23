"use client";

import { useI18n } from "@/lib/i18n";
import { useMenosMovimiento } from "@/components/developer-platform/motion";

// DuLabs Developer · login -- panel visual. Una estancia en perspectiva dibujada con líneas finísimas: un portal de luz fría (la arista
// vertical), el suelo y el techo que convergen hacia él, nodos en los cruces y un único punto de luz que recorre las aristas de fuera
// hacia dentro y de abajo hacia arriba (~13 s). Todo es SVG + CSS: las líneas se trazan una vez al entrar, el halo respira (12 s), los
// nodos laten (10 s) y las líneas del suelo derivan unos píxeles (14 s). Sin canvas, sin librerías. Con reduced motion: composición
// estática (sin punto de luz, sin loops).

// Geometría (viewBox 800 × 1000). El portal es la arista x = 540 entre el techo (y = 170) y el suelo (y = 640).
const PORTAL = { x: 540, arriba: 170, abajo: 640 };
const TECHO_FIN = { x: 800, y: 50 };
const SUELO_IZQ = { x: 0, y: 735 };
const SUELO_DER = { x: 800, y: 835 };
const RUTA_LUZ = `M${SUELO_IZQ.x},${SUELO_IZQ.y} L${PORTAL.x},${PORTAL.abajo} L${PORTAL.x},${PORTAL.arriba} L${TECHO_FIN.x},${TECHO_FIN.y}`;
const NODOS: [number, number, number][] = [
  [PORTAL.x, PORTAL.arriba, 0],
  [PORTAL.x, PORTAL.abajo, 2.5],
  [680, 105, 5],
  [680, 745, 1.5],
  [260, 689, 3.5],
  [760, 805, 6.5],
];

export function InfrastructureVisual({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  const menos = useMenosMovimiento();
  return (
    <div aria-hidden className={`relative overflow-hidden bg-auth-bg [mask-image:linear-gradient(90deg,transparent,#000_9%)] ${className}`}>
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 800 1000" preserveAspectRatio="xMidYMid slice" fill="none">
        <defs>
          <radialGradient id="dl-halo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.14" />
            <stop offset="35%" stopColor="#3B82F6" stopOpacity="0.07" />
            <stop offset="70%" stopColor="#3B82F6" stopOpacity="0.02" />
            <stop offset="100%" stopColor="#3B82F6" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="dl-reflejo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#60A5FA" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#60A5FA" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="dl-portal" x1="0" y1={PORTAL.arriba} x2="0" y2={PORTAL.abajo} gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#60A5FA" stopOpacity="0.25" />
            <stop offset="55%" stopColor="#DBEAFE" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#93C5FD" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id="dl-suelo" x1={PORTAL.x} y1="0" x2={SUELO_IZQ.x} y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#93C5FD" stopOpacity="0.75" />
            <stop offset="60%" stopColor="#60A5FA" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#60A5FA" stopOpacity="0.05" />
          </linearGradient>
          <filter id="dl-brillo" x="-50%" y="-10%" width="200%" height="120%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>

        {/* Luz ambiental: un halo frío detrás del portal y su reflejo en el suelo. */}
        <ellipse className="dl-halo" cx={PORTAL.x} cy="420" rx="340" ry="460" fill="url(#dl-halo)" />
        <ellipse className="dl-halo" cx={PORTAL.x} cy={PORTAL.abajo} rx="280" ry="46" fill="url(#dl-reflejo)" style={{ animationDelay: "-6s" }} />

        {/* Muro derecho: juntas verticales entre el techo y el suelo. */}
        <g stroke="#FFFFFF" strokeOpacity="0.06" strokeWidth="1">
          <line x1="680" y1="105" x2="680" y2="745" />
          <line x1="760" y1="68" x2="760" y2="805" />
        </g>

        {/* Suelo: líneas paralelas que derivan unos píxeles, muy lento. */}
        <g className="dl-deriva" stroke="#FFFFFF" strokeWidth="1">
          <line x1="600" y1="700" x2="0" y2="812" strokeOpacity="0.05" />
          <line x1="690" y1="792" x2="0" y2="921" strokeOpacity="0.04" />
          <line x1="790" y1="905" x2="120" y2="1000" strokeOpacity="0.03" />
          <line x1={PORTAL.x} y1={PORTAL.abajo} x2="140" y2="1000" strokeOpacity="0.035" />
          <line x1={PORTAL.x} y1={PORTAL.abajo} x2="470" y2="1000" strokeOpacity="0.035" />
        </g>

        {/* Aristas principales: se trazan una vez al entrar. */}
        <line className="dl-traza" x1={PORTAL.x} y1={PORTAL.arriba} x2={TECHO_FIN.x} y2={TECHO_FIN.y} stroke="#FFFFFF" strokeOpacity="0.16" strokeWidth="1" style={{ ["--largo" as string]: 290, ["--retraso" as string]: "0.9s" }} />
        <line className="dl-traza" x1={PORTAL.x} y1={PORTAL.abajo} x2={SUELO_DER.x} y2={SUELO_DER.y} stroke="#FFFFFF" strokeOpacity="0.12" strokeWidth="1" style={{ ["--largo" as string]: 330, ["--retraso" as string]: "0.7s" }} />
        <line className="dl-traza" x1={PORTAL.x} y1={PORTAL.abajo} x2={SUELO_IZQ.x} y2={SUELO_IZQ.y} stroke="url(#dl-suelo)" strokeWidth="1.2" style={{ ["--largo" as string]: 560, ["--retraso" as string]: "0.5s" }} />

        {/* El portal: resplandor suave + línea nítida. */}
        <g className="dl-portal-luz">
          <line x1={PORTAL.x} y1={PORTAL.arriba} x2={PORTAL.x} y2={PORTAL.abajo} stroke="#60A5FA" strokeOpacity="0.45" strokeWidth="5" filter="url(#dl-brillo)" />
          <line className="dl-traza" x1={PORTAL.x} y1={PORTAL.abajo} x2={PORTAL.x} y2={PORTAL.arriba} stroke="url(#dl-portal)" strokeWidth="1.5" style={{ ["--largo" as string]: 480, ["--retraso" as string]: "0.2s" }} />
        </g>

        {/* Nodos en los cruces, latiendo desfasados. */}
        {NODOS.map(([cx, cy, retraso]) => (
          <circle key={`${cx}-${cy}`} className="dl-nodo" cx={cx} cy={cy} r="2" fill="#93C5FD" style={{ ["--retraso" as string]: `-${retraso}s` }} />
        ))}

        {/* Un solo punto de luz recorre las aristas: suelo -> portal -> techo, con pausas (infraestructura viva, no decoración). */}
        {menos ? null : (
          <g opacity="0">
            <circle r="7" fill="#60A5FA" fillOpacity="0.18" />
            <circle r="2.2" fill="#DBEAFE" />
            <animateMotion
              dur="13s"
              repeatCount="indefinite"
              path={RUTA_LUZ}
              keyPoints="0;0.42;0.78;1;1"
              keyTimes="0;0.34;0.66;0.84;1"
              calcMode="spline"
              keySplines="0.45 0 0.55 1;0.45 0 0.55 1;0.45 0 0.55 1;0 0 1 1"
            />
            <animate attributeName="opacity" dur="13s" repeatCount="indefinite" values="0;1;1;0;0" keyTimes="0;0.06;0.8;0.86;1" />
          </g>
        )}
      </svg>

      <div className="dl-panel-texto pointer-events-none absolute left-[12%] top-[42%] font-mono text-[11px] uppercase leading-[2.1] tracking-[0.34em] text-auth-text-2">
        <p>{t("Infraestructura", "Infrastructure")}</p>
        <p>{t("para lo que viene", "for what comes next")}</p>
        <span className="mt-5 block h-px w-10 bg-auth-text-2/50" />
      </div>
    </div>
  );
}
