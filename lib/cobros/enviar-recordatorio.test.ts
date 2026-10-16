import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlantillaImportada } from "@/lib/meta-templates";
import { DULABS_PHONE_NUMBER_ID, WHATSAPP_VENTAS_NUMERO } from "@/lib/site-contact";
import { enviarRecordatorioPago, type DepsEnvioRecordatorio } from "./enviar-recordatorio";

const CUERPO = "Hola, {{1}} 👋\n⚠️ Tu Agente IA está desactivado debido al vencimiento de tu suscripción.\n\n💳 Para reactivarlo, recuerda realizar el pago de tu mensualidad por {{2}}.";
const plantilla = (extra: Partial<PlantillaImportada> = {}): PlantillaImportada => ({
  metaTemplateId: "1646756836819671",
  estado: "APPROVED",
  categoria: "UTILITY",
  idioma: "es_CO",
  cuerpo: CUERPO,
  footer: "Facturación",
  botones: [],
  botonesCta: [],
  headerFormato: null,
  headerTexto: null,
  variablesEjemplo: ["AMORE", "$39.990"],
  ...extra,
});

type Llamada = Parameters<DepsEnvioRecordatorio["enviar"]>[0];
function armar(opciones: { plantilla?: PlantillaImportada | null | Error; token?: { token: string } | { error: string }; fallaEnvio?: string } = {}) {
  const llamadas: Llamada[] = [];
  const cuenta = { token: 0, plantilla: 0 };
  const deps: DepsEnvioRecordatorio = {
    async resolverToken() {
      cuenta.token++;
      return opciones.token ?? { token: "TOKEN-DE-PRUEBA" };
    },
    async importarPlantilla() {
      cuenta.plantilla++;
      if (opciones.plantilla instanceof Error) throw opciones.plantilla;
      return opciones.plantilla === undefined ? plantilla() : opciones.plantilla;
    },
    async enviar(params) {
      if (opciones.fallaEnvio) throw new Error(opciones.fallaEnvio);
      llamadas.push(params);
      return { wamid: "wamid.PRUEBA" };
    },
  };
  return { deps, llamadas, cuenta };
}
const entrada = { telefonoE164: "573001234567", nombreNegocio: "AMORE", montoCop: 39990 };

describe("enviarRecordatorioPago", () => {
  it("manda la plantilla pendiente_pago DESDE el número de Dulabs, en el idioma real aprobado, con el nombre y el monto del cliente", async () => {
    const { deps, llamadas } = armar();
    const r = await enviarRecordatorioPago(entrada, deps);
    assert.deepEqual(r, { enviado: true, wamid: "wamid.PRUEBA", resumen: "nombre=AMORE · monto=$39.990" });
    assert.equal(llamadas.length, 1);
    assert.deepEqual(llamadas[0], {
      phoneNumberId: DULABS_PHONE_NUMBER_ID,
      token: "TOKEN-DE-PRUEBA",
      para: "573001234567",
      nombrePlantilla: "pendiente_pago",
      idioma: "es_CO",
      parametrosPosicionales: ["AMORE", "$39.990"],
    });
  });

  it("limpia el teléfono: acepta «+57 300 123 4567» y manda solo dígitos", async () => {
    const { deps, llamadas } = armar();
    await enviarRecordatorioPago({ ...entrada, telefonoE164: "+57 300 123 4567" }, deps);
    assert.equal(llamadas[0]!.para, "573001234567");
  });

  it("si la plantilla usa variables con nombre, las manda con su nombre", async () => {
    const { deps, llamadas } = armar({ plantilla: plantilla({ cuerpo: "Hola, {{nombre}}. Tu mensualidad de {{monto}} está pendiente." }) });
    const r = await enviarRecordatorioPago(entrada, deps);
    assert.equal(r.enviado, true);
    assert.deepEqual(llamadas[0]!.variables, [
      { nombre: "nombre", valor: "AMORE" },
      { nombre: "monto", valor: "$39.990" },
    ]);
    assert.equal(llamadas[0]!.parametrosPosicionales, undefined);
  });

  it("usa el idioma que Meta tiene aprobado, no el que se pidió", async () => {
    const { deps, llamadas } = armar({ plantilla: plantilla({ idioma: "es_MX" }) });
    await enviarRecordatorioPago(entrada, deps);
    assert.equal(llamadas[0]!.idioma, "es_MX");
  });

  it("NO envía si la plantilla no está aprobada, no existe o Meta no responde (y dice por qué)", async () => {
    for (const [opciones, motivo] of [
      [{ plantilla: plantilla({ estado: "PENDING" }) }, "plantilla_no_aprobada"],
      [{ plantilla: plantilla({ estado: "REJECTED" }) }, "plantilla_no_aprobada"],
      [{ plantilla: null }, "plantilla_no_encontrada"],
      [{ plantilla: new Error("Meta respondió 500") }, "plantilla_no_consultable"],
    ] as const) {
      const { deps, llamadas } = armar(opciones);
      const r = await enviarRecordatorioPago(entrada, deps);
      assert.equal(r.enviado, false);
      assert.equal(!r.enviado && r.motivo, motivo);
      assert.equal(llamadas.length, 0, `no debía enviar (${motivo})`);
    }
  });

  it("NO envía si la plantilla no calza con «nombre + monto»", async () => {
    const { deps, llamadas } = armar({ plantilla: plantilla({ cuerpo: "Hola {{1}}, tu pago está pendiente." }) });
    const r = await enviarRecordatorioPago(entrada, deps);
    assert.deepEqual(r, { enviado: false, motivo: "variables_no_coinciden", detalle: "la plantilla tiene 1 variable(s) y se esperaban 2 (nombre y monto)" });
    assert.equal(llamadas.length, 0);
  });

  it("NO envía sin credenciales del número de Dulabs", async () => {
    const { deps, llamadas, cuenta } = armar({ token: { error: "sin_token_meta" } });
    const r = await enviarRecordatorioPago(entrada, deps);
    assert.deepEqual(r, { enviado: false, motivo: "sin_credenciales", detalle: "sin_token_meta" });
    assert.equal(cuenta.plantilla, 0, "ni siquiera consulta la plantilla");
    assert.equal(llamadas.length, 0);
  });

  it("rechaza un destino inválido o el propio número de Dulabs, sin tocar Meta", async () => {
    for (const [telefono, motivo] of [
      ["", "destino_invalido"],
      ["12345", "destino_invalido"],
      ["abc", "destino_invalido"],
      [`+${WHATSAPP_VENTAS_NUMERO}`, "destino_es_el_remitente"],
      [WHATSAPP_VENTAS_NUMERO, "destino_es_el_remitente"],
    ] as const) {
      const { deps, llamadas, cuenta } = armar();
      const r = await enviarRecordatorioPago({ ...entrada, telefonoE164: telefono }, deps);
      assert.equal(!r.enviado && r.motivo, motivo, telefono);
      assert.equal(cuenta.token + cuenta.plantilla + llamadas.length, 0, `no debía llamar a nada (${telefono})`);
    }
  });

  it("si Meta rechaza el envío, devuelve el error con el detalle y no lanza", async () => {
    const { deps } = armar({ fallaEnvio: "Meta respondió 400: (#131026) Message undeliverable" });
    const r = await enviarRecordatorioPago(entrada, deps);
    assert.deepEqual(r, { enviado: false, motivo: "error_envio", detalle: "Meta respondió 400: (#131026) Message undeliverable" });
  });
});
