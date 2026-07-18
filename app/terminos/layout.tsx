import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Términos y Condiciones — Du Labs",
  description: "Términos y condiciones de servicio de Du Labs.",
};

export default function TerminosLayout({ children }: { children: React.ReactNode }) {
  return children;
}
