import type { Metadata } from "next";
import { MiCitaAmore } from "@/components/mi-cita/MiCitaAmore";

// AMORE «Mi cita»: la página del enlace personal. El token de la URL es el secreto: fuera de los buscadores y sin enviarlo como Referer a ningún sitio externo.
export const metadata: Metadata = {
  title: "Mi cita · AMORE",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function MiCitaPage() {
  return <MiCitaAmore />;
}
