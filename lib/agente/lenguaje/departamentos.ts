/**
 * FASE 3B.4 — DEPARTAMENTOS DE COLOMBIA (división político-administrativa oficial: 32 departamentos y
 * Bogotá D.C.). Es geografía oficial, no información comercial: no dice nada de cobertura ni de envíos.
 *
 * leerDepartamento("valle") => "Valle del Cauca"; algo que no es un departamento => null (se vuelve a
 * preguntar; nunca se adivina).
 */
import { plano } from "@/lib/agente/lenguaje/normalizar";

export const DEPARTAMENTOS_COLOMBIA = [
  "Amazonas",
  "Antioquia",
  "Arauca",
  "Atlántico",
  "Bogotá D.C.",
  "Bolívar",
  "Boyacá",
  "Caldas",
  "Caquetá",
  "Casanare",
  "Cauca",
  "Cesar",
  "Chocó",
  "Córdoba",
  "Cundinamarca",
  "Guainía",
  "Guaviare",
  "Huila",
  "La Guajira",
  "Magdalena",
  "Meta",
  "Nariño",
  "Norte de Santander",
  "Putumayo",
  "Quindío",
  "Risaralda",
  "San Andrés, Providencia y Santa Catalina",
  "Santander",
  "Sucre",
  "Tolima",
  "Valle del Cauca",
  "Vaupés",
  "Vichada",
] as const;
export type Departamento = (typeof DEPARTAMENTOS_COLOMBIA)[number];

/** Formas comunes de escribirlos (ya normalizadas) => nombre oficial. */
const ALIAS: Readonly<Record<string, Departamento>> = {
  bogota: "Bogotá D.C.",
  "bogota dc": "Bogotá D.C.",
  "bogota d c": "Bogotá D.C.",
  "distrito capital": "Bogotá D.C.",
  "bogota distrito capital": "Bogotá D.C.",
  "santa fe de bogota": "Bogotá D.C.",
  valle: "Valle del Cauca",
  guajira: "La Guajira",
  "norte santander": "Norte de Santander",
  "san andres": "San Andrés, Providencia y Santa Catalina",
  "san andres y providencia": "San Andrés, Providencia y Santa Catalina",
  "archipielago de san andres": "San Andrés, Providencia y Santa Catalina",
  "san andres providencia y santa catalina": "San Andrés, Providencia y Santa Catalina",
  "archipielago de san andres providencia y santa catalina": "San Andrés, Providencia y Santa Catalina",
};

const OFICIAL = new Map<string, Departamento>(DEPARTAMENTOS_COLOMBIA.map((d) => [plano(d), d]));

/** Departamento escrito por el cliente => nombre oficial, o null. */
export function leerDepartamento(texto: string): Departamento | null {
  let t = plano(texto)
    .replace(/^(es|en|de|el|la|del)\s+/, "")
    .replace(/^(departamento|depto|dpto|dto)\s+(de\s+|del\s+)?/, "")
    .trim();
  t = t.replace(/^(el|la)\s+/, "").trim();
  if (!t || t.length > 60) return null;
  return OFICIAL.get(t) ?? ALIAS[t] ?? null;
}
