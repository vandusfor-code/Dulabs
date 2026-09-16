import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

// DuLabs Developer V1 -- Fase 3. Lectura de secretos de infraestructura
// (sección K del documento) -- distinto de KMS envelope encryption
// (lib/developer/secure-crypto.ts), que es para los secretos PERSISTENTES
// por-tenant. Esto es solo para las credenciales compartidas de la
// plataforma (Supabase, App Secret de Meta, etc.).

let cliente: SecretManagerServiceClient | null = null;
function obtenerCliente(): SecretManagerServiceClient {
  if (!cliente) cliente = new SecretManagerServiceClient();
  return cliente;
}

/** Lee la versión "latest" de un secreto de Secret Manager. `nombreProyecto` es el project ID de GCP (no el nombre completo del recurso). */
export async function leerSecreto(nombreProyecto: string, nombreSecreto: string): Promise<string> {
  const cliente = obtenerCliente();
  const [version] = await cliente.accessSecretVersion({ name: `projects/${nombreProyecto}/secrets/${nombreSecreto}/versions/latest` });
  const valor = version.payload?.data?.toString();
  if (!valor) throw new Error(`[secret-manager] el secreto ${nombreSecreto} no devolvió contenido`);
  return valor;
}
