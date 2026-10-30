/**
 * AMORE -- ¿el flujo de COMPRA DE PRODUCTO sigue siendo de la clienta? (lib/amore-compra-vigencia.ts). Funciones puras: el historial entra como dato.
 * Lo que debe cumplirse: el asistente deja de repetir «No reconocí esa opción» / el recordatorio de pago cuando una persona ya atiende, la clienta cambió de tema o ya se le insistió,
 * y NUNCA se pierde un pago: «Ya pagué» no pasa por aquí, una respuesta válida no se descarta y un envío del asistente mal marcado como «humano» no le quita el flujo.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_AVISOS_OPCION_COMPRA_SEGUIDOS,
  SALIENTES_COMPRA_A_REVISAR,
  atiendeUnaPersona,
  avisosDeOpcionInvalidaSeguidos,
  cambiaDeTema,
  decidirEsperaPago,
  esTextoDelAsistente,
  motivoSoltarMenuCompra,
  yaSeLeRecordoElPago,
} from "@/lib/amore-compra-vigencia";
import {
  MENSAJE_COMPRA_ASESOR_CLIENTE,
  MENSAJE_COMPRA_MENU,
  MENSAJE_COMPRA_METODOS_PAGO_PENDIENTE,
  MENSAJE_COMPRA_OPCION_INVALIDA,
  MENSAJE_COMPRA_PAGO_REGISTRADO_CLIENTE,
  MENSAJE_COMPRA_RECORDATORIO_PAGO,
  construirMensajeCompraSaludo,
} from "@/lib/amore-entrada-gemini";
import type { SalienteReciente } from "@/lib/chats/salientes-recientes";

const bot = (texto: string | null): SalienteReciente => ({ origen: "automatico", texto, enviadoEn: null });
const persona = (texto: string | null): SalienteReciente => ({ origen: "humano", texto, enviadoEn: null });
/** Un envío del asistente que el worker NO alcanzó a marcar como «automatico» (se guarda como «humano»). */
const botMalMarcado = (texto: string): SalienteReciente => persona(texto);

describe("esTextoDelAsistente -- los textos fijos de la compra", () => {
  it("reconoce cada texto fijo del flujo, también con espacios y saltos de línea distintos", () => {
    for (const texto of [
      MENSAJE_COMPRA_MENU,
      MENSAJE_COMPRA_OPCION_INVALIDA,
      MENSAJE_COMPRA_METODOS_PAGO_PENDIENTE,
      MENSAJE_COMPRA_RECORDATORIO_PAGO,
      MENSAJE_COMPRA_ASESOR_CLIENTE,
      MENSAJE_COMPRA_PAGO_REGISTRADO_CLIENTE,
    ]) {
      assert.equal(esTextoDelAsistente(texto), true, texto.slice(0, 30));
      assert.equal(esTextoDelAsistente(`  ${texto.replace(/\n/g, "\r\n ")}  `), true, `con otros espacios: ${texto.slice(0, 30)}`);
    }
  });

  it("reconoce el saludo del flujo con CUALQUIER nombre de producto", () => {
    for (const producto of ["Kit de Cuidado Capilar", "Aretes de plata", "X"]) assert.equal(esTextoDelAsistente(construirMensajeCompraSaludo(producto)), true, producto);
  });

  it("lo que escribe una persona NO es del asistente", () => {
    for (const texto of ["Hola linda, claro que sí", "¿Te sirve a las 3?", "Te queda en 230 mil", "1. Pagar producto", "Claro que sí"]) assert.equal(esTextoDelAsistente(texto), false, texto);
  });

  it("sin texto (audio, imagen) o vacío -> no es del asistente", () => {
    assert.equal(esTextoDelAsistente(null), false);
    assert.equal(esTextoDelAsistente(undefined), false);
    assert.equal(esTextoDelAsistente(""), false);
  });
});

describe("atiendeUnaPersona", () => {
  it("sin historial legible -> false (el flujo sigue como siempre)", () => {
    assert.equal(atiendeUnaPersona(null), false);
    assert.equal(atiendeUnaPersona(undefined), false);
    assert.equal(atiendeUnaPersona([]), false);
  });

  it("lo último que se le envió lo escribió una persona -> true", () => {
    assert.equal(atiendeUnaPersona([persona("Te queda en 230 mil"), bot(MENSAJE_COMPRA_MENU)]), true);
  });

  it("el asistente habló DESPUÉS de la persona -> la última palabra es del asistente: false", () => {
    assert.equal(atiendeUnaPersona([bot(MENSAJE_COMPRA_OPCION_INVALIDA), persona("Hola linda")]), false);
  });

  it("lo último lo mandó el asistente -> false", () => {
    assert.equal(atiendeUnaPersona([bot(MENSAJE_COMPRA_MENU)]), false);
  });

  it("DEFENSA: un envío del asistente mal marcado como «humano» NO cuenta como una persona (si no, la clienta perdería el flujo de pago)", () => {
    for (const texto of [MENSAJE_COMPRA_MENU, MENSAJE_COMPRA_OPCION_INVALIDA, MENSAJE_COMPRA_METODOS_PAGO_PENDIENTE, MENSAJE_COMPRA_RECORDATORIO_PAGO, construirMensajeCompraSaludo("Aretes")]) {
      assert.equal(atiendeUnaPersona([botMalMarcado(texto)]), false, texto.slice(0, 30));
    }
  });

  it("un mensaje de una persona sin texto (audio, imagen) también cuenta como persona", () => {
    assert.equal(atiendeUnaPersona([persona(null)]), true);
  });
});

describe("avisosDeOpcionInvalidaSeguidos", () => {
  it("cuenta los avisos más recientes, seguidos", () => {
    assert.equal(avisosDeOpcionInvalidaSeguidos([]), 0);
    assert.equal(avisosDeOpcionInvalidaSeguidos(null), 0);
    assert.equal(avisosDeOpcionInvalidaSeguidos([bot(MENSAJE_COMPRA_MENU)]), 0);
    assert.equal(avisosDeOpcionInvalidaSeguidos([bot(MENSAJE_COMPRA_OPCION_INVALIDA), bot(MENSAJE_COMPRA_MENU)]), 1);
    assert.equal(avisosDeOpcionInvalidaSeguidos([bot(MENSAJE_COMPRA_OPCION_INVALIDA), bot(MENSAJE_COMPRA_OPCION_INVALIDA), bot(MENSAJE_COMPRA_MENU)]), 2);
  });

  it("se corta con cualquier otro mensaje en medio (o uno sin texto)", () => {
    assert.equal(avisosDeOpcionInvalidaSeguidos([bot(MENSAJE_COMPRA_OPCION_INVALIDA), persona("Hola"), bot(MENSAJE_COMPRA_OPCION_INVALIDA)]), 1);
    assert.equal(avisosDeOpcionInvalidaSeguidos([bot(MENSAJE_COMPRA_OPCION_INVALIDA), bot(null), bot(MENSAJE_COMPRA_OPCION_INVALIDA)]), 1);
  });

  it("tolera espacios y saltos de línea distintos en el texto guardado", () => {
    const raro = `  ${MENSAJE_COMPRA_OPCION_INVALIDA.replace(/\n/g, "\r\n")} `;
    assert.equal(avisosDeOpcionInvalidaSeguidos([bot(raro), bot(raro)]), 2);
  });

  it("el tope es de 2 y se lee más de 2 mensajes para poder contarlos", () => {
    assert.equal(MAX_AVISOS_OPCION_COMPRA_SEGUIDOS, 2);
    assert.ok(SALIENTES_COMPRA_A_REVISAR > MAX_AVISOS_OPCION_COMPRA_SEGUIDOS);
  });
});

describe("yaSeLeRecordoElPago", () => {
  it("true solo si LO ÚLTIMO que se le envió fue el recordatorio", () => {
    assert.equal(yaSeLeRecordoElPago([bot(MENSAJE_COMPRA_RECORDATORIO_PAGO), bot(MENSAJE_COMPRA_METODOS_PAGO_PENDIENTE)]), true);
    assert.equal(yaSeLeRecordoElPago([bot(MENSAJE_COMPRA_METODOS_PAGO_PENDIENTE)]), false, "las instrucciones de pago NO son el recordatorio: el primer mensaje después de ellas todavía lo recibe");
    assert.equal(yaSeLeRecordoElPago([persona("Hola"), bot(MENSAJE_COMPRA_RECORDATORIO_PAGO)]), false, "pasó otra cosa después del recordatorio");
    assert.equal(yaSeLeRecordoElPago([]), false);
    assert.equal(yaSeLeRecordoElPago(null), false);
    assert.equal(yaSeLeRecordoElPago([bot(null)]), false);
  });
});

describe("cambiaDeTema -- pide una cita o gestiona la que tiene", () => {
  it("pedir una cita o gestionar la cita es otro tema", () => {
    for (const texto of ["quiero una cita", "Quisiera agendar una cita para el viernes", "quiero cancelar mi cita", "necesito cambiar mi cita", "quiero reprogramar mi cita"]) {
      assert.equal(cambiaDeTema(texto), true, texto);
    }
  });

  it("lo propio de la compra y la charla corriente NO cambian de tema", () => {
    for (const texto of ["1", "2", "Ya pagué", "hola", "gracias", "¿tienen en rojo?", "cuánto cuesta el kit", "ok", "listo", "👍"]) {
      assert.equal(cambiaDeTema(texto), false, texto);
    }
  });
});

describe("motivoSoltarMenuCompra -- menú 1/2", () => {
  const sinAvisos = [bot(MENSAJE_COMPRA_MENU), bot(construirMensajeCompraSaludo("Aretes"))];
  const dosAvisos = [bot(MENSAJE_COMPRA_OPCION_INVALIDA), bot(MENSAJE_COMPRA_OPCION_INVALIDA), bot(MENSAJE_COMPRA_MENU)];

  it("el flujo sigue siendo suyo: elige una opción, o escribe algo que no es opción las primeras veces", () => {
    assert.equal(motivoSoltarMenuCompra({ texto: "1", esOpcion: true, salientes: sinAvisos }), null);
    assert.equal(motivoSoltarMenuCompra({ texto: "2", esOpcion: true, salientes: sinAvisos }), null);
    assert.equal(motivoSoltarMenuCompra({ texto: "hola", esOpcion: false, salientes: sinAvisos }), null);
    assert.equal(motivoSoltarMenuCompra({ texto: "hola", esOpcion: false, salientes: [bot(MENSAJE_COMPRA_OPCION_INVALIDA), bot(MENSAJE_COMPRA_MENU)] }), null, "un solo aviso todavía se tolera");
  });

  it("sin historial legible no se suelta nada", () => {
    assert.equal(motivoSoltarMenuCompra({ texto: "hola", esOpcion: false, salientes: null }), null);
    assert.equal(motivoSoltarMenuCompra({ texto: "hola", esOpcion: false, salientes: [] }), null);
  });

  it("una persona del equipo fue la última en escribirle -> 'atiende_una_persona' (incluso si escribe «1»: es de SU conversación)", () => {
    assert.equal(motivoSoltarMenuCompra({ texto: "1", esOpcion: true, salientes: [persona("¿las 10 o las 11?"), ...sinAvisos] }), "atiende_una_persona");
    assert.equal(motivoSoltarMenuCompra({ texto: "gracias", esOpcion: false, salientes: [persona("Listo, te lo separo")] }), "atiende_una_persona");
  });

  it("cambió de tema -> 'cambio_de_tema'", () => {
    assert.equal(motivoSoltarMenuCompra({ texto: "quiero una cita", esOpcion: false, salientes: sinAvisos }), "cambio_de_tema");
  });

  it("dos avisos seguidos y vuelve a no elegir -> 'sin_opcion_valida'", () => {
    assert.equal(motivoSoltarMenuCompra({ texto: "jajaja", esOpcion: false, salientes: dosAvisos }), "sin_opcion_valida");
  });

  it("una respuesta VÁLIDA nunca se descarta por los avisos anteriores", () => {
    assert.equal(motivoSoltarMenuCompra({ texto: "1", esOpcion: true, salientes: dosAvisos }), null);
    assert.equal(motivoSoltarMenuCompra({ texto: "2", esOpcion: true, salientes: dosAvisos }), null);
  });

  it("DEFENSA: si el menú del asistente quedó mal marcado como «humano», la clienta igual puede elegir «1»", () => {
    assert.equal(motivoSoltarMenuCompra({ texto: "1", esOpcion: true, salientes: [botMalMarcado(MENSAJE_COMPRA_MENU), botMalMarcado(construirMensajeCompraSaludo("Aretes"))] }), null);
  });

  it("sin vencimiento por tiempo: el historial ni siquiera trae la hora, y quien elige «1» días después todavía puede pagar", () => {
    const viejo: SalienteReciente = { origen: "automatico", texto: MENSAJE_COMPRA_MENU, enviadoEn: "2020-01-01T00:00:00.000Z" };
    assert.equal(motivoSoltarMenuCompra({ texto: "1", esOpcion: true, salientes: [viejo] }), null);
  });

  it("orden de las reglas: una persona atendiendo manda sobre el cambio de tema, y este sobre los avisos", () => {
    assert.equal(motivoSoltarMenuCompra({ texto: "quiero una cita", esOpcion: false, salientes: [persona("Hola"), ...dosAvisos] }), "atiende_una_persona");
    assert.equal(motivoSoltarMenuCompra({ texto: "quiero una cita", esOpcion: false, salientes: dosAvisos }), "cambio_de_tema");
  });
});

describe("decidirEsperaPago -- con un mensaje que NO es «Ya pagué»", () => {
  const trasLasInstrucciones = [bot(MENSAJE_COMPRA_METODOS_PAGO_PENDIENTE), bot(MENSAJE_COMPRA_MENU)];
  const tras1Recordatorio = [bot(MENSAJE_COMPRA_RECORDATORIO_PAGO), ...trasLasInstrucciones];

  it("el primer mensaje después de las instrucciones de pago recibe el recordatorio de siempre", () => {
    assert.equal(decidirEsperaPago({ texto: "ok gracias", salientes: trasLasInstrucciones }), "recordar");
  });

  it("sin historial legible -> el recordatorio de siempre (comportamiento anterior)", () => {
    assert.equal(decidirEsperaPago({ texto: "hola", salientes: null }), "recordar");
    assert.equal(decidirEsperaPago({ texto: "hola", salientes: [] }), "recordar");
  });

  it("el recordatorio se manda UNA vez seguida: si lo último que se le envió ya fue el recordatorio, el asistente calla", () => {
    assert.equal(decidirEsperaPago({ texto: "dale", salientes: tras1Recordatorio }), "callar_ya_se_recordo");
  });

  it("una persona del equipo fue la última en escribirle -> el asistente calla (el flujo sigue abierto para un «Ya pagué» posterior)", () => {
    assert.equal(decidirEsperaPago({ texto: "gracias", salientes: [persona("Ya te confirmo el envío"), ...trasLasInstrucciones] }), "callar_atiende_una_persona");
  });

  it("cambió de tema -> se suelta el flujo", () => {
    assert.equal(decidirEsperaPago({ texto: "quiero una cita", salientes: trasLasInstrucciones }), "soltar_cambio_de_tema");
  });

  it("DEFENSA: instrucciones de pago mal marcadas como «humano» -> igual se manda el recordatorio, no se calla creyendo que habla una persona", () => {
    assert.equal(decidirEsperaPago({ texto: "ok", salientes: [botMalMarcado(MENSAJE_COMPRA_METODOS_PAGO_PENDIENTE)] }), "recordar");
  });

  it("orden: cambio de tema > persona atendiendo > ya se recordó", () => {
    assert.equal(decidirEsperaPago({ texto: "quiero una cita", salientes: [persona("Hola"), ...tras1Recordatorio] }), "soltar_cambio_de_tema");
    assert.equal(decidirEsperaPago({ texto: "ok", salientes: [persona("Hola"), ...tras1Recordatorio] }), "callar_atiende_una_persona");
  });
});
