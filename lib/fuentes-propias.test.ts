/**
 * Fuentes propias (lib/fonts/): la compilación no puede depender de Google Fonts. `next/font/google` baja el CSS y los archivos de cada familia de fonts.googleapis.com y fonts.gstatic.com en CADA compilación en frío, y cuando esa
 * descarga falla (pasó en 2 de 3 reconstrucciones el 2026-10-14 en Vercel) la compilación se cae y no se puede publicar. Estas pruebas cuidan que no vuelva a pasar: ningún código usa Google Fonts, y cada archivo que declaran los
 * módulos lib/fonts-*.ts existe, es un woff2 de verdad y liviano, no sobra ninguno, y la carpeta dice de dónde vienen y con qué licencia. Solo leen archivos: no usan la red.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const RAIZ = process.cwd();
const CARPETA = path.join(RAIZ, "lib", "fonts");
// Un woff2 «latin» pesa entre 8 y 40 KB: si alguien suma una fuente completa (cientos de KB) la prueba avisa antes de que llegue a producción.
const MAX_BYTES = 100 * 1024;

const leer = (ruta: string) => readFileSync(path.join(RAIZ, ruta), "utf8").replace(/\r\n/g, "\n");

/** Código del sitio: sin pruebas ni carpetas de dependencias o de compilación. */
function archivosDeCodigo(dir: string, salida: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name !== "node_modules" && entrada.name !== ".next") archivosDeCodigo(ruta, salida);
    } else if (/\.(tsx?|mts|jsx?|mjs|css)$/.test(entrada.name) && !/\.(test|e2e)\./.test(entrada.name)) {
      salida.push(ruta);
    }
  }
  return salida;
}

/** Archivos `./fonts/….woff2` que declaran los módulos lib/fonts-*.ts (`src` o `path`). */
function archivosDeclarados(): string[] {
  const nombres = new Set<string>();
  for (const modulo of readdirSync(path.join(RAIZ, "lib")).filter((n) => /^fonts-.+\.ts$/.test(n))) {
    for (const m of leer(`lib/${modulo}`).matchAll(/["']\.\/fonts\/([\w.-]+\.woff2)["']/g)) nombres.add(m[1]);
  }
  return [...nombres].sort();
}

describe("fuentes propias (lib/fonts/)", () => {
  it("el código del sitio no usa Google Fonts: ni `next/font/google` ni los dominios fonts.googleapis.com / fonts.gstatic.com", () => {
    const infractores: string[] = [];
    for (const raiz of ["app", "components", "lib"]) {
      for (const archivo of archivosDeCodigo(path.join(RAIZ, raiz))) {
        if (/next\/font\/google|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(readFileSync(archivo, "utf8"))) infractores.push(path.relative(RAIZ, archivo).replace(/\\/g, "/"));
      }
    }
    assert.equal(infractores.length, 0, `usan Google Fonts: ${infractores.join(", ")}. Las fuentes van en lib/fonts/ con \`next/font/local\` (ver lib/fonts/README.md).`);
  });

  it("cada archivo declarado existe, es un woff2 de verdad (firma «wOF2») y pesa menos de 100 KB", () => {
    const declarados = archivosDeclarados();
    assert.ok(declarados.length > 0, "los módulos lib/fonts-*.ts deben declarar al menos una fuente propia");
    for (const nombre of declarados) {
      const archivo = path.join(CARPETA, nombre);
      const bytes = readFileSync(archivo);
      assert.equal(bytes.subarray(0, 4).toString("latin1"), "wOF2", `${nombre} no es un woff2 (¿un puntero de Git LFS o un archivo cortado?)`);
      assert.ok(statSync(archivo).size < MAX_BYTES, `${nombre} pesa ${statSync(archivo).size} bytes: más de ${MAX_BYTES}. Una fuente propia debe ser el subconjunto «latin», no la fuente completa.`);
    }
  });

  it("no sobra ningún archivo: todo woff2 de lib/fonts/ está declarado por algún módulo", () => {
    const presentes = readdirSync(CARPETA).filter((n) => n.endsWith(".woff2")).sort();
    const declarados = archivosDeclarados();
    const sobrantes = presentes.filter((n) => !declarados.includes(n));
    assert.equal(sobrantes.length, 0, `sin declarar en lib/fonts-*.ts: ${sobrantes.join(", ")}`);
    assert.equal(declarados.filter((n) => !presentes.includes(n)).length, 0, "un módulo declara un archivo que no está en lib/fonts/");
  });

  it("la carpeta dice de dónde viene cada fuente y con qué licencia: el README nombra todos los archivos y existe la licencia", () => {
    const readme = readFileSync(path.join(CARPETA, "README.md"), "utf8");
    for (const nombre of readdirSync(CARPETA).filter((n) => n.endsWith(".woff2"))) assert.ok(readme.includes(nombre), `el README de lib/fonts/ no menciona ${nombre}`);
    const licencia = readFileSync(path.join(CARPETA, "LICENSE.md"), "utf8");
    assert.ok(licencia.includes("SIL OPEN FONT LICENSE Version 1.1"), "falta el texto de la licencia OFL en lib/fonts/LICENSE.md");
    for (const familia of ["Geist", "Cormorant", "Parisienne", "Playfair", "Poppins"]) assert.ok(licencia.includes(familia), `LICENSE.md no cita el copyright de ${familia}`);
  });
});
