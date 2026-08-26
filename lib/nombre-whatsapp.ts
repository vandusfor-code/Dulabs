// Intenta sacar un primer nombre razonable del nombre de perfil de
// WhatsApp (ej. "Vivi463818384" -> "Vivi", "maria.lopez" -> "Maria",
// "CARLOS PEREZ" -> "Carlos"). Es solo una SUPOSICIÓN -- nunca se guarda
// como nombre confirmado sin que la clienta lo valide (ver
// lib/especialista-solicitud-ia.ts).
const PALABRAS_GENERICAS = new Set([
  "cliente",
  "clienta",
  "usuario",
  "usuaria",
  "user",
  "test",
  "spa",
  "whatsapp",
  "admin",
  "contacto",
  "invitado",
  "guest",
  "unknown",
  "desconocido",
  "numero",
  "number",
  "negocio",
]);

function capitalizar(token: string): string {
  return token.charAt(0).toLocaleUpperCase("es") + token.slice(1).toLocaleLowerCase("es");
}

// Un token "se ve como un nombre" si es normal (todo minúscula tras la
// primera letra, o todo mayúsculas) -- descarta mezclas raras tipo "xX".
function pareceNombre(token: string): boolean {
  const resto = token.slice(1);
  return resto === resto.toLowerCase() || token === token.toUpperCase();
}

export function interpretarNombreWhatsapp(nombrePerfil: string | null | undefined): string | null {
  if (!nombrePerfil) return null;
  const tokens = nombrePerfil.split(/[^\p{L}]+/u).filter(Boolean);
  for (const token of tokens) {
    if (token.length < 3 || token.length > 20) continue;
    if (PALABRAS_GENERICAS.has(token.toLowerCase())) continue;
    if (!pareceNombre(token)) continue;
    return capitalizar(token);
  }
  return null;
}
