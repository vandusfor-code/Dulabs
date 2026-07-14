export function formatearTelefono(digitos: string): string {
  if (digitos.length === 11 && digitos[0] === "1") {
    return `+1 ${digitos.slice(1, 4)}-${digitos.slice(4, 7)}-${digitos.slice(7)}`;
  }
  if (digitos.length === 12 && digitos.startsWith("57")) {
    return `+57 ${digitos.slice(2, 5)} ${digitos.slice(5, 8)} ${digitos.slice(8)}`;
  }
  return `+${digitos}`;
}
