import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { estadoInicial, transicionar, MAX_INTENTOS_FISICOS, type EstadoCompletoJob } from "@/lib/developer/outbound-state-machine";

describe("DuLabs Developer V1 — outbound state machine (Fase 1, secciones 10/11/12/14)", () => {
  it("primer intento: created -> queued -> sending, con network_attempts en 1", () => {
    let estado = estadoInicial();
    const r1 = transicionar(estado, { tipo: "encolar" });
    assert.equal(r1.permitida, true);
    if (!r1.permitida) return;
    estado = r1.siguiente;
    assert.equal(estado.status, "queued");

    const r2 = transicionar(estado, { tipo: "iniciar_envio" });
    assert.equal(r2.permitida, true);
    if (!r2.permitida) return;
    estado = r2.siguiente;
    assert.equal(estado.status, "sending");
    assert.equal(estado.physicalOutcome, "pre_send");
    assert.equal(estado.networkAttempts, 1);
  });

  it("éxito confirmado por Meta: sending -> success_confirmed, physicalOutcome pasa a success_confirmed", () => {
    const enviando: EstadoCompletoJob = { status: "sending", physicalOutcome: "pre_send", networkAttempts: 1 };
    const r = transicionar(enviando, { tipo: "meta_confirmo_exito" });
    assert.equal(r.permitida, true);
    if (r.permitida) {
      assert.equal(r.siguiente.status, "success_confirmed");
      assert.equal(r.siguiente.physicalOutcome, "success_confirmed");
    }
  });

  it("REGLA CRÍTICA (sección 11): incertidumbre de red NUNCA pasa a retry_pending -- siempre a reconciliation_pending", () => {
    const enviando: EstadoCompletoJob = { status: "sending", physicalOutcome: "pre_send", networkAttempts: 1 };
    const r = transicionar(enviando, { tipo: "incertidumbre_de_red" });
    assert.equal(r.permitida, true);
    if (r.permitida) {
      assert.equal(r.siguiente.status, "reconciliation_pending");
      assert.notEqual(r.siguiente.status, "retry_pending");
      assert.equal(r.siguiente.physicalOutcome, "uncertain");
    }
  });

  it("REGLA CRÍTICA: incertidumbre de red va a reconciliation_pending SIN importar cuántos intentos queden disponibles", () => {
    // Aunque todavía queda 1 intento físico disponible (1 de 2 usados), la
    // incertidumbre igual bloquea el auto-retry -- el número de intentos
    // restantes es irrelevante para esta regla.
    const primerIntento: EstadoCompletoJob = { status: "sending", physicalOutcome: "pre_send", networkAttempts: 1 };
    const r = transicionar(primerIntento, { tipo: "incertidumbre_de_red" });
    assert.equal(r.permitida, true);
    if (r.permitida) assert.equal(r.siguiente.status, "reconciliation_pending");
  });

  it("desde reconciliation_pending, SOLO una reconciliación explícita puede volver a habilitar el reintento -- nunca un evento de red directo", () => {
    const pendienteDeReconciliar: EstadoCompletoJob = { status: "reconciliation_pending", physicalOutcome: "uncertain", networkAttempts: 1 };
    // Intentar iniciar envío directo desde acá debe estar prohibido.
    const intentoInvalido = transicionar(pendienteDeReconciliar, { tipo: "iniciar_envio" });
    assert.equal(intentoInvalido.permitida, false);

    const reconciliado = transicionar(pendienteDeReconciliar, { tipo: "reconciliacion_confirmo_no_enviado" });
    assert.equal(reconciliado.permitida, true);
    if (reconciliado.permitida) assert.equal(reconciliado.siguiente.status, "retry_pending");
  });

  it(`máximo ${MAX_INTENTOS_FISICOS} intentos físicos: un rechazo de Meta en el último intento disponible va a failed_by_meta, no a retry_pending`, () => {
    const ultimoIntento: EstadoCompletoJob = { status: "sending", physicalOutcome: "pre_send", networkAttempts: MAX_INTENTOS_FISICOS };
    const r = transicionar(ultimoIntento, { tipo: "meta_rechazo", codigoError: "131026" });
    assert.equal(r.permitida, true);
    if (r.permitida) assert.equal(r.siguiente.status, "failed_by_meta");
  });

  it(`no se puede iniciar un tercer envío físico cuando networkAttempts ya alcanzó ${MAX_INTENTOS_FISICOS}`, () => {
    const agotado: EstadoCompletoJob = { status: "retry_pending", physicalOutcome: "pre_send", networkAttempts: MAX_INTENTOS_FISICOS };
    const r = transicionar(agotado, { tipo: "iniciar_envio" });
    assert.equal(r.permitida, false);
  });

  it("un rechazo de Meta con intentos disponibles todavía va a retry_pending, nunca directo a failed_by_meta", () => {
    const primerIntento: EstadoCompletoJob = { status: "sending", physicalOutcome: "pre_send", networkAttempts: 1 };
    const r = transicionar(primerIntento, { tipo: "meta_rechazo" });
    assert.equal(r.permitida, true);
    if (r.permitida) assert.equal(r.siguiente.status, "retry_pending");
  });

  it("transiciones inválidas se rechazan explícitamente (no lanzan, no mutan silenciosamente)", () => {
    const creado = estadoInicial();
    // No se puede confirmar éxito de Meta si nunca se intentó enviar.
    const r = transicionar(creado, { tipo: "meta_confirmo_exito" });
    assert.equal(r.permitida, false);
    assert.equal(typeof (r as { motivo: string }).motivo, "string");
  });

  it("ciclo completo real: created -> queued -> sending -> incertidumbre -> reconciliation_pending -> retry_pending -> sending -> éxito", () => {
    let estado = estadoInicial();
    const pasos: Array<Parameters<typeof transicionar>[1]> = [
      { tipo: "encolar" },
      { tipo: "iniciar_envio" },
      { tipo: "incertidumbre_de_red" },
      { tipo: "reconciliacion_confirmo_no_enviado" },
      { tipo: "iniciar_envio" },
      { tipo: "meta_confirmo_exito" },
    ];
    for (const evento of pasos) {
      const r = transicionar(estado, evento);
      assert.equal(r.permitida, true, `paso "${evento.tipo}" debería ser válido desde "${estado.status}"`);
      if (r.permitida) estado = r.siguiente;
    }
    assert.equal(estado.status, "success_confirmed");
    assert.equal(estado.networkAttempts, 2); // dos intentos físicos reales, dentro del máximo permitido
  });
});
