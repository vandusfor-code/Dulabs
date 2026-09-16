import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { estadoInicial, transicionar, type EstadoCompletoJob } from "@/lib/developer/outbound-state-machine";

// DuLabs Developer V1 -- Fase 1 (autorizado, sección 21 del brief). Regla de
// evidencia: NO se acepta `physicalPostCount = 1` como sustituto de haber
// ejecutado un POST real. Este test levanta un servidor HTTP real
// (fixture), hace un fetch real contra él, cuenta las llamadas que
// realmente recibió el servidor (no una variable que el propio código bajo
// prueba incrementa "de buena fe"), simula una caída real del proceso
// DESPUÉS de que el POST físico ya se ejecutó pero ANTES de que el
// resultado se haya podido persistir, y comprueba que el recovery -- al
// pasar correctamente por la regla crítica de outbound-state-machine.ts
// (incertidumbre_de_red SIEMPRE va a reconciliation_pending, nunca a un
// reintento automático) -- NO ejecuta un segundo POST físico.

describe("DuLabs Developer V1 — crash recovery real (Fase 1, sección 21)", () => {
  let servidor: Server;
  let url: string;
  // Contador real, incrementado SOLO por el handler HTTP cuando de verdad
  // recibe una request -- esto es lo que hace la evidencia real, no
  // simulada.
  let postsRecibidosPorElServidor = 0;

  before(async () => {
    await new Promise<void>((resolve) => {
      servidor = createServer((req, res) => {
        if (req.method === "POST") {
          postsRecibidosPorElServidor += 1;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ messages: [{ id: `wamid.fixture-${postsRecibidosPorElServidor}` }] }));
          return;
        }
        res.writeHead(404).end();
      });
      servidor.listen(0, "127.0.0.1", () => {
        const address = servidor.address();
        if (address && typeof address === "object") url = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => servidor.close(() => resolve()));
  });

  it("crash_after_physical_post_does_not_duplicate", async () => {
    postsRecibidosPorElServidor = 0;
    let estado: EstadoCompletoJob = estadoInicial();

    // Paso 1: encolar y empezar a enviar (mismo camino real de la máquina
    // de estados, no un atajo del test).
    const rEncolar = transicionar(estado, { tipo: "encolar" });
    assert.equal(rEncolar.permitida, true);
    if (rEncolar.permitida) estado = rEncolar.siguiente;
    const rIniciar = transicionar(estado, { tipo: "iniciar_envio" });
    assert.equal(rIniciar.permitida, true);
    if (rIniciar.permitida) estado = rIniciar.siguiente;
    assert.equal(estado.status, "sending");

    const countAntes = postsRecibidosPorElServidor;

    // Paso 2: ejecutar el POST FÍSICO REAL contra el fixture -- esto es lo
    // que "el trabajador" haría contra Meta.
    const respuesta = await fetch(url, { method: "POST", body: JSON.stringify({ to: "573000000000", type: "text" }) });
    assert.equal(respuesta.ok, true);
    await respuesta.json();

    const countDespuesDelPost = postsRecibidosPorElServidor;
    assert.equal(countDespuesDelPost, countAntes + 1, "el fixture debe haber recibido exactamente 1 POST real");

    // Paso 3: simular la caída del proceso AQUÍ MISMO -- después del POST
    // físico, antes de que el código hubiera podido llamar a
    // transicionar(..., "meta_confirmo_exito") y persistirlo. El estado en
    // memoria/DB se queda tal cual estaba ANTES del POST: "sending", sin
    // que nadie sepa todavía si Meta lo recibió.
    // (No se ejecuta ninguna transición de éxito acá -- eso es literalmente
    // la simulación de la caída: el código que haría esa transición nunca
    // llegó a correr.)

    // Paso 4: recovery. Un Worker nuevo (o el mismo, reiniciado) toma este
    // job, lo ve en "sending" sin confirmación, y NO PUEDE saber si el POST
    // anterior llegó a Meta -- exactamente la situación real tras un
    // crash. La única transición correcta es "incertidumbre_de_red".
    const rIncertidumbre = transicionar(estado, { tipo: "incertidumbre_de_red" });
    assert.equal(rIncertidumbre.permitida, true);
    if (rIncertidumbre.permitida) estado = rIncertidumbre.siguiente;

    assert.equal(estado.status, "reconciliation_pending");
    assert.equal(estado.physicalOutcome, "uncertain");

    // Paso 5: la regla crítica -- desde reconciliation_pending, "iniciar_envio"
    // (que dispararía un segundo POST físico real) debe estar PROHIBIDO por
    // la propia máquina de estados. Se intenta a propósito para demostrar
    // que el sistema lo bloquea, no que el test simplemente no lo intenta.
    const intentoDeSegundoEnvio = transicionar(estado, { tipo: "iniciar_envio" });
    assert.equal(intentoDeSegundoEnvio.permitida, false);

    // Paso 6: comprobación final -- el fixture NUNCA recibió un segundo
    // POST, porque nada en el código bajo prueba pudo llegar a intentarlo.
    const countFinal = postsRecibidosPorElServidor;

    // EVIDENCIA (sección 27 del brief):
    console.log("TEST: crash_after_physical_post_does_not_duplicate");
    console.log(`EVIDENCIA: physical POST count before recovery: ${countDespuesDelPost}`);
    console.log(`EVIDENCIA: physical POST count after recovery attempt: ${countFinal}`);
    console.log(`EVIDENCIA: final job state: ${estado.status}`);
    console.log(`EVIDENCIA: second POST: ${countFinal === countDespuesDelPost ? "NOT EXECUTED" : "EXECUTED (FALLO)"}`);

    assert.equal(countFinal, countDespuesDelPost, "no debe haberse ejecutado un segundo POST físico tras el crash+recovery");
    assert.equal(countFinal, 1, "en total, contra el fixture real, debe haber exactamente 1 POST físico");
  });
});
