import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { manejarNotificarDuExplora, fechaDDMMAAAAReal, depurarDetalle, type DependenciasNotificarDuExplora } from "./du-explora-notificar";
import type { ResultadoEnvioTemplate } from "@/lib/developer/dulabs-whatsapp";

const SECRETO = "secreto-de-prueba-123";
const DESTINO = "573001112233";

type LlamadaEnvio = { nombrePlantilla: string; idioma: string; destinoE164: string; params?: string[] };

function montar(opts: { resultado?: ResultadoEnvioTemplate; secreto?: string | undefined; destino?: string | undefined; permitido?: boolean } = {}) {
  const llamadas: LlamadaEnvio[] = [];
  let creaciones = 0;
  const deps: DependenciasNotificarDuExplora = {
    crearSupabase: () => {
      creaciones++;
      return {} as SupabaseClient;
    },
    env: { secreto: "secreto" in opts ? opts.secreto : SECRETO, destino: "destino" in opts ? opts.destino : DESTINO },
    enviar: async (_sb, input) => {
      llamadas.push(input);
      return opts.resultado ?? { enviado: true, wamid: "wamid.ABC123" };
    },
    limitar: async () => ({ permitido: opts.permitido ?? true, conteo: 1, limite: 10, reiniciaEn: new Date(Date.now() + 30_000).toISOString() }),
  };
  return { deps, llamadas, creaciones: () => creaciones };
}

const cuerpoOk = { ready: 3, date: "26-10-2026", runId: "run_2026-10-26-06" };
const peticion = (cuerpo: unknown, authorization: string | null = `Bearer ${SECRETO}`) => ({
  authorization,
  cuerpoCrudo: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
});

describe("POST /api/integraciones/du-explora/notificar (lógica)", () => {
  it("403 sin Authorization, con secreto incorrecto, con esquema distinto, o sin secreto configurado -- y sin tocar la base ni enviar", async () => {
    const casos: [string | null, string | undefined][] = [
      [null, SECRETO],
      ["Bearer otro", SECRETO],
      [`Basic ${SECRETO}`, SECRETO],
      ["Bearer ", SECRETO],
      [`Bearer ${SECRETO}`, undefined],
      ["Bearer ", undefined],
    ];
    for (const [auth, secreto] of casos) {
      const m = montar({ secreto });
      const r = await manejarNotificarDuExplora(m.deps, peticion(cuerpoOk, auth));
      assert.equal(r.status, 403, `${auth} / ${secreto}`);
      assert.equal(m.llamadas.length, 0);
      assert.equal(m.creaciones(), 0);
    }
  });

  it("400 con body inválido (nada se envía)", async () => {
    const invalidos: unknown[] = [
      "no es json",
      "[]",
      "null",
      {},
      { ...cuerpoOk, ready: 4 },
      { ...cuerpoOk, ready: -1 },
      { ...cuerpoOk, ready: 1.5 },
      { ...cuerpoOk, ready: "3" },
      { ...cuerpoOk, ready: undefined },
      { ...cuerpoOk, date: "2026-10-26" },
      { ...cuerpoOk, date: "31-02-2026" },
      { ...cuerpoOk, date: "26/10/2026" },
      { ...cuerpoOk, date: 20261026 },
      { ...cuerpoOk, runId: "" },
      { ...cuerpoOk, runId: "a".repeat(65) },
      { ...cuerpoOk, runId: "con espacio" },
      { ...cuerpoOk, runId: "../x" },
      { ready: 1, date: "26-10-2026" },
    ];
    for (const cuerpo of invalidos) {
      const m = montar();
      const r = await manejarNotificarDuExplora(m.deps, peticion(cuerpo));
      assert.equal(r.status, 400, JSON.stringify(cuerpo));
      assert.equal(r.cuerpo.ok, false);
      assert.equal(m.llamadas.length, 0);
    }
  });

  it("acepta los límites: ready 0 y 3, runId de 64 caracteres, 29-feb en año bisiesto", async () => {
    for (const cuerpo of [{ ...cuerpoOk, ready: 0 }, { ...cuerpoOk, ready: 3, runId: "a".repeat(64) }, { ready: 1, date: "29-02-2028", runId: "x" }]) {
      const m = montar();
      const r = await manejarNotificarDuExplora(m.deps, peticion(cuerpo));
      assert.equal(r.status, 200, JSON.stringify(cuerpo));
    }
  });

  it("200 con wamid cuando enviarTemplateDulabs devuelve enviado:true; plantilla/idioma/params/destino fijados por el servidor", async () => {
    const m = montar();
    const r = await manejarNotificarDuExplora(m.deps, peticion(cuerpoOk));
    assert.equal(r.status, 200);
    assert.deepEqual(r.cuerpo, { ok: true, wamid: "wamid.ABC123" });
    assert.equal(m.llamadas.length, 1);
    assert.deepEqual(m.llamadas[0], { nombrePlantilla: "du_explora_videos_listos", idioma: "es_CO", destinoE164: DESTINO, params: ["3", "26-10-2026"] });
    // la respuesta jamás incluye el destino
    assert.ok(!JSON.stringify(r.cuerpo).includes(DESTINO));
  });

  it("wamid null (Meta no lo devolvió) sigue siendo ok:true", async () => {
    const m = montar({ resultado: { enviado: true, wamid: null } });
    const r = await manejarNotificarDuExplora(m.deps, peticion(cuerpoOk));
    assert.deepEqual(r, { status: 200, cuerpo: { ok: true, wamid: null } });
  });

  it("el body NO puede sobrescribir plantilla, idioma, params ni destino: campos extra -> 400 y no se envía", async () => {
    for (const extra of [
      { template: "otra_plantilla" },
      { name: "otra_plantilla" },
      { to: "573009999999" },
      { destino: "573009999999" },
      { language: "en_US" },
      { params: ["x", "y"] },
      { bodyParams: ["x"] },
      { type: "text" },
    ]) {
      const m = montar();
      const r = await manejarNotificarDuExplora(m.deps, peticion({ ...cuerpoOk, ...extra }));
      assert.equal(r.status, 400, JSON.stringify(extra));
      assert.equal(m.llamadas.length, 0);
    }
  });

  it("502 con motivo y detalle cuando el envío falla; nunca expone el destino ni un token", async () => {
    const m = montar({
      resultado: {
        enviado: false,
        motivo: "error_envio",
        detalle: `(#131030) Recipient ${DESTINO} not in allowed list; Bearer EAAGabcdefghijklmnopqrstuvwxyz0123456789 call +${DESTINO}`,
      },
    });
    const r = await manejarNotificarDuExplora(m.deps, peticion(cuerpoOk));
    assert.equal(r.status, 502);
    assert.equal(r.cuerpo.ok, false);
    assert.equal(r.cuerpo.motivo, "error_envio");
    const texto = JSON.stringify(r.cuerpo);
    assert.ok(texto.includes("#131030"));
    assert.ok(!texto.includes(DESTINO));
    assert.ok(!texto.includes("EAAG"));
  });

  it("502 sin detalle propaga solo el motivo (p. ej. plantilla_no_aprobada)", async () => {
    const m = montar({ resultado: { enviado: false, motivo: "plantilla_no_aprobada", detalle: "status=PENDING" } });
    const r = await manejarNotificarDuExplora(m.deps, peticion(cuerpoOk));
    assert.deepEqual(r, { status: 502, cuerpo: { ok: false, motivo: "plantilla_no_aprobada", detalle: "status=PENDING" } });
    const sin = montar({ resultado: { enviado: false, motivo: "destino_invalido" } });
    const r2 = await manejarNotificarDuExplora(sin.deps, peticion(cuerpoOk));
    assert.deepEqual(r2, { status: 502, cuerpo: { ok: false, motivo: "destino_invalido" } });
  });

  it("si enviar lanza (no debería), responde 502 sin filtrar el destino", async () => {
    const m = montar();
    m.deps.enviar = async () => {
      throw new Error(`boom ${DESTINO}`);
    };
    const r = await manejarNotificarDuExplora(m.deps, peticion(cuerpoOk));
    assert.equal(r.status, 502);
    assert.ok(!JSON.stringify(r.cuerpo).includes(DESTINO));
  });

  it("destino no configurado o mal formado en el entorno -> 503, sin enviar", async () => {
    for (const destino of [undefined, "", "abc", "+57300", "5730011122334455667"]) {
      const m = montar({ destino });
      const r = await manejarNotificarDuExplora(m.deps, peticion(cuerpoOk));
      assert.equal(r.status, 503, String(destino));
      assert.equal(r.cuerpo.motivo, "destino_no_configurado");
      assert.equal(m.llamadas.length, 0);
    }
  });

  it("rate limit excedido -> 429 con Retry-After, sin enviar", async () => {
    const m = montar({ permitido: false });
    const r = await manejarNotificarDuExplora(m.deps, peticion(cuerpoOk));
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers?.["Retry-After"]) >= 1);
    assert.equal(m.llamadas.length, 0);
  });

  it("fechaDDMMAAAAReal / depurarDetalle", () => {
    assert.equal(fechaDDMMAAAAReal("26-10-2026"), true);
    assert.equal(fechaDDMMAAAAReal("29-02-2026"), false);
    assert.equal(fechaDDMMAAAAReal("00-10-2026"), false);
    assert.equal(fechaDDMMAAAAReal("26-13-2026"), false);
    assert.equal(depurarDetalle(undefined, DESTINO), undefined);
    assert.equal(depurarDetalle(`a ${DESTINO} b`, DESTINO), "a [destino] b");
  });
});
