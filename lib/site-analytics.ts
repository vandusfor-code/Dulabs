export type ConversionEvent =
  | "cta_whatsapp"
  | "cta_enterprise"
  | "form_enterprise_start"
  | "form_enterprise_submit"
  | "plan_select";

declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[];
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
  }
}

/** Eventos de conversión para GTM / GA / Meta Pixel (cuando estén configurados). */
export function trackConversion(event: ConversionEvent, detail?: Record<string, string>) {
  if (typeof window === "undefined") return;
  const payload = { event, ...detail };
  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push(payload);
  window.gtag?.("event", event, detail);
  window.fbq?.("trackCustom", event, detail);
}
