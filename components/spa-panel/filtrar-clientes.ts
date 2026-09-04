// AMORE (Fase 4, base de clientes, autorizado) — filtro puro por nombre O
// teléfono, sin distinguir mayúsculas/tildes ni símbolos del teléfono
// (espacios, +, guiones). Usado por ClientesPage para no depender de un
// segundo viaje de red por cada tecla -- el listado ya viene completo y
// filtrado por tenant desde el backend.
export type ClienteFiltrable = { nombre: string; telefono: string };

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function soloDigitos(texto: string): string {
  return texto.replace(/\D/g, "");
}

export function filtrarClientes<T extends ClienteFiltrable>(clientes: T[], busqueda: string): T[] {
  const texto = busqueda.trim();
  if (!texto) return clientes;

  const textoNormalizado = normalizar(texto);
  const digitosBusqueda = soloDigitos(texto);

  return clientes.filter((c) => {
    if (normalizar(c.nombre).includes(textoNormalizado)) return true;
    if (digitosBusqueda && soloDigitos(c.telefono).includes(digitosBusqueda)) return true;
    return false;
  });
}
