/**
 * AMORE — el PANEL de la profesional y Google Calendar. Editar, proponer otro horario, rechazar, cancelar, confirmar y crear a mano dejan el calendario igual que
 * la agenda; si Google no responde NO se cambia nada; si la base rechaza el cambio el evento nuevo se deshace. Sobre el código REAL, con una base en memoria con
 * las reglas de Postgres que importan (EXCLUDE de solapes) y un Google Calendar falso con estado.
 */
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  cancelarCitaDelPanelAmore,
  confirmarCitaDelPanelAmore,
  crearCitaDelPanelAmore,
  editarCitaDelPanelAmore,
  reagendarCitaDelPanelAmore,
  rechazarCitaDelPanelAmore,
  type DepsPanelAmore,
} from "@/lib/mi-cita/panel";
import { GRACIA_TRAS_LA_CITA_MS, obtenerOCrearEnlace } from "@/lib/mi-cita/enlaces";
import { T, TELEFONO_CLIENTA, crearMundoAmore, diaLaborable, type OpcionesMundo } from "@/lib/mi-cita/testing/mundo-amore";

const sinLog = () => {};
const unix = (d: Date) => Math.floor(d.getTime() / 1000);

/** Un día de lunes a viernes (jornada completa), dentro de N días. */
function diaHabil(desde: Date, minimo: number): string {
  let dia = diaLaborable(desde, minimo);
  while (new Date(`${dia}T12:00:00-05:00`).getDay() === 6) dia = diaLaborable(new Date(new Date(`${dia}T12:00:00-05:00`).getTime() + 86_400_000), 1);
  return dia;
}

function armar(opciones: OpcionesMundo = {}, cita: { estado?: string; diasAdelante?: number; hora?: string; especialistaId?: number; conEvento?: boolean; telefono?: string | null; conEnlace?: boolean } = {}) {
  const mundo = crearMundoAmore(opciones);
  const dia = diaHabil(mundo.ahora(), cita.diasAdelante ?? 3);
  const inicio = new Date(`${dia}T${cita.hora ?? "10:00"}:00-05:00`);
  const { citaId, eventoId } = mundo.sembrarCita({ id: 700, inicio, estado: cita.estado, especialistaId: cita.especialistaId, conEvento: cita.conEvento, telefono: cita.telefono });
  const avisosProfesional: { numero: string | null | undefined; cita: { nombreProfesional: string; servicio: string; telefonoCliente: string | null } }[] = [];
  const deps: DepsPanelAmore = {
    ...mundo.depsMiCita(),
    enviarConfirmacion: async (_supabase, _tenant, telefono, c) => {
      mundo.confirmaciones.push({ telefono, cita: c });
      return { enviado: true };
    },
    notificarProfesional: async (_tenant, numero, c) => {
      avisosProfesional.push({ numero, cita: c });
      return { enviado: true };
    },
  };
  return { mundo, deps, citaId, eventoId, inicio, dia, avisosProfesional, hora: (h: string, d = dia) => new Date(`${d}T${h}:00-05:00`) };
}

async function conEnlace(m: ReturnType<typeof armar>) {
  const fin = new Date(m.inicio.getTime() + 7_200_000).toISOString();
  return (await obtenerOCrearEnlace(m.mundo.enlaces, { idTenant: T, citaId: m.citaId, citaFinISO: fin }, { ahora: m.mundo.ahora, log: sinLog }))!;
}

const eventos = (m: ReturnType<typeof armar>) => [...m.mundo.google.eventos.values()];
const mapeo = (m: ReturnType<typeof armar>) => (m.mundo.tablas.dulabs_agenda_v2_citas_nylas ?? []) as { cita_id: number; nylas_event_id: string }[];

describe("1. Editar una cita CONFIRMADA desde el panel mueve su evento de Google", () => {
  it("otra hora (misma profesional): el evento nuevo queda a la hora nueva en SU calendario, el viejo se borra y el mapeo apunta al nuevo", async () => {
    const m = armar();
    const nuevo = m.hora("14:00");
    const r = await editarCitaDelPanelAmore(m.deps, m.citaId, { nuevoInicio: nuevo });
    assert.ok(r.ok, JSON.stringify(r));
    const cita = m.mundo.citas()[0]!;
    assert.equal(new Date(cita.inicio as string).getTime(), nuevo.getTime());
    assert.equal(m.mundo.google.eventos.has(m.eventoId!), false, "el evento viejo ya no está");
    const [evento] = eventos(m);
    assert.equal(eventos(m).length, 1);
    assert.equal(evento!.calendarId, "cal-cristal");
    assert.equal(evento!.startUnix, unix(nuevo));
    assert.equal(evento!.endUnix, unix(nuevo) + 7200, "dura lo mismo que la cita");
    assert.deepEqual(mapeo(m).map((x) => [x.cita_id, x.nylas_event_id]), [[m.citaId, evento!.id]]);
    assert.match(evento!.title, /AMORE — Dipping \(Ana\)/);
  });

  it("otra profesional: el evento pasa al calendario de la nueva y se borra del de la anterior", async () => {
    const m = armar(); // Cristal (cal-cristal)
    const r = await editarCitaDelPanelAmore(m.deps, m.citaId, { especialistaId: 1262 });
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(m.mundo.citas()[0]!.especialista_id, 1262);
    assert.equal(eventos(m).length, 1);
    assert.equal(eventos(m)[0]!.calendarId, "cal-mary");
    assert.equal(m.mundo.google.eventos.has(m.eventoId!), false);
    assert.equal(mapeo(m)[0]!.nylas_event_id, eventos(m)[0]!.id);
  });

  it("otra duración: el evento dura lo nuevo", async () => {
    const m = armar();
    const r = await editarCitaDelPanelAmore(m.deps, m.citaId, { duracionMin: 180 });
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(eventos(m)[0]!.endUnix - eventos(m)[0]!.startUnix, 180 * 60);
  });

  it("si Google no puede crear el evento: NO se cambia nada (ni la cita, ni el evento viejo, ni el mapeo) y se explica", async () => {
    const m = armar();
    m.mundo.google.falla.crear = true;
    const antes = JSON.stringify(m.mundo.citas());
    const r = await editarCitaDelPanelAmore(m.deps, m.citaId, { nuevoInicio: m.hora("14:00") });
    assert.ok(!r.ok && r.motivo === "calendario_no_disponible");
    assert.match((r as { detalle: string }).detalle, /no se cambió nada/);
    assert.equal(JSON.stringify(m.mundo.citas()), antes);
    assert.equal(m.mundo.google.eventos.has(m.eventoId!), true);
    assert.equal(mapeo(m)[0]!.nylas_event_id, m.eventoId);
    assert.equal(m.mundo.google.llamadas.borrar, 0);
  });

  it("si la base rechaza el cambio (choque con otra cita de DuLabs): el evento nuevo se DESHACE y la cita y su evento quedan intactos", async () => {
    const m = armar();
    m.mundo.sembrarCita({ id: 701, inicio: m.hora("14:00"), conEvento: false });
    const antes = JSON.stringify(m.mundo.citas().filter((c) => c.id === 700));
    const r = await editarCitaDelPanelAmore(m.deps, m.citaId, { nuevoInicio: m.hora("14:30") });
    assert.ok(!r.ok && r.motivo === "ocupado");
    assert.equal(JSON.stringify(m.mundo.citas().filter((c) => c.id === 700)), antes);
    assert.deepEqual(eventos(m).map((e) => e.id), [m.eventoId], "solo queda el evento original: el nuevo se borró");
    assert.equal(mapeo(m)[0]!.nylas_event_id, m.eventoId);
  });

  it("sin integración de Google en el entorno: falla cerrado, no se cambia nada", async () => {
    const m = armar();
    const antes = JSON.stringify(m.mundo.citas());
    const r = await editarCitaDelPanelAmore({ ...m.deps, nylas: null }, m.citaId, { nuevoInicio: m.hora("14:00") });
    assert.ok(!r.ok && r.motivo === "calendario_no_disponible");
    assert.equal(JSON.stringify(m.mundo.citas()), antes);
    assert.equal(m.mundo.google.llamadas.crear, 0);
  });

  it("si lo que se edita no afecta al calendario (mismo horario y profesional): no se toca Google", async () => {
    const m = armar();
    const r = await editarCitaDelPanelAmore(m.deps, m.citaId, { nuevoInicio: m.inicio });
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(m.mundo.google.llamadas.crear, 0);
    assert.equal(m.mundo.google.llamadas.borrar, 0);
    assert.equal(mapeo(m)[0]!.nylas_event_id, m.eventoId);
  });

  it("una cita que NUNCA tuvo evento (la creó el portal antiguo): al editarla se crea el evento correcto, sin nada que borrar", async () => {
    const m = armar({}, { conEvento: false });
    const r = await editarCitaDelPanelAmore(m.deps, m.citaId, { nuevoInicio: m.hora("14:00") });
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(eventos(m).length, 1);
    assert.equal(eventos(m)[0]!.startUnix, unix(m.hora("14:00")));
    assert.equal(mapeo(m).length, 1);
    assert.equal(m.mundo.google.llamadas.borrar, 0);
  });

  it("si Google no deja borrar el evento viejo: la cita igual queda movida y el mapeo apunta al evento NUEVO (nunca un falso fallo)", async () => {
    const m = armar();
    m.mundo.google.falla.borrar = true;
    const r = await editarCitaDelPanelAmore(m.deps, m.citaId, { nuevoInicio: m.hora("14:00") });
    assert.ok(r.ok, JSON.stringify(r));
    const nuevo = eventos(m).find((e) => e.id !== m.eventoId)!;
    assert.equal(mapeo(m)[0]!.nylas_event_id, nuevo.id);
  });

  it("solo una cita CONFIRMADA se edita: una pendiente responde «no encontrada» sin tocar Google", async () => {
    const m = armar({}, { estado: "pendiente" });
    const r = await editarCitaDelPanelAmore(m.deps, m.citaId, { nuevoInicio: m.hora("14:00") });
    assert.ok(!r.ok && r.motivo === "no_encontrada");
    assert.equal(m.mundo.google.llamadas.crear, 0);
  });

  it("pasar a una profesional SIN calendario de Google se rechaza sin cambiar nada", async () => {
    const m = armar();
    (m.mundo.tablas.dulabs_especialistas as Record<string, unknown>[]).find((e) => e.id === 1262)!.nylas_calendar_id = null;
    const antes = JSON.stringify(m.mundo.citas());
    const r = await editarCitaDelPanelAmore(m.deps, m.citaId, { especialistaId: 1262 });
    assert.ok(!r.ok && r.motivo === "calendario_no_disponible");
    assert.equal(JSON.stringify(m.mundo.citas()), antes);
  });

  it("el enlace «Mi cita» sigue vigente hasta después de la NUEVA fecha cuando la cita se mueve lejos", async () => {
    const m = armar();
    await conEnlace(m);
    const hash = m.mundo.enlaces.filas[0]!.tokenHash;
    const lejos = m.hora("10:00", diaHabil(m.mundo.ahora(), 60));
    const r = await editarCitaDelPanelAmore(m.deps, m.citaId, { nuevoInicio: lejos });
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(m.mundo.enlaces.filas.length, 1, "es el MISMO enlace (no se emite otro)");
    const fila = m.mundo.enlaces.filas[0]!;
    assert.equal(fila.tokenHash, hash);
    assert.ok(Date.parse(fila.expiraAt) >= lejos.getTime() + 7_200_000 + GRACIA_TRAS_LA_CITA_MS - 1000, "vence 14 días después del fin de la cita NUEVA");
  });
});

describe("2. Proponer otro horario a una solicitud PENDIENTE", () => {
  it("el horario propuesto queda retenido y el evento de Google lo acompaña", async () => {
    const m = armar({}, { estado: "pendiente" });
    const nuevo = m.hora("15:00");
    const r = await reagendarCitaDelPanelAmore(m.deps, m.citaId, nuevo, 120);
    assert.ok(r.ok, JSON.stringify(r));
    const cita = m.mundo.citas()[0]!;
    assert.equal(cita.estado, "propuesta");
    assert.equal(new Date(cita.inicio as string).getTime(), nuevo.getTime());
    assert.equal(eventos(m).length, 1);
    assert.equal(eventos(m)[0]!.startUnix, unix(nuevo));
    assert.equal(m.mundo.google.eventos.has(m.eventoId!), false);
  });

  it("si Google no responde no se propone nada; una cita que no está pendiente responde «no encontrada» sin tocar Google", async () => {
    const a = armar({}, { estado: "pendiente" });
    a.mundo.google.falla.crear = true;
    const r = await reagendarCitaDelPanelAmore(a.deps, a.citaId, a.hora("15:00"), 120);
    assert.ok(!r.ok && r.motivo === "calendario_no_disponible");
    assert.equal(a.mundo.citas()[0]!.estado, "pendiente");
    const b = armar();
    const r2 = await reagendarCitaDelPanelAmore(b.deps, b.citaId, b.hora("15:00"), 120);
    assert.ok(!r2.ok && r2.motivo === "no_encontrada");
    assert.equal(b.mundo.google.llamadas.crear, 0);
  });
});

describe("3. Rechazar, cancelar y confirmar", () => {
  it("rechazar una solicitud libera el evento de Google y su mapeo; repetirlo no hace nada", async () => {
    const m = armar({}, { estado: "pendiente" });
    const cita = await rechazarCitaDelPanelAmore(m.deps, m.citaId, "no hay cupo");
    assert.ok(cita);
    assert.equal(m.mundo.citas()[0]!.estado, "rechazada");
    assert.equal(m.mundo.google.eventos.has(m.eventoId!), false);
    assert.equal(mapeo(m).length, 0);
    assert.equal(await rechazarCitaDelPanelAmore(m.deps, m.citaId), null);
    assert.equal(m.mundo.google.llamadas.borrar, 1);
  });

  it("cancelar una cita libera el evento de Google y su mapeo; repetirlo no hace nada", async () => {
    const m = armar();
    assert.ok(await cancelarCitaDelPanelAmore(m.deps, m.citaId, "la clienta avisó"));
    assert.equal(m.mundo.citas()[0]!.estado, "cancelada");
    assert.equal(m.mundo.google.eventos.has(m.eventoId!), false);
    assert.equal(await cancelarCitaDelPanelAmore(m.deps, m.citaId), null);
    assert.equal(m.mundo.google.llamadas.borrar, 1);
  });

  it("si Google no deja borrar el evento, la cita igual queda cancelada y el mapeo se conserva para reintentar", async () => {
    const m = armar();
    m.mundo.google.falla.borrar = true;
    assert.ok(await cancelarCitaDelPanelAmore(m.deps, m.citaId));
    assert.equal(m.mundo.citas()[0]!.estado, "cancelada");
    assert.equal(mapeo(m).length, 1);
  });

  it("confirmar una pendiente: la clienta recibe la confirmación por WhatsApp con su enlace «Mi cita» (y la cita queda confirmada)", async () => {
    const m = armar({}, { estado: "pendiente" });
    const cita = await confirmarCitaDelPanelAmore(m.deps, m.citaId);
    assert.ok(cita && cita.estado === "confirmada");
    assert.equal(m.mundo.confirmaciones.length, 1);
    const c = m.mundo.confirmaciones[0]!;
    assert.equal(c.telefono, TELEFONO_CLIENTA);
    assert.equal(c.cita.servicio, "Dipping");
    assert.equal(c.cita.profesional, "Cristal");
    assert.match(c.cita.enlaceGestion ?? "", /^https:\/\/www\.dulabs\.co\/mi-cita\/[A-Za-z0-9_-]{43}$/);
    assert.equal(m.mundo.enlaces.filas.length, 1);
    assert.equal(await confirmarCitaDelPanelAmore(m.deps, m.citaId), null, "ya no está pendiente");
    assert.equal(m.mundo.confirmaciones.length, 1);
  });

  it("confirmar sin teléfono interpretable no manda nada, y si el aviso falla la cita igual queda confirmada", async () => {
    const sinTelefono = armar({}, { estado: "pendiente", telefono: null });
    assert.ok(await confirmarCitaDelPanelAmore(sinTelefono.deps, sinTelefono.citaId));
    assert.equal(sinTelefono.mundo.confirmaciones.length, 0);
    const falla = armar({}, { estado: "pendiente" });
    const cita = await confirmarCitaDelPanelAmore({ ...falla.deps, enviarConfirmacion: async () => Promise.reject(new Error("worker caído")) }, falla.citaId);
    assert.ok(cita && cita.estado === "confirmada");
  });
});

describe("4. Crear una cita a mano desde el panel", () => {
  const entrada = (m: ReturnType<typeof armar>, extra: Record<string, unknown> = {}) => ({
    servicioId: "s-dipping",
    especialistaId: 1263,
    inicio: m.hora("16:00", diaHabil(m.mundo.ahora(), 5)),
    nombreCliente: "Ana Pérez",
    telefonoCliente: "314 812 7388" as string | null,
    idempotencyKey: "panel-1",
    ...extra,
  });

  it("la clienta queda con la identidad del chat (teléfono normalizado), con su evento, su enlace y la confirmación con el enlace; la profesional es avisada", async () => {
    const m = armar();
    const r = await crearCitaDelPanelAmore(m.deps, entrada(m, { correoCliente: "ana@ejemplo.com" }));
    assert.ok(r.ok, JSON.stringify(r));
    const nueva = m.mundo.citas().find((c) => c.id !== 700)!;
    assert.equal(nueva.telefono_cliente, "573148127388", "normalizado: así el bot la encuentra al cancelar o cambiar");
    assert.equal(nueva.phone_number_id, `whatsapp-qr:${T}`);
    assert.equal(nueva.estado, "confirmada");
    assert.equal(eventos(m).filter((e) => e.id !== m.eventoId).length, 1);
    assert.equal(mapeo(m).filter((x) => x.cita_id === nueva.id).length, 1);
    const conocida = (m.mundo.tablas.dulabs_clientes_conocidos as Record<string, unknown>[]).find((c) => c.nombre === "Ana Pérez")!;
    assert.equal(conocida.telefono_cliente, "573148127388");
    assert.equal(conocida.phone_number_id, `whatsapp-qr:${T}`);
    assert.equal(m.mundo.confirmaciones.length, 1);
    assert.equal(m.mundo.confirmaciones[0]!.telefono, "573148127388");
    assert.match(m.mundo.confirmaciones[0]!.cita.enlaceGestion ?? "", /^https:\/\/www\.dulabs\.co\/mi-cita\//);
    assert.equal(m.avisosProfesional.length, 1);
    assert.equal(m.avisosProfesional[0]!.cita.nombreProfesional, "Cristal");
  });

  it("una profesional que requiere aprobación deja la cita PENDIENTE: no se le dice «confirmada» a la clienta, pero el enlace ya existe", async () => {
    const m = armar({ requiereAprobacion: true });
    const r = await crearCitaDelPanelAmore(m.deps, entrada(m));
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.cita.estado, "pendiente");
    assert.equal(m.mundo.confirmaciones.length, 0);
    assert.equal(m.mundo.enlaces.filas.length, 1);
    assert.equal(m.avisosProfesional.length, 1);
  });

  it("un teléfono que no se puede interpretar se conserva como lo escribieron, sin avisos a la clienta ni clienta «conocida»; sin teléfono, igual", async () => {
    const m = armar();
    const r = await crearCitaDelPanelAmore(m.deps, entrada(m, { telefonoCliente: "abc", idempotencyKey: "panel-2" }));
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(m.mundo.citas().find((c) => c.id !== 700)!.telefono_cliente, "abc");
    assert.equal(m.mundo.confirmaciones.length, 0);
    assert.equal((m.mundo.tablas.dulabs_clientes_conocidos as unknown[]).length, 0);
    const sin = await crearCitaDelPanelAmore(m.deps, entrada(m, { telefonoCliente: null, idempotencyKey: "panel-3", inicio: m.hora("10:00", diaHabil(m.mundo.ahora(), 6)) }));
    assert.ok(sin.ok, JSON.stringify(sin));
    assert.equal(m.mundo.confirmaciones.length, 0);
  });

  it("si Google no puede crear el evento: no se crea la cita ni se avisa a nadie; sin integración, igual", async () => {
    const m = armar();
    m.mundo.google.falla.crear = true;
    const r = await crearCitaDelPanelAmore(m.deps, entrada(m));
    assert.ok(!r.ok && r.motivo === "error_creando_evento_nylas");
    assert.equal(m.mundo.citas().length, 1, "solo la cita sembrada");
    assert.equal(m.mundo.confirmaciones.length + m.avisosProfesional.length, 0);
    const sin = await crearCitaDelPanelAmore({ ...m.deps, nylas: null }, entrada(m, { idempotencyKey: "panel-4" }));
    assert.ok(!sin.ok && sin.motivo === "sin_calendario_nylas");
  });

  it("un horario ocupado por otra cita se rechaza sin crear nada", async () => {
    const m = armar();
    const ocupado = m.hora("16:00", diaHabil(m.mundo.ahora(), 5));
    m.mundo.sembrarCita({ id: 702, inicio: ocupado, conEvento: false });
    const r = await crearCitaDelPanelAmore(m.deps, entrada(m, { inicio: ocupado, idempotencyKey: "panel-5" }));
    assert.ok(!r.ok && r.motivo === "ocupado");
    assert.equal(m.mundo.citas().length, 2);
  });

  it("si los avisos fallan, la cita ya creada NO se pierde", async () => {
    const m = armar();
    const r = await crearCitaDelPanelAmore(
      { ...m.deps, enviarConfirmacion: async () => Promise.reject(new Error("worker caído")), notificarProfesional: async () => Promise.reject(new Error("worker caído")) },
      entrada(m, { idempotencyKey: "panel-6" }),
    );
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(m.mundo.citas().length, 2);
  });
});

describe("5. Cableado de las rutas del panel (solo AMORE; los demás negocios siguen igual)", () => {
  const leer = (...partes: string[]) => readFileSync(path.join(process.cwd(), ...partes), "utf8").replace(/\r\n/g, "\n");

  it("la ruta de una cita: las cinco acciones de AMORE pasan por lib/mi-cita/panel.ts y las de los demás negocios siguen directas a la base", () => {
    const f = leer("app", "api", "agenda", "[token]", "citas", "[id]", "route.ts");
    assert.match(f, /const amore = especialista\.id_tenant === AMORE_TENANT_ID \? depsProduccionMiCita\(supabase\) : null;/);
    const pares: [string, string][] = [
      ["confirmarCitaDelPanelAmore(amore, citaId)", "await confirmarCita(supabase, citaId)"],
      ["rechazarCitaDelPanelAmore(amore, citaId, motivo)", "await rechazarCita(supabase, citaId, motivo)"],
      ["cancelarCitaDelPanelAmore(amore, citaId, motivo)", "await cancelarCita(supabase, citaId, motivo)"],
      ["reagendarCitaDelPanelAmore(amore, citaId, nuevoInicio, duracionMin)", "await proponerReagendamiento(supabase, citaId, nuevoInicio, duracionMin)"],
      ["editarCitaDelPanelAmore(amore, citaId, cambiosEdicion)", "await editarCitaConfirmada(supabase, citaId, cambiosEdicion)"],
    ];
    for (const [amore, legado] of pares) {
      assert.equal(f.split(`amore ? await ${amore}`).length - 1, 1, `AMORE: ${amore}`);
      assert.equal(f.split(`: ${legado}`).length - 1, 1, `otros negocios: ${legado}`);
    }
    assert.ok(!f.includes("borrarEventoDeCita("), "la ruta ya no borra eventos por su cuenta: lo hace lib/mi-cita/panel.ts");
    assert.match(f, /if \(cliente && !amore\) await notificarCitaConfirmada\(cliente, cita\);/, "el aviso antiguo de Meta sigue para los demás negocios");
    assert.equal(f.split('resultado.motivo === "calendario_no_disponible") return Response.json({ error: resultado.detalle }, { status: 503 })').length - 1, 2, "reagendar y editar responden 503 con el motivo cuando Google no responde");
  });

  it("la ruta de «Nueva cita»: AMORE usa crearCitaDelPanelAmore (teléfono normalizado + enlace) y los demás negocios siguen con reservarCitaPorServicio", () => {
    const f = leer("app", "api", "agenda", "[token]", "route.ts");
    assert.equal(f.split("crearCitaDelPanelAmore(").length - 1, 1);
    assert.ok(!f.includes("crearCitaConNylas("), "la ruta ya no arma la cita de AMORE por su cuenta");
    assert.equal(f.split("reservarCitaPorServicio(").length - 1, 1, "el camino de los demás negocios sigue igual");
    assert.match(f, /if \(idTenant === AMORE_TENANT_ID\) \{/);
  });
});
