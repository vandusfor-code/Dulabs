import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validarArchivoConocimiento,
  MAX_UPLOAD_BYTES,
  EXTENSIONES_CONOCIMIENTO,
  extensionDe,
} from "@/lib/upload-validacion";

describe("validarArchivoConocimiento — casos válidos", () => {
  for (const ext of EXTENSIONES_CONOCIMIENTO) {
    it(`acepta .${ext} dentro del límite`, () => {
      const r = validarArchivoConocimiento({ name: `precios.${ext}`, size: 1024 });
      assert.equal(r.ok, true);
    });
  }

  it("acepta un PDF justo en el límite", () => {
    const r = validarArchivoConocimiento({ name: "estatutos.pdf", size: MAX_UPLOAD_BYTES });
    assert.equal(r.ok, true);
  });
});

describe("validarArchivoConocimiento — rechazos con mensaje accionable", () => {
  it("rechaza archivo vacío", () => {
    const r = validarArchivoConocimiento({ name: "vacio.pdf", size: 0 });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /vac[ií]o/i);
  });

  it("rechaza tamaño negativo/no finito", () => {
    const r = validarArchivoConocimiento({ name: "raro.pdf", size: Number.NaN });
    assert.equal(r.ok, false);
  });

  it("rechaza por encima del límite y nombra el peso y el máximo", () => {
    const r = validarArchivoConocimiento({ name: "portafolio.pdf", size: MAX_UPLOAD_BYTES + 1_500_000 });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.match(r.error, /supera el límite de 4 MB/);
      assert.match(r.error, /MB/);
    }
  });

  it("rechaza .xls (legacy, no soportado)", () => {
    const r = validarArchivoConocimiento({ name: "listado.xls", size: 2048 });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /Formato no soportado/);
  });

  it("rechaza extensión desconocida", () => {
    const r = validarArchivoConocimiento({ name: "malware.exe", size: 2048 });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /Formato no soportado/);
  });

  it("rechaza archivo sin extensión", () => {
    const r = validarArchivoConocimiento({ name: "archivo_sin_ext", size: 2048 });
    assert.equal(r.ok, false);
  });

  it("no confía en mayúsculas de la extensión", () => {
    const r = validarArchivoConocimiento({ name: "DOC.PDF", size: 2048 });
    assert.equal(r.ok, true);
  });
});

describe("extensionDe", () => {
  it("extrae y normaliza la extensión", () => {
    assert.equal(extensionDe("a.b.PDF"), "pdf");
    // Sin punto, split(".").pop() devuelve el nombre completo; da igual porque
    // no coincidirá con ninguna extensión permitida (queda rechazado igual).
    assert.equal(extensionDe("sinext"), "sinext");
  });
});
