// DuMo es una integración interna del operador de Du Labs (reenvía un número
// a un CRM externo propio), NO una función del producto que se le vende a los
// clientes. Sin este control, cualquier tenant veía el botón "Conectar con
// DuMo" en su pantalla de Conexión y podía activarlo.
//
// La lista vive en el servidor (sin NEXT_PUBLIC_) a propósito: el correo del
// operador no tiene por qué viajar en el bundle del navegador. El front se
// entera de si puede verlo por el booleano que devuelve /api/dashboard/me.
function correosAutorizados(): string[] {
  return (process.env.DUMO_ADMIN_EMAILS ?? "")
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
}

export function puedeUsarDumo(email: string | null | undefined): boolean {
  if (!email) return false;
  const autorizados = correosAutorizados();
  // Sin lista configurada nadie puede: preferimos que la función quede
  // apagada a que se le abra por defecto a todos los clientes.
  if (autorizados.length === 0) return false;
  return autorizados.includes(email.toLowerCase());
}
