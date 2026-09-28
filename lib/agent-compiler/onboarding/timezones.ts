// Business Agent 2.0, FASE 6 — zonas horarias en lenguaje humano. El backend guarda SIEMPRE el identificador IANA;
// la persona elige "Bogotá, Colombia". Solo zonas IANA válidas (lo verifica un test contra Intl).

export interface TimezoneOption {
  iana: string;
  label: string;
}

export const TIMEZONE_OPTIONS: readonly TimezoneOption[] = [
  { iana: "America/Bogota", label: "Bogotá, Colombia" },
  { iana: "America/Mexico_City", label: "Ciudad de México, México" },
  { iana: "America/Lima", label: "Lima, Perú" },
  { iana: "America/Guayaquil", label: "Guayaquil, Ecuador" },
  { iana: "America/Panama", label: "Ciudad de Panamá, Panamá" },
  { iana: "America/Caracas", label: "Caracas, Venezuela" },
  { iana: "America/Santiago", label: "Santiago, Chile" },
  { iana: "America/Argentina/Buenos_Aires", label: "Buenos Aires, Argentina" },
  { iana: "America/Sao_Paulo", label: "São Paulo, Brasil" },
  { iana: "America/Santo_Domingo", label: "Santo Domingo, República Dominicana" },
  { iana: "America/Costa_Rica", label: "San José, Costa Rica" },
  { iana: "America/Guatemala", label: "Ciudad de Guatemala, Guatemala" },
  { iana: "America/New_York", label: "Nueva York / Miami, EE. UU." },
  { iana: "America/Los_Angeles", label: "Los Ángeles, EE. UU." },
  { iana: "Europe/Madrid", label: "Madrid, España" },
];

export const DEFAULT_TIMEZONE = "America/Bogota";

export function timezoneLabel(iana: string | undefined): string {
  return TIMEZONE_OPTIONS.find((t) => t.iana === iana)?.label ?? iana ?? "";
}

export function isOfferedTimezone(iana: string): boolean {
  return TIMEZONE_OPTIONS.some((t) => t.iana === iana);
}
