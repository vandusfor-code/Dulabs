/**
 * DuLabs Developer V1 -- Fase 9 (autorizado). Tests unitarios de la lógica
 * PURA del Dashboard (sin DOM, sin red): clasificación de errores, permisos
 * por rol, formateo/estado, y ruta activa.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clasificarError, DevApiError } from "@/lib/dev-dashboard/dev-client";
import { puedeGestionarRecursos, puedeGestionarMiembros, esSoloLectura } from "@/lib/dev-dashboard/dev-permissions";
import { labelEstadoJob, tonoEstadoJob, truncarWamid, porcentajeUso, estadoCuota, formatearLimite, tonoEstadoNumero, labelEstadoApiKey } from "@/lib/dev-dashboard/dev-format";
import { mensajePorKind, esSesionExpirada } from "@/lib/dev-dashboard/dev-errors";
import { esRutaActiva } from "@/components/developer/nav";

describe("clasificarError -- distingue 401/403/404/429(rate vs quota)/red/servidor", () => {
  it("401 -> unauthorized", () => assert.equal(clasificarError(401, "invalid_session"), "unauthorized"));
  it("403 -> forbidden", () => assert.equal(clasificarError(403, "forbidden"), "forbidden"));
  it("404 -> not_found", () => assert.equal(clasificarError(404, "not_found"), "not_found"));
  it("400 -> validation", () => assert.equal(clasificarError(400, "invalid_request"), "validation"));
  it("429 con código de cuota -> quota", () => assert.equal(clasificarError(429, "monthly_message_limit_exceeded"), "quota"));
  it("429 sin código de cuota -> rate_limit", () => assert.equal(clasificarError(429, "rate_limit_exceeded"), "rate_limit"));
  it("500 -> server", () => assert.equal(clasificarError(500, null), "server"));
});

describe("permisos por rol (D4)", () => {
  it("OWNER gestiona recursos y miembros", () => {
    assert.equal(puedeGestionarRecursos("OWNER"), true);
    assert.equal(puedeGestionarMiembros("OWNER"), true);
  });
  it("ADMIN gestiona recursos pero NO miembros", () => {
    assert.equal(puedeGestionarRecursos("ADMIN"), true);
    assert.equal(puedeGestionarMiembros("ADMIN"), false);
  });
  it("MEMBER es solo lectura", () => {
    assert.equal(puedeGestionarRecursos("MEMBER"), false);
    assert.equal(puedeGestionarMiembros("MEMBER"), false);
    assert.equal(esSoloLectura("MEMBER"), true);
  });
  it("rol null no puede nada", () => {
    assert.equal(puedeGestionarRecursos(null), false);
    assert.equal(puedeGestionarMiembros(null), false);
  });
});

describe("formateo/estado", () => {
  it("labels y tonos de estado de job (sin cambiar la state machine)", () => {
    assert.equal(labelEstadoJob("success_confirmed"), "Delivered");
    assert.equal(tonoEstadoJob("success_confirmed"), "success");
    assert.equal(tonoEstadoJob("failed_by_meta"), "danger");
    assert.equal(tonoEstadoJob("retry_pending"), "warning");
    assert.equal(labelEstadoJob("estado_desconocido"), "estado_desconocido");
  });
  it("trunca wamid largo y maneja null", () => {
    assert.equal(truncarWamid(null), "—");
    assert.ok(truncarWamid("wamid.HBgMxxxxxxxxxxxxxxxxxxxx").endsWith("…"));
  });
  it("porcentaje de uso y estado de cuota", () => {
    assert.equal(porcentajeUso(50, 100), 50);
    assert.equal(porcentajeUso(10, null), null);
    assert.equal(estadoCuota(50, 100), "normal");
    assert.equal(estadoCuota(85, 100), "cerca");
    assert.equal(estadoCuota(100, 100), "limite");
    assert.equal(estadoCuota(999, null), "normal", "plan sin límite nunca está en 'limite'");
  });
  it("formatea límite null como infinito", () => assert.equal(formatearLimite(null), "∞"));
  it("tono de número y label de api key", () => {
    assert.equal(tonoEstadoNumero("conectado"), "success");
    assert.equal(labelEstadoApiKey(null), "Active");
    assert.equal(labelEstadoApiKey("2026-01-01T00:00:00Z"), "Revoked");
  });
});

describe("mensajes de error de usuario", () => {
  it("403 -> mensaje de permisos", () => assert.match(mensajePorKind("forbidden"), /permisos/i));
  it("quota -> menciona la cuota mensual", () => assert.match(mensajePorKind("quota"), /cuota mensual/i));
  it("rate_limit distinto de quota", () => assert.notEqual(mensajePorKind("rate_limit"), mensajePorKind("quota")));
  it("esSesionExpirada true solo para 401", () => {
    assert.equal(esSesionExpirada(new DevApiError({ kind: "unauthorized", status: 401, code: null, requestId: null })), true);
    assert.equal(esSesionExpirada(new DevApiError({ kind: "forbidden", status: 403, code: null, requestId: null })), false);
    assert.equal(esSesionExpirada(new Error("x")), false);
  });
});

describe("navegación -- ruta activa", () => {
  it("Overview es exacto", () => {
    assert.equal(esRutaActiva("/developer", "/developer"), true);
    assert.equal(esRutaActiva("/developer", "/developer/usage"), false);
  });
  it("otras rutas hacen match por prefijo", () => {
    assert.equal(esRutaActiva("/developer/api-keys", "/developer/api-keys"), true);
    assert.equal(esRutaActiva("/developer/api", "/developer/api-keys"), false, "'/developer/api' no debe activarse en '/developer/api-keys'");
  });
});
