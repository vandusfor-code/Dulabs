/**
 * AMORE -- ¿sigue VIVO el registro de una clienta? (lib/amore-registro-vigencia.ts). Función pura: el reloj y el historial entran como datos.
 * El caso real que motivó esto: una clienta atrapada en «registro_dia» recibía «Necesito un día válido entre 1 y 31» con CADA mensaje suyo («Gracias, listo», «Nos vemos el
 * miércoles»), también mientras una persona del equipo le contestaba desde el celular.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  motivoAbandonoRegistro,
  MAX_AVISOS_INVALIDOS_SEGUIDOS,
  REGISTRO_VENCE_MS,
  SALIENTES_A_REVISAR,
} from "@/lib/amore-registro-vigencia";
import { MENSAJE_DIA_INVALIDO, MENSAJE_MES_INVALIDO, MENSAJE_REGISTRO_DIA, MENSAJE_REGISTRO_NOMBRE } from "@/lib/amore-entrada-gemini";
import type { SalienteReciente } from "@/lib/chats/salientes-recientes";

const AHORA = Date.parse("2026-10-29T16:00:00-05:00");
const MIN = 60_000;
const hace = (ms: number) => new Date(AHORA - ms).toISOString();
const bot = (texto: string, haceMs = 2 * MIN): SalienteReciente => ({ origen: "automatico", texto, enviadoEn: hace(haceMs) });
const persona = (texto: string, haceMs = 2 * MIN): SalienteReciente => ({ origen: "humano", texto, enviadoEn: hace(haceMs) });

describe("motivoAbandonoRegistro -- sin información no se decide nada", () => {
  it("sin historial (null, undefined o vacío) el registro sigue como siempre", () => {
    assert.equal(motivoAbandonoRegistro(null, AHORA), null);
    assert.equal(motivoAbandonoRegistro(undefined, AHORA), null);
    assert.equal(motivoAbandonoRegistro([], AHORA), null);
  });

  it("el último mensaje es el aviso del propio registro y es reciente -> sigue vivo", () => {
    assert.equal(motivoAbandonoRegistro([bot(MENSAJE_REGISTRO_NOMBRE)], AHORA), null);
    assert.equal(motivoAbandonoRegistro([bot(MENSAJE_REGISTRO_DIA)], AHORA), null);
  });
});

describe("motivoAbandonoRegistro -- 1. una persona del equipo ya la atiende", () => {
  it("lo último que se le envió lo escribió una persona -> 'atiende_una_persona'", () => {
    assert.equal(motivoAbandonoRegistro([persona("Te queda en 230 mil")], AHORA), "atiende_una_persona");
  });

  it("manda sobre todo lo demás: aunque el mensaje sea viejísimo o haya avisos de día inválido detrás", () => {
    assert.equal(motivoAbandonoRegistro([persona("Te queda en 230 mil", 30 * 24 * 60 * MIN)], AHORA), "atiende_una_persona");
    assert.equal(motivoAbandonoRegistro([persona("Te queda en 230 mil"), bot(MENSAJE_DIA_INVALIDO), bot(MENSAJE_DIA_INVALIDO)], AHORA), "atiende_una_persona");
  });

  it("si una persona escribió ANTES y el asistente habló DESPUÉS, la última palabra es del asistente: el registro sigue vivo", () => {
    assert.equal(motivoAbandonoRegistro([bot(MENSAJE_REGISTRO_DIA), persona("Hola linda")], AHORA), null);
  });
});

describe("motivoAbandonoRegistro -- 2. registro vencido (nadie le escribe hace horas)", () => {
  it("más de REGISTRO_VENCE_MS desde el último mensaje -> 'registro_vencido'", () => {
    assert.equal(motivoAbandonoRegistro([bot(MENSAJE_REGISTRO_NOMBRE, REGISTRO_VENCE_MS + 1)], AHORA), "registro_vencido");
    assert.equal(motivoAbandonoRegistro([bot(MENSAJE_REGISTRO_DIA, 20 * 24 * 60 * MIN)], AHORA), "registro_vencido");
  });

  it("justo en el límite todavía está vivo (el límite es estricto)", () => {
    assert.equal(motivoAbandonoRegistro([bot(MENSAJE_REGISTRO_NOMBRE, REGISTRO_VENCE_MS)], AHORA), null);
    assert.equal(motivoAbandonoRegistro([bot(MENSAJE_REGISTRO_NOMBRE, REGISTRO_VENCE_MS - 1)], AHORA), null);
  });

  it("una hora que no se puede leer (falta o inválida) NO vence el registro", () => {
    assert.equal(motivoAbandonoRegistro([{ origen: "automatico", texto: MENSAJE_REGISTRO_NOMBRE, enviadoEn: null }], AHORA), null);
    assert.equal(motivoAbandonoRegistro([{ origen: "automatico", texto: MENSAJE_REGISTRO_NOMBRE, enviadoEn: "no-es-una-fecha" }], AHORA), null);
  });

  it("un mensaje 'del futuro' (reloj desfasado) tampoco vence nada", () => {
    assert.equal(motivoAbandonoRegistro([bot(MENSAJE_REGISTRO_NOMBRE, -5 * MIN)], AHORA), null);
  });

  it("la hora que cuenta es la del último mensaje, no la de los anteriores", () => {
    assert.equal(motivoAbandonoRegistro([bot(MENSAJE_REGISTRO_DIA, 5 * MIN), bot(MENSAJE_REGISTRO_NOMBRE, 3 * REGISTRO_VENCE_MS)], AHORA), null);
  });
});

describe("motivoAbandonoRegistro -- 3. ya se le insistió demasiado con «necesito un día/mes válido»", () => {
  it("el tope de avisos seguidos es de 2", () => {
    assert.equal(MAX_AVISOS_INVALIDOS_SEGUIDOS, 2);
    assert.ok(SALIENTES_A_REVISAR > MAX_AVISOS_INVALIDOS_SEGUIDOS, "hay que leer más mensajes que el tope para poder contarlos");
  });

  it("un solo aviso todavía se tolera (la clienta puede haberse equivocado de formato)", () => {
    assert.equal(motivoAbandonoRegistro([bot(MENSAJE_DIA_INVALIDO), bot(MENSAJE_REGISTRO_DIA)], AHORA), null);
  });

  it("dos avisos de día inválido seguidos -> 'sin_respuesta_valida'", () => {
    assert.equal(motivoAbandonoRegistro([bot(MENSAJE_DIA_INVALIDO), bot(MENSAJE_DIA_INVALIDO), bot(MENSAJE_REGISTRO_DIA)], AHORA), "sin_respuesta_valida");
  });

  it("también con el aviso del mes, y mezclando día y mes", () => {
    assert.equal(motivoAbandonoRegistro([bot(MENSAJE_MES_INVALIDO), bot(MENSAJE_MES_INVALIDO)], AHORA), "sin_respuesta_valida");
    assert.equal(motivoAbandonoRegistro([bot(MENSAJE_MES_INVALIDO), bot(MENSAJE_DIA_INVALIDO)], AHORA), "sin_respuesta_valida");
  });

  it("deben ser SEGUIDOS: si entre dos avisos hubo otro mensaje (pasó de paso), la cuenta empieza de cero", () => {
    assert.equal(motivoAbandonoRegistro([bot(MENSAJE_DIA_INVALIDO), bot("¿Y en qué mes cumples años?"), bot(MENSAJE_DIA_INVALIDO)], AHORA), null);
  });

  it("tolera diferencias de espacios y saltos de línea en el texto guardado", () => {
    const conEspacios = `  ${MENSAJE_DIA_INVALIDO.replace(" ", "   ")}\n`;
    assert.equal(motivoAbandonoRegistro([bot(conEspacios), bot(conEspacios)], AHORA), "sin_respuesta_valida");
  });

  it("un mensaje sin texto (audio, imagen) corta la cuenta", () => {
    assert.equal(motivoAbandonoRegistro([bot(MENSAJE_DIA_INVALIDO), { origen: "automatico", texto: null, enviadoEn: hace(MIN) }, bot(MENSAJE_DIA_INVALIDO)], AHORA), null);
  });
});

describe("motivoAbandonoRegistro -- orden de las reglas", () => {
  it("persona atendiendo > registro vencido > demasiados avisos", () => {
    assert.equal(motivoAbandonoRegistro([persona("Hola", REGISTRO_VENCE_MS * 2)], AHORA), "atiende_una_persona");
    assert.equal(motivoAbandonoRegistro([bot(MENSAJE_DIA_INVALIDO, REGISTRO_VENCE_MS + 1), bot(MENSAJE_DIA_INVALIDO, REGISTRO_VENCE_MS + 2)], AHORA), "registro_vencido");
  });
});
