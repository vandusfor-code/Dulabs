import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extraerTexto, conTimeout, TAMANO_MAXIMO_BYTES } from "@/lib/archivo-texto";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-validacion";

// Nota: estas pruebas cubren deliberadamente las GUARDAS que corren ANTES de
// cargar pdf-parse (pdfjs) — no invocamos pdfjs en el runner porque referencia
// DOMMatrix (API de navegador). El comportamiento de parseo real se valida en
// e2e/manual; acá aseguramos que un PDF inválido, un formato no soportado y un
// procesamiento lento NUNCA cuelguen sin un error claro.

describe("archivo-texto — límite único de tamaño", () => {
  it("TAMANO_MAXIMO_BYTES reexporta la fuente única (upload-validacion)", () => {
    assert.equal(TAMANO_MAXIMO_BYTES, MAX_UPLOAD_BYTES);
  });
});

describe("extraerTexto — guardas de formato/firma", () => {
  it("rechaza un formato no soportado con mensaje claro", async () => {
    const archivo = new File([Buffer.from("hola")], "notas.txt");
    await assert.rejects(() => extraerTexto(archivo, Buffer.from("hola")), /Formato no soportado/);
  });

  it("rechaza un .pdf con firma incorrecta (no empieza en %PDF-)", async () => {
    const buffer = Buffer.from("esto no es un pdf de verdad");
    const archivo = new File([buffer], "renombrado.pdf");
    await assert.rejects(() => extraerTexto(archivo, buffer), /no es un PDF válido/);
  });

  it("rechaza un .pdf demasiado corto para tener firma", async () => {
    const buffer = Buffer.from("%PD");
    const archivo = new File([buffer], "corto.pdf");
    await assert.rejects(() => extraerTexto(archivo, buffer), /no es un PDF válido/);
  });
});

describe("conTimeout — ninguna promesa cuelga para siempre", () => {
  it("resuelve una promesa rápida antes del tope", async () => {
    const valor = await conTimeout(Promise.resolve(42), 1000, "no debería");
    assert.equal(valor, 42);
  });

  it("rechaza con el mensaje dado cuando la promesa nunca resuelve", async () => {
    const colgada = new Promise<never>(() => {}); // nunca resuelve
    await assert.rejects(() => conTimeout(colgada, 20, "procesamiento lento"), /procesamiento lento/);
  });

  it("propaga el rechazo real si ocurre antes del tope", async () => {
    await assert.rejects(
      () => conTimeout(Promise.reject(new Error("fallo real")), 1000, "no debería"),
      /fallo real/
    );
  });
});
