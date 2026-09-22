// DuLabs Developer V1 -- Fuente de verdad ÚNICA del hostname público de la
// Developer API (`/api/v1`, servido por el gateway de Cloud Run, ver
// services/gateway). TODO lo que muestra o documenta la "Base URL" (el OpenAPI,
// las docs de /developers, el dashboard /developer, la landing
// /developer-platform y el bloque de la integración GitHub) referencia este
// valor -- el dominio nunca se hardcodea en varios lugares.
//
// SOLO DISPLAY / documentación: ni el dashboard ni la landing llaman a `/api/v1`
// desde el navegador (los developers la consumen desde SUS propias apps), así
// que cambiar este string NO cambia el ruteo real del gateway ni la
// autenticación por API key. El hostname efectivo lo resuelve el domain-mapping
// del gateway (infra), no este valor.
//
// Overridable por entorno con NEXT_PUBLIC_ (se inlinea en build para que llegue
// a los componentes de cliente); el default es el dominio de producción, así que
// no hace falta setear nada para que muestre el hostname correcto.
export const DEVELOPER_API_BASE_URL =
  process.env.NEXT_PUBLIC_DEVELOPER_API_BASE_URL?.trim() || "https://developer-api.dulabs.co/api/v1";
