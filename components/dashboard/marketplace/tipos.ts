// Tipos de la respuesta de GET /api/dashboard/marketplace, compartidos entre
// el listado y el detalle.

export interface CitasProximasResumen {
  total: number;
  proximas: { fecha: string; hora: string; cliente: string }[];
}

export interface ActivacionResumen {
  phone_number_id: string;
  nombre_negocio: string;
  tipo_plan: "recurrente" | "mes";
  fecha_proximo_cobro: string | null;
  vence_at: string | null;
  numero_admin: string | null;
  nombre_admin: string | null;
  /** Solo presente si el agente usa agenda (ver AgenteVista.usaAgenda). */
  citasProximas: CitasProximasResumen | null;
}

export interface AgenteVista {
  slug: string;
  nombre: string;
  categoria: string;
  icono: string;
  descripcion: string;
  queIncluye: string[];
  usaAgenda: boolean;
  precioRecurrente: number;
  precioMes: number;
  activacion: ActivacionResumen | null;
}

export interface NumeroVista {
  phone_number_id: string;
  nombre_negocio: string;
  marketplaceSlug: string | null;
}

export interface MarketplaceEstado {
  agentes: AgenteVista[];
  numeros: NumeroVista[];
}
