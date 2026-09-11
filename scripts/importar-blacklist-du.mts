// Lista negra de DuLabs (autorizado) -- importador de contactos a
// ia_numeros_bloqueados. Reutiliza la MISMA normalización que ya usa el
// webhook en producción (lib/blacklist-du.ts), para que un número marcado
// "válido" aquí sea garantizado el mismo formato que espera esTelefonoBloqueado.
//
// Alcance: EXCLUSIVAMENTE dulabs_clientes_config.phone_number_id =
// 696346603563682 (DuLabs). Nunca toca otra fila.
//
// Modo por defecto: SOLO REPORTE (dry-run) -- no escribe nada en Supabase.
// Pasar --write para persistir. Operación de UNIÓN pura: nunca elimina un
// número que ya estuviera en la lista, solo agrega los que falten.
//
// Uso:
//   npx tsx scripts/importar-blacklist-du.mts "C:/ruta/contactos.csv"
//   npx tsx scripts/importar-blacklist-du.mts "C:/ruta/contactos.csv" --write
import fs from "node:fs";
import { normalizarCampoTelefonos, unirListaNegra } from "../lib/blacklist-du";

const PHONE_NUMBER_ID_DULABS = "696346603563682";

function cargarEnv() {
  const envRaw = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of envRaw.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  }
}

// Parser CSV mínimo (respeta comillas), suficiente para exports tipo Google
// Contacts -- no pretende ser un parser CSV general de propósito completo.
function parsearCsv(texto: string): string[][] {
  const filas: string[][] = [];
  const lineas = texto.split(/\r?\n/);
  for (const linea of lineas) {
    if (linea === "") continue;
    const fila: string[] = [];
    let actual = "";
    let entreComillas = false;
    for (let i = 0; i < linea.length; i++) {
      const c = linea[i];
      if (c === '"') {
        entreComillas = !entreComillas;
        continue;
      }
      if (c === "," && !entreComillas) {
        fila.push(actual);
        actual = "";
        continue;
      }
      actual += c;
    }
    fila.push(actual);
    filas.push(fila);
  }
  return filas;
}

function main() {
  const args = process.argv.slice(2);
  const rutaArchivo = args.find((a) => !a.startsWith("--"));
  const escribir = args.includes("--write");

  if (!rutaArchivo) {
    console.error("Uso: npx tsx scripts/importar-blacklist-du.mts <archivo.csv> [--write]");
    process.exit(1);
  }
  if (!fs.existsSync(rutaArchivo)) {
    console.error(`No existe el archivo: ${rutaArchivo}`);
    process.exit(1);
  }

  const texto = fs.readFileSync(rutaArchivo, "utf8");
  const filas = parsearCsv(texto);
  if (filas.length === 0) {
    console.error("El archivo está vacío.");
    process.exit(1);
  }
  const header = filas[0];
  const columnasTelefono = header
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => /phone\s*\d*\s*-?\s*value/i.test(h.trim()));

  if (columnasTelefono.length === 0) {
    console.error(
      `No se encontró ninguna columna de teléfono reconocible en el encabezado.\nEncabezado recibido: ${header.join(" | ")}\nSe esperaba algo como "Phone 1 - Value" (formato de export de Google Contacts).`,
    );
    process.exit(1);
  }

  let totalCamposRecibidos = 0;
  const validosCrudos: string[] = [];
  const invalidos: string[] = [];

  for (let f = 1; f < filas.length; f++) {
    const fila = filas[f];
    for (const { i } of columnasTelefono) {
      const valor = (fila[i] ?? "").trim();
      if (!valor) continue;
      totalCamposRecibidos++;
      const { validos, invalidos: inv } = normalizarCampoTelefonos(valor);
      validosCrudos.push(...validos);
      invalidos.push(...inv);
    }
  }

  const setValidosUnicos = new Set(validosCrudos);
  const duplicadosEnArchivo = validosCrudos.length - setValidosUnicos.size;

  console.log("=== IMPORTACIÓN BLACKLIST DU — REPORTE ===");
  console.log(`Archivo: ${rutaArchivo}`);
  console.log(`Columnas de teléfono detectadas: ${columnasTelefono.map((c) => header[c.i]).join(", ")}`);
  console.log(`Total de campos con contenido recibidos: ${totalCamposRecibidos}`);
  console.log(`Válidos (después de normalizar, con duplicados del archivo): ${validosCrudos.length}`);
  console.log(`Inválidos (formato irreconocible, NO se adivina el indicativo): ${invalidos.length}`);
  console.log(`Duplicados dentro del propio archivo: ${duplicadosEnArchivo}`);
  console.log(`Total único válido a considerar: ${setValidosUnicos.size}`);

  cargarEnv();
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  void (async () => {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/dulabs_clientes_config?select=id,nombre_negocio,ia_numeros_bloqueados&phone_number_id=eq.${PHONE_NUMBER_ID_DULABS}`,
      { headers: { apikey: KEY!, Authorization: `Bearer ${KEY}` } },
    );
    if (!res.ok) {
      console.error(`Error consultando dulabs_clientes_config: ${res.status} ${await res.text()}`);
      process.exit(1);
    }
    const data = (await res.json()) as { id: string; nombre_negocio: string; ia_numeros_bloqueados: string | null }[];
    const fila = data[0];
    if (!fila) {
      console.error(`No se encontró ninguna fila con phone_number_id=${PHONE_NUMBER_ID_DULABS}`);
      process.exit(1);
    }

    const { resultado, agregados, yaExistian } = unirListaNegra(fila.ia_numeros_bloqueados, [...setValidosUnicos]);
    const totalActual = (fila.ia_numeros_bloqueados ?? "").split(",").map((s) => s.trim()).filter(Boolean).length;
    const totalFinal = resultado.split(",").filter(Boolean).length;

    console.log("");
    console.log(`Cliente objetivo: "${fila.nombre_negocio}" (phone_number_id=${PHONE_NUMBER_ID_DULABS})`);
    console.log(`Números ya en la lista negra actual: ${totalActual}`);
    console.log(`De los válidos del archivo, ya estaban presentes: ${yaExistian}`);
    console.log(`Números NUEVOS a agregar: ${agregados}`);
    console.log(`Total final tras la unión: ${totalFinal}`);

    if (!escribir) {
      console.log("");
      console.log("Modo simulación (dry-run) -- no se escribió nada en Supabase. Ejecuta con --write para persistir.");
      return;
    }

    if (agregados === 0) {
      console.log("");
      console.log("Nada nuevo que agregar -- no se realiza ninguna escritura (la lista actual ya cubre este archivo).");
      return;
    }

    const resUpdate = await fetch(
      `${SUPABASE_URL}/rest/v1/dulabs_clientes_config?phone_number_id=eq.${PHONE_NUMBER_ID_DULABS}`,
      {
        method: "PATCH",
        headers: {
          apikey: KEY!,
          Authorization: `Bearer ${KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({ ia_numeros_bloqueados: resultado }),
      },
    );
    if (!resUpdate.ok) {
      console.error(`Error escribiendo: ${resUpdate.status} ${await resUpdate.text()}`);
      process.exit(1);
    }
    console.log("");
    console.log(`✓ Escrito. ${agregados} números nuevos agregados. Total final: ${totalFinal}.`);
  })();
}

main();
