// Parseo compartido de una línea de destinatario en el formato
// "telefono" o "telefono, Nombre" — usado tanto al invitar a una encuesta
// (app/api/dashboard/surveys/invitar) como al enviar una campaña
// (app/api/campanas/enviar). El nombre es opcional: si el usuario no lo
// escribió (a mano o en la columna "Nombre" del Excel importado), queda en
// null y el envío sigue siendo válido, solo sin personalizar.
export function parseDestinatario(linea: string): { telefono: string; nombre: string | null } {
  const [tel, ...resto] = linea.split(",");
  const telefono = (tel ?? "").replace(/\D/g, "");
  const nombre = resto.join(",").trim() || null;
  return { telefono, nombre };
}
