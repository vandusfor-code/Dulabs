// Extracción tolerante de RUT / teléfono / compañía actual desde el texto
// libre que un cliente escribe en respuesta a la campaña (sección 13 del
// spec: "no depender exclusivamente de etiquetas exactas como RUT:/
// Teléfono:/Compañía:"). Deliberadamente 100% determinístico (sin IA): RUT y
// teléfono chilenos tienen un formato lo bastante distintivo (dígito
// verificador con guion, celular de 9 dígitos que empieza en 9) como para
// que una regex bien acotada sea más confiable que una inferencia de IA acá
// — y estos son datos comerciales reales de un cliente, preferible pedir de
// nuevo a adivinar mal.

export type OperadorChileno = "claro" | "movistar" | "entel" | "wom" | "virgin" | "vtr" | "gtd";

const OPERADORES: Record<OperadorChileno, string[]> = {
  claro: ["claro"],
  movistar: ["movistar"],
  entel: ["entel"],
  wom: ["wom"],
  virgin: ["virgin"],
  vtr: ["vtr"],
  gtd: ["gtd"],
};

function calcularDigitoVerificador(cuerpo: string): string {
  let suma = 0;
  let multiplicador = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * multiplicador;
    multiplicador = multiplicador === 7 ? 2 : multiplicador + 1;
  }
  const resto = 11 - (suma % 11);
  if (resto === 11) return "0";
  if (resto === 10) return "K";
  return String(resto);
}

/** true si el dígito verificador calza (algoritmo módulo 11 estándar). */
export function validarRut(rutFormateado: string): boolean {
  const limpio = rutFormateado.replace(/[.\s]/g, "").toUpperCase();
  const m = limpio.match(/^(\d{7,8})-([\dK])$/);
  if (!m) return false;
  return calcularDigitoVerificador(m[1]) === m[2];
}

// Requiere el guion explícito antes del dígito verificador a propósito: sin
// ese delimitador, un RUT sin puntos es indistinguible de un teléfono (7-8
// dígitos seguidos). Preferimos no extraer antes que confundir uno con otro.
const RUT_REGEX = /\b(\d{1,2}\.\d{3}\.\d{3}|\d{7,8})[\s-]+([\dkK])\b/;

/** Extrae el primer RUT con dígito verificador válido. null si no hay ninguno o el DV no calza. */
export function extraerRut(texto: string): { valor: string; coincidencia: string } | null {
  const m = texto.match(RUT_REGEX);
  if (!m) return null;
  const cuerpo = m[1].replace(/\./g, "");
  const dv = m[2].toUpperCase();
  const formateado = `${cuerpo}-${dv}`;
  if (!validarRut(formateado)) return null;
  return { valor: formateado, coincidencia: m[0] };
}

// Celular chileno: 9 dígitos empezando en 9, prefijo +56/56 opcional.
const TELEFONO_REGEX = /(?:\+?56[\s.-]?)?9[\s.-]?\d{4}[\s.-]?\d{4}\b/;

/** Extrae el primer teléfono celular chileno, normalizado a +569XXXXXXXX. */
export function extraerTelefono(texto: string): { valor: string; coincidencia: string } | null {
  const m = texto.match(TELEFONO_REGEX);
  if (!m) return null;
  const digitos = m[0].replace(/\D/g, "");
  const nueve = digitos.slice(-9); // últimos 9 dígitos = 9XXXXXXXX
  if (nueve.length !== 9 || nueve[0] !== "9") return null;
  return { valor: `+56${nueve}`, coincidencia: m[0] };
}

/** Busca el nombre de un operador chileno conocido en el texto (case/acento-insensible). */
export function extraerCompania(texto: string): { raw: string; operador: OperadorChileno | null } | null {
  const normalizado = texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  for (const [operador, alias] of Object.entries(OPERADORES) as [OperadorChileno, string[]][]) {
    for (const a of alias) {
      if (new RegExp(`\\b${a}\\b`).test(normalizado)) {
        return { raw: operador.charAt(0).toUpperCase() + operador.slice(1), operador };
      }
    }
  }
  return null;
}

export interface DatosExtraidos {
  rut: string | null;
  telefono: string | null;
  companiaRaw: string | null;
  companiaOperador: OperadorChileno | null;
}

/** Extrae los 3 campos de un mensaje libre, sin asumir ningún formato/orden/etiqueta fijo. */
export function extraerDatosLead(texto: string): DatosExtraidos {
  const rut = extraerRut(texto);
  // Se quita el tramo del RUT ya reconocido antes de buscar teléfono, para
  // que sus dígitos nunca se puedan confundir con un celular.
  const textoSinRut = rut ? texto.replace(rut.coincidencia, " ") : texto;
  const telefono = extraerTelefono(textoSinRut);
  const compania = extraerCompania(texto);

  return {
    rut: rut?.valor ?? null,
    telefono: telefono?.valor ?? null,
    companiaRaw: compania?.raw ?? null,
    companiaOperador: compania?.operador ?? null,
  };
}
