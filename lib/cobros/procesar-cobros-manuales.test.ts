import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ResultadoRecordatorio } from "./enviar-recordatorio";
import {
  enmascararTelefono,
  MAX_INTENTOS_AVISO,
  modoCobros,
  procesarCobrosManuales,
  resumenParaElDueno,
  type CicloExistente,
  type DepsCobros,
  type SuscripcionVencida,
} from "./procesar-cobros-manuales";

const sus = (extra: Partial<SuscripcionVencida> = {}): SuscripcionVencida => ({
  idTenant: "T-AMORE",
  plan: "start",
  precioCop: 39990,
  fechaCobro: "2026-10-30",
  telefonoCobro: "573001234567",
  nombreCobro: "AMORE",
  suspendida: false,
  ...extra,
});
const ENVIADO: ResultadoRecordatorio = { enviado: true, wamid: "wamid.1", resumen: "nombre=AMORE · monto=$39.990" };

/** Dependencias en memoria que apuntan cada llamada y se pueden afinar por prueba. */
function armar(
  datos: {
    vencidas?: SuscripcionVencida[];
    ciclos?: Record<string, CicloExistente>;
    reclamar?: boolean;
    suspender?: boolean | ((id: string) => boolean);
    envio?: ResultadoRecordatorio | ((id: string) => ResultadoRecordatorio | Promise<ResultadoRecordatorio>);
    avisoFalla?: boolean;
  } = {},
) {
  const llamadas: string[] = [];
  const avisos: string[] = [];
  const envios: { telefonoE164: string; nombreNegocio: string; montoCop: number }[] = [];
  const registros: { idTenant: string; fechaCobro: string; resultado: ResultadoRecordatorio; intentos: number }[] = [];
  const deps: DepsCobros = {
    hoy: () => "2026-10-30",
    async listarVencidas(hoy) {
      llamadas.push(`listar:${hoy}`);
      return datos.vencidas ?? [sus()];
    },
    async obtenerCiclo(id, fecha) {
      llamadas.push(`ciclo:${id}:${fecha}`);
      return datos.ciclos?.[`${id}:${fecha}`] ?? null;
    },
    async reclamarCiclo(s) {
      llamadas.push(`reclamar:${s.idTenant}`);
      return datos.reclamar ?? true;
    },
    async suspender(id) {
      llamadas.push(`suspender:${id}`);
      return typeof datos.suspender === "function" ? datos.suspender(id) : (datos.suspender ?? true);
    },
    async marcarOmitido(id) {
      llamadas.push(`omitir:${id}`);
    },
    async nombreNegocio(s) {
      return s.nombreCobro ?? "Negocio sin nombre";
    },
    async enviar(input) {
      llamadas.push(`enviar:${input.telefonoE164}`);
      envios.push(input);
      const e = datos.envio ?? ENVIADO;
      return typeof e === "function" ? e(input.telefonoE164) : e;
    },
    async registrarEnvio(p) {
      llamadas.push(`registrar:${p.idTenant}`);
      registros.push(p);
    },
    async avisarDueno(texto) {
      llamadas.push("avisar");
      if (datos.avisoFalla) throw new Error("Meta caído");
      avisos.push(texto);
    },
  };
  return { deps, llamadas, avisos, envios, registros };
}

describe("modoCobros", () => {
  it("solo «activo» actúa; cualquier otra cosa (o nada) es simulación", () => {
    for (const v of ["activo", " ACTIVO ", "Activo"]) assert.equal(modoCobros(v), "activo", v);
    for (const v of [undefined, null, "", "simulacion", "si", "true", "1", "on", "activa"]) assert.equal(modoCobros(v), "simulacion", String(v));
  });
});

describe("enmascararTelefono", () => {
  it("deja solo los 4 últimos dígitos", () => {
    assert.equal(enmascararTelefono("573001234567"), "…4567");
    assert.equal(enmascararTelefono("+57 300 123 4567"), "…4567");
    assert.equal(enmascararTelefono("12"), "…");
  });
});

describe("procesarCobrosManuales — modo activo", () => {
  it("ciclo nuevo: lo reclama, suspende el bot, manda el recordatorio con el nombre y el monto, guarda el resultado y le cuenta al dueño", async () => {
    const t = armar();
    const r = await procesarCobrosManuales(t.deps, { modo: "activo" });
    assert.deepEqual(t.llamadas, ["listar:2026-10-30", "ciclo:T-AMORE:2026-10-30", "reclamar:T-AMORE", "suspender:T-AMORE", "enviar:573001234567", "registrar:T-AMORE", "avisar"]);
    assert.deepEqual(t.envios, [{ telefonoE164: "573001234567", nombreNegocio: "AMORE", montoCop: 39990 }]);
    assert.deepEqual(t.registros, [{ idTenant: "T-AMORE", fechaCobro: "2026-10-30", resultado: ENVIADO, intentos: 1 }]);
    assert.deepEqual(r, {
      modo: "activo",
      hoy: "2026-10-30",
      revisadas: 1,
      acciones: [{ idTenant: "T-AMORE", fechaCobro: "2026-10-30", simulado: false, accion: "avisar", cliente: "AMORE", telefono: "…4567", suspendido: true, resultado: "enviado", motivo: undefined }],
    });
    assert.equal(t.avisos.length, 1);
    assert.match(t.avisos[0]!, /AMORE: bot suspendido y recordatorio enviado a …4567 \(cobro del 2026-10-30\)/);
    assert.match(t.avisos[0]!, /Registrar pago/);
    assert.doesNotMatch(t.avisos[0]!, /57322/, "el aviso nunca lleva el teléfono completo");
  });

  it("si el envío falla, el bot QUEDA suspendido, el fallo se guarda con su motivo y el dueño se entera", async () => {
    const t = armar({ envio: { enviado: false, motivo: "plantilla_no_aprobada", detalle: "status=PENDING" } });
    const r = await procesarCobrosManuales(t.deps, { modo: "activo" });
    assert.ok(t.llamadas.includes("suspender:T-AMORE"));
    assert.equal(t.registros[0]!.resultado.enviado, false);
    assert.equal(r.acciones[0]!.resultado, "fallido");
    assert.equal(r.acciones[0]!.motivo, "plantilla_no_aprobada: status=PENDING");
    assert.match(t.avisos[0]!, /bot suspendido y el recordatorio FALLÓ \(plantilla_no_aprobada: status=PENDING\); se reintenta mañana/);
  });

  it("un ciclo que ya se avisó (enviado), se pagó, se omitió o agotó los intentos NO se toca y no genera ruido", async () => {
    for (const ciclo of [
      { estado: "enviado", intentos: 1 },
      { estado: "pagado", intentos: 0 },
      { estado: "omitido", intentos: 0 },
      { estado: "fallido", intentos: MAX_INTENTOS_AVISO },
    ] as CicloExistente[]) {
      const t = armar({ ciclos: { "T-AMORE:2026-10-30": ciclo } });
      const r = await procesarCobrosManuales(t.deps, { modo: "activo" });
      assert.equal(r.acciones[0]!.accion, "ya_procesado", ciclo.estado);
      assert.equal(r.acciones[0]!.estadoPrevio, ciclo.estado);
      assert.deepEqual(t.llamadas.filter((l) => /^(reclamar|suspender|enviar|registrar|avisar|omitir)/.test(l)), [], `no debía hacer nada con un ciclo ${ciclo.estado}`);
    }
  });

  it("un envío fallido con intentos disponibles se REINTENTA (sin reclamar otra vez) y suma el intento", async () => {
    const t = armar({ ciclos: { "T-AMORE:2026-10-30": { estado: "fallido", intentos: 2 } }, suspender: false, vencidas: [sus({ suspendida: true })] });
    const r = await procesarCobrosManuales(t.deps, { modo: "activo" });
    assert.ok(!t.llamadas.includes("reclamar:T-AMORE"), "el ciclo ya existe");
    assert.equal(r.acciones[0]!.accion, "reintentar_aviso");
    assert.equal(r.acciones[0]!.suspendido, false, "ya estaba suspendido de antes");
    assert.equal(t.registros[0]!.intentos, 3);
    assert.match(t.avisos[0]!, /AMORE: recordatorio enviado a …4567/);
  });

  it("un ciclo «pendiente» (reclamado pero sin terminar, p. ej. se cortó la corrida) también se reintenta", async () => {
    const t = armar({ ciclos: { "T-AMORE:2026-10-30": { estado: "pendiente", intentos: 0 } } });
    const r = await procesarCobrosManuales(t.deps, { modo: "activo" });
    assert.equal(r.acciones[0]!.accion, "reintentar_aviso");
    assert.equal(t.envios.length, 1);
  });

  it("sin teléfono de cobro NO suspende ni avisa: solo se lo cuenta al dueño", async () => {
    const t = armar({ vencidas: [sus({ telefonoCobro: null })] });
    const r = await procesarCobrosManuales(t.deps, { modo: "activo" });
    assert.equal(r.acciones[0]!.accion, "sin_telefono");
    assert.deepEqual(t.llamadas.filter((l) => /^(reclamar|suspender|enviar|registrar|ciclo)/.test(l)), []);
    assert.match(t.avisos[0]!, /T-AMORE: venció el 2026-10-30 y NO tiene teléfono de cobro: no se avisó ni se suspendió/);
  });

  it("sin precio tampoco actúa (no hay monto que cobrar)", async () => {
    const t = armar({ vencidas: [sus({ precioCop: 0 })] });
    const r = await procesarCobrosManuales(t.deps, { modo: "activo" });
    assert.equal(r.acciones[0]!.accion, "sin_precio");
    assert.equal(t.envios.length, 0);
    assert.match(t.avisos[0]!, /no tiene precio/);
  });

  it("si otra corrida reclamó el ciclo primero, esta se retira sin suspender ni enviar", async () => {
    const t = armar({ reclamar: false });
    const r = await procesarCobrosManuales(t.deps, { modo: "activo" });
    assert.equal(r.acciones[0]!.accion, "carrera_perdida");
    assert.deepEqual(t.llamadas.filter((l) => /^(suspender|enviar|registrar|avisar)/.test(l)), []);
  });

  it("si el pago se registró mientras tanto (la suspensión condicionada no aplica), no se avisa a nadie y el ciclo queda omitido", async () => {
    const t = armar({ suspender: false });
    const r = await procesarCobrosManuales(t.deps, { modo: "activo" });
    assert.equal(r.acciones[0]!.accion, "ya_no_aplica");
    assert.ok(t.llamadas.includes("omitir:T-AMORE"));
    assert.equal(t.envios.length, 0);
    assert.equal(t.avisos.length, 0, "no hay nada que contar");
  });

  it("un error en un cliente no frena a los demás, y el dueño se entera del error", async () => {
    const t = armar({
      vencidas: [sus({ idTenant: "T1", telefonoCobro: "573001111111", nombreCobro: "Uno" }), sus({ idTenant: "T2", telefonoCobro: "573002222222", nombreCobro: "Dos" })],
      envio: (telefono) => {
        if (telefono === "573001111111") throw new Error("se cayó la red");
        return ENVIADO;
      },
    });
    const r = await procesarCobrosManuales(t.deps, { modo: "activo" });
    assert.deepEqual(r.acciones.map((a) => [a.idTenant, a.accion]), [["T1", "error"], ["T2", "avisar"]]);
    assert.equal(r.acciones[0]!.motivo, "se cayó la red");
    assert.match(t.avisos[0]!, /T1: error procesando el cobro del 2026-10-30 \(se cayó la red\)/);
    assert.match(t.avisos[0]!, /Dos: bot suspendido y recordatorio enviado a …2222/);
  });

  it("si el aviso al dueño falla, el resultado igual se devuelve (no tumba el cron)", async () => {
    const t = armar({ avisoFalla: true });
    const r = await procesarCobrosManuales(t.deps, { modo: "activo" });
    assert.equal(r.acciones[0]!.resultado, "enviado");
  });

  it("sin nada vencido no hace nada ni molesta al dueño", async () => {
    const t = armar({ vencidas: [] });
    const r = await procesarCobrosManuales(t.deps, { modo: "activo" });
    assert.deepEqual(r, { modo: "activo", hoy: "2026-10-30", revisadas: 0, acciones: [] });
    assert.deepEqual(t.llamadas, ["listar:2026-10-30"]);
  });
});

describe("procesarCobrosManuales — modo simulación", () => {
  it("NO escribe, NO suspende, NO envía y NO avisa: solo informa qué haría", async () => {
    const t = armar({ vencidas: [sus(), sus({ idTenant: "T2", telefonoCobro: null }), sus({ idTenant: "T3", nombreCobro: "Tres" })], ciclos: { "T3:2026-10-30": { estado: "fallido", intentos: 1 } } });
    const r = await procesarCobrosManuales(t.deps, { modo: "simulacion" });
    assert.deepEqual(t.llamadas.filter((l) => /^(reclamar|suspender|enviar|registrar|avisar|omitir)/.test(l)), []);
    assert.deepEqual(r.acciones.map((a) => [a.idTenant, a.accion, a.simulado]), [["T-AMORE", "avisar", true], ["T2", "sin_telefono", true], ["T3", "reintentar_aviso", true]]);
    assert.deepEqual([r.acciones[0]!.cliente, r.acciones[0]!.telefono], ["AMORE", "…4567"]);
    assert.equal(r.modo, "simulacion");
  });
});

describe("procesarCobrosManuales — de punta a punta con un estado en memoria", () => {
  /** Una suscripción y su libro de ciclos: reproduce lo que hacen la base y el pago manual, para ver el comportamiento de varios días. */
  function mundo() {
    const estado = { fecha: "2026-10-30", suspendida: false, ciclos: new Map<string, CicloExistente & { fecha: string }>(), envios: 0, hoy: "2026-10-30" };
    const deps: DepsCobros = {
      hoy: () => estado.hoy,
      async listarVencidas() {
        return estado.fecha <= estado.hoy ? [sus({ fechaCobro: estado.fecha, suspendida: estado.suspendida })] : [];
      },
      async obtenerCiclo(_id, fecha) {
        return estado.ciclos.get(fecha) ?? null;
      },
      async reclamarCiclo(s) {
        if (estado.ciclos.has(s.fechaCobro)) return false;
        estado.ciclos.set(s.fechaCobro, { estado: "pendiente", intentos: 0, fecha: s.fechaCobro });
        return true;
      },
      async suspender(_id, fecha) {
        if (estado.fecha !== fecha || estado.suspendida) return false;
        estado.suspendida = true;
        return true;
      },
      async marcarOmitido(_id, fecha) {
        const c = estado.ciclos.get(fecha);
        if (c?.estado === "pendiente") c.estado = "omitido";
      },
      nombreNegocio: async () => "AMORE",
      async enviar() {
        estado.envios++;
        return ENVIADO;
      },
      async registrarEnvio({ fechaCobro, resultado, intentos }) {
        const c = estado.ciclos.get(fechaCobro)!;
        c.estado = resultado.enviado ? "enviado" : "fallido";
        c.intentos = intentos;
      },
      avisarDueno: async () => {},
    };
    /** Lo que hace dulabs_cobro_registrar_pago. */
    const registrarPago = (proximaFecha: string) => {
      estado.ciclos.set(estado.fecha, { estado: "pagado", intentos: 0, fecha: estado.fecha });
      estado.fecha = proximaFecha;
      estado.suspendida = false;
    };
    return { estado, deps, registrarPago };
  }

  it("el aviso sale UNA sola vez por ciclo aunque el cron corra varias veces o varios días seguidos", async () => {
    const m = mundo();
    await procesarCobrosManuales(m.deps, { modo: "activo" });
    await procesarCobrosManuales(m.deps, { modo: "activo" });
    m.estado.hoy = "2026-10-31";
    await procesarCobrosManuales(m.deps, { modo: "activo" });
    m.estado.hoy = "2026-11-02";
    await procesarCobrosManuales(m.deps, { modo: "activo" });
    assert.equal(m.estado.envios, 1);
    assert.equal(m.estado.suspendida, true);
  });

  it("al registrar el pago se levanta la suspensión y no pasa nada hasta el siguiente vencimiento, cuando se repite el ciclo completo", async () => {
    const m = mundo();
    await procesarCobrosManuales(m.deps, { modo: "activo" });
    m.registrarPago("2026-11-30");
    assert.equal(m.estado.suspendida, false);
    m.estado.hoy = "2026-11-15";
    assert.equal((await procesarCobrosManuales(m.deps, { modo: "activo" })).revisadas, 0, "antes del siguiente vencimiento no hay nada que revisar");
    m.estado.hoy = "2026-11-30";
    await procesarCobrosManuales(m.deps, { modo: "activo" });
    assert.equal(m.estado.envios, 2, "un ciclo nuevo, un aviso nuevo");
    assert.equal(m.estado.suspendida, true);
  });

  it("un envío fallido se reintenta cada día hasta el tope y después se deja de insistir", async () => {
    const m = mundo();
    let intentos = 0;
    m.deps.enviar = async () => {
      intentos++;
      return { enviado: false, motivo: "error_envio", detalle: "Meta caído" };
    };
    const dia = (i: number) => new Date(Date.UTC(2026, 9, 30 + i)).toISOString().slice(0, 10); // 30-oct, 31-oct, 1-nov…
    for (let i = 0; i < MAX_INTENTOS_AVISO + 3; i++) {
      m.estado.hoy = dia(i);
      await procesarCobrosManuales(m.deps, { modo: "activo" });
    }
    assert.equal(intentos, MAX_INTENTOS_AVISO);
    assert.equal(m.estado.ciclos.get("2026-10-30")!.estado, "fallido");
    assert.equal(m.estado.suspendida, true, "el bot sigue suspendido aunque el aviso no haya podido salir");
  });
});

describe("resumenParaElDueno", () => {
  it("devuelve null si no hay nada que contar", () => {
    assert.equal(resumenParaElDueno("2026-10-30", []), null);
    assert.equal(resumenParaElDueno("2026-10-30", [{ idTenant: "T", fechaCobro: "2026-10-30", accion: "ya_procesado", simulado: false }]), null);
    assert.equal(resumenParaElDueno("2026-10-30", [{ idTenant: "T", fechaCobro: "2026-10-30", accion: "ya_no_aplica", simulado: false }]), null);
  });
});
