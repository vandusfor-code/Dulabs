import Link from "next/link";
import { CodeSample } from "@/components/developers/CodeSample";
import { OPENAPI_BASE_URL } from "@/lib/developers/openapi";

const ME_CURL = `curl ${OPENAPI_BASE_URL}/me \\
  -H "Authorization: Bearer dl_live_tu_api_key"`;

const ME_JS = `const res = await fetch("${OPENAPI_BASE_URL}/me", {
  headers: { Authorization: \`Bearer \${process.env.DULABS_API_KEY}\` },
});
const me = await res.json(); // { workspaceId, apiKeyId, apiKeyPrefix, apiKeyName }`;

export default function AuthenticationPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold text-fg">Autenticación</h1>
      <p className="mt-3 text-sm text-mist">
        Toda petición se autentica con una API key enviada como Bearer token:
      </p>
      <pre className="my-3 overflow-x-auto rounded-lg border border-edge bg-ink p-3 text-[12px] text-fg"><code>Authorization: Bearer dl_live_…</code></pre>

      <h2 className="mt-8 text-lg font-semibold text-fg">API keys</h2>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-mist">
        <li>Créalas y revócalas en el <Link href="/developer/api-keys" className="text-dev-accent hover:underline">dashboard → API Keys</Link> (OWNER/ADMIN).</li>
        <li>Prefijo <code className="text-fg">dl_live_</code>. Se muestran <strong>una sola vez</strong>: guárdalas de forma segura (nunca en el cliente ni en el repo).</li>
        <li>Cada key pertenece a un workspace; las operaciones se limitan a ese workspace (aislamiento por tenant).</li>
        <li>Rótala si se filtra: crea una nueva y revoca la anterior.</li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold text-fg">Verificar la key</h2>
      <p className="mt-2 text-sm text-mist"><code className="text-fg">GET /me</code> confirma que la key funciona y a qué workspace pertenece (nunca devuelve la key completa).</p>
      <CodeSample curl={ME_CURL} js={ME_JS} titulo="GET /me" />

      <p className="mt-6 text-xs text-mist">Sin key válida: <code>401 missing_api_key</code> / <code>invalid_api_key</code>.</p>
    </>
  );
}
