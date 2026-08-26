import type { Metadata } from "next";

// Herramienta interna por token (como /agenda/[token]) -- nunca debe
// indexarse ni aparecer en resultados de búsqueda.
export const metadata: Metadata = {
  title: "Configuración del bot",
  robots: { index: false, follow: false },
};

export default function ConfigBotLayout({ children }: { children: React.ReactNode }) {
  return children;
}
