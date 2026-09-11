import type { Metadata } from "next";
import { NavV2 } from "@/components/site-v2/NavV2";
import { HeroV2 } from "@/components/site-v2/HeroV2";

// Preview aislado del rediseño (DuLabs V2). NO debe indexarse ni aparecer
// públicamente como la home hasta que se apruebe la migración (regla 53/54).
export const metadata: Metadata = {
  title: "DuLabs V2 — Preview",
  robots: { index: false, follow: false },
  alternates: { canonical: undefined },
};

export default function V2Home() {
  return (
    <div className="v2-scope relative min-h-screen">
      <NavV2 />
      <main>
        <HeroV2 />
      </main>
    </div>
  );
}
