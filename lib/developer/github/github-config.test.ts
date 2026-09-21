import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { obtenerGithubConfig, githubConfigurado, normalizarPrivateKey, urlInstalacionGithub } from "@/lib/developer/github/github-config";

const PEM = "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----\n";

const CLAVES = ["GITHUB_APP_ID", "GITHUB_APP_SLUG", "GITHUB_PRIVATE_KEY", "GITHUB_WEBHOOK_SECRET"] as const;
const previos: Record<string, string | undefined> = {};
function set(env: Partial<Record<(typeof CLAVES)[number], string | undefined>>) {
  for (const k of CLAVES) {
    if (!(k in previos)) previos[k] = process.env[k];
    const v = env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}
afterEach(() => {
  for (const k of CLAVES) {
    if (previos[k] === undefined) delete process.env[k];
    else process.env[k] = previos[k];
    delete previos[k];
  }
});

describe("obtenerGithubConfig / githubConfigurado", () => {
  it("devuelve config cuando las 4 variables están presentes", () => {
    set({ GITHUB_APP_ID: "123", GITHUB_APP_SLUG: "dulabs-dev", GITHUB_PRIVATE_KEY: PEM, GITHUB_WEBHOOK_SECRET: "s3cr3t" });
    const cfg = obtenerGithubConfig();
    assert.ok(cfg);
    assert.equal(cfg!.appId, "123");
    assert.equal(cfg!.appSlug, "dulabs-dev");
    assert.equal(cfg!.webhookSecret, "s3cr3t");
    assert.equal(githubConfigurado(), true);
  });

  it("devuelve null si falta cualquiera de las variables", () => {
    for (const faltante of CLAVES) {
      const base: Record<string, string> = { GITHUB_APP_ID: "1", GITHUB_APP_SLUG: "s", GITHUB_PRIVATE_KEY: PEM, GITHUB_WEBHOOK_SECRET: "x" };
      delete base[faltante];
      set({ ...base, [faltante]: undefined });
      assert.equal(obtenerGithubConfig(), null, `debe ser null sin ${faltante}`);
    }
  });

  it("devuelve null si la private key no parece un PEM", () => {
    set({ GITHUB_APP_ID: "1", GITHUB_APP_SLUG: "s", GITHUB_PRIVATE_KEY: "no-es-pem", GITHUB_WEBHOOK_SECRET: "x" });
    assert.equal(obtenerGithubConfig(), null);
  });
});

describe("normalizarPrivateKey", () => {
  it("convierte \\n escapados en saltos reales", () => {
    const escapada = "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----";
    assert.equal(normalizarPrivateKey(escapada), "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----");
  });
  it("deja intacta una key que ya trae saltos reales", () => {
    assert.equal(normalizarPrivateKey(PEM.trim()), PEM.trim());
  });
});

describe("urlInstalacionGithub", () => {
  it("arma la URL de instalación con el state escapado", () => {
    const url = urlInstalacionGithub("dulabs-dev", "abc 123");
    assert.equal(url, "https://github.com/apps/dulabs-dev/installations/new?state=abc%20123");
  });
});
