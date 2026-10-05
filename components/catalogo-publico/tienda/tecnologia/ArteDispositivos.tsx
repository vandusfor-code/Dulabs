/**
 * Dibujos DECORATIVOS de dispositivos para el hero y los banners del tema "tecnologia". No son fotos ni renders de productos del catálogo: son
 * ilustración vectorial (sin peso de imagen, nítida en cualquier pantalla) que ocupa el lugar del render hasta que el negocio suba el suyo
 * (`hero.imagen` en lib/catalogo/vitrina.ts). Las fotos reales de los productos viven en las tarjetas, nunca aquí. Todo es aria-hidden.
 * Server Component puro (sin estado ni efectos).
 */
import type { ArteBanner } from "@/lib/catalogo/vitrina";

const BASE = { "aria-hidden": true, focusable: false } as const;

/** Composición del hero: tablet, estuche de audífonos y smartwatch sobre un pedestal, con un aro luminoso detrás. */
export function ArteHero({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 280 220" fill="none" className={className} {...BASE}>
      <defs>
        <linearGradient id="ah-aro" x1="40" y1="170" x2="250" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#19c8ff" stopOpacity="0" />
          <stop offset="0.35" stopColor="#19c8ff" />
          <stop offset="1" stopColor="#087cff" />
        </linearGradient>
        <radialGradient id="ah-halo" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#1597ff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#1597ff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ah-pantalla" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6d28d9" />
          <stop offset="0.5" stopColor="#2563eb" />
          <stop offset="1" stopColor="#19c8ff" />
        </linearGradient>
        <linearGradient id="ah-marco" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2b3b60" />
          <stop offset="1" stopColor="#0c1730" />
        </linearGradient>
        <linearGradient id="ah-reloj" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b2745" />
          <stop offset="1" stopColor="#0a1226" />
        </linearGradient>
        <linearGradient id="ah-estuche" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#d9e1ee" />
        </linearGradient>
        <linearGradient id="ah-pedestal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#14213f" />
          <stop offset="1" stopColor="#060f22" />
        </linearGradient>
        <filter id="ah-brillo" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>

      {/* Halo y aro luminoso */}
      <circle cx="160" cy="112" r="104" fill="url(#ah-halo)" />
      <path d="M52 164a104 104 0 1 1 196-12" stroke="url(#ah-aro)" strokeWidth="6" strokeLinecap="round" opacity="0.55" filter="url(#ah-brillo)" />
      <path d="M52 164a104 104 0 1 1 196-12" stroke="url(#ah-aro)" strokeWidth="2.4" strokeLinecap="round" />

      {/* Pedestal */}
      <ellipse cx="150" cy="196" rx="118" ry="17" fill="url(#ah-pedestal)" />
      <ellipse cx="150" cy="190" rx="112" ry="13" fill="#0e1b38" stroke="#243557" strokeWidth="1" />
      <ellipse cx="150" cy="188" rx="86" ry="8" fill="#13244a" opacity="0.8" />

      {/* Tablet */}
      <g transform="rotate(-8 120 104)">
        <rect x="40" y="40" width="168" height="116" rx="12" fill="url(#ah-marco)" stroke="#3a4d7a" strokeWidth="1.2" />
        <rect x="46.5" y="46.5" width="155" height="103" rx="7.5" fill="url(#ah-pantalla)" />
        <path d="M46.5 120c28-24 52-4 78-22s46-18 77-8v52a7.5 7.5 0 0 1-7.5 7.5h-140A7.5 7.5 0 0 1 46.5 142z" fill="#0b1b4a" opacity="0.45" />
        <path d="M70 46.5c-4 26 14 44 42 50s60-6 89.500-28V54a7.500 7.500 0 0 0-7.500-7.500z" fill="#ffffff" opacity="0.12" />
        <circle cx="124.500" cy="43.300" r="1.300" fill="#5b6f9c" />
      </g>

      {/* Estuche de audífonos */}
      <g transform="translate(100 130)">
        <rect x="0" y="6" width="64" height="52" rx="16" fill="url(#ah-estuche)" />
        <path d="M2 28h60" stroke="#c4cfe0" strokeWidth="1.4" />
        <rect x="26" y="26" width="12" height="4.500" rx="2.200" fill="#aab8d0" />
        <circle cx="32" cy="46" r="2" fill="#9fb0cb" />
        <path d="M10 14c6-6 38-6 44 0" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
        <ellipse cx="32" cy="60" rx="30" ry="4.500" fill="#000000" opacity="0.18" />
      </g>

      {/* Smartwatch */}
      <g transform="translate(190 58)">
        <rect x="14" y="-6" width="36" height="22" rx="9" fill="#0d1427" />
        <rect x="14" y="68" width="36" height="24" rx="9" fill="#0d1427" />
        <rect x="0" y="6" width="64" height="74" rx="20" fill="url(#ah-reloj)" stroke="#34466f" strokeWidth="1.600" />
        <rect x="5.500" y="11.500" width="53" height="63" rx="15.500" fill="#050a17" />
        <circle cx="32" cy="43" r="19" stroke="#0e2a52" strokeWidth="5" />
        <path d="M32 24a19 19 0 0 1 16.500 9.500" stroke="#19c8ff" strokeWidth="5" strokeLinecap="round" />
        <path d="M48.500 52.500A19 19 0 0 1 32 62" stroke="#ff9f1a" strokeWidth="5" strokeLinecap="round" />
        <path d="M23 59.500A19 19 0 0 1 13 43" stroke="#1597ff" strokeWidth="5" strokeLinecap="round" />
        <text x="32" y="46.500" textAnchor="middle" fontSize="12" fontWeight="700" fill="#ffffff" fontFamily="system-ui, sans-serif">
          10:08
        </text>
        <rect x="62" y="30" width="4" height="12" rx="2" fill="#2a3a60" />
      </g>
    </svg>
  );
}

/** Banner "Tablets": una tablet inclinada con pantalla de gradiente. */
function ArteTablet({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 150" fill="none" className={className} {...BASE}>
      <defs>
        <linearGradient id="at-pantalla" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6d28d9" />
          <stop offset="0.55" stopColor="#2563eb" />
          <stop offset="1" stopColor="#19c8ff" />
        </linearGradient>
        <linearGradient id="at-marco" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#32456f" />
          <stop offset="1" stopColor="#0c1730" />
        </linearGradient>
      </defs>
      <g transform="rotate(-10 100 78)">
        <rect x="26" y="20" width="156" height="108" rx="12" fill="url(#at-marco)" stroke="#3f538a" strokeWidth="1.200" />
        <rect x="32.500" y="26.500" width="143" height="95" rx="7.500" fill="url(#at-pantalla)" />
        <path d="M32.500 100c26-22 48-4 72-20s42-16 71-8v42a7.500 7.500 0 0 1-7.500 7.500H40A7.500 7.500 0 0 1 32.500 114z" fill="#0b1b4a" opacity="0.45" />
        <path d="M58 26.500c-3 24 12 40 38 46s56-6 79.500-26V34a7.500 7.500 0 0 0-7.500-7.500z" fill="#ffffff" opacity="0.13" />
      </g>
    </svg>
  );
}

/** Banner "Smartwatch": reloj con correas y esfera de anillos. */
function ArteSmartwatch({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 150" fill="none" className={className} {...BASE}>
      <defs>
        <linearGradient id="as-caja" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#24325a" />
          <stop offset="1" stopColor="#0a1226" />
        </linearGradient>
        <linearGradient id="as-correa" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#16213f" />
          <stop offset="1" stopColor="#0b1328" />
        </linearGradient>
      </defs>
      <g transform="rotate(8 100 76)">
        <rect x="72" y="-8" width="58" height="52" rx="14" fill="url(#as-correa)" />
        <rect x="72" y="108" width="58" height="52" rx="14" fill="url(#as-correa)" />
        <rect x="58" y="26" width="86" height="100" rx="26" fill="url(#as-caja)" stroke="#3a4f80" strokeWidth="1.800" />
        <rect x="65.500" y="33.500" width="71" height="85" rx="20" fill="#050a17" />
        <circle cx="101" cy="76" r="25" stroke="#0e2a52" strokeWidth="7" />
        <path d="M101 51a25 25 0 0 1 21.700 12.500" stroke="#19c8ff" strokeWidth="7" strokeLinecap="round" />
        <path d="M122.700 88.500A25 25 0 0 1 101 101" stroke="#ff9f1a" strokeWidth="7" strokeLinecap="round" />
        <path d="M89 98.500A25 25 0 0 1 76 76" stroke="#1597ff" strokeWidth="7" strokeLinecap="round" />
        <text x="101" y="81" textAnchor="middle" fontSize="16" fontWeight="700" fill="#ffffff" fontFamily="system-ui, sans-serif">
          09:30
        </text>
        <rect x="143" y="62" width="5" height="16" rx="2.500" fill="#2a3a60" />
      </g>
    </svg>
  );
}

/** Banner "Celulares": teléfono con pantalla de gradiente. */
function ArteCelular({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 150" fill="none" className={className} {...BASE}>
      <defs>
        <linearGradient id="ac-pantalla" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0ea5e9" />
          <stop offset="0.55" stopColor="#2563eb" />
          <stop offset="1" stopColor="#7c3aed" />
        </linearGradient>
        <linearGradient id="ac-marco" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3a4d7a" />
          <stop offset="1" stopColor="#0c1730" />
        </linearGradient>
      </defs>
      <g transform="rotate(12 100 76)">
        <rect x="68" y="6" width="74" height="138" rx="16" fill="url(#ac-marco)" stroke="#4a5f95" strokeWidth="1.400" />
        <rect x="73.500" y="11.500" width="63" height="127" rx="11.500" fill="url(#ac-pantalla)" />
        <path d="M73.500 96c20-18 34-2 63-14v44a11.500 11.500 0 0 1-11.500 12H85A11.500 11.500 0 0 1 73.500 126z" fill="#0b1b4a" opacity="0.4" />
        <rect x="93" y="15" width="24" height="6" rx="3" fill="#050a17" />
      </g>
    </svg>
  );
}

export function ArteDeBanner({ arte, className }: { arte: ArteBanner; className?: string }) {
  if (arte === "smartwatch") return <ArteSmartwatch className={className} />;
  if (arte === "celular") return <ArteCelular className={className} />;
  return <ArteTablet className={className} />;
}
