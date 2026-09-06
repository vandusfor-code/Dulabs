/**
 * Corrección (autorizada) -- confirma que el grant real de AMORE se
 * resuelve SIEMPRE desde la variable de entorno NYLAS_GRANT_ID_AMORE,
 * nunca hardcodeado en código (causa raíz del fallo de disponibilidad
 * real reportado: la variable nunca había sido configurada en Vercel
 * Production). Ningún otro tenant, real o futuro, puede recibir el grant
 * de AMORE por error.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { resolverNylasGrantIdParaTenant, AMORE_TENANT_ID } from "@/lib/nylas/nylas-grant";

const ORIGINAL = process.env.NYLAS_GRANT_ID_AMORE;

describe("resolverNylasGrantIdParaTenant -- siempre desde process.env, nunca hardcodeado", () => {
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.NYLAS_GRANT_ID_AMORE;
    else process.env.NYLAS_GRANT_ID_AMORE = ORIGINAL;
  });

  it("con la variable definida, devuelve EXACTAMENTE su valor para el tenant AMORE", () => {
    process.env.NYLAS_GRANT_ID_AMORE = "3de430ac-7032-40f3-99f5-b8e8a3ebb5f8";
    assert.equal(resolverNylasGrantIdParaTenant(AMORE_TENANT_ID), "3de430ac-7032-40f3-99f5-b8e8a3ebb5f8");
  });

  it("si la variable cambia, el resultado cambia con ella -- nunca un valor fijo en código", () => {
    process.env.NYLAS_GRANT_ID_AMORE = "otro-grant-de-prueba";
    assert.equal(resolverNylasGrantIdParaTenant(AMORE_TENANT_ID), "otro-grant-de-prueba");
  });

  it("sin la variable definida, devuelve null -- nunca un valor inventado", () => {
    delete process.env.NYLAS_GRANT_ID_AMORE;
    assert.equal(resolverNylasGrantIdParaTenant(AMORE_TENANT_ID), null);
  });

  it("cualquier tenant que NO sea AMORE recibe null, sin importar la variable de entorno", () => {
    process.env.NYLAS_GRANT_ID_AMORE = "3de430ac-7032-40f3-99f5-b8e8a3ebb5f8";
    assert.equal(resolverNylasGrantIdParaTenant("c64fac97-eff8-45f2-b691-30b3449da524"), null, "Daniela nunca recibe el grant de AMORE");
    assert.equal(resolverNylasGrantIdParaTenant("11ccf0a3-726b-4d4b-9f7d-2deb8441d6a9"), null, "Solo Talento nunca recibe el grant de AMORE");
    assert.equal(resolverNylasGrantIdParaTenant("tenant-futuro-cualquiera"), null);
  });
});
