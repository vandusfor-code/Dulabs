/**
 * Enlaces del pie de página (enlaces.ts): lo que una dirección externa tiene que cumplir para poder ponerse en la tienda. Cada rechazo es una forma real de sacar a un cliente
 * hacia un sitio que no es el que parece (esquema distinto de https, usuario dentro de la dirección, dominio disfrazado, red local) o de esconder datos en un enlace.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { REDES_SOCIALES } from "@/lib/cms-comercial/contrato";
import { DOMINIOS_RED, esCorreoValido, esRedSocial, esTelefonoValido, esUrlHttpsSegura, hrefCorreo, hrefTelefono, MAX_LARGO_URL, perteneceARed, urlDesdeUsuario, usuarioDeRed } from "@/lib/cms-comercial/enlaces";

// Caracteres invisibles que ocultarían contenido dentro de una dirección (se escriben por su código para que se vean en el código fuente).
const ZWSP = String.fromCharCode(0x200b);
const RLO = String.fromCharCode(0x202e);

describe("esUrlHttpsSegura — qué dirección se puede poner en la tienda", () => {
  it("acepta direcciones https normales (con ruta, consulta y ancla)", () => {
    for (const url of ["https://www.instagram.com/delacour.joyeria", "https://delacour.co", "https://sub.dominio.com.co/ruta/larga?x=1&y=2#ancla", "HTTPS://WWW.EJEMPLO-TIENDA.COM/", "https://mi-tienda.co/politica-de-privacidad"]) {
      assert.equal(esUrlHttpsSegura(url), true, url);
    }
  });

  it("solo https: http, javascript:, data:, mailto:, rutas sin esquema y esquemas escondidos se rechazan", () => {
    for (const url of ["http://delacour.co", "javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>alert(1)</script>", "mailto:a@b.co", "//evil.com", "/ruta", "ftp://delacour.co", "delacour.co", "https:/delacour.co", "https:delacour.co", " https://delacour.co", "https://delacour.co "]) {
      assert.equal(esUrlHttpsSegura(url), false, url);
    }
  });

  it("sin usuario ni clave dentro de la dirección (https://instagram.com@sitio-malo.com lleva a sitio-malo.com), sin puertos y sin barras invertidas", () => {
    for (const url of ["https://instagram.com@sitio-malo.com", "https://usuario:clave@delacour.co", "https://delacour.co:8443/x", "https://delacour.co\\@evil.com", "https://evil.com\\.delacour.co"]) {
      assert.equal(esUrlHttpsSegura(url), false, url);
    }
  });

  it("nada de direcciones numéricas, de la red local ni de nombres sin punto (no son sitios públicos)", () => {
    for (const url of ["https://127.0.0.1/x", "https://10.0.0.5", "https://192.168.1.10/admin", "https://[::1]/", "https://[2001:db8::1]/", "https://localhost", "https://localhost:3000", "https://intranet", "https://servidor.local", "https://app.internal", "https://sitio.test", "https://x.example", "https://delacour.co."]) {
      assert.equal(esUrlHttpsSegura(url), false, url);
    }
  });

  it("rechaza los dominios con letras disfrazadas (punycode/IDN), que pueden imitar a otro", () => {
    for (const url of ["https://xn--delacour-9ya.co", "https://dominio.xn--p1ai", "https://аpple.com", "https://delacóur.co"]) {
      assert.equal(esUrlHttpsSegura(url), false, url);
    }
  });

  it("rechaza espacios, saltos de línea, caracteres de control o invisibles, lo demasiado largo y lo vacío", () => {
    for (const url of ["https://delacour.co/a b", "https://delacour.co/\n", "https://delacour.co/\u0000", "https://delacour.co/" + ZWSP, "https://delacour.co/" + RLO, "https://delacour.co/\t", ""]) {
      assert.equal(esUrlHttpsSegura(url), false, JSON.stringify(url));
    }
    assert.equal(esUrlHttpsSegura(`https://delacour.co/${"a".repeat(MAX_LARGO_URL)}`), false);
    assert.equal(esUrlHttpsSegura(`https://delacour.co/${"a".repeat(MAX_LARGO_URL - "https://delacour.co/".length)}`), true, "justo en el tope");
    assert.equal(esUrlHttpsSegura(undefined as unknown as string), false);
    assert.equal(esUrlHttpsSegura(42 as unknown as string), false);
  });
});

describe("perteneceARed — el dominio tiene que ser el de la red", () => {
  it("la propia red y sus subdominios sí", () => {
    assert.equal(perteneceARed("instagram", "https://instagram.com/delacour"), true);
    assert.equal(perteneceARed("instagram", "https://www.instagram.com/delacour"), true);
    assert.equal(perteneceARed("instagram", "https://m.instagram.com/delacour"), true);
    assert.equal(perteneceARed("tiktok", "https://vm.tiktok.com/ZM123/"), true);
    assert.equal(perteneceARed("x", "https://twitter.com/delacour"), true);
    assert.equal(perteneceARed("x", "https://x.com/delacour"), true);
    assert.equal(perteneceARed("whatsapp", "https://chat.whatsapp.com/ABC123"), true);
    assert.equal(perteneceARed("whatsapp", "https://wa.me/573001112233"), true);
    assert.equal(perteneceARed("telegram", "https://t.me/delacour"), true);
    assert.equal(perteneceARed("facebook", "https://fb.me/delacour"), true);
    assert.equal(perteneceARed("youtube", "https://youtu.be/abc"), true);
  });

  it("un dominio que solo CONTIENE el de la red, o que lo imita, no", () => {
    for (const url of ["https://instagram.com.evil.com/delacour", "https://evilinstagram.com/delacour", "https://notinstagram.com/delacour", "https://instagram.co/delacour", "https://evil.com/instagram.com", "https://evil.com/?u=instagram.com", "https://instagram-com.evil.co/x"]) {
      assert.equal(perteneceARed("instagram", url), false, url);
    }
  });

  it("una red no acepta el dominio de otra", () => {
    assert.equal(perteneceARed("tiktok", "https://instagram.com/delacour"), false);
    assert.equal(perteneceARed("facebook", "https://x.com/delacour"), false);
    assert.equal(perteneceARed("instagram", "no es una dirección"), false);
  });

  it("cada red de la lista cerrada tiene al menos un dominio y ninguno se repite entre redes", () => {
    const todos: string[] = [];
    for (const red of REDES_SOCIALES) {
      assert.ok(DOMINIOS_RED[red].length > 0, red);
      todos.push(...DOMINIOS_RED[red]);
    }
    assert.equal(new Set(todos).size, todos.length);
  });
});

describe("usuarioDeRed — el usuario que se muestra bajo los iconos", () => {
  it("Instagram, TikTok, X y YouTube con perfil", () => {
    assert.equal(usuarioDeRed("instagram", "https://www.instagram.com/delacour.joyeria/"), "@delacour.joyeria");
    assert.equal(usuarioDeRed("instagram", "https://instagram.com/delacour?igsh=abc"), "@delacour");
    assert.equal(usuarioDeRed("tiktok", "https://www.tiktok.com/@delacour"), "@delacour");
    assert.equal(usuarioDeRed("x", "https://x.com/delacour"), "@delacour");
    assert.equal(usuarioDeRed("youtube", "https://www.youtube.com/@delacour"), "@delacour");
  });

  it("lo que no es un perfil (una publicación, un video, un canal sin @) no inventa un usuario", () => {
    assert.equal(usuarioDeRed("instagram", "https://instagram.com/p/ABC123/"), null);
    assert.equal(usuarioDeRed("instagram", "https://instagram.com/reel/ABC123/"), null);
    assert.equal(usuarioDeRed("instagram", "https://instagram.com/"), null);
    assert.equal(usuarioDeRed("tiktok", "https://www.tiktok.com/delacour"), null);
    assert.equal(usuarioDeRed("youtube", "https://www.youtube.com/channel/UC123"), null);
    assert.equal(usuarioDeRed("x", "https://x.com/i/flow/login"), null);
    assert.equal(usuarioDeRed("facebook", "https://facebook.com/delacour"), null);
    assert.equal(usuarioDeRed("linkedin", "https://linkedin.com/company/delacour"), null);
    assert.equal(usuarioDeRed("instagram", "https://tiktok.com/@delacour"), null, "una dirección de otra red no se interpreta");
    assert.equal(usuarioDeRed("instagram", "no es una dirección"), null);
  });
});

describe("urlDesdeUsuario — escribir solo el usuario", () => {
  it("convierte «@usuario» o «usuario» en la dirección del perfil", () => {
    assert.equal(urlDesdeUsuario("instagram", "@delacour.joyeria"), "https://instagram.com/delacour.joyeria");
    assert.equal(urlDesdeUsuario("instagram", "delacour.joyeria"), "https://instagram.com/delacour.joyeria");
    assert.equal(urlDesdeUsuario("tiktok", "@delacour"), "https://tiktok.com/@delacour");
    assert.equal(urlDesdeUsuario("x", "delacour"), "https://x.com/delacour");
    assert.equal(urlDesdeUsuario("youtube", "@delacour"), "https://youtube.com/@delacour");
    assert.equal(urlDesdeUsuario("facebook", "delacour"), "https://facebook.com/delacour");
    assert.equal(urlDesdeUsuario("telegram", "@delacour"), "https://t.me/delacour");
  });

  it("una dirección completa se deja tal cual (la revisa el esquema)", () => {
    assert.equal(urlDesdeUsuario("instagram", "https://instagram.com/otra"), "https://instagram.com/otra");
    assert.equal(urlDesdeUsuario("instagram", "  https://instagram.com/otra  "), "https://instagram.com/otra");
    assert.equal(urlDesdeUsuario("instagram", "http://instagram.com/otra"), "http://instagram.com/otra", "se devuelve igual: el esquema la rechazará por no ser https");
  });

  it("lo que no se puede deducir devuelve null (usuario con caracteres raros, redes que piden la dirección completa, vacío)", () => {
    assert.equal(urlDesdeUsuario("instagram", "mi usuario"), null);
    assert.equal(urlDesdeUsuario("instagram", "a/b"), null);
    assert.equal(urlDesdeUsuario("instagram", "@"), null);
    assert.equal(urlDesdeUsuario("instagram", ""), null);
    assert.equal(urlDesdeUsuario("instagram", "   "), null);
    assert.equal(urlDesdeUsuario("whatsapp", "delacour"), null);
    assert.equal(urlDesdeUsuario("linkedin", "delacour"), null);
    assert.equal(urlDesdeUsuario("instagram", "x".repeat(41)), null);
  });
});

describe("teléfono y correo", () => {
  it("un teléfono válido lleva entre 7 y 15 dígitos y solo símbolos de teléfono", () => {
    for (const t of ["+57 300 123 4567", "3001234567", "(601) 234 5678", "+57 (1) 234-5678", "300.123.4567", "+1 202 555 0143"]) assert.equal(esTelefonoValido(t), true, t);
    for (const t of ["123", "abc", "300 123 abc", "+57 300 123 4567 ext 12", "1234567890123456", "++573001234567", "300-<script>", ""]) assert.equal(esTelefonoValido(t), false, t);
  });

  it("el enlace de teléfono lleva solo dígitos y un + inicial", () => {
    assert.equal(hrefTelefono("+57 300 123 4567"), "tel:+573001234567");
    assert.equal(hrefTelefono("(601) 234 5678"), "tel:6012345678");
    assert.equal(hrefTelefono("300.123.4567"), "tel:3001234567");
  });

  it("un correo válido tiene una arroba, un dominio con punto y nada raro", () => {
    for (const c of ["info@delacour.co", "ventas.mayor@delacour-joyeria.com.co", "a+b@sub.dominio.org"]) assert.equal(esCorreoValido(c), true, c);
    for (const c of ["info", "info@", "@delacour.co", "info@delacour", "info@@delacour.co", "info @delacour.co", "info@delacour.co\n", "<b>@delacour.co", "a@b.c", `${"a".repeat(120)}@delacour.co`]) assert.equal(esCorreoValido(c), false, JSON.stringify(c));
    assert.equal(hrefCorreo("info@delacour.co"), "mailto:info@delacour.co");
  });

  it("esRedSocial reconoce solo las de la lista cerrada", () => {
    for (const r of REDES_SOCIALES) assert.equal(esRedSocial(r), true);
    for (const r of ["myspace", "", null, undefined, 3, "Instagram"]) assert.equal(esRedSocial(r), false, String(r));
  });
});
