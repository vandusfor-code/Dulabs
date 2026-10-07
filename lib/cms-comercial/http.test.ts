/**
 * CMS comercial — adaptador HTTP: traducción de errores (jamás se filtra un detalle interno), lectura del cuerpo con tope de tamaño e id de ruta.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextRequest } from "next/server";
import { z } from "zod";
import { CmsError } from "@/lib/cms-comercial/errores";
import { MAX_CUERPO_CMS, cmsErrorResponse, leerCuerpo, leerIdRuta } from "@/lib/cms-comercial/http";

const cuerpo = async (res: Response) => (await res.json()) as { success: boolean; error?: { code: string; message: string; diagnostics?: unknown } };
const post = (texto: string, headers: Record<string, string> = {}) => new NextRequest("http://localhost/api/dashboard/tienda/entidades", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: texto });
const esquema = z.strictObject({ nombre: z.string({ message: "Falta el nombre." }) });

describe("cmsErrorResponse", () => {
  it("un CmsError sale con su código, su estado y su mensaje seguro", async () => {
    const r = cmsErrorResponse(new CmsError("CONFLICT", "Otra persona cambió este elemento."));
    assert.equal(r.status, 409);
    assert.deepEqual(await cuerpo(r), { success: false, error: { code: "CONFLICT", message: "Otra persona cambió este elemento." } });
  });

  it("los problemas de validación viajan como diagnóstico para que la administradora corrija", async () => {
    const problemas = [{ severidad: "error" as const, codigo: "oferta_sin_productos", campo: "alcance", mensaje: "Esta oferta no puede publicarse porque no tiene productos asociados." }];
    const r = cmsErrorResponse(new CmsError("NOT_PUBLISHABLE", "Corrige los problemas marcados antes de publicar.", problemas));
    assert.equal(r.status, 422);
    assert.deepEqual((await cuerpo(r)).error?.diagnostics, { problemas });
  });

  it("CADA código de error tiene su estado HTTP", () => {
    const esperado: Record<string, number> = { VALIDATION_ERROR: 400, NOT_FOUND: 404, CONFLICT: 409, FORBIDDEN: 403, ARCHIVED: 409, INVALID_STATE: 409, NOT_PUBLISHABLE: 422, FEATURE_UNAVAILABLE: 503, INTERNAL_ERROR: 500 };
    for (const [codigo, status] of Object.entries(esperado)) assert.equal(cmsErrorResponse(new CmsError(codigo as never, "x")).status, status, codigo);
  });

  it("cualquier otro error es 500 con texto FIJO: sin mensaje, sin SQL, sin traza", async () => {
    const original = console.error;
    console.error = () => {};
    try {
      for (const raro of [new Error('relation "dulabs_cms_entidades" no existe; SELECT * FROM secreto'), new TypeError("Cannot read properties of undefined (reading 'x') at C:\\Users\\HP\\Dulabs"), "texto suelto sensible", { message: "token abc123" }, null]) {
        const r = cmsErrorResponse(raro);
        assert.equal(r.status, 500);
        const b = await cuerpo(r);
        assert.equal(b.error?.code, "INTERNAL_ERROR");
        assert.equal(b.error?.message, "No se pudo completar la operación de la tienda.");
        assert.equal(JSON.stringify(b).includes("secreto"), false);
        assert.equal(JSON.stringify(b).includes("abc123"), false);
        assert.equal(JSON.stringify(b).includes("Dulabs"), false);
      }
    } finally {
      console.error = original;
    }
  });
});

describe("leerCuerpo", () => {
  it("acepta un JSON válido que cumple el esquema", async () => {
    const r = await leerCuerpo(post('{"nombre":"Amor"}'), esquema);
    assert.deepEqual(r, { ok: true, data: { nombre: "Amor" } });
  });

  it("JSON inválido o vacío: 400", async () => {
    for (const malo of ["{no", "", "nada"]) {
      const r = await leerCuerpo(post(malo), esquema);
      assert.equal(r.ok, false, malo);
      if (!r.ok) assert.equal(r.response.status, 400);
    }
  });

  it("no cumple el esquema (clave de más, tipo equivocado): 400 con el mensaje en español", async () => {
    for (const malo of ['{"nombre":"x","tenantId":"ajeno"}', '{"nombre":5}', "{}", "[]", "null"]) {
      const r = await leerCuerpo(post(malo), esquema);
      assert.equal(r.ok, false, malo);
      if (!r.ok) {
        assert.equal(r.response.status, 400);
        assert.equal((await cuerpo(r.response)).error?.code, "VALIDATION_ERROR");
      }
    }
    const r = await leerCuerpo(post("{}"), esquema);
    if (!r.ok) assert.equal((await cuerpo(r.response)).error?.message, "Falta el nombre.");
  });

  it("un cuerpo más grande que el tope es 413, tanto si lo declara como si no", async () => {
    const grande = JSON.stringify({ nombre: "x".repeat(MAX_CUERPO_CMS + 10) });
    const real = await leerCuerpo(post(grande), esquema);
    assert.equal(real.ok, false);
    if (!real.ok) assert.equal(real.response.status, 413);
    const declarado = await leerCuerpo(post('{"nombre":"x"}', { "content-length": String(MAX_CUERPO_CMS + 1) }), esquema);
    assert.equal(declarado.ok, false);
    if (!declarado.ok) assert.equal(declarado.response.status, 413);
    const justo = await leerCuerpo(post(JSON.stringify({ nombre: "x".repeat(MAX_CUERPO_CMS - 20) })), esquema);
    assert.equal(justo.ok, true, "un cuerpo dentro del tope pasa");
  });
});

describe("leerIdRuta", () => {
  it("solo un UUID es un id; todo lo demás es 404 sin tocar la base", async () => {
    assert.deepEqual(leerIdRuta("d0000000-0000-4000-8000-000000000001"), { ok: true, data: "d0000000-0000-4000-8000-000000000001" });
    for (const malo of ["", "1", "no-es-uuid", "'; drop table x; --", "d0000000-0000-4000-8000-00000000000g", "../../etc/passwd", "%00"]) {
      const r = leerIdRuta(malo);
      assert.equal(r.ok, false, malo);
      if (!r.ok) {
        assert.equal(r.response.status, 404);
        assert.equal((await cuerpo(r.response)).error?.message, "El elemento no existe.");
      }
    }
    const r = leerIdRuta("x", "La oferta");
    if (!r.ok) assert.equal((await cuerpo(r.response)).error?.message, "La oferta no existe.");
  });
});
