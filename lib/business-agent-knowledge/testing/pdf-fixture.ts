/**
 * R4 — genera un PDF mínimo y VÁLIDO con texto seleccionable (SOLO tests / E2E).
 * Helvetica + WinAnsi: los caracteres latinos con tilde se escriben como octal
 * de Latin-1, así que pdf-parse los extrae tal cual ("política", "cancelación").
 */
// Sin secuencias de escape en el código fuente: el backslash se obtiene por código.
const BS = String.fromCharCode(92);

function escapePdfText(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (ch === BS || ch === "(" || ch === ")") out += BS + ch;
    else if (code > 127 && code <= 255) out += BS + code.toString(8).padStart(3, "0");
    else if (code <= 127) out += ch;
    else out += "?";
  }
  return out;
}

/** Cada elemento de `lineas` es una línea de texto (una sola página). */
export function buildPdf(lineas: string[]): Buffer {
  const contenido = "BT\n/F1 11 Tf\n14 TL\n50 780 Td\n" + lineas.map((l) => `(${escapePdfText(l)}) Tj T*`).join("\n") + "\nET";
  const objetos = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(contenido, "latin1")} >>\nstream\n${contenido}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objetos.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xrefPos = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
