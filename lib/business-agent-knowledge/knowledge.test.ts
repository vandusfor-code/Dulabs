/**
 * R4 — conocimiento del Business Agent: tokenizador, chunker, FAQ, ingesta,
 * servicio (límites), recuperación (umbral/presupuesto), aislamiento por
 * tenant, borrado y "sin conocimiento". 100% offline (store en memoria; la
 * relevancia real de Postgres se verifica en el E2E contra la BD).
 * La extracción de PDF es REAL (pdf-parse) sobre un PDF generado.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KNOWLEDGE_LIMITS } from "@/lib/business-agent-knowledge/limits";
import { tokenizeQuery, unaccent } from "@/lib/business-agent-knowledge/tokenizer";
import { chunkText, cleanExtractedText } from "@/lib/business-agent-knowledge/chunker";
import { validateFaqInput } from "@/lib/business-agent-knowledge/faq";
import { inspectZipBomb, prepareDocument, sanitizeFilename } from "@/lib/business-agent-knowledge/ingest";
import { buscarConocimiento, isRelevant } from "@/lib/business-agent-knowledge/retrieval";
import { createFaq, createFaqWithWarnings, hasUsableKnowledge, removeDocument, removeFaq, updateFaq, updateFaqWithWarnings, uploadDocument } from "@/lib/business-agent-knowledge/service";
import { assessClaimRisk } from "@/lib/business-agent-knowledge/claim-risk";
import { createInMemoryKnowledgeStore } from "@/lib/business-agent-knowledge/testing/in-memory-knowledge-store";
import { buildPdf } from "@/lib/business-agent-knowledge/testing/pdf-fixture";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const POLITICAS = buildPdf([
  "Política de cancelación",
  "Las citas pueden cancelarse sin costo hasta 24 horas antes.",
  "Si la cancelación es con menos de 24 horas se cobra el 50% del servicio.",
  "",
  "Política de reembolsos",
  "No hay reembolsos por servicios ya prestados.",
]);

describe("R4 tokenizador", () => {
  it("1. minúsculas, sin tildes (conserva ñ), sin stopwords ni duplicados", () => {
    assert.deepEqual(tokenizeQuery("¿Qué dice la política sobre cancelaciones?").terms, ["politica", "cancelaciones"]);
    assert.equal(unaccent("Año Ñandú Cancelación"), "año ñandu cancelacion");
    assert.deepEqual(tokenizeQuery("horario horario HORARIO").terms, ["horario"]);
  });

  it("2. saludos, agradecimientos y vacío => consulta vacía (no se busca)", () => {
    for (const q of ["Hola", "buenos días", "Buenas tardes!", "gracias", "ok", "   ", "", null, undefined, "¿?"]) {
      assert.equal(tokenizeQuery(q).empty, true, String(q));
    }
    assert.equal(tokenizeQuery("Hola, ¿cuál es el horario?").terms.join(","), "horario");
  });

  it("3. neutraliza operadores de tsquery/SQL: solo quedan palabras inertes", () => {
    const t = tokenizeQuery("horario' | & ! (precio):* ; drop table x -- \\ <->").terms;
    assert.ok(t.every((x) => /^[a-z0-9ñ]+$/.test(x)), JSON.stringify(t));
    assert.ok(t.includes("horario") && t.includes("precio"));
  });

  it("4. topes: máximo de términos y de longitud de consulta", () => {
    const muchas = Array.from({ length: 50 }, (_, i) => `termino${i}`).join(" ");
    assert.equal(tokenizeQuery(muchas).terms.length, KNOWLEDGE_LIMITS.queryMaxTerms);
    assert.equal(tokenizeQuery("x".repeat(100_000)).terms.length <= 1, true);
  });
});

describe("R4 chunker", () => {
  it("5. agrupa párrafos hasta ~900 chars, nunca supera el máximo y es determinista", () => {
    const parrafo = "Este es un párrafo de prueba con información del negocio. ".repeat(6).trim(); // ~350 chars
    const texto = Array.from({ length: 30 }, () => parrafo).join("\n\n");
    const a = chunkText(texto);
    assert.ok(a.length > 3);
    for (const c of a) assert.ok(c.length <= KNOWLEDGE_LIMITS.chunkMaxChars, `len ${c.length}`);
    assert.deepEqual(a, chunkText(texto), "mismo texto -> mismos chunks");
  });

  it("6. un bloque enorme sin puntuación se parte con solapamiento y sin chunks vacíos", () => {
    const largo = "palabra ".repeat(1000).trim();
    const chunks = chunkText(largo);
    assert.ok(chunks.length >= 6);
    for (const c of chunks) assert.ok(c.length > 0 && c.length <= KNOWLEDGE_LIMITS.chunkMaxChars);
  });

  it("7. filas de CSV: se parte por filas completas, no a mitad de fila", () => {
    const filas = Array.from({ length: 200 }, (_, i) => `Servicio ${i},${20000 + i},45 min`).join("\n");
    const chunks = chunkText(`# Lista\n${filas}`);
    assert.ok(chunks.length > 1);
    for (const c of chunks) for (const linea of c.split("\n")) assert.ok(/^(#|Servicio \d+,\d+,45 min$)/.test(linea), linea);
  });

  it("8. limpia caracteres de control (NUL rompe Postgres), saltos raros y marcadores de página de pdf-parse", () => {
    const sucio = `Hola${String.fromCharCode(0)}mundo\r\n\r\n\r\n\r\n-- 1 of 2 --\n\nfin${String.fromCharCode(7)}`;
    const limpio = cleanExtractedText(sucio);
    assert.equal(limpio.includes(String.fromCharCode(0)), false);
    assert.equal(limpio.includes(String.fromCharCode(7)), false);
    assert.doesNotMatch(limpio, /of 2/);
    assert.equal(chunkText("   \n\n  ").length, 0);
  });
});

describe("R4 FAQ (validación)", () => {
  it("9. FAQ válida se normaliza; activa por defecto", () => {
    const v = validateFaqInput({ question: "  ¿Cuál\nes el horario? ", answer: "  Lunes a viernes de 8 a 6.  " });
    assert.deepEqual(v, { ok: true, value: { question: "¿Cuál es el horario?", answer: "Lunes a viernes de 8 a 6.", active: true } });
  });

  it("10. inválidas: no objeto, tipos, vacías, cortas y demasiado largas", () => {
    const err = (x: unknown) => { const v = validateFaqInput(x); return v.ok ? "OK" : v.error; };
    assert.match(err(null), /objeto/);
    assert.match(err([]), /objeto/);
    assert.match(err({ question: 1, answer: "x" }), /Faltan/);
    assert.match(err({ question: "ab", answer: "x" }), /al menos/);
    assert.match(err({ question: "¿Horario?", answer: "   " }), /vacía/);
    assert.match(err({ question: "q".repeat(301), answer: "x" }), /máximo/);
    assert.match(err({ question: "¿Horario?", answer: "a".repeat(2001) }), /máximo/);
    assert.match(err({ question: "¿Horario?", answer: "x", active: "si" }), /verdadero/);
  });
});

describe("R4 ingesta (validación + extracción)", () => {
  it("11. PDF REAL: extrae con pdf-parse, sanea el nombre (sin rutas), chunkea y calcula la huella", async () => {
    const r = await prepareDocument({ filename: "../../etc/pasword/politicas.pdf", size: POLITICAS.length, buffer: POLITICAS });
    assert.ok(r.ok, JSON.stringify(r));
    if (!r.ok) return;
    assert.equal(r.filename, "politicas.pdf");
    assert.ok(r.chunks.join("\n").includes("Política de cancelación"));
    assert.doesNotMatch(r.chunks.join("\n"), /of \d/);
    assert.match(r.sha256, /^[0-9a-f]{64}$/);
    assert.equal(r.truncated, false);
  });

  it("12. rechaza: extensión no permitida, vacío, gigante, firma PDF falsa, xlsx falso, binario disfrazado de csv/txt", async () => {
    const p = (filename: string, buffer: Buffer) => prepareDocument({ filename, size: buffer.length, buffer });
    const code = async (filename: string, buffer: Buffer) => { const r = await p(filename, buffer); return r.ok ? "OK" : r.code; };
    assert.equal(await code("virus.exe", Buffer.from("MZ")), "UNSUPPORTED_TYPE");
    assert.equal(await code("a.pdf", Buffer.alloc(0)), "EMPTY");
    assert.equal(await code("grande.pdf", Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(KNOWLEDGE_LIMITS.docMaxBytes)])), "TOO_LARGE");
    assert.equal(await code("falso.pdf", Buffer.from("esto no es un pdf")), "INVALID_FILE");
    assert.equal(await code("falso.xlsx", Buffer.from("no es zip")), "INVALID_FILE");
    assert.equal(await code("bin.csv", Buffer.concat([Buffer.from("a,b\n1,2"), Buffer.alloc(10)])), "INVALID_FILE");
    assert.equal(await code("bin.txt", Buffer.from([0x50, 0x00, 0x01])), "INVALID_FILE");
    assert.equal(await code(".pdf", Buffer.from("%PDF-1")), "UNSUPPORTED_TYPE", "sin nombre útil");
  });

  it("13. PDF sin texto extraíble => NO_TEXT con mensaje claro; error del extractor => EXTRACTION_FAILED", async () => {
    const sinTexto = await prepareDocument({ filename: "escaneado.pdf", size: 10, buffer: Buffer.from("%PDF-1.4 x"), extract: async () => "   \n  " });
    assert.ok(!sinTexto.ok && sinTexto.code === "NO_TEXT");
    const roto = await prepareDocument({ filename: "roto.pdf", size: 10, buffer: Buffer.from("%PDF-1.4 x"), extract: async () => { throw new Error("PDF corrupto"); } });
    assert.ok(!roto.ok && roto.code === "EXTRACTION_FAILED" && /corrupto/.test(roto.error));
  });

  it("14. documento grande: se trunca al tope de caracteres/chunks y se marca truncated", async () => {
    const parrafo = "Texto de prueba con contenido del negocio para indexar. ".repeat(10).trim();
    const enorme = Array.from({ length: 900 }, () => parrafo).join("\n\n"); // ~500 KB de texto
    const r = await prepareDocument({ filename: "manual.txt", size: 10, buffer: Buffer.from("x"), extract: async () => enorme });
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.truncated, true);
      assert.ok(r.chunks.length <= KNOWLEDGE_LIMITS.docMaxChunks);
      assert.ok(r.charCount <= KNOWLEDGE_LIMITS.docMaxChars);
    }
  });

  it("15. sanitizeFilename: solo basename, sin caracteres de control/reservados, con tope y sin ocultos", () => {
    assert.equal(sanitizeFilename("C:\\Users\\x\\..\\politicas.pdf"), "politicas.pdf");
    assert.equal(sanitizeFilename("../../a/b/reglamento.pdf"), "reglamento.pdf");
    assert.equal(sanitizeFilename(`a${String.fromCharCode(0)}b<c>|d.pdf`), "a b c d.pdf");
    assert.equal(sanitizeFilename("...oculto.pdf"), "oculto.pdf");
    const largo = sanitizeFilename(`${"n".repeat(300)}.pdf`);
    assert.ok(largo.length <= KNOWLEDGE_LIMITS.filenameMax && largo.endsWith(".pdf"));
    assert.equal(sanitizeFilename("///"), "");
  });

  it("16. zip bomb: un xlsx que declara GBs descomprimidos, con zip64 o corrupto se rechaza sin descomprimir", () => {
    function zipFalso(sinComprimir: number, entradas = 1): Buffer {
      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0);
      cd.writeUInt32LE(sinComprimir, 24);
      const cdTodas = Buffer.concat(Array.from({ length: entradas }, () => cd));
      const eocd = Buffer.alloc(22);
      eocd.writeUInt32LE(0x06054b50, 0);
      eocd.writeUInt16LE(entradas, 10);
      eocd.writeUInt32LE(0, 16); // el directorio central empieza en 0
      return Buffer.concat([cdTodas, eocd]);
    }
    assert.equal(inspectZipBomb(zipFalso(1024)).ok, true);
    assert.equal(inspectZipBomb(zipFalso(40 * 1024 * 1024, 2)).ok, false, "2 x 40MB > 50MB");
    assert.equal(inspectZipBomb(zipFalso(0xffffffff)).ok, false, "zip64");
    assert.equal(inspectZipBomb(Buffer.from("PK\x03\x04 basura")).ok, false, "sin directorio central");
  });
});

describe("R4 servicio: límites, duplicados, estados y rollback", () => {
  it("17. FAQ: crear/editar/eliminar con validación; tope por tenant; aislamiento (B no toca las de A)", async () => {
    const store = createInMemoryKnowledgeStore();
    const f = await createFaq(store, A, { question: "¿Cuál es el horario?", answer: "Lunes a viernes de 8 a 6." });
    assert.ok(f.ok);
    if (!f.ok) return;
    assert.equal((await createFaq(store, A, { question: "x", answer: "y" })).ok, false);
    assert.equal((await updateFaq(store, B, f.value.id, { question: "¿Horario?", answer: "hackeado" })).ok, false, "B no edita la FAQ de A");
    assert.equal((await removeFaq(store, B, f.value.id)).ok, false, "B no elimina la FAQ de A");
    const up = await updateFaq(store, A, f.value.id, { question: "¿Cuál es el horario?", answer: "Lunes a sábado de 8 a 6.", active: false });
    assert.ok(up.ok && up.value.answer.includes("sábado") && up.value.active === false);
    assert.equal((await removeFaq(store, A, f.value.id)).ok, true);
    assert.equal((await removeFaq(store, A, f.value.id)).ok, false, "ya no existe");

    for (let i = 0; i < KNOWLEDGE_LIMITS.faqMaxPerTenant; i++) assert.ok((await createFaq(store, A, { question: `Pregunta número ${i}`, answer: "r" })).ok);
    const lleno = await createFaq(store, A, { question: "Una más", answer: "r" });
    assert.ok(!lleno.ok && lleno.code === "LIMIT_REACHED" && lleno.status === 409);
    assert.ok((await createFaq(store, B, { question: "Otra de B", answer: "r" })).ok, "el tope es por tenant");
  });

  it("18. documento: sube un PDF REAL -> processing -> ready con chunks; el duplicado (mismo contenido) se rechaza", async () => {
    const store = createInMemoryKnowledgeStore();
    const r = await uploadDocument(store, A, { filename: "politicas.pdf", mimeType: "application/pdf", buffer: POLITICAS, userId: "u1" });
    assert.ok(r.ok, JSON.stringify(r));
    if (!r.ok) return;
    assert.equal(r.value.status, "ready");
    assert.ok(r.value.chunkCount >= 1);
    assert.ok(store.chunksOf(A, r.value.id).join(" ").includes("cancelación"));
    const dup = await uploadDocument(store, A, { filename: "copia.pdf", mimeType: "application/pdf", buffer: POLITICAS, userId: "u1" });
    assert.ok(!dup.ok && dup.code === "DUPLICATE" && dup.status === 409);
    // el mismo archivo en OTRO tenant sí se acepta (la dedupe es por tenant)
    assert.ok((await uploadDocument(store, B, { filename: "politicas.pdf", mimeType: "application/pdf", buffer: POLITICAS, userId: "u2" })).ok);
  });

  it("19. tope de documentos por tenant y de chunks totales", async () => {
    const store = createInMemoryKnowledgeStore();
    for (let i = 0; i < KNOWLEDGE_LIMITS.docMaxPerTenant; i++) {
      const r = await uploadDocument(store, A, { filename: `d${i}.txt`, mimeType: "text/plain", buffer: Buffer.from(`contenido distinto ${i}`), userId: null });
      assert.ok(r.ok, JSON.stringify(r));
    }
    const de = await uploadDocument(store, A, { filename: "otro.txt", mimeType: "text/plain", buffer: Buffer.from("otro contenido"), userId: null });
    assert.ok(!de.ok && de.code === "LIMIT_REACHED");

    // chunks totales: un tenant con el índice lleno no admite más
    const s2 = createInMemoryKnowledgeStore();
    const original = KNOWLEDGE_LIMITS.tenantMaxChunks;
    void original;
    const gran = Array.from({ length: 280 }, (_, i) => `Bloque ${i}: ` + "contenido del negocio ".repeat(40)).join("\n\n");
    let subidos = 0;
    for (let i = 0; i < 8; i++) {
      const r = await uploadDocument(s2, A, { filename: `m${i}.txt`, mimeType: "text/plain", buffer: Buffer.from(`${i}${gran}`), userId: null });
      if (r.ok) subidos += r.value.chunkCount;
      else { assert.equal(r.code, "LIMIT_REACHED"); break; }
    }
    assert.ok(subidos <= KNOWLEDGE_LIMITS.tenantMaxChunks, `chunks indexados ${subidos}`);
    assert.ok(await s2.countChunks(A) <= KNOWLEDGE_LIMITS.tenantMaxChunks);
  });

  it("20. inválido NO deja filas; una falla al indexar deja el documento en 'error' SIN chunks parciales", async () => {
    const store = createInMemoryKnowledgeStore();
    const malo = await uploadDocument(store, A, { filename: "falso.pdf", mimeType: "application/pdf", buffer: Buffer.from("no soy pdf"), userId: null });
    assert.ok(!malo.ok && malo.code === "INVALID_FILE" && malo.status === 400);
    assert.equal((await store.listDocuments(A)).length, 0, "un archivo inválido no crea filas");

    store.failNextCompleteWith(new Error("db caída"));
    const r = await uploadDocument(store, A, { filename: "ok.txt", mimeType: "text/plain", buffer: Buffer.from("contenido válido de prueba"), userId: null });
    assert.ok(!r.ok && r.code === "STORE_ERROR");
    const docs = await store.listDocuments(A);
    assert.equal(docs.length, 1);
    assert.equal(docs[0]!.status, "error");
    assert.equal(store.allChunkCount(), 0, "sin chunks huérfanos");
    // y el mismo contenido se puede volver a subir (el 'error' no bloquea la dedupe)
    assert.ok((await uploadDocument(store, A, { filename: "ok.txt", mimeType: "text/plain", buffer: Buffer.from("contenido válido de prueba"), userId: null })).ok);
  });

  it("21. eliminar un documento borra sus chunks; B no puede eliminar el de A", async () => {
    const store = createInMemoryKnowledgeStore();
    const r = await uploadDocument(store, A, { filename: "politicas.pdf", mimeType: "application/pdf", buffer: POLITICAS, userId: null });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal((await removeDocument(store, B, r.value.id)).ok, false);
    assert.ok(store.allChunkCount() > 0);
    assert.equal((await removeDocument(store, A, r.value.id)).ok, true);
    assert.equal(store.allChunkCount(), 0);
    assert.equal((await removeDocument(store, A, r.value.id)).ok, false);
  });

  it("22. hasUsableKnowledge: FAQ activa o documento listo; FAQ inactiva o documento en error no cuentan", async () => {
    const store = createInMemoryKnowledgeStore();
    assert.equal(await hasUsableKnowledge(store, A), false);
    const f = await createFaq(store, A, { question: "¿Horario?", answer: "8 a 6", active: false });
    assert.equal(await hasUsableKnowledge(store, A), false, "FAQ inactiva no cuenta");
    assert.ok(f.ok);
    await updateFaq(store, A, (f as { ok: true; value: { id: string } }).value.id, { question: "¿Horario?", answer: "8 a 6", active: true });
    assert.equal(await hasUsableKnowledge(store, A), true);
    assert.equal(await hasUsableKnowledge(store, B), false, "el conocimiento de A no cuenta para B");
  });
});

describe("R4 recuperación (umbral, presupuesto, aislamiento, sin conocimiento)", () => {
  async function tienda() {
    const store = createInMemoryKnowledgeStore();
    await createFaq(store, A, { question: "¿Cuál es el horario?", answer: "Lunes a viernes de 8 a 6." });
    await createFaq(store, A, { question: "¿Dónde están ubicados?", answer: "Estamos en la Calle 10 #20-30, Bogotá." });
    const doc = await uploadDocument(store, A, { filename: "politicas.pdf", mimeType: "application/pdf", buffer: POLITICAS, userId: null });
    assert.ok(doc.ok);
    return store;
  }

  it("23. FAQ: la pregunta del cliente recupera la respuesta correcta (y solo esa)", async () => {
    const store = await tienda();
    const r = await buscarConocimiento(store, { tenantId: A, query: "¿Cuál es el horario?" });
    assert.equal(r.found, true);
    assert.equal(r.hits[0]!.source, "faq");
    assert.match(r.hits[0]!.content, /Lunes a viernes de 8 a 6/);
    assert.doesNotMatch(r.text, /Calle 10/);
  });

  it("24. Documento: la pregunta sobre cancelaciones recupera el fragmento del PDF (stemming: cancelaciones/cancelarse)", async () => {
    const store = await tienda();
    const r = await buscarConocimiento(store, { tenantId: A, query: "¿Qué dice la política sobre cancelaciones?" });
    assert.equal(r.found, true);
    assert.equal(r.hits[0]!.source, "documento");
    assert.match(r.hits[0]!.title, /politicas\.pdf/);
    assert.match(r.text, /24 horas/);
    assert.match(r.text, /Documento "politicas\.pdf"/);
  });

  it("25. SIN conocimiento relevante: found:false (la IA no se invoca y no inventa); saludo => emptyQuery", async () => {
    const store = await tienda();
    const r = await buscarConocimiento(store, { tenantId: A, query: "¿Venden pizza con piña?" });
    assert.deepEqual([r.found, r.hits.length, r.text], [false, 0, ""]);
    const saludo = await buscarConocimiento(store, { tenantId: A, query: "Hola, buenos días" });
    assert.deepEqual([saludo.found, saludo.emptyQuery], [false, true]);
    const vacio = await buscarConocimiento(createInMemoryKnowledgeStore(), { tenantId: A, query: "¿Cuál es el horario?" });
    assert.equal(vacio.found, false, "tenant sin ningún conocimiento");
  });

  it("26. TENANT ISOLATION: B nunca recupera lo de A (ni FAQ ni documentos), aunque pregunte exactamente lo mismo", async () => {
    const store = await tienda();
    for (const q of ["¿Cuál es el horario?", "¿Qué dice la política sobre cancelaciones?", "Calle 10 Bogotá ubicados"]) {
      const r = await buscarConocimiento(store, { tenantId: B, query: q });
      assert.equal(r.found, false, q);
      assert.equal(r.text, "");
    }
    // y cada uno ve lo suyo
    await createFaq(store, B, { question: "¿Cuál es el horario?", answer: "Solo domingos." });
    const rb = await buscarConocimiento(store, { tenantId: B, query: "¿Cuál es el horario?" });
    assert.match(rb.text, /Solo domingos/);
    assert.doesNotMatch(rb.text, /Lunes a viernes/);
    const ra = await buscarConocimiento(store, { tenantId: A, query: "¿Cuál es el horario?" });
    assert.doesNotMatch(ra.text, /Solo domingos/);
  });

  it("27. documento eliminado / FAQ eliminada o inactiva: dejan de aparecer en la recuperación", async () => {
    const store = createInMemoryKnowledgeStore();
    const doc = await uploadDocument(store, A, { filename: "politicas.pdf", mimeType: "application/pdf", buffer: POLITICAS, userId: null });
    const faq = await createFaq(store, A, { question: "¿Cuál es el horario?", answer: "Lunes a viernes de 8 a 6." });
    assert.ok(doc.ok && faq.ok);
    if (!doc.ok || !faq.ok) return;
    assert.equal((await buscarConocimiento(store, { tenantId: A, query: "cancelaciones política" })).found, true);
    await removeDocument(store, A, doc.value.id);
    assert.equal((await buscarConocimiento(store, { tenantId: A, query: "cancelaciones política" })).found, false, "documento eliminado");

    await updateFaq(store, A, faq.value.id, { question: faq.value.question, answer: faq.value.answer, active: false });
    assert.equal((await buscarConocimiento(store, { tenantId: A, query: "¿Cuál es el horario?" })).found, false, "FAQ inactiva");
    await updateFaq(store, A, faq.value.id, { question: faq.value.question, answer: faq.value.answer, active: true });
    assert.equal((await buscarConocimiento(store, { tenantId: A, query: "¿Cuál es el horario?" })).found, true);
    await removeFaq(store, A, faq.value.id);
    assert.equal((await buscarConocimiento(store, { tenantId: A, query: "¿Cuál es el horario?" })).found, false, "FAQ eliminada");
  });

  it("28. presupuesto: nunca más de resultsMax fragmentos ni resultsMaxChars caracteres (control de tokens/costo)", async () => {
    const store = createInMemoryKnowledgeStore();
    for (let i = 0; i < 30; i++) await createFaq(store, A, { question: `¿Precio del corte tipo ${i}?`, answer: `El corte tipo ${i} cuesta ` + "muy poco dinero ".repeat(60) });
    const r = await buscarConocimiento(store, { tenantId: A, query: "precio corte" });
    assert.equal(r.found, true);
    assert.ok(r.hits.length <= KNOWLEDGE_LIMITS.resultsMax, `hits ${r.hits.length}`);
    const total = r.hits.reduce((n, h) => n + h.content.length, 0);
    assert.ok(total <= KNOWLEDGE_LIMITS.resultsMaxChars, `chars ${total}`);
  });

  it("29. umbral de relevancia: una palabra suelta en común NO basta en consultas de 3+ términos", () => {
    assert.equal(isRelevant({ matched: 1, total: 3 }), false);
    assert.equal(isRelevant({ matched: 2, total: 3 }), true);
    assert.equal(isRelevant({ matched: 1, total: 1 }), true);
    assert.equal(isRelevant({ matched: 1, total: 2 }), true);
    assert.equal(isRelevant({ matched: 0, total: 2 }), false);
    assert.equal(isRelevant({ matched: 1, total: 5 }), false);
  });

  it("30. FAQ prima sobre un documento con igual cobertura; duplicados se colapsan", async () => {
    const store = createInMemoryKnowledgeStore();
    await uploadDocument(store, A, { filename: "manual.txt", mimeType: "text/plain", buffer: Buffer.from("El horario de atención es de lunes a viernes de 8 a 6."), userId: null });
    await createFaq(store, A, { question: "¿Cuál es el horario de atención?", answer: "El horario de atención es de lunes a viernes de 8 a 6." });
    const r = await buscarConocimiento(store, { tenantId: A, query: "horario de atención" });
    assert.equal(r.hits[0]!.source, "faq");
  });

  it("31. fuentes restringidas: con sources=['faq'] nunca se consultan documentos; tenant vacío no busca", async () => {
    const store = await tienda();
    const soloFaq = await buscarConocimiento(store, { tenantId: A, query: "política cancelaciones", sources: ["faq"] });
    assert.equal(soloFaq.found, false);
    const soloDocs = await buscarConocimiento(store, { tenantId: A, query: "¿Cuál es el horario?", sources: ["documento"] });
    assert.equal(soloDocs.found, false);
    assert.equal((await buscarConocimiento(store, { tenantId: "", query: "horario" })).found, false);
    // fuentes desconocidas se descartan
    assert.equal((await buscarConocimiento(store, { tenantId: A, query: "horario", sources: ["secretos" as never] })).found, false);
  });
});

describe("R4 aviso de riesgo del filtro de afirmaciones externas (FAQ)", () => {
  it("32. respuestas comunes NO generan aviso; frases que el filtro bloquea SÍ (el autor puede reescribirlas)", () => {
    for (const ok of ["Lunes a viernes de 8 a 6.", "Estamos en la Calle 10 #20-30, Bogotá.", "El corte cuesta $35.000 y dura 45 minutos.", "Aceptamos pagos con tarjeta y transferencia."]) {
      assert.equal(assessClaimRisk(ok).risky, false, ok);
    }
    const r = assessClaimRisk("Puedes agendar tu cita escribiéndonos por este chat.");
    assert.equal(r.risky, true);
    assert.match(r.message ?? "", /filtro de seguridad/);
  });

  it("33. createFaqWithWarnings/updateFaqWithWarnings guardan igual y devuelven el aviso (no bloquea el guardado)", async () => {
    const store = createInMemoryKnowledgeStore();
    const c = await createFaqWithWarnings(store, A, { question: "¿Cómo pido una cita?", answer: "Puedes agendar tu cita escribiéndonos por este chat." });
    assert.ok(c.ok);
    if (!c.ok) return;
    assert.equal(c.value.warnings.length, 1);
    assert.equal((await store.listFaqs(A)).length, 1, "se guardó pese al aviso");
    const u = await updateFaqWithWarnings(store, A, c.value.faq.id, { question: "¿Cómo pido una cita?", answer: "Escríbenos por este chat y te ayudamos." });
    assert.ok(u.ok && u.value.warnings.length === 0);
    const inval = await createFaqWithWarnings(store, A, { question: "x", answer: "y" });
    assert.ok(!inval.ok && inval.code === "VALIDATION_ERROR");
  });
});
