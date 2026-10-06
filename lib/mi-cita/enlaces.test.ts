/**
 * AMORE «Mi cita» — el enlace personal: el token es aleatorio e impredecible, no revela nada, se valida por hash, se puede revocar y vencer, una cita
 * tiene UN solo enlace activo (el mismo cada vez), y todo falla sin lanzar (p. ej. migración sin aplicar). Base y Nylas EN MEMORIA.
 */
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { createSupabaseEnlacesStore, createMemoryEnlacesStore, esTokenBienFormado, generarToken, hashDeToken, obtenerOCrearEnlace, resolverEnlace, urlDeEnlace, vencimientoDeEnlace, GRACIA_TRAS_LA_CITA_MS, AMORE_SITIO_BASE, URL_RESERVA_AMORE } from "@/lib/mi-cita/enlaces";
import { crearSupabaseEnMemoria } from "@/lib/test-helpers/supabase-en-memoria";
import { cifrarSecreto } from "@/lib/crypto";

const T = "ed6ae77f-8a0c-483e-a5d9-8ede68eca50f";
const AHORA = new Date("2026-10-06T15:00:00Z");
const FIN = "2026-10-08T17:00:00Z";
const sinLog = () => {};

describe("el token: aleatorio, impredecible y sin información", () => {
  it("tiene 43 caracteres base64url (256 bits) y es distinto cada vez (10.000 sin una sola repetición)", () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const t = generarToken();
      assert.match(t, /^[A-Za-z0-9_-]{43}$/);
      assert.ok(esTokenBienFormado(t));
      vistos.add(t);
    }
    assert.equal(vistos.size, 10_000);
  });

  it("no se deriva del id de la cita ni de nada predecible: ninguna fórmula simple a partir del id (base64, hex, sha256, con el tenant) da el token", async () => {
    const store = createMemoryEnlacesStore();
    const emitidos: { id: number; token: string }[] = [];
    for (let id = 1; id <= 300; id++) {
      const e = await obtenerOCrearEnlace(store, { idTenant: T, citaId: id, citaFinISO: FIN }, { ahora: () => AHORA, log: sinLog });
      assert.ok(e);
      emitidos.push({ id, token: e.token });
    }
    for (const { id, token } of emitidos) {
      const candidatos = [
        Buffer.from(String(id)).toString("base64url"),
        Buffer.from(String(id)).toString("hex"),
        createHash("sha256").update(String(id)).digest("base64url").slice(0, 43),
        createHash("sha256").update(`${T}:${id}`).digest("base64url").slice(0, 43),
        createHash("sha256").update(`amore-cita:${id}`).digest("base64url").slice(0, 43),
      ];
      assert.ok(!candidatos.includes(token), `la cita ${id}: el token no sale de una fórmula simple del id`);
    }
    // Citas consecutivas no producen tokens parecidos (no hay secuencia ni prefijo común).
    const prefijos = new Set(emitidos.map((e) => e.token.slice(0, 4)));
    assert.ok(prefijos.size > 250, "los prefijos de 4 caracteres de 300 tokens son casi todos distintos");
    assert.ok(emitidos.every((e) => !Buffer.from(e.token, "base64url").toString("utf8").includes(T)), "no embebe el tenant");
  });

  it("solo un token con el formato exacto es válido (se rechaza lo vacío, corto, largo, con símbolos, números o no-strings)", () => {
    const bueno = generarToken();
    assert.ok(esTokenBienFormado(bueno));
    for (const malo of ["", bueno.slice(0, 42), `${bueno}A`, `${bueno.slice(0, 42)}!`, `${bueno.slice(0, 42)} `, "1234", 12345, null, undefined, {}, [bueno]]) {
      assert.ok(!esTokenBienFormado(malo), String(malo));
    }
  });

  it("el hash es sha256 hex (64) determinista y distinto del token", () => {
    const t = generarToken();
    assert.match(hashDeToken(t), /^[0-9a-f]{64}$/);
    assert.equal(hashDeToken(t), hashDeToken(t));
    assert.notEqual(hashDeToken(t), t);
    assert.notEqual(hashDeToken(t), hashDeToken(generarToken()));
  });

  it("la URL es el dominio canónico + /mi-cita/<token>; la de reservas es la que dio el negocio", () => {
    const t = generarToken();
    assert.equal(urlDeEnlace(t), `https://www.dulabs.co/mi-cita/${t}`);
    assert.equal(AMORE_SITIO_BASE, "https://www.dulabs.co");
    assert.equal(URL_RESERVA_AMORE, "https://www.dulabs.co/reservar/amore");
  });
});

describe("obtener o crear el enlace de una cita", () => {
  it("devuelve SIEMPRE el mismo enlace para la misma cita (la confirmación y el recordatorio llevan el mismo) y guarda solo hash + copia cifrada, nunca el token", async () => {
    const store = createMemoryEnlacesStore();
    const a = await obtenerOCrearEnlace(store, { idTenant: T, citaId: 77, citaFinISO: FIN }, { ahora: () => AHORA, log: sinLog });
    const b = await obtenerOCrearEnlace(store, { idTenant: T, citaId: 77, citaFinISO: FIN }, { ahora: () => AHORA, log: sinLog });
    assert.ok(a && b);
    assert.equal(a.token, b.token);
    assert.equal(a.url, `https://www.dulabs.co/mi-cita/${a.token}`);
    assert.equal(store.filas.length, 1, "un solo enlace activo por cita");
    const fila = store.filas[0]!;
    assert.equal(fila.tokenHash, hashDeToken(a.token));
    assert.ok(fila.tokenCifrado.startsWith("v1:"), "copia cifrada (AES-256-GCM)");
    assert.ok(!JSON.stringify(fila).includes(a.token), "el token en claro NO está en ninguna columna");
  });

  it("dos procesos a la vez para la misma cita terminan con UN solo enlace (el mismo)", async () => {
    const store = createMemoryEnlacesStore();
    const resultados = await Promise.all(Array.from({ length: 8 }, () => obtenerOCrearEnlace(store, { idTenant: T, citaId: 5, citaFinISO: FIN }, { ahora: () => AHORA, log: sinLog })));
    assert.ok(resultados.every((r) => r !== null));
    assert.equal(new Set(resultados.map((r) => r!.token)).size, 1);
    assert.equal(store.filas.filter((f) => f.revocadoAt === null).length, 1);
  });

  it("vence 14 días después del fin de la cita; si la cita se mueve, el vencimiento se extiende (nunca se acorta)", async () => {
    const store = createMemoryEnlacesStore();
    await obtenerOCrearEnlace(store, { idTenant: T, citaId: 9, citaFinISO: FIN }, { ahora: () => AHORA, log: sinLog });
    assert.equal(Date.parse(store.filas[0]!.expiraAt), Date.parse(FIN) + GRACIA_TRAS_LA_CITA_MS);
    const masTarde = "2026-10-20T17:00:00Z";
    await obtenerOCrearEnlace(store, { idTenant: T, citaId: 9, citaFinISO: masTarde }, { ahora: () => AHORA, log: sinLog });
    assert.equal(Date.parse(store.filas[0]!.expiraAt), Date.parse(masTarde) + GRACIA_TRAS_LA_CITA_MS, "se extendió");
    await obtenerOCrearEnlace(store, { idTenant: T, citaId: 9, citaFinISO: FIN }, { ahora: () => AHORA, log: sinLog });
    assert.equal(Date.parse(store.filas[0]!.expiraAt), Date.parse(masTarde) + GRACIA_TRAS_LA_CITA_MS, "nunca se acorta");
    assert.equal(vencimientoDeEnlace("1970-01-01T00:00:00Z", AHORA).getTime(), AHORA.getTime() + GRACIA_TRAS_LA_CITA_MS, "una cita ya pasada vence 14 días desde ahora, no en 1970");
  });

  it("un enlace vencido se revoca y se emite uno nuevo; uno cuyo cifrado se corrompió también (el viejo deja de abrir)", async () => {
    const store = createMemoryEnlacesStore();
    const viejo = await obtenerOCrearEnlace(store, { idTenant: T, citaId: 3, citaFinISO: FIN }, { ahora: () => AHORA, log: sinLog });
    const muchoDespues = new Date(Date.parse(FIN) + GRACIA_TRAS_LA_CITA_MS + 60_000);
    const nuevo = await obtenerOCrearEnlace(store, { idTenant: T, citaId: 3, citaFinISO: new Date(muchoDespues.getTime() + 3600_000).toISOString() }, { ahora: () => muchoDespues, log: sinLog });
    assert.ok(viejo && nuevo && viejo.token !== nuevo.token);
    assert.notEqual(store.filas.find((f) => f.tokenHash === hashDeToken(viejo.token))!.revocadoAt, null);
    // Cifrado corrupto
    const otro = createMemoryEnlacesStore();
    const x = await obtenerOCrearEnlace(otro, { idTenant: T, citaId: 4, citaFinISO: FIN }, { ahora: () => AHORA, log: sinLog });
    otro.filas[0]!.tokenCifrado = cifrarSecreto("OTRO-TOKEN-QUE-NO-COINCIDE-CON-EL-HASH-0000");
    const y = await obtenerOCrearEnlace(otro, { idTenant: T, citaId: 4, citaFinISO: FIN }, { ahora: () => AHORA, log: sinLog });
    assert.ok(x && y && x.token !== y.token, "no entrega un enlace que no coincide con su hash");
  });

  it("sin la tabla (migración sin aplicar) o con la base caída: devuelve null y NUNCA lanza", async () => {
    assert.equal(await obtenerOCrearEnlace(createMemoryEnlacesStore({ sinTabla: true }), { idTenant: T, citaId: 1, citaFinISO: FIN }, { ahora: () => AHORA, log: sinLog }), null);
    const rota = { ...createMemoryEnlacesStore(), activoDeCita: async () => Promise.reject(new Error("base caída")) };
    assert.equal(await obtenerOCrearEnlace(rota, { idTenant: T, citaId: 1, citaFinISO: FIN }, { ahora: () => AHORA, log: sinLog }), null);
  });
});

describe("validar el token que llega por la URL", () => {
  const preparar = async () => {
    const store = createMemoryEnlacesStore();
    const e = (await obtenerOCrearEnlace(store, { idTenant: T, citaId: 77, citaFinISO: FIN }, { ahora: () => AHORA, log: sinLog }))!;
    return { store, token: e.token };
  };

  it("un token válido devuelve SU fila", async () => {
    const { store, token } = await preparar();
    const r = await resolverEnlace(store, token, AHORA);
    assert.ok(r.ok && r.enlace.citaId === 77 && r.enlace.idTenant === T);
  });

  it("manipulado, truncado, con un carácter cambiado, de otra longitud, vacío o no-string: se rechaza", async () => {
    const { store, token } = await preparar();
    const cambiado = `${token.slice(0, 20)}${token[20] === "A" ? "B" : "A"}${token.slice(21)}`;
    for (const malo of [cambiado, token.slice(1), `${token}x`, token.toUpperCase() === token ? token.toLowerCase() : token.toUpperCase(), "", null, 77, "77", generarToken()]) {
      const r = await resolverEnlace(store, malo, AHORA, { log: sinLog });
      assert.equal(r.ok, false, String(malo));
    }
  });

  it("revocado o vencido: se rechaza; revocar es inmediato", async () => {
    const { store, token } = await preparar();
    const despues = new Date(Date.parse(FIN) + GRACIA_TRAS_LA_CITA_MS + 1);
    assert.deepEqual(await resolverEnlace(store, token, despues), { ok: false, motivo: "vencido" });
    await store.revocar(store.filas[0]!.id, AHORA.toISOString());
    assert.deepEqual(await resolverEnlace(store, token, AHORA), { ok: false, motivo: "revocado" });
  });

  it("un token bien formado pero inexistente no toca la base como si existiera: motivo no_existe; un fallo de la base no se confunde con 'válido'", async () => {
    const { store } = await preparar();
    assert.deepEqual(await resolverEnlace(store, generarToken(), AHORA), { ok: false, motivo: "no_existe" });
    const rota = { ...store, porHash: async () => Promise.reject(new Error("caída")) };
    assert.deepEqual(await resolverEnlace(rota, generarToken(), AHORA, { log: sinLog }), { ok: false, motivo: "error" });
  });
});

describe("el almacén de Supabase (consultas reales sobre una base en memoria)", () => {
  it("emite, reutiliza, resuelve por hash y revoca por los mismos caminos que el almacén en memoria", async () => {
    const tablas = { dulabs_cita_enlaces: [] as Record<string, unknown>[] };
    const supabase = crearSupabaseEnMemoria(tablas, { defaults: { dulabs_cita_enlaces: () => ({ revocado_at: null, ultimo_uso_at: null }) } });
    const store = createSupabaseEnlacesStore(supabase);
    const a = await obtenerOCrearEnlace(store, { idTenant: T, citaId: 12, citaFinISO: FIN }, { ahora: () => AHORA, log: sinLog });
    const b = await obtenerOCrearEnlace(store, { idTenant: T, citaId: 12, citaFinISO: FIN }, { ahora: () => AHORA, log: sinLog });
    assert.ok(a && b && a.token === b.token);
    assert.equal(tablas.dulabs_cita_enlaces.length, 1);
    assert.equal(tablas.dulabs_cita_enlaces[0]!.token_hash, hashDeToken(a.token));
    assert.ok(!JSON.stringify(tablas.dulabs_cita_enlaces).includes(a.token), "el token en claro nunca se guarda");
    const r = await resolverEnlace(store, a.token, AHORA);
    assert.ok(r.ok && r.enlace.citaId === 12);
    await store.registrarUso(r.ok ? r.enlace.id : "", AHORA.toISOString());
    assert.equal(tablas.dulabs_cita_enlaces[0]!.ultimo_uso_at, AHORA.toISOString());
    await store.revocar(r.ok ? r.enlace.id : "", AHORA.toISOString());
    assert.equal((await resolverEnlace(store, a.token, AHORA)).ok, false);
  });
});

void sinLog;
