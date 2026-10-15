/**
 * CMS comercial — TOPE DE ESPERA de las lecturas de la tienda pública que van en TODAS las pantallas o que no tienen otro contenido (el pie de página y las páginas propias). PURO.
 *
 * Una lectura lenta nunca debe dejar esperando al cliente: pasado el plazo se rinde con un error que quien llama convierte en «dibuja lo de siempre» (el pie) o «no pudimos cargar esta
 * página» (una página propia).
 */
export class PlazoVencido extends Error {
  constructor(que: string) {
    super(`la lectura ${que} tardó demasiado`);
  }
}

/** Espera `trabajo` hasta `ms` milisegundos; pasado el tope rechaza con `PlazoVencido`. El temporizador siempre se libera. */
export async function conPlazo<T>(trabajo: Promise<T>, ms: number, que: string): Promise<T> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const tope = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(() => rechazar(new PlazoVencido(que)), ms);
  });
  try {
    return await Promise.race([trabajo, tope]);
  } finally {
    clearTimeout(temporizador);
  }
}
