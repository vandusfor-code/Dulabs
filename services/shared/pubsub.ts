import { PubSub } from "@google-cloud/pubsub";

// DuLabs Developer V1 -- Fase 3. Cliente de Pub/Sub compartido entre
// dulabs-gateway y dulabs-reconciliation (los dos únicos runtimes que
// publican mensajes -- los Workers solo reciben). Detecta el proyecto GCP
// automáticamente vía las credenciales por defecto del entorno (Cloud Run
// las provee sin necesidad de configuración explícita).

let cliente: PubSub | null = null;
function obtenerCliente(): PubSub {
  if (!cliente) cliente = new PubSub();
  return cliente;
}

/** Publica un mensaje JSON en el topic dado. Devuelve el messageId real que Pub/Sub asigna. */
export async function publicarMensaje(topic: string, payload: unknown): Promise<string> {
  const dataBuffer = Buffer.from(JSON.stringify(payload));
  return obtenerCliente().topic(topic).publishMessage({ data: dataBuffer });
}
