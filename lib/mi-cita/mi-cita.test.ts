/**
 * AMORE «Mi cita» — ver, reprogramar y cancelar una cita desde su enlace personal, de punta a punta sobre el código REAL (revalidación contra Google Calendar,
 * UPDATE atómico, borrado del evento, avisos) con una base en memoria con las reglas de Postgres que importan y un Google Calendar falso con estado.
 * Incluye lo de seguridad: enlaces manipulados, ajenos, de otro negocio, revocados y vencidos; el id de la cita nunca viene del cliente.
 */
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { borrarEventoDeCita, cancelarMiCita, gestionDeCita, horariosParaReprogramar, reprogramarMiCita, verMiCita, type DepsMiCita } from "@/lib/mi-cita/gestion";
import { atenderCancelarMiCita, atenderHorariosMiCita, atenderReprogramarMiCita, atenderVerMiCita } from "@/lib/mi-cita/rutas";
import { generarToken, hashDeToken, obtenerOCrearEnlace, GRACIA_TRAS_LA_CITA_MS } from "@/lib/mi-cita/enlaces";
import { mensajeCitaCancelada } from "@/lib/mi-cita/mensajes";
import { reservarPorPortalAmore } from "@/lib/mi-cita/reserva-portal";
import { T, TELEFONO_CLIENTA, crearMundoAmore, diaLaborable } from "@/lib/mi-cita/testing/mundo-amore";

const sinLog = () => {};
const unix = (d: Date) => Math.floor(d.getTime() / 1000);

/** Un día de lunes a viernes (jornada 9:00–19:00 sin recortes de sábado), dentro de N días. */
function diaHabil(desde: Date, minimo: number): string {
  let dia = diaLaborable(desde, minimo);
  while (new Date(`${dia}T12:00:00-05:00`).getDay() === 6) dia = diaLaborable(new Date(new Date(`${dia}T12:00:00-05:00`).getTime() + 86_400_000), 1);
  return dia;
}

async function armar(opciones: Parameters<typeof crearMundoAmore>[0] = {}, cita: { estado?: string; diasAdelante?: number; hora?: string } = {}) {
  const mundo = crearMundoAmore(opciones);
  const dia = diaHabil(mundo.ahora(), cita.diasAdelante ?? 3);
  const inicio = new Date(`${dia}T${cita.hora ?? "10:00"}:00-05:00`);
  const { citaId, eventoId } = mundo.sembrarCita({ id: 700, inicio, estado: cita.estado });
  const fin = new Date(inicio.getTime() + 7_200_000).toISOString();
  const enlace = (await obtenerOCrearEnlace(mundo.enlaces, { idTenant: T, citaId, citaFinISO: fin }, { ahora: mundo.ahora, log: sinLog }))!;
  const deps = mundo.depsMiCita();
  const otroDia = diaHabil(mundo.ahora(), (cita.diasAdelante ?? 3) + 1);
  return { mundo, deps, token: enlace.token, citaId, eventoId, inicio, dia, otroDia };
}

describe("1. Ver la cita", () => {
  it("devuelve los datos de la cita SIN ids internos, teléfono, nombre de la clienta ni el negocio (id)", async () => {
    const { deps, token } = await armar();
    const r = await verMiCita(deps, token);
    assert.ok(r.ok);
    assert.deepEqual(Object.keys(r.data).sort(), ["aviso", "duracionMin", "estado", "fin", "inicio", "negocio", "profesional", "puedeCancelar", "puedeReprogramar", "servicio"]);
    assert.equal(r.data.servicio, "Dipping");
    assert.equal(r.data.profesional, "Cristal");
    assert.equal(r.data.duracionMin, 120);
    assert.equal(r.data.estado, "confirmada");
    assert.equal(r.data.puedeCancelar && r.data.puedeReprogramar, true);
    const cuerpo = JSON.stringify(r.data);
    for (const secreto of ["700", TELEFONO_CLIENTA, "Ana", T, "whatsapp-qr"]) assert.ok(!cuerpo.includes(secreto), `no debe aparecer ${secreto}`);
  });

  it("según el estado y la fecha: pendiente solo se puede cancelar; pasada o cancelada, nada; sin calendario no se ofrece reprogramar", async () => {
    const pendiente = await armar({}, { estado: "pendiente" });
    const p = await verMiCita(pendiente.deps, pendiente.token);
    assert.ok(p.ok && p.data.puedeCancelar && !p.data.puedeReprogramar && /pendiente de aprobación/.test(p.data.aviso!));
    const cancelada = await armar({}, { estado: "cancelada" });
    const c = await verMiCita(cancelada.deps, cancelada.token);
    assert.ok(c.ok && !c.data.puedeCancelar && !c.data.puedeReprogramar && /ya fue cancelada/.test(c.data.aviso!));
    const pasada = await armar();
    pasada.mundo.avanzarReloj(5 * 86_400_000);
    // El enlace sigue abriendo (14 días de gracia) pero la cita ya pasó.
    const pa = await verMiCita(pasada.mundo.depsMiCita(), pasada.token);
    assert.ok(pa.ok && !pa.data.puedeCancelar && !pa.data.puedeReprogramar && /ya pasó/.test(pa.data.aviso!));
    const sinNylas = await armar();
    const s = await verMiCita({ ...sinNylas.deps, nylas: null }, sinNylas.token);
    assert.ok(s.ok && s.data.puedeCancelar && !s.data.puedeReprogramar);
  });

  it("gestionDeCita (pura): el criterio por estado", () => {
    const ahora = new Date("2026-10-06T12:00:00Z");
    const futura = "2026-10-08T15:00:00Z";
    assert.deepEqual(gestionDeCita({ estado: "confirmada", inicio: futura }, ahora), { puedeCancelar: true, puedeReprogramar: true, aviso: null });
    for (const estado of ["rechazada", "propuesta", "no_show", "completada", "cancelada"] as const) {
      const g = gestionDeCita({ estado, inicio: futura }, ahora);
      assert.equal(g.puedeCancelar || g.puedeReprogramar, false, estado);
    }
    assert.equal(gestionDeCita({ estado: "confirmada", inicio: "2026-10-06T12:00:00Z" }, ahora).puedeCancelar, false, "empieza justo ahora: ya no");
  });
});

describe("2. Seguridad del enlace", () => {
  const MENSAJE = "Este enlace no es válido o ya venció.";

  it("un enlace manipulado, inexistente, mal formado, revocado o vencido responde IGUAL (sin pistas) en las cuatro operaciones", async () => {
    const { deps, token, mundo } = await armar();
    const cambiado = `${token.slice(0, 10)}${token[10] === "A" ? "B" : "A"}${token.slice(11)}`;
    const malos: unknown[] = [cambiado, generarToken(), token.slice(1), `${token}x`, "", null, 700, hashDeToken(token)];
    for (const t of malos) {
      for (const r of [
        await verMiCita(deps, t),
        await cancelarMiCita(deps, t),
        await horariosParaReprogramar(deps, t, "2026-10-12"),
        await reprogramarMiCita(deps, t, { fecha: "2026-10-12", hora: "10:00", idempotenciaDelCliente: "clave-123456" }),
      ]) {
        assert.ok(!r.ok && r.codigo === "enlace_invalido" && r.status === 404 && r.mensaje === MENSAJE, String(t));
      }
    }
    assert.equal(mundo.citas()[0]!.estado, "confirmada", "ningún intento tocó la cita");
    // Revocado
    await mundo.enlaces.revocar(mundo.enlaces.filas[0]!.id, mundo.ahora().toISOString());
    const rev = await verMiCita(deps, token);
    assert.ok(!rev.ok && rev.mensaje === MENSAJE);
    // Vencido
    const v = await armar();
    v.mundo.avanzarReloj(30 * 86_400_000 + GRACIA_TRAS_LA_CITA_MS);
    const ven = await verMiCita(v.mundo.depsMiCita(), v.token);
    assert.ok(!ven.ok && ven.mensaje === MENSAJE);
  });

  it("el token de UNA cita nunca actúa sobre OTRA: cancelar con el enlace de A solo cancela A; B queda intacta", async () => {
    const a = await armar();
    const inicioB = new Date(`${a.otroDia}T14:00:00-05:00`);
    const b = a.mundo.sembrarCita({ id: 701, inicio: inicioB });
    const enlaceB = (await obtenerOCrearEnlace(a.mundo.enlaces, { idTenant: T, citaId: b.citaId, citaFinISO: new Date(inicioB.getTime() + 7_200_000).toISOString() }, { ahora: a.mundo.ahora, log: sinLog }))!;
    assert.notEqual(enlaceB.token, a.token);
    const r = await cancelarMiCita(a.deps, a.token);
    assert.ok(r.ok);
    assert.equal(a.mundo.citas().find((c) => c.id === 700)!.estado, "cancelada");
    assert.equal(a.mundo.citas().find((c) => c.id === 701)!.estado, "confirmada", "la cita B no se tocó");
    assert.ok(a.mundo.google.eventos.has(b.eventoId!), "su evento de Google tampoco");
  });

  it("el cuerpo de la petición NO puede elegir la cita: un citaId / id / especialistaId enviado se ignora, solo cuenta el token", async () => {
    const a = await armar();
    const inicioB = new Date(`${a.otroDia}T14:00:00-05:00`);
    a.mundo.sembrarCita({ id: 701, inicio: inicioB });
    const entorno = { deps: () => a.deps };
    // Los martes, +4 días cae en sábado y +6 en domingo: ambos saltan al lunes y el nuevo horario chocaba con la cita B (409). Se busca un día distinto al de la cita B.
    let nuevoDia = diaHabil(a.mundo.ahora(), 6);
    for (let minimo = 7; nuevoDia === a.otroDia; minimo++) nuevoDia = diaHabil(a.mundo.ahora(), minimo);
    const r = await atenderReprogramarMiCita(a.token, { fecha: nuevoDia, hora: "15:00", idempotencyKey: "intento-0001", citaId: 701, id: 701, cita_id: 701, especialistaId: 1262, idTenant: "otro" }, entorno);
    assert.equal(r.status, 200, await r.clone().text());
    const citas = a.mundo.citas();
    assert.equal(new Date(citas.find((c) => c.id === 700)!.inicio as string).toISOString(), new Date(`${nuevoDia}T15:00:00-05:00`).toISOString(), "se movió la cita DEL ENLACE");
    assert.equal(new Date(citas.find((c) => c.id === 701)!.inicio as string).toISOString(), inicioB.toISOString(), "la otra no");
    assert.equal(citas.find((c) => c.id === 700)!.especialista_id, 1263, "la profesional no cambia");
  });

  it("un enlace de OTRO negocio no abre nada (aunque apunte a una cita real de AMORE)", async () => {
    const { deps, mundo, citaId } = await armar();
    const tokenAjeno = generarToken();
    mundo.enlaces.filas.push({ id: "enlace-ajeno", idTenant: "11111111-1111-4111-8111-111111111111", citaId, tokenHash: hashDeToken(tokenAjeno), tokenCifrado: "x", createdAt: mundo.ahora().toISOString(), expiraAt: new Date(mundo.ahora().getTime() + 86_400_000).toISOString(), revocadoAt: null });
    for (const r of [await verMiCita(deps, tokenAjeno), await cancelarMiCita(deps, tokenAjeno)]) assert.ok(!r.ok && r.codigo === "enlace_invalido");
    assert.equal(mundo.citas()[0]!.estado, "confirmada");
  });

  it("un enlace de AMORE cuya cita pertenece a OTRO negocio tampoco abre nada (el negocio de la cita debe ser el del enlace)", async () => {
    const { deps, mundo, token } = await armar();
    mundo.citas()[0]!.id_tenant = "22222222-2222-4222-8222-222222222222";
    for (const r of [await verMiCita(deps, token), await cancelarMiCita(deps, token), await horariosParaReprogramar(deps, token, mundo.ahora().toISOString().slice(0, 10))]) assert.ok(!r.ok && r.codigo === "enlace_invalido");
    assert.equal(mundo.citas()[0]!.estado, "confirmada");
  });

  it("registra cuándo se usó el enlace (para auditar) sin cambiar nada de la cita", async () => {
    const { deps, mundo, token } = await armar();
    await verMiCita(deps, token);
    assert.equal(mundo.enlaces.usos.length, 1);
    assert.equal(mundo.citas()[0]!.estado, "confirmada");
  });
});

describe("3. Cancelar", () => {
  it("cancela la cita, borra el evento de Google Calendar y su mapeo, libera el horario y avisa por WhatsApp", async () => {
    const { deps, mundo, token, eventoId, inicio } = await armar();
    const r = await cancelarMiCita(deps, token);
    assert.ok(r.ok && r.data.yaCancelada === false);
    assert.equal(mundo.citas()[0]!.estado, "cancelada");
    assert.equal(mundo.google.eventos.has(eventoId!), false, "el evento ya no está en el calendario");
    assert.equal(mundo.google.llamadas.borrar, 1);
    assert.equal((mundo.tablas.dulabs_agenda_v2_citas_nylas ?? []).length, 0, "el mapeo cita→evento se quitó");
    assert.equal(mundo.enviados.length, 1);
    assert.equal(mundo.enviados[0]!.telefono, TELEFONO_CLIENTA);
    assert.equal(mundo.enviados[0]!.mensaje, mensajeCitaCancelada());
    assert.match(mundo.enviados[0]!.mensaje, /Tu cita fue cancelada correctamente/);
    assert.ok(mundo.enviados[0]!.mensaje.includes("https://www.dulabs.co/reservar/amore"), "ofrece reservar otra");
    // El horario quedó libre: otra clienta lo puede reservar de verdad.
    const otra = await reservarPorPortalAmore(
      { supabase: mundo.supabase, store: mundo.enlaces, nylas: deps.nylas, ahora: mundo.ahora, enviarConfirmacion: async () => ({ enviado: true }) },
      { servicioId: "s-dipping", especialistaId: 1263, inicio, nombreCliente: "Beto", telefonoCliente: "3001234567", idempotencyKey: "otra-clienta" },
    );
    assert.ok(otra.ok, JSON.stringify(otra));
  });

  it("es idempotente: cancelar dos veces no repite el borrado ni el aviso", async () => {
    const { deps, mundo, token } = await armar();
    assert.ok((await cancelarMiCita(deps, token)).ok);
    const segunda = await cancelarMiCita(deps, token);
    assert.ok(segunda.ok && segunda.data.yaCancelada === true);
    assert.equal(mundo.google.llamadas.borrar, 1);
    assert.equal(mundo.enviados.length, 1);
  });

  it("una cita que ya pasó no se puede cancelar; una pendiente de aprobación sí", async () => {
    const pasada = await armar();
    pasada.mundo.avanzarReloj(5 * 86_400_000);
    const r = await cancelarMiCita(pasada.mundo.depsMiCita(), pasada.token);
    assert.ok(!r.ok && r.codigo === "cita_no_gestionable");
    assert.equal(pasada.mundo.citas()[0]!.estado, "confirmada");
    const pend = await armar({}, { estado: "pendiente" });
    assert.ok((await cancelarMiCita(pend.deps, pend.token)).ok);
    assert.equal(pend.mundo.citas()[0]!.estado, "cancelada");
  });

  it("si Google no deja borrar el evento, la cita igual queda cancelada y el mapeo se CONSERVA para reintentar (nunca un falso fallo ni una excepción)", async () => {
    const { deps, mundo, token } = await armar();
    mundo.google.falla.borrar = true;
    const r = await cancelarMiCita(deps, token);
    assert.ok(r.ok);
    assert.equal(mundo.citas()[0]!.estado, "cancelada");
    assert.equal((mundo.tablas.dulabs_agenda_v2_citas_nylas ?? []).length, 1);
  });

  it("sin integración de calendario en el entorno: cancela igual (sin tocar el evento) y no lanza", async () => {
    const { deps, mundo, token } = await armar();
    const r = await cancelarMiCita({ ...deps, nylas: null }, token);
    assert.ok(r.ok);
    assert.equal(mundo.citas()[0]!.estado, "cancelada");
    assert.equal(mundo.google.llamadas.borrar, 0);
  });

  it("si el aviso por WhatsApp falla, la cancelación NO se deshace", async () => {
    const { deps, mundo, token } = await armar();
    const r = await cancelarMiCita({ ...deps, enviarMensaje: async () => Promise.reject(new Error("worker caído")) }, token);
    assert.ok(r.ok);
    assert.equal(mundo.citas()[0]!.estado, "cancelada");
  });
});

describe("4. Horarios para cambiar la cita", () => {
  it("son los horarios REALES de la MISMA profesional con la duración de la cita (jornada, citas y Google Calendar)", async () => {
    const { deps, mundo, token, otroDia } = await armar();
    // Cristal ya tiene un evento 13:00–15:00 ese día; Mary también uno (no debe afectar a Cristal).
    mundo.google.eventos.set("e1", { id: "e1", calendarId: "cal-cristal", startUnix: unix(new Date(`${otroDia}T13:00:00-05:00`)), endUnix: unix(new Date(`${otroDia}T15:00:00-05:00`)), title: "X" });
    mundo.google.eventos.set("e2", { id: "e2", calendarId: "cal-mary", startUnix: unix(new Date(`${otroDia}T09:00:00-05:00`)), endUnix: unix(new Date(`${otroDia}T12:00:00-05:00`)), title: "Y" });
    const r = await horariosParaReprogramar(deps, token, otroDia);
    assert.ok(r.ok);
    assert.equal(r.data.fecha, otroDia);
    const h = r.data.horarios;
    assert.ok(h.includes("09:00") && h.includes("11:00"), "libre antes del evento (el servicio dura 2 h: 9–11 y 11–13 caben)");
    assert.ok(!h.includes("11:30") && !h.includes("12:00") && !h.includes("13:00") && !h.includes("14:30"), "se solapan con el evento de Cristal");
    assert.ok(h.includes("15:00") && h.includes("17:00"), "libre después del evento hasta el cierre (la última cabe de 17 a 19)");
    assert.ok(!h.includes("17:30") && !h.includes("18:00"), "ya no cabe el servicio completo antes del cierre");
    assert.equal(mundo.google.llamadas.listar >= 1, true);
  });

  it("si Nylas falla NO dice «no hay horarios»: dice que no pudo confirmar (503); sin integración, igual", async () => {
    const { deps, mundo, token, otroDia } = await armar();
    mundo.google.falla.listar = true;
    const a = await horariosParaReprogramar(deps, token, otroDia);
    assert.ok(!a.ok && a.codigo === "calendario_no_disponible" && a.status === 503);
    const b = await horariosParaReprogramar({ ...deps, nylas: null }, token, otroDia);
    assert.ok(!b.ok && b.codigo === "calendario_no_disponible");
  });

  it("rechaza fechas mal formadas, pasadas o a más de 30 días; y una cita pendiente o pasada no ofrece horarios", async () => {
    const { deps, mundo, token } = await armar();
    const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(mundo.ahora());
    const lejos = new Date(`${hoy}T12:00:00Z`);
    lejos.setUTCDate(lejos.getUTCDate() + 31);
    const ayer = new Date(`${hoy}T12:00:00Z`);
    ayer.setUTCDate(ayer.getUTCDate() - 1);
    for (const fecha of ["", "2026-13-45x", "mañana", undefined, null, 20261012, lejos.toISOString().slice(0, 10), ayer.toISOString().slice(0, 10)]) {
      const r = await horariosParaReprogramar(deps, token, fecha);
      assert.ok(!r.ok && r.codigo === "solicitud_invalida" && r.status === 400, String(fecha));
    }
    const pend = await armar({}, { estado: "pendiente" });
    const rp = await horariosParaReprogramar(pend.deps, pend.token, pend.otroDia);
    assert.ok(!rp.ok && rp.codigo === "cita_no_gestionable");
  });
});

describe("5. Reprogramar", () => {
  const ENTRADA = (fecha: string, hora: string, clave = "intento-0001") => ({ fecha, hora, idempotenciaDelCliente: clave });

  it("mueve la MISMA cita (mismo id y profesional) al nuevo horario: crea el evento nuevo, borra el viejo, actualiza el mapeo, extiende el enlace y avisa con el nuevo horario + el enlace", async () => {
    const { deps, mundo, token, eventoId, otroDia } = await armar();
    const antes = { ...mundo.citas()[0]! };
    const r = await reprogramarMiCita(deps, token, ENTRADA(otroDia, "15:00"));
    assert.ok(r.ok, JSON.stringify(r));
    const citas = mundo.citas();
    assert.equal(citas.length, 1, "nunca una cita nueva ni «cancelar y crear»");
    assert.equal(citas[0]!.id, antes.id);
    assert.equal(citas[0]!.especialista_id, antes.especialista_id);
    assert.equal(citas[0]!.estado, "confirmada");
    assert.equal(new Date(citas[0]!.inicio as string).toISOString(), new Date(`${otroDia}T15:00:00-05:00`).toISOString());
    assert.equal(new Date(citas[0]!.fin as string).getTime() - new Date(citas[0]!.inicio as string).getTime(), 7_200_000);
    // Google Calendar: el evento viejo se borró, hay UNO nuevo en el nuevo horario.
    assert.equal(mundo.google.eventos.has(eventoId!), false);
    assert.equal(mundo.google.eventos.size, 1);
    const nuevo = [...mundo.google.eventos.values()][0]!;
    assert.equal(nuevo.calendarId, "cal-cristal");
    assert.equal(nuevo.startUnix, unix(new Date(`${otroDia}T15:00:00-05:00`)));
    assert.equal((mundo.tablas.dulabs_agenda_v2_citas_nylas ?? []).map((m) => m.nylas_event_id).join(), nuevo.id);
    // El enlace sigue siendo el mismo y su vencimiento se movió con la cita.
    assert.equal(mundo.enlaces.filas.length, 1);
    assert.equal(Date.parse(mundo.enlaces.filas[0]!.expiraAt) >= Date.parse(`${otroDia}T17:00:00-05:00`) + GRACIA_TRAS_LA_CITA_MS - 1000, true);
    // Aviso por WhatsApp: nueva fecha/hora y el enlace.
    assert.equal(mundo.enviados.length, 1);
    assert.match(mundo.enviados[0]!.mensaje, /Tu cita fue reprogramada/);
    assert.match(mundo.enviados[0]!.mensaje, /Profesional: Cristal/);
    assert.match(mundo.enviados[0]!.mensaje, /3:00 p\. m\./);
    assert.match(mundo.enviados[0]!.mensaje, /https:\/\/www\.dulabs\.co\/mi-cita\/[A-Za-z0-9_-]{43}/);
    // Y la vista del enlace ya muestra el nuevo horario.
    const v = await verMiCita(deps, token);
    assert.ok(v.ok && v.data.inicio === new Date(`${otroDia}T15:00:00-05:00`).toISOString());
  });

  it("el MISMO envío repetido (red caída tras confirmar) responde igual SIN repetir cambios, eventos ni avisos", async () => {
    const { deps, mundo, token, otroDia } = await armar();
    const a = await reprogramarMiCita(deps, token, ENTRADA(otroDia, "15:00", "mismo-intento-1"));
    const b = await reprogramarMiCita(deps, token, ENTRADA(otroDia, "15:00", "mismo-intento-1"));
    assert.ok(a.ok && b.ok);
    assert.equal(b.ok && b.data.inicio, a.ok && a.data.inicio);
    assert.equal(mundo.google.llamadas.crear, 1);
    assert.equal(mundo.google.eventos.size, 1);
    assert.equal(mundo.enviados.length, 1, "un solo aviso");
    // Pedir «el mismo horario» con una clave NUEVA es otra cosa: se rechaza con un mensaje claro.
    const c = await reprogramarMiCita(deps, token, ENTRADA(otroDia, "15:00", "intento-distinto"));
    assert.ok(!c.ok && c.codigo === "horario_invalido" && /Esa ya es la fecha y hora de tu cita/.test(c.mensaje));
  });

  it("horario ocupado en Google Calendar: se rechaza (409), la cita y su evento quedan INTACTOS y no se crea nada", async () => {
    const { deps, mundo, token, otroDia, inicio, eventoId } = await armar();
    mundo.google.eventos.set("tomado", { id: "tomado", calendarId: "cal-cristal", startUnix: unix(new Date(`${otroDia}T15:00:00-05:00`)), endUnix: unix(new Date(`${otroDia}T16:00:00-05:00`)), title: "Otro" });
    const r = await reprogramarMiCita(deps, token, ENTRADA(otroDia, "15:00"));
    assert.ok(!r.ok && r.codigo === "horario_ocupado" && r.status === 409);
    assert.equal(new Date(mundo.citas()[0]!.inicio as string).toISOString(), inicio.toISOString());
    assert.ok(mundo.google.eventos.has(eventoId!));
    assert.equal(mundo.google.llamadas.crear, 0);
    assert.equal(mundo.enviados.length, 0);
  });

  it("horario ocupado por otra cita de DuLabs: lo mismo; fuera de la jornada: horario_invalido", async () => {
    const { deps, mundo, token, otroDia } = await armar();
    mundo.sembrarCita({ id: 701, inicio: new Date(`${otroDia}T15:00:00-05:00`), conEvento: false });
    const a = await reprogramarMiCita(deps, token, ENTRADA(otroDia, "16:00"));
    assert.ok(!a.ok && a.codigo === "horario_ocupado");
    const b = await reprogramarMiCita(deps, token, ENTRADA(otroDia, "21:00", "intento-0002"));
    assert.ok(!b.ok && b.codigo === "horario_invalido");
    assert.equal(mundo.google.llamadas.crear, 0);
  });

  it("mover la cita a un horario que se solapa con su propio horario actual se rechaza de forma SEGURA (limitación conocida y documentada): nunca queda a medias", async () => {
    const { deps, mundo, token, dia, inicio, eventoId } = await armar();
    const r = await reprogramarMiCita(deps, token, ENTRADA(dia, "10:30"));
    assert.ok(!r.ok && r.codigo === "horario_ocupado");
    assert.equal(new Date(mundo.citas()[0]!.inicio as string).toISOString(), inicio.toISOString());
    assert.ok(mundo.google.eventos.has(eventoId!));
  });

  it("si Nylas falla (al revalidar o al crear el evento): 503 y la cita queda INTACTA; sin integración, igual", async () => {
    const a = await armar();
    a.mundo.google.falla.listar = true;
    const r1 = await reprogramarMiCita(a.deps, a.token, ENTRADA(a.otroDia, "15:00"));
    assert.ok(!r1.ok && r1.codigo === "calendario_no_disponible");
    const b = await armar();
    b.mundo.google.falla.crear = true;
    const r2 = await reprogramarMiCita(b.deps, b.token, ENTRADA(b.otroDia, "15:00"));
    assert.ok(!r2.ok && r2.codigo === "calendario_no_disponible");
    for (const x of [a, b]) {
      assert.equal(new Date(x.mundo.citas()[0]!.inicio as string).toISOString(), x.inicio.toISOString());
      assert.ok(x.mundo.google.eventos.has(x.eventoId!));
    }
    const c = await armar();
    const r3 = await reprogramarMiCita({ ...c.deps, nylas: null }, c.token, ENTRADA(c.otroDia, "15:00"));
    assert.ok(!r3.ok && r3.codigo === "calendario_no_disponible");
  });

  it("entradas inválidas: fecha/hora mal formadas, pasado, más de 30 días, el mismo horario, clave de intento ausente o corta", async () => {
    const { deps, mundo, token, dia, otroDia } = await armar();
    const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(mundo.ahora());
    const lejos = new Date(`${hoy}T12:00:00Z`);
    lejos.setUTCDate(lejos.getUTCDate() + 31);
    const casos: Array<[unknown, unknown, unknown, string]> = [
      ["mañana", "10:00", "intento-0001", "solicitud_invalida"],
      [otroDia, "25:00", "intento-0001", "solicitud_invalida"],
      [otroDia, "10:0", "intento-0001", "solicitud_invalida"],
      [otroDia, "15:00", "", "solicitud_invalida"],
      [otroDia, "15:00", "corta", "solicitud_invalida"],
      [otroDia, "15:00", undefined, "solicitud_invalida"],
      [hoy, "00:30", "intento-0001", "horario_invalido"],
      [lejos.toISOString().slice(0, 10), "10:00", "intento-0001", "solicitud_invalida"],
      [dia, "10:00", "intento-nuevo", "horario_invalido"],
    ];
    for (const [fecha, hora, clave, codigo] of casos) {
      const r = await reprogramarMiCita(deps, token, { fecha, hora, idempotenciaDelCliente: clave });
      assert.ok(!r.ok && r.codigo === codigo, `${String(fecha)} ${String(hora)} -> ${r.ok ? "ok" : r.codigo}`);
    }
    assert.equal(mundo.google.llamadas.crear, 0, "ninguno llegó a tocar Google Calendar");
  });

  it("una cita pendiente de aprobación, cancelada o ya pasada NO se reprograma", async () => {
    for (const cfg of [{ estado: "pendiente" }, { estado: "cancelada" }]) {
      const x = await armar({}, cfg);
      const r = await reprogramarMiCita(x.deps, x.token, ENTRADA(x.otroDia, "15:00"));
      assert.ok(!r.ok && r.codigo === "cita_no_gestionable", cfg.estado);
    }
    const pasada = await armar();
    pasada.mundo.avanzarReloj(5 * 86_400_000);
    const r = await reprogramarMiCita(pasada.mundo.depsMiCita(), pasada.token, ENTRADA(pasada.otroDia, "15:00"));
    assert.ok(!r.ok && r.codigo === "cita_no_gestionable");
  });

  it("de punta a punta: reservar por el portal → abrir el enlace → reprogramar → cancelar; el calendario y la agenda quedan coherentes en cada paso", async () => {
    const mundo = crearMundoAmore();
    const dia = diaHabil(mundo.ahora(), 4);
    const otro = diaHabil(mundo.ahora(), 6);
    const nylas = { read: mundo.google.read, write: mundo.google.write, grantId: mundo.google.grantId };
    const reserva = await reservarPorPortalAmore(
      { supabase: mundo.supabase, store: mundo.enlaces, nylas, ahora: mundo.ahora, enviarConfirmacion: async () => ({ enviado: true }) },
      { servicioId: "s-dipping", especialistaId: 1263, inicio: new Date(`${dia}T09:00:00-05:00`), nombreCliente: "Ana Pérez", telefonoCliente: "314 812 7388", idempotencyKey: "reserva-e2e" },
    );
    assert.ok(reserva.ok);
    const token = reserva.data.enlaceGestion!.split("/").pop()!;
    const deps = mundo.depsMiCita();
    // Abrir el enlace: la cita correcta.
    const vista = await verMiCita(deps, token);
    assert.ok(vista.ok && vista.data.servicio === "Dipping" && vista.data.profesional === "Cristal" && vista.data.inicio === new Date(`${dia}T09:00:00-05:00`).toISOString());
    // Reprogramar: cambio real en agenda y calendario.
    const moved = await reprogramarMiCita(deps, token, ENTRADA(otro, "14:00", "e2e-intento-1"));
    assert.ok(moved.ok, JSON.stringify(moved));
    assert.equal(mundo.citas().length, 1);
    assert.equal(new Date(mundo.citas()[0]!.inicio as string).toISOString(), new Date(`${otro}T14:00:00-05:00`).toISOString());
    assert.equal(mundo.google.eventos.size, 1);
    assert.equal([...mundo.google.eventos.values()][0]!.startUnix, unix(new Date(`${otro}T14:00:00-05:00`)));
    // El horario viejo quedó libre en la agenda REAL.
    const libre = await horariosParaReprogramar(deps, token, dia);
    assert.ok(libre.ok && libre.data.horarios.includes("09:00"));
    // Cancelar: la agenda y el calendario quedan sin la cita.
    assert.ok((await cancelarMiCita(deps, token)).ok);
    assert.equal(mundo.citas()[0]!.estado, "cancelada");
    assert.equal(mundo.google.eventos.size, 0);
    const despues = await verMiCita(deps, token);
    assert.ok(despues.ok && despues.data.estado === "cancelada" && !despues.data.puedeCancelar && !despues.data.puedeReprogramar);
  });
});

describe("6. Las rutas HTTP", () => {
  const cabecerasSeguras = (r: Response) => {
    assert.equal(r.headers.get("cache-control"), "no-store, max-age=0");
    assert.equal(r.headers.get("referrer-policy"), "no-referrer");
    assert.equal(r.headers.get("x-robots-tag"), "noindex, nofollow");
  };

  it("un token mal formado se rechaza (404) SIN crear dependencias ni tocar la base; con las cabeceras seguras", async () => {
    let creadas = 0;
    const entorno = { deps: (): DepsMiCita => (creadas++, null as never) };
    for (const t of ["", "corto", `${"a".repeat(43)}!`, null, undefined, 123]) {
      for (const r of [await atenderVerMiCita(t, entorno), await atenderCancelarMiCita(t, entorno), await atenderHorariosMiCita(t, "2026-10-12", entorno), await atenderReprogramarMiCita(t, {}, entorno)]) {
        assert.equal(r.status, 404);
        cabecerasSeguras(r);
        assert.deepEqual(await r.json(), { success: false, error: "Este enlace no es válido o ya venció.", codigo: "enlace_invalido" });
      }
    }
    assert.equal(creadas, 0);
  });

  it("ver: 200 con { success, data } y sin ids; cancelar y reprogramar: la misma forma; todas con cabeceras seguras", async () => {
    const { deps, token, otroDia } = await armar();
    const entorno = { deps: () => deps };
    const ver = await atenderVerMiCita(token, entorno);
    assert.equal(ver.status, 200);
    cabecerasSeguras(ver);
    const cuerpo = await ver.json();
    assert.equal(cuerpo.success, true);
    assert.equal(cuerpo.data.servicio, "Dipping");
    assert.ok(!JSON.stringify(cuerpo).includes("700") && !JSON.stringify(cuerpo).includes(T));
    const horarios = await atenderHorariosMiCita(token, otroDia, entorno);
    assert.equal(horarios.status, 200);
    cabecerasSeguras(horarios);
    const mover = await atenderReprogramarMiCita(token, { fecha: otroDia, hora: "15:00", idempotencyKey: "http-0001" }, entorno);
    assert.equal(mover.status, 200);
    cabecerasSeguras(mover);
    const cancelar = await atenderCancelarMiCita(token, entorno);
    assert.equal(cancelar.status, 200);
    cabecerasSeguras(cancelar);
  });

  it("los errores de dominio viajan con su código HTTP (409 ocupado, 503 sin calendario, 400 inválida); un cuerpo basura da 400", async () => {
    const { deps, mundo, token, otroDia } = await armar();
    const entorno = { deps: () => deps };
    mundo.google.eventos.set("tomado", { id: "tomado", calendarId: "cal-cristal", startUnix: unix(new Date(`${otroDia}T15:00:00-05:00`)), endUnix: unix(new Date(`${otroDia}T16:00:00-05:00`)), title: "Otro" });
    const ocupado = await atenderReprogramarMiCita(token, { fecha: otroDia, hora: "15:00", idempotencyKey: "http-0002" }, entorno);
    assert.equal(ocupado.status, 409);
    assert.equal((await ocupado.json()).codigo, "horario_ocupado");
    const basura = await atenderReprogramarMiCita(token, "esto no es un objeto", entorno);
    assert.equal(basura.status, 400);
    const vacio = await atenderReprogramarMiCita(token, null, entorno);
    assert.equal(vacio.status, 400);
    const sinNylas = await atenderHorariosMiCita(token, otroDia, { deps: () => ({ ...deps, nylas: null }) });
    assert.equal(sinNylas.status, 503);
    cabecerasSeguras(sinNylas);
  });

  it("el límite de tasa corta ANTES de hacer nada (429 con su respuesta); un fallo inesperado responde 500 genérico sin filtrar detalles", async () => {
    const { deps, mundo, token } = await armar();
    const limitada = await atenderCancelarMiCita(token, { deps: () => deps, limite: async () => Response.json({ error: "Demasiadas solicitudes" }, { status: 429 }) });
    assert.equal(limitada.status, 429);
    assert.equal(mundo.citas()[0]!.estado, "confirmada", "no se canceló nada");
    const silenciar = console.error;
    console.error = sinLog;
    try {
      const roto = await atenderVerMiCita(token, {
        deps: () => {
          throw new Error("SECRETO: la conexión a la base falló en 10.0.0.5");
        },
      });
      assert.equal(roto.status, 500);
      cabecerasSeguras(roto);
      const txt = await roto.text();
      assert.ok(!txt.includes("SECRETO") && !txt.includes("10.0.0.5"));
    } finally {
      console.error = silenciar;
    }
  });
});

describe("7. Borrar el evento de Google de una cita (lo que usa el panel al cancelar o rechazar; el cableado de las rutas se prueba en panel.test.ts)", () => {
  it("borrarEventoDeCita (lo que usa el panel) borra el evento y su mapeo; repetirlo no falla ni repite el borrado", async () => {
    const { deps, mundo, citaId, eventoId } = await armar();
    const cita = mundo.citas()[0]!;
    const datos = { id: citaId, id_tenant: T, especialista_id: cita.especialista_id as number };
    await borrarEventoDeCita(deps, datos);
    assert.equal(mundo.google.eventos.has(eventoId!), false);
    assert.equal(mundo.google.llamadas.borrar, 1);
    assert.equal((mundo.tablas.dulabs_agenda_v2_citas_nylas ?? []).length, 0);
    await borrarEventoDeCita(deps, datos);
    assert.equal(mundo.google.llamadas.borrar, 1, "sin mapeo no hay nada que borrar");
  });

  it("si Google falla o no hay integración, no lanza y conserva el mapeo para reintentar", async () => {
    const a = await armar();
    a.mundo.google.falla.borrar = true;
    await borrarEventoDeCita(a.deps, { id: a.citaId, id_tenant: T, especialista_id: a.mundo.citas()[0]!.especialista_id as number });
    assert.equal((a.mundo.tablas.dulabs_agenda_v2_citas_nylas ?? []).length, 1);
    const b = await armar();
    await borrarEventoDeCita({ ...b.deps, nylas: null }, { id: b.citaId, id_tenant: T, especialista_id: b.mundo.citas()[0]!.especialista_id as number });
    assert.equal(b.mundo.google.llamadas.borrar, 0);
    assert.equal((b.mundo.tablas.dulabs_agenda_v2_citas_nylas ?? []).length, 1);
  });
});
