/**
 * AMORE — reserva desde el portal (/reservar/amore) sobre el MISMO motor real que el chat y el panel (crearCitaConNylas), confirmación con el enlace personal
 * «Mi cita» y recordatorio con ese mismo enlace. TODO el código real de reservas sobre una base en memoria con las reglas de Postgres que importan (EXCLUDE de
 * solape, clave única de idempotencia) y un Google Calendar falso con estado. Nada toca Supabase, Nylas ni WhatsApp reales.
 */
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reservarPorPortalAmore, codigoDeReferencia, telefonoParaReserva, type DepsReservaPortalAmore, type EntradaReservaPortalAmore } from "@/lib/mi-cita/reserva-portal";
import { construirMensajeConfirmacionReserva, formatearFechaHoraColombia, MENSAJE_RECORDATORIO_INMEDIATO } from "@/lib/reserva-notificaciones-whatsapp";
import { enviarRecordatorioAmore, construirTextoRecordatorioAmore, type DepsRecordatorioAmore } from "@/lib/amore-recordatorio-citas";
import { urlEnlaceDeCita } from "@/lib/mi-cita/chat";
import { createMemoryEnlacesStore, hashDeToken } from "@/lib/mi-cita/enlaces";
import { reservarCitaPorServicio } from "@/lib/disponibilidad-servicio";
import { consultarCitasActivasEspecialista } from "@/lib/especialistas-flow-adaptador";
import { textoEnlaceGestion } from "@/lib/mi-cita/mensajes";
import { T, PROFESIONALES, SERVICIO_DIPPING, TELEFONO_CLIENTA, crearMundoAmore, diaLaborable, type MundoAmore } from "@/lib/mi-cita/testing/mundo-amore";

const sinLog = () => {};

function armar(opciones: Parameters<typeof crearMundoAmore>[0] = {}, sobre: Partial<DepsReservaPortalAmore> = {}) {
  const mundo = crearMundoAmore(opciones);
  const dia = diaLaborable(mundo.ahora(), 4);
  const inicio = new Date(`${dia}T10:00:00-05:00`);
  const deps: DepsReservaPortalAmore = {
    supabase: mundo.supabase,
    store: mundo.enlaces,
    nylas: { read: mundo.google.read, write: mundo.google.write, grantId: mundo.google.grantId },
    ahora: mundo.ahora,
    // La confirmación real arma el texto con construirMensajeConfirmacionReserva: aquí se captura lo que se enviaría.
    enviarConfirmacion: async (_s, _t, telefono, cita) => {
      mundo.confirmaciones.push({ telefono, cita });
      mundo.enviados.push({ tenantId: T, telefono, mensaje: construirMensajeConfirmacionReserva(cita) });
      return { enviado: true };
    },
    ...sobre,
  };
  const entrada = (extra: Partial<EntradaReservaPortalAmore> = {}): EntradaReservaPortalAmore => ({
    servicioId: SERVICIO_DIPPING.id,
    especialistaId: 1263,
    inicio,
    nombreCliente: "Ana Pérez",
    telefonoCliente: "314 812 7388",
    fechaNacimientoDia: 12,
    fechaNacimientoMes: 3,
    idempotencyKey: "clave-1",
    ...extra,
  });
  return { mundo, deps, entrada, inicio, dia };
}

const sinNada = (m: MundoAmore) => {
  assert.equal(m.citas().length, 0, "no se creó ninguna cita");
  assert.equal(m.google.eventos.size, 0, "no quedó ningún evento en Google Calendar");
  assert.equal(m.confirmaciones.length, 0, "no se mandó ninguna confirmación");
  assert.equal(m.enlaces.filas.length, 0, "no se emitió ningún enlace");
};

describe("1. Reserva por el portal: una sola fuente de verdad (Google Calendar + DuLabs) y la identidad del chat", () => {
  it("crea la cita CONFIRMADA, el evento en el calendario de ESA profesional, el mapeo cita→evento, la clienta conocida y el enlace personal", async () => {
    const { mundo, deps, entrada, inicio } = armar();
    const r = await reservarPorPortalAmore(deps, entrada());
    assert.ok(r.ok, JSON.stringify(r));
    const [cita] = mundo.citas();
    assert.equal(cita!.estado, "confirmada");
    assert.equal(cita!.especialista_id, 1263);
    assert.equal(cita!.servicio_id, "s-dipping");
    assert.equal(new Date(cita!.inicio as string).toISOString(), inicio.toISOString());
    assert.equal(new Date(cita!.fin as string).getTime() - inicio.getTime(), 120 * 60_000, "la duración sale del servicio, nunca del cliente");
    // Google Calendar: un evento, en el calendario de Cristal, a esa hora.
    assert.equal(mundo.google.eventos.size, 1);
    const evento = [...mundo.google.eventos.values()][0]!;
    assert.equal(evento.calendarId, "cal-cristal");
    assert.equal(evento.startUnix, Math.floor(inicio.getTime() / 1000));
    assert.equal(evento.endUnix, Math.floor(inicio.getTime() / 1000) + 7200);
    // Mapeo cita -> evento (para poder cancelar / reprogramar después).
    const mapeos = (mundo.tablas.dulabs_agenda_v2_citas_nylas ?? []).map((m) => ({ cita_id: m.cita_id, nylas_event_id: m.nylas_event_id }));
    assert.deepEqual(mapeos, [{ cita_id: cita!.id, nylas_event_id: evento.id }]);
    // La clienta queda como una que escribió por WhatsApp (misma identidad).
    const conocida = (mundo.tablas.dulabs_clientes_conocidos ?? [])[0]!;
    assert.equal(conocida.phone_number_id, `whatsapp-qr:${T}`);
    assert.equal(conocida.telefono_cliente, TELEFONO_CLIENTA);
    assert.equal(conocida.nombre, "Ana Pérez");
    assert.equal(conocida.cumple_dia, 12);
    assert.equal(conocida.cumple_mes, 3);
  });

  it("CAUSA RAÍZ del bug: la cita queda con la identidad que busca el chat (whatsapp-qr:<negocio> + teléfono normalizado), así «cancelar mi cita» por WhatsApp SÍ la encuentra", async () => {
    const { mundo, deps, entrada } = armar();
    assert.ok((await reservarPorPortalAmore(deps, entrada())).ok);
    const [cita] = mundo.citas();
    assert.equal(cita!.phone_number_id, `whatsapp-qr:${T}`, "no el phone_number_id legacy de Meta (pendiente-amore-…)");
    assert.equal(cita!.telefono_cliente, "573148127388", "no el teléfono tal como lo escribió la clienta («314 812 7388»)");
    const delChat = await consultarCitasActivasEspecialista(mundo.supabase, { phoneNumberId: `whatsapp-qr:${T}`, telefonoCliente: TELEFONO_CLIENTA });
    assert.equal(delChat.cantidad, 1, "es EXACTAMENTE la consulta que hace el bot de WhatsApp");
    assert.equal(delChat.citas[0]!.id, cita!.id);
  });

  it("DIAGNÓSTICO del bug original: el motor genérico que usaba el portal dejaba la cita con la identidad LEGACY, invisible para el chat y sin evento en Google Calendar", async () => {
    const { mundo, inicio } = armar();
    const r = await reservarCitaPorServicio(mundo.supabase, { idTenant: T, especialistaId: 1263, servicioId: "s-dipping", telefonoCliente: "314 812 7388", nombreCliente: "Ana", inicio });
    assert.ok(r.ok);
    const [cita] = mundo.citas();
    assert.notEqual(cita!.phone_number_id, `whatsapp-qr:${T}`);
    assert.equal(cita!.telefono_cliente, "314 812 7388");
    assert.equal((await consultarCitasActivasEspecialista(mundo.supabase, { phoneNumberId: `whatsapp-qr:${T}`, telefonoCliente: TELEFONO_CLIENTA })).cantidad, 0, "el chat no la encontraba");
    assert.equal(mundo.google.eventos.size, 0, "y el calendario de la profesional nunca se enteraba");
  });

  it("la confirmación sale por WhatsApp con el enlace personal y cómo usarlo; el enlace es el MISMO que queda guardado (y solo su hash)", async () => {
    const { mundo, deps, entrada } = armar();
    const r = await reservarPorPortalAmore(deps, entrada());
    assert.ok(r.ok);
    assert.match(r.data.enlaceGestion!, /^https:\/\/www\.dulabs\.co\/mi-cita\/[A-Za-z0-9_-]{43}$/);
    assert.equal(mundo.confirmaciones.length, 1);
    assert.equal(mundo.confirmaciones[0]!.cita.enlaceGestion, r.data.enlaceGestion);
    const texto = mundo.enviados.at(-1)!.mensaje;
    assert.match(texto, /¡Tu cita ha sido confirmada!/);
    assert.match(texto, /Servicio: Dipping/);
    assert.match(texto, /Profesional: Cristal/);
    assert.ok(texto.includes("Si necesitas modificar o cancelar tu cita, puedes hacerlo desde este enlace:"));
    assert.ok(texto.includes(r.data.enlaceGestion!));
    const token = r.data.enlaceGestion!.split("/").pop()!;
    assert.equal(mundo.enlaces.filas.length, 1);
    assert.equal(mundo.enlaces.filas[0]!.tokenHash, hashDeToken(token));
    assert.equal(mundo.enlaces.filas[0]!.citaId, mundo.citas()[0]!.id);
  });

  it("la respuesta al navegador no expone ids internos ni el teléfono; el «código» ya no es el id de la cita en base 36", async () => {
    const { mundo, deps, entrada } = armar();
    const r = await reservarPorPortalAmore(deps, entrada());
    assert.ok(r.ok);
    const citaId = mundo.citas()[0]!.id as number;
    const cuerpo = JSON.stringify(r.data);
    assert.ok(!/"(id|citaId|cita_id|especialistaId|telefono)"/i.test(cuerpo));
    assert.ok(!cuerpo.includes("573148127388") && !cuerpo.includes(T));
    assert.match(r.data.codigo, /^A-[0-9A-F]{6}$/);
    assert.notEqual(r.data.codigo, `R-${citaId.toString(36).toUpperCase()}`);
    assert.equal(r.data.codigo, codigoDeReferencia(citaId), "estable para la misma cita");
    assert.notEqual(codigoDeReferencia(citaId), codigoDeReferencia(citaId + 1));
  });
});

describe("2. Reintentos y carreras: una cita, un evento, un mensaje", () => {
  it("la MISMA solicitud repetida (doble clic / reintento de red) devuelve lo mismo SIN crear otra cita, otro evento ni otro WhatsApp", async () => {
    const { mundo, deps, entrada } = armar();
    const a = await reservarPorPortalAmore(deps, entrada());
    const b = await reservarPorPortalAmore(deps, entrada());
    assert.ok(a.ok && b.ok);
    assert.equal(mundo.citas().length, 1);
    assert.equal(mundo.google.eventos.size, 1);
    assert.equal(mundo.google.llamadas.crear, 1);
    assert.equal(mundo.confirmaciones.length, 1, "la confirmación no se reenvía");
    assert.equal(a.data.enlaceGestion, b.data.enlaceGestion);
    assert.equal(a.data.codigo, b.data.codigo);
    assert.equal(mundo.enlaces.filas.length, 1);
  });

  it("la misma clave con datos DISTINTOS se rechaza (nunca se reutiliza el resultado de otra solicitud)", async () => {
    const { mundo, deps, entrada } = armar();
    assert.ok((await reservarPorPortalAmore(deps, entrada())).ok);
    const otra = await reservarPorPortalAmore(deps, entrada({ nombreCliente: "Otra Persona" }));
    assert.equal(otra.ok, false);
    assert.equal(!otra.ok && otra.status, 409);
    assert.equal(mundo.citas().length, 1);
  });

  it("dos clientas pidiendo el MISMO horario a la vez: una gana, la otra recibe «acaba de ser reservado»; sin eventos huérfanos ni doble confirmación", async () => {
    const { mundo, deps, entrada } = armar();
    const [a, b] = await Promise.all([
      reservarPorPortalAmore(deps, entrada({ nombreCliente: "Ana", telefonoCliente: "3148127388", idempotencyKey: "k-a" })),
      reservarPorPortalAmore(deps, entrada({ nombreCliente: "Beto", telefonoCliente: "3001234567", idempotencyKey: "k-b" })),
    ]);
    assert.equal([a, b].filter((x) => x.ok).length, 1);
    const perdedora = [a, b].find((x) => !x.ok)!;
    assert.ok(!perdedora.ok && perdedora.status === 409 && perdedora.error.includes("acaba de ser reservado"));
    assert.equal(mundo.citas().length, 1, "el EXCLUDE de Postgres deja UNA sola cita");
    assert.equal(mundo.google.eventos.size, 1, "el evento de la perdedora se revirtió");
    assert.equal(mundo.confirmaciones.length, 1);
  });
});

describe("3. Disponibilidad real: lo ocupado en Google Calendar o en DuLabs nunca se reserva", () => {
  it("horario ocupado en Google Calendar (aunque DuLabs no sepa) -> «acaba de ser reservado»; no se crea nada", async () => {
    const { mundo, deps, entrada, inicio } = armar();
    mundo.google.eventos.set("externo", { id: "externo", calendarId: "cal-cristal", startUnix: Math.floor(inicio.getTime() / 1000), endUnix: Math.floor(inicio.getTime() / 1000) + 3600, title: "Evento personal" });
    const r = await reservarPorPortalAmore(deps, entrada());
    assert.ok(!r.ok && r.status === 409 && r.error.includes("acaba de ser reservado"));
    assert.equal(mundo.citas().length, 0);
    assert.equal(mundo.google.llamadas.crear, 0, "ni siquiera se intentó crear el evento");
    assert.equal(mundo.confirmaciones.length, 0);
  });

  it("horario ocupado por otra cita de DuLabs -> lo mismo", async () => {
    const { mundo, deps, entrada, inicio } = armar();
    mundo.sembrarCita({ inicio, conEvento: false });
    const r = await reservarPorPortalAmore(deps, entrada());
    assert.ok(!r.ok && r.error.includes("acaba de ser reservado"));
    assert.equal(mundo.citas().length, 1, "solo la que ya existía");
  });

  it("la misma hora con OTRA profesional sí se puede (cada una tiene su calendario)", async () => {
    const { mundo, deps, entrada, inicio } = armar();
    mundo.sembrarCita({ inicio, especialistaId: 1263, conEvento: false });
    const r = await reservarPorPortalAmore(deps, entrada({ especialistaId: 1262 }));
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(mundo.citas().length, 2);
  });

  it("una hora en el pasado se rechaza aunque alguien llame a la API directamente", async () => {
    const { mundo, deps, entrada } = armar();
    const r = await reservarPorPortalAmore(deps, entrada({ inicio: new Date(mundo.ahora().getTime() - 3600_000) }));
    assert.ok(!r.ok && r.status === 409);
    sinNada(mundo);
    // La guardia del portal corta ANTES de consultar Google Calendar y de reservar la clave de idempotencia: no depende solo de que el motor lo rechace después.
    assert.equal(mundo.google.llamadas.listar, 0, "ni siquiera se consultó Google Calendar");
    assert.equal((mundo.tablas.dulabs_idempotencia_reservas ?? []).length, 0, "no se reservó ninguna clave de idempotencia");
  });
});

describe("4. Fallar cerrado: sin calendario confirmado no se reserva a ciegas", () => {
  it("sin integración de calendario en el entorno -> 503, nada se crea", async () => {
    const { mundo, deps, entrada } = armar({}, { nylas: null });
    const r = await reservarPorPortalAmore(deps, entrada());
    assert.ok(!r.ok && r.status === 503);
    sinNada(mundo);
  });

  it("Nylas no responde al revalidar -> 503 («no pudimos confirmar la disponibilidad»), nada se crea", async () => {
    const { mundo, deps, entrada } = armar();
    mundo.google.falla.listar = true;
    const r = await reservarPorPortalAmore(deps, entrada());
    assert.ok(!r.ok && r.status === 503 && /no pudimos confirmar la disponibilidad/i.test(r.error));
    sinNada(mundo);
  });

  it("Google no puede crear el evento -> 503 y NO se crea la cita en DuLabs (nunca una cita sin su evento)", async () => {
    const { mundo, deps, entrada } = armar();
    mundo.google.falla.crear = true;
    const r = await reservarPorPortalAmore(deps, entrada());
    assert.ok(!r.ok && r.status === 503);
    sinNada(mundo);
  });
});

describe("5. Datos de la clienta", () => {
  it("el teléfono se normaliza (10 dígitos colombianos -> 57…; con +57 y espacios; extranjero con su indicativo) y uno inválido se rechaza sin crear nada", async () => {
    for (const [escrito, esperado] of [
      ["3148127388", "573148127388"],
      ["314 812 7388", "573148127388"],
      ["+57 314 812 7388", "573148127388"],
      ["573148127388", "573148127388"],
      ["+1 (305) 555-0100", "13055550100"],
    ] as const) {
      assert.equal(telefonoParaReserva(escrito), esperado, escrito);
    }
    for (const malo of ["", "123", "abc", "31481", "12345678901234567890"]) assert.equal(telefonoParaReserva(malo), null, malo);
    const { mundo, deps, entrada } = armar();
    const r = await reservarPorPortalAmore(deps, entrada({ telefonoCliente: "123" }));
    assert.ok(!r.ok && r.status === 400);
    sinNada(mundo);
  });

  it("una profesional que requiere aprobación deja la cita PENDIENTE y NO se le dice «confirmada» a la clienta (el enlace sí existe)", async () => {
    const { mundo, deps, entrada } = armar({ requiereAprobacion: true });
    const r = await reservarPorPortalAmore(deps, entrada());
    assert.ok(r.ok);
    assert.equal(mundo.citas()[0]!.estado, "pendiente");
    assert.equal(mundo.confirmaciones.length, 0, "nunca se afirma algo falso");
    assert.ok(r.data.enlaceGestion);
  });
});

describe("6. Si el enlace no se puede emitir, la reserva NO falla", () => {
  it("sin la tabla de enlaces (migración sin aplicar): la cita y el evento quedan, la confirmación sale SIN la línea del enlace y la respuesta trae enlaceGestion = null", async () => {
    const { mundo, deps, entrada } = armar({}, { store: createMemoryEnlacesStore({ sinTabla: true }) });
    const r = await reservarPorPortalAmore(deps, entrada());
    assert.ok(r.ok);
    assert.equal(r.data.enlaceGestion, null);
    assert.equal(mundo.citas().length, 1);
    assert.equal(mundo.google.eventos.size, 1);
    assert.equal(mundo.confirmaciones.length, 1);
    const texto = mundo.enviados.at(-1)!.mensaje;
    assert.ok(!texto.includes("mi-cita") && !texto.includes("Si necesitas modificar o cancelar"));
    assert.match(texto, /¡Tu cita ha sido confirmada!/);
  });
});

describe("7. Los textos", () => {
  const cita = { servicio: "Dipping", profesional: "Cristal", inicioISO: "2026-10-09T15:00:00.000Z" };

  it("la confirmación SIN enlace (otros negocios, o si no se pudo emitir) es EXACTAMENTE el texto de siempre", () => {
    const esperado = `¡Tu cita ha sido confirmada! 💗

Te esperamos el ${formatearFechaHoraColombia(cita.inicioISO)}.

📌 Servicio: Dipping
💅 Profesional: Cristal

¡Gracias por elegirnos! ✨`;
    assert.equal(construirMensajeConfirmacionReserva(cita), esperado);
    assert.equal(construirMensajeConfirmacionReserva({ ...cita, enlaceGestion: null }), construirMensajeConfirmacionReserva(cita));
  });

  it("CON enlace agrega «Si necesitas modificar o cancelar tu cita, puedes hacerlo desde este enlace:» + la URL, antes del cierre", () => {
    const url = "https://www.dulabs.co/mi-cita/TOKEN";
    const t = construirMensajeConfirmacionReserva({ ...cita, enlaceGestion: url });
    assert.ok(t.includes(`${textoEnlaceGestion(url)}\n\n¡Gracias por elegirnos!`));
    assert.equal(textoEnlaceGestion(url), `Si necesitas modificar o cancelar tu cita, puedes hacerlo desde este enlace:\n${url}`);
    assert.match(MENSAJE_RECORDATORIO_INMEDIATO, /confirmada 1 hora antes/, "la política del salón sigue igual");
  });
});

describe("8. El recordatorio lleva el MISMO enlace personal", () => {
  const preparar = async () => {
    const m = armar();
    const r = await reservarPorPortalAmore(m.deps, m.entrada());
    assert.ok(r.ok);
    const cita = m.mundo.citas()[0]!;
    const citaRecordatorio = { id: cita.id as number, especialista_id: 1263, telefono_cliente: TELEFONO_CLIENTA, nombre_cliente: "Ana Pérez", servicio: "Dipping", inicio: cita.inicio as string, fin: cita.fin as string };
    const enviados: string[] = [];
    const baseDeps = {
      especialistaPorId: async () => ({ nombre: "Cristal" }) as never,
      enviarMensajeWhatsApp: (async (p: { mensaje: string }) => {
        enviados.push(p.mensaje);
        return { ok: true };
      }) as never,
      obtenerNombresServiciosDeCita: async () => [],
      buscarNombreConocido: async () => "Ana",
    };
    return { ...m, cita: citaRecordatorio, enviados, baseDeps, enlace: r.data.enlaceGestion! };
  };

  it("el texto del recordatorio incluye «Si necesitas modificar o cancelar tu cita…» con el enlace que recibió en la confirmación", async () => {
    const p = await preparar();
    const ok = await enviarRecordatorioAmore(p.mundo.supabase, T, p.cita, { ...p.baseDeps, urlEnlaceCita: (sb, t, c) => urlEnlaceDeCita(sb, t, c, p.mundo.enlaces) });
    assert.equal(ok, true);
    assert.equal(p.enviados.length, 1);
    assert.match(p.enviados[0]!, /Te recordamos tu cita en AMORE/);
    assert.ok(p.enviados[0]!.includes(textoEnlaceGestion(p.enlace)), "el MISMO enlace de la confirmación");
    assert.equal(p.mundo.enlaces.filas.length, 1, "no se emitió otro enlace");
  });

  it("una cita SIN enlace todavía (creada antes de esta función) recibe uno al recordarle", async () => {
    const p = await preparar();
    const otra = p.mundo.sembrarCita({ id: 901, inicio: new Date(p.mundo.ahora().getTime() + 3 * 86_400_000), especialistaId: 1262 });
    const cita = { ...p.cita, id: otra.citaId, inicio: new Date(p.mundo.ahora().getTime() + 3 * 86_400_000).toISOString(), fin: new Date(p.mundo.ahora().getTime() + 3 * 86_400_000 + 7_200_000).toISOString() };
    await enviarRecordatorioAmore(p.mundo.supabase, T, cita, { ...p.baseDeps, urlEnlaceCita: (sb, t, c) => urlEnlaceDeCita(sb, t, c, p.mundo.enlaces) });
    assert.match(p.enviados[0]!, /https:\/\/www\.dulabs\.co\/mi-cita\/[A-Za-z0-9_-]{43}/);
    assert.equal(p.mundo.enlaces.filas.length, 2);
  });

  it("si el enlace no se puede obtener (null o excepción), el recordatorio SALE igual, sin la línea (nunca se retrasa ni se pierde un recordatorio)", async () => {
    for (const urlEnlaceCita of [async () => null, async () => Promise.reject(new Error("base caída"))]) {
      const p = await preparar();
      const silenciar = console.error;
      console.error = sinLog;
      try {
        const ok = await enviarRecordatorioAmore(p.mundo.supabase, T, p.cita, { ...p.baseDeps, urlEnlaceCita });
        assert.equal(ok, true);
      } finally {
        console.error = silenciar;
      }
      assert.equal(p.enviados.length, 1);
      assert.ok(!p.enviados[0]!.includes("mi-cita"));
      assert.equal(p.enviados[0], construirTextoRecordatorioAmore({ nombreCliente: "Ana", servicios: ["Dipping"], profesionalNombre: "Cristal", fechaEtiqueta: p.enviados[0]!.match(/Fecha: (.*)\n/)![1]!, horaTexto: p.enviados[0]!.match(/Hora: (.*)\n/)![1]! }));
    }
  });

  it("con la plantilla personalizada del negocio también lleva el enlace; si la plantilla ya lo trae, no se repite", async () => {
    const p = await preparar();
    const deps: DepsRecordatorioAmore = { ...p.baseDeps, urlEnlaceCita: (sb, t, c) => urlEnlaceDeCita(sb, t, c, p.mundo.enlaces) };
    await enviarRecordatorioAmore(p.mundo.supabase, T, p.cita, deps, "Hola {{nombre}}, te esperamos el {{fecha}} a las {{hora}} con {{profesional}} 💗");
    assert.match(p.enviados[0]!, /^Hola Ana, te esperamos el /);
    assert.ok(p.enviados[0]!.includes(textoEnlaceGestion(p.enlace)));
    await enviarRecordatorioAmore(p.mundo.supabase, T, p.cita, deps, `Tu enlace: ${p.enlace}`);
    assert.equal(p.enviados[1], `Tu enlace: ${p.enlace}`, "ya traía el enlace: no se duplica");
  });

  it("solo AMORE tiene enlaces «Mi cita»: para otro negocio no hay ninguno", async () => {
    const p = await preparar();
    assert.equal(await urlEnlaceDeCita(p.mundo.supabase, "otro-negocio", { id: 1, fin: p.cita.fin }, p.mundo.enlaces), null);
  });
});

// ---------------------------------------------------------------------------
// VARIOS SERVICIOS EN UNA SOLA CITA (manos + pies): una sola profesional que haga TODOS, un bloque continuo con la duración SUMADA, un solo evento en Google
// Calendar y una sola cita en DuLabs (con el detalle de cada servicio). Mismo motor real, sobre la misma base en memoria.
// ---------------------------------------------------------------------------
describe("VARIOS SERVICIOS por el portal -- manos + pies en UNA sola cita", () => {
  type Fila = Record<string, unknown>;
  const servicio = (id: string, nombre: string, duracion_min: number, precio: number | null): Fila => ({ id, id_tenant: T, nombre, precio, duracion_min, categoria: "Uñas", descripcion: null, activo: true });

  /** El mundo de siempre + manos (60 min, $40.000), pies (60 min, $35.000), uno sin precio, y dos que hace cada una por separado (Mary / Cristal). */
  function armarVarios(sobre: Partial<DepsReservaPortalAmore> = {}) {
    const base = armar({}, sobre);
    const tablas = base.mundo.tablas;
    (tablas.dulabs_servicios as Fila[]).push(
      servicio("s-manos", "Manos Semi", 60, 40000),
      servicio("s-pies", "Pies Semi", 60, 35000),
      servicio("s-sin-precio", "Keratina", 60, null),
      servicio("s-solo-mary", "Maquillaje Suave", 60, 90000),
      servicio("s-solo-cristal", "Maquillaje Pro", 60, 150000),
    );
    const asociar = (servicioId: string, ids: number[]) => ids.forEach((especialista_id) => (tablas.dulabs_servicio_especialista as Fila[]).push({ id_tenant: T, servicio_id: servicioId, especialista_id }));
    const ambas = PROFESIONALES.map((p) => p.id);
    asociar("s-manos", ambas);
    asociar("s-pies", ambas);
    asociar("s-sin-precio", ambas);
    asociar("s-solo-mary", [1262]);
    asociar("s-solo-cristal", [1263]);
    return base;
  }

  it("crea UNA cita y UN evento de 2 h (la suma), con el detalle de los dos servicios y el precio total", async () => {
    const { mundo, deps, entrada, inicio } = armarVarios();
    const r = await reservarPorPortalAmore(deps, entrada({ servicioId: "s-manos", serviciosIdsAdicionales: ["s-pies"] }));
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(mundo.citas().length, 1, "una sola cita, no una por servicio");
    const cita = mundo.citas()[0]!;
    assert.equal(cita.servicio_id, "s-manos", "el servicio de la cita es el PRIMERO (compatibilidad con todo lo que ya la lee)");
    assert.equal(new Date(cita.fin as string).getTime() - inicio.getTime(), 120 * 60_000, "60 + 60 minutos continuos");
    assert.equal(cita.precio_total, 75000);
    assert.equal(mundo.google.eventos.size, 1, "un solo evento en Google Calendar");
    const evento = [...mundo.google.eventos.values()][0]!;
    assert.equal(evento.calendarId, "cal-cristal");
    assert.equal(evento.endUnix - evento.startUnix, 7200);
    assert.match(evento.title, /Manos Semi \+ Pies Semi/);
    const detalle = (mundo.tablas.dulabs_cita_servicios ?? []).map((f) => ({ servicio_id: f.servicio_id, orden: f.orden }));
    assert.deepEqual(detalle, [
      { servicio_id: "s-manos", orden: 1 },
      { servicio_id: "s-pies", orden: 2 },
    ]);
  });

  it("la respuesta resume la cita completa: «A + B» y la duración total; la confirmación por WhatsApp nombra los dos", async () => {
    const { mundo, deps, entrada } = armarVarios();
    const r = await reservarPorPortalAmore(deps, entrada({ servicioId: "s-manos", serviciosIdsAdicionales: ["s-pies"] }));
    assert.ok(r.ok);
    assert.equal(r.data.servicio, "Manos Semi + Pies Semi");
    assert.equal(r.data.duracionMin, 120);
    assert.equal(r.data.profesional, "Cristal");
    assert.equal(mundo.confirmaciones.length, 1);
    assert.match(mundo.enviados.at(-1)!.mensaje, /Servicio: Manos Semi \+ Pies Semi/);
  });

  it("tres servicios: se suman las tres duraciones; sin precio en uno, NO se inventa un total", async () => {
    const { mundo, deps, entrada, inicio } = armarVarios();
    const r = await reservarPorPortalAmore(deps, entrada({ servicioId: "s-manos", serviciosIdsAdicionales: ["s-pies", "s-sin-precio"] }));
    assert.ok(r.ok, JSON.stringify(r));
    const cita = mundo.citas()[0]!;
    assert.equal(new Date(cita.fin as string).getTime() - inicio.getTime(), 180 * 60_000);
    assert.equal(cita.precio_total, null, "un servicio sin precio fijo: se deja sin total en vez de sumar un 0 falso");
    assert.equal((mundo.tablas.dulabs_cita_servicios ?? []).length, 3);
  });

  it("el bloque es continuo: una cita que cae a mitad de las 2 h bloquea la reserva COMPLETA (nada queda creado)", async () => {
    const { mundo, deps, entrada, dia } = armarVarios();
    mundo.sembrarCita({ especialistaId: 1263, inicio: new Date(`${dia}T11:00:00-05:00`) }); // Cristal 11:00-13:00 (un Dipping ya reservado)
    const antes = { citas: mundo.citas().length, eventos: mundo.google.eventos.size };
    const r = await reservarPorPortalAmore(deps, entrada({ servicioId: "s-manos", serviciosIdsAdicionales: ["s-pies"] })); // 10:00-12:00 se cruza con las 11:00
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.status, 409);
    assert.ok(r.error.includes("acaba de ser reservado"), "la pantalla reconoce esta frase para ofrecer «elegir otro horario»");
    assert.equal(mundo.citas().length, antes.citas);
    assert.equal(mundo.google.eventos.size, antes.eventos);
    assert.equal(mundo.confirmaciones.length, 0);
  });

  it("una profesional que NO hace todos los servicios se rechaza con el texto de la combinación y sin dejar nada", async () => {
    const { mundo, deps, entrada } = armarVarios();
    // Maquillaje Suave solo lo hace Mary: con Cristal la combinación es imposible.
    const r = await reservarPorPortalAmore(deps, entrada({ servicioId: "s-manos", serviciosIdsAdicionales: ["s-solo-mary"], especialistaId: 1263 }));
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.status, 409);
    assert.match(r.error, /combinación de servicios/);
    sinNada(mundo);
  });

  it("con Mary (que sí hace los dos) la misma combinación se reserva", async () => {
    const { mundo, deps, entrada } = armarVarios();
    const r = await reservarPorPortalAmore(deps, entrada({ servicioId: "s-manos", serviciosIdsAdicionales: ["s-solo-mary"], especialistaId: 1262 }));
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal([...mundo.google.eventos.values()][0]!.calendarId, "cal-mary");
  });

  it("dos servicios que ninguna profesional hace juntos (uno solo de Mary y otro solo de Cristal) -> rechazo con cualquiera de las dos, sin dejar nada", async () => {
    for (const especialistaId of [1262, 1263]) {
      const { mundo, deps, entrada } = armarVarios();
      const r = await reservarPorPortalAmore(deps, entrada({ servicioId: "s-solo-mary", serviciosIdsAdicionales: ["s-solo-cristal"], especialistaId }));
      assert.equal(r.ok, false);
      sinNada(mundo);
    }
  });

  it("un servicio inexistente entre los elegidos -> «alguno de los servicios ya no está disponible», sin dejar nada", async () => {
    const { mundo, deps, entrada } = armarVarios();
    const r = await reservarPorPortalAmore(deps, entrada({ servicioId: "s-manos", serviciosIdsAdicionales: ["s-no-existe"] }));
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.status, 409);
    assert.match(r.error, /Alguno de los servicios/);
    sinNada(mundo);
  });

  it("más de 3 servicios, o un servicio repetido -> 400 y nada se toca (la API se puede llamar directamente)", async () => {
    const { mundo, deps, entrada } = armarVarios();
    const demasiados = await reservarPorPortalAmore(deps, entrada({ servicioId: "s-manos", serviciosIdsAdicionales: ["s-pies", "s-sin-precio", "s-solo-mary"] }));
    assert.equal(demasiados.ok, false);
    if (!demasiados.ok) assert.equal(demasiados.status, 400);
    const repetido = await reservarPorPortalAmore(deps, entrada({ servicioId: "s-manos", serviciosIdsAdicionales: ["s-manos"] }));
    assert.equal(repetido.ok, false);
    if (!repetido.ok) assert.equal(repetido.status, 400);
    sinNada(mundo);
  });

  it("doble clic (misma clave) -> UNA sola cita, UN evento y UNA confirmación", async () => {
    const { mundo, deps, entrada } = armarVarios();
    const a = await reservarPorPortalAmore(deps, entrada({ servicioId: "s-manos", serviciosIdsAdicionales: ["s-pies"] }));
    const b = await reservarPorPortalAmore(deps, entrada({ servicioId: "s-manos", serviciosIdsAdicionales: ["s-pies"] }));
    assert.ok(a.ok && b.ok);
    assert.equal(mundo.citas().length, 1);
    assert.equal(mundo.google.eventos.size, 1);
    assert.equal(mundo.confirmaciones.length, 1);
  });

  it("reusar una clave con OTRA combinación de servicios es un conflicto (la huella incluye todos los servicios)", async () => {
    const { mundo, deps, entrada } = armarVarios();
    assert.ok((await reservarPorPortalAmore(deps, entrada({ servicioId: "s-manos", serviciosIdsAdicionales: ["s-pies"] }))).ok);
    const otra = await reservarPorPortalAmore(deps, entrada({ servicioId: "s-manos" }));
    assert.equal(otra.ok, false);
    if (!otra.ok) assert.match(otra.error, /ya se procesó con datos diferentes/);
    assert.equal(mundo.citas().length, 1);
  });

  it("un solo servicio sigue igual que siempre (sin detalle de servicios, huella y respuesta de siempre)", async () => {
    const { mundo, deps, entrada } = armarVarios();
    const r = await reservarPorPortalAmore(deps, entrada());
    assert.ok(r.ok);
    assert.equal(r.data.servicio, "Dipping");
    assert.equal(r.data.duracionMin, 120);
    assert.equal((mundo.tablas.dulabs_cita_servicios ?? []).length, 0, "con un solo servicio no hay detalle: nada cambió respecto de antes");
  });
});
