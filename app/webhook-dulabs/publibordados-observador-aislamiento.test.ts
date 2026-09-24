/**
 * Publi Bordados — Fase 2A: guarda ESTRUCTURAL de aislamiento del observador shadow.
 *
 * Misma técnica que blacklist-orden.test.ts: se lee el código fuente real y se fija la forma del
 * cambio, para que el observador no pueda (ni ahora ni por un cambio futuro inadvertido):
 *   - alterar el flujo del webhook (su resultado nunca se espera ni decide nada);
 *   - ejecutarse sin el interruptor maestro PUBLIBORDADOS_ENABLED;
 *   - enviar WhatsApp, llamar a una IA, pausar/tomar conversaciones o tocar Flow/agentes/legacy;
 *   - escribir en tablas que no sean de Publi Bordados.
 * El comportamiento (inerte con el interruptor apagado, nunca rechaza, etc.) está probado en
 * lib/publibordados/observador/observador.test.ts.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ruta = readFileSync(join(__dirname, "route.ts"), "utf8");
const DIR_OBS = join(__dirname, "..", "..", "lib", "publibordados", "observador");
const fuentesObservador = readdirSync(DIR_OBS)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .map((f) => ({ f, src: readFileSync(join(DIR_OBS, f), "utf8") }));

describe("webhook-dulabs: el observador de Publi Bordados es aditivo e inerte", () => {
  it("route.ts solo lo menciona en el import y en UNA línea condicionada por el interruptor maestro", () => {
    const lineas = ruta.split("\n").filter((l) => /publibordados/i.test(l) && !l.trim().startsWith("//"));
    assert.deepEqual(lineas.map((l) => l.trim()), [
      'import { observadorPublibordadosActivo, observarCambioPublibordados } from "@/lib/publibordados/observador/observador";',
      "if (observadorPublibordadosActivo()) after(observarCambioPublibordados(change, recibidoAt));",
    ]);
  });

  it("su resultado nunca se espera ni decide el flujo (no await, no asignación, no return)", () => {
    assert.ok(!/await\s+observarCambioPublibordados/.test(ruta));
    assert.ok(!/=\s*observarCambioPublibordados/.test(ruta));
    assert.ok(!/return[^;\n]*observarCambioPublibordados/.test(ruta));
  });

  it("se programa en after(), antes del procesamiento existente del mismo change, sin reemplazarlo", () => {
    const posHook = ruta.indexOf("after(observarCambioPublibordados(change, recibidoAt))");
    const posDumo = ruta.indexOf("await reenviarMensajesADumoSiAplica(change as");
    const posProcesar = ruta.indexOf("await procesarCambio(phoneNumberId, value,");
    assert.ok(posHook > 0 && posHook < posDumo && posDumo < posProcesar);
  });

  it("no introduce ningún phone_number_id, teléfono ni tenant de producción en el código", () => {
    for (const { f, src } of fuentesObservador) {
      assert.ok(!/3012913038|301\s?291\s?3038/.test(src), `${f}: número real`);
      assert.ok(!/["']\d{12,20}["']/.test(src), `${f}: id numérico largo literal`);
      assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(src), `${f}: uuid literal`);
    }
  });

  it("el módulo del observador no importa nada que envíe, responda, pause o decida conversaciones", () => {
    const prohibidos = [
      /whatsapp/i, /pausas-chat/, /ia-proveedores/, /lib\/agente/, /lib\/flow/, /agent-compiler/, /gemini/i, /anthropic/i,
      /lib\/ia["']/, /catalogo/, /chat-lock/, /meta-templates/,
    ];
    for (const { f, src } of fuentesObservador) {
      const imports = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
      for (const imp of imports) {
        assert.ok(["node:crypto", "@/lib/supabase", "@supabase/supabase-js"].includes(imp) || imp.startsWith("./"), `${f}: import no permitido ${imp}`);
        for (const p of prohibidos) assert.ok(!p.test(imp), `${f}: import prohibido ${imp}`);
      }
      assert.ok(!/\bfetch\s*\(/.test(src), `${f}: no debe hacer llamadas HTTP propias`);
    }
  });

  it("solo LEE tablas compartidas y solo ESCRIBE en tablas de Publi Bordados (vía su RPC)", () => {
    const todo = fuentesObservador.map((x) => x.src).join("\n");
    // (createHash().update("…") es crypto, no una escritura: se excluye por su argumento de texto).
    assert.ok(!/\.(insert|upsert|delete)\s*\(|\.update\(\s*[{[]/.test(todo), "sin escrituras directas");
    const tablas = [...todo.matchAll(/\.from\(\s*["']([a-z_]+)["']\s*\)/g)].map((m) => m[1]).sort();
    assert.deepEqual([...new Set(tablas)], ["dulabs_clientes_config", "dulabs_mensajes_log", "dulabs_pb_config", "dulabs_pb_mensajes_enviados"]);
    const rpcs = [...todo.matchAll(/\.rpc\(\s*["']([a-z_]+)["']/g)].map((m) => m[1]);
    assert.deepEqual(rpcs, ["dulabs_pb_observar"]);
  });
});
