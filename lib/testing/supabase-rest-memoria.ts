/**
 * Supabase EN MEMORIA para pruebas de rutas reales (sin red, sin Supabase).
 *
 * Intercepta `fetch` hacia una URL base ficticia y emula lo que usan las rutas del
 * dashboard a través de supabase-js: PostgREST (/rest/v1: select con filtros eq/neq/gt/gte/
 * lt/lte/in/is, order, limit, offset, proyección de columnas y de rutas jsonb `a:col->k` /
 * `col->>k`; insert, upsert con on_conflict, update, delete; RPC) y Auth (/auth/v1/user).
 *
 * Reglas de BD que importan para las pruebas se declaran por tabla: claves únicas (=> 23505
 * como Postgres) e identidad. Una tabla "ausente" responde como Postgres sin la migración
 * (42P01). Una RPC no registrada responde PGRST202 (función inexistente).
 *
 * No es PostgREST completo: lo que no soporta falla EN VOZ ALTA (500 con el motivo), nunca
 * devuelve datos inventados.
 */
type Row = Record<string, unknown>;
type RpcHandler = (args: Record<string, unknown>) => { data?: unknown; error?: { code: string; message: string; details?: string | null } };

export interface TableSpec {
  /** Columnas que forman cada restricción UNIQUE (la primera también sirve para on_conflict). */
  unique?: string[][];
  /** Columna identidad (bigint generated) — se asigna sola. */
  identity?: string;
  /** Valores por defecto (p. ej. created_at). */
  defaults?: () => Row;
}

export interface SupabaseMemoria {
  url: string;
  tables: Map<string, Row[]>;
  /** Peticiones recibidas (método + ruta + query), para afirmar QUÉ filtros se aplicaron. */
  requests: Array<{ method: string; path: string; query: URLSearchParams }>;
  table(name: string, spec?: TableSpec): Row[];
  rows(name: string): Row[];
  missing(name: string): void;
  rpc(name: string, handler: RpcHandler): void;
  user(token: string, id: string): void;
  uninstall(): void;
}

const SIMPLE_OPS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "in", "is", "like", "ilike"]);

function parseValue(raw: string): unknown {
  if (raw === "null") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw;
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : 1;
}

function matches(row: Row, col: string, op: string, raw: string): boolean {
  const v = row[col];
  const s = (x: unknown) => (x === null || x === undefined ? x : typeof x === "object" ? JSON.stringify(x) : String(x));
  switch (op) {
    case "eq":
      return s(v) === raw;
    case "neq":
      return s(v) !== raw;
    case "gt":
      return v !== null && v !== undefined && compare(v, raw) > 0;
    case "gte":
      return v !== null && v !== undefined && compare(v, raw) >= 0;
    case "lt":
      return v !== null && v !== undefined && compare(v, raw) < 0;
    case "lte":
      return v !== null && v !== undefined && compare(v, raw) <= 0;
    case "in": {
      const list = raw.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, ""));
      return list.includes(String(v));
    }
    case "is":
      return parseValue(raw) === null ? v === null || v === undefined : v === parseValue(raw);
    default:
      throw new Error(`operador no soportado: ${op}`);
  }
}

/** "(a.lt.\"x,y\",b.eq.2)" -> ["a.lt.\"x,y\"", "b.eq.2"]: separa por comas de primer nivel (respeta comillas). */
function splitLogic(value: string): string[] {
  const inner = value.replace(/^\(|\)$/g, "");
  const parts: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of inner) {
    if (ch === '"') quoted = !quoted;
    if (ch === "," && !quoted) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}

/** Una condición "col.op.valor" (valor con comillas opcionales) de un or()/and() SIN anidar. */
function matchesCondition(row: Row, cond: string): boolean {
  const [col, op, ...rest] = cond.split(".");
  if (!col || !op || rest.length === 0 || !SIMPLE_OPS.has(op) || /^(or|and)\(/.test(cond)) throw new Error(`condición no soportada: ${cond}`);
  return matches(row, col, op, rest.join(".").replace(/^"|"$/g, ""));
}

function applyFilters(rows: Row[], query: URLSearchParams): Row[] {
  let out = rows;
  for (const [key, value] of query) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(key)) continue;
    // or=(c1,c2) / and=(c1,c2) de condiciones simples (sin anidar): lo que usa el cursor del historial.
    if (key === "or" || key === "and") {
      const conds = splitLogic(value);
      out = out.filter((r) => (key === "or" ? conds.some((c) => matchesCondition(r, c)) : conds.every((c) => matchesCondition(r, c))));
      continue;
    }
    const negate = value.startsWith("not.");
    const expr = negate ? value.slice(4) : value;
    const dot = expr.indexOf(".");
    const op = expr.slice(0, dot);
    const raw = expr.slice(dot + 1);
    if (!SIMPLE_OPS.has(op)) throw new Error(`operador no soportado: ${op}`);
    out = out.filter((r) => matches(r, key, op, raw) !== negate);
  }
  return out;
}

/** "a, b:c->k, d->>k" -> proyección; "*" = todo. */
function project(rows: Row[], select: string | null): Row[] {
  if (!select || select.trim() === "*") return rows.map((r) => ({ ...r }));
  const fields = select.split(",").map((f) => f.trim()).filter(Boolean);
  return rows.map((r) => {
    const o: Row = {};
    for (const f of fields) {
      if (f.includes("(")) throw new Error(`select anidado no soportado: ${f}`);
      const [alias, path] = f.includes(":") ? f.split(":") : [null, f];
      const m = /^([a-z_0-9]+)(?:(->>?)([a-z_0-9]+))?$/i.exec(path);
      if (!m) throw new Error(`select no soportado: ${f}`);
      const [, col, arrow, key] = m;
      let v: unknown = r[col];
      if (arrow) {
        const inner = v && typeof v === "object" ? (v as Row)[key] : undefined;
        v = inner === undefined ? null : arrow === "->>" ? (inner === null ? null : typeof inner === "object" ? JSON.stringify(inner) : String(inner)) : inner;
      }
      o[alias ?? (arrow ? key : col)] = v;
    }
    return o;
  });
}

function sortRows(rows: Row[], order: string | null): Row[] {
  if (!order) return rows;
  const keys = order.split(",").map((k) => {
    const [col, dir] = k.split(".");
    return { col, desc: dir === "desc" };
  });
  return [...rows].sort((a, b) => {
    for (const k of keys) {
      const c = compare(a[k.col], b[k.col]);
      if (c !== 0) return k.desc ? -c : c;
    }
    return 0;
  });
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(status === 204 || body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export function installSupabaseMemoria(url = "http://supabase.memoria"): SupabaseMemoria {
  const tables = new Map<string, Row[]>();
  const specs = new Map<string, TableSpec>();
  const missingTables = new Set<string>();
  const rpcs = new Map<string, RpcHandler>();
  const users = new Map<string, string>();
  const requests: SupabaseMemoria["requests"] = [];
  const ids = new Map<string, number>();
  const realFetch = globalThis.fetch;

  function violates(name: string, candidate: Row, ignore?: Row): string[] | null {
    for (const cols of specs.get(name)?.unique ?? []) {
      if (tables.get(name)!.some((r) => r !== ignore && cols.every((c) => String(r[c]) === String(candidate[c])))) return cols;
    }
    return null;
  }

  function insertRow(name: string, input: Row, upsertOn: string[] | null): Row {
    const spec = specs.get(name) ?? {};
    const list = tables.get(name)!;
    if (upsertOn) {
      const existing = list.find((r) => upsertOn.every((c) => String(r[c]) === String(input[c])));
      if (existing) {
        Object.assign(existing, input);
        return existing;
      }
    }
    const row: Row = { ...(spec.defaults?.() ?? {}), ...input };
    if (spec.identity && row[spec.identity] === undefined) {
      const next = (ids.get(name) ?? 0) + 1;
      ids.set(name, next);
      row[spec.identity] = next;
    }
    if (violates(name, row)) throw Object.assign(new Error("duplicate key"), { pg: { code: "23505", message: `duplicate key value violates unique constraint on ${name}` } });
    list.push(row);
    return row;
  }

  async function handle(req: Request): Promise<Response> {
    const u = new URL(req.url);
    const method = req.method.toUpperCase();
    requests.push({ method, path: u.pathname, query: u.searchParams });

    if (u.pathname === "/auth/v1/user") {
      const token = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
      const id = users.get(token);
      if (!id) return json(401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
      return json(200, { id, aud: "authenticated", role: "authenticated", email: `${id}@test.local`, app_metadata: {}, user_metadata: {}, created_at: new Date(0).toISOString() });
    }

    const rpc = /^\/rest\/v1\/rpc\/([a-z_0-9]+)$/.exec(u.pathname);
    if (rpc) {
      const handler = rpcs.get(rpc[1]);
      if (!handler) return json(404, { code: "PGRST202", message: `Could not find the function public.${rpc[1]}`, details: null, hint: null });
      const args = method === "GET" ? Object.fromEntries(u.searchParams) : ((await req.json().catch(() => ({}))) as Record<string, unknown>);
      const r = handler(args);
      return r.error ? json(400, { details: null, hint: null, ...r.error }) : json(200, r.data ?? null);
    }

    const t = /^\/rest\/v1\/([a-z_0-9]+)$/.exec(u.pathname);
    if (!t) return json(404, { message: `ruta no emulada: ${u.pathname}` });
    const name = t[1];
    if (missingTables.has(name) || !tables.has(name)) return json(404, { code: "42P01", message: `relation "public.${name}" does not exist`, details: null, hint: null });
    const list = tables.get(name)!;
    const prefer = req.headers.get("prefer") ?? "";
    const wantsRows = prefer.includes("return=representation");
    const single = (req.headers.get("accept") ?? "").includes("vnd.pgrst.object+json");
    const reply = (rows: Row[]) => {
      if (single) return rows.length === 1 ? json(200, rows[0]) : json(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
      return json(200, rows, { "content-range": `0-${Math.max(rows.length - 1, 0)}/${rows.length}` });
    };

    try {
      if (method === "GET" || method === "HEAD") {
        let rows = sortRows(applyFilters(list, u.searchParams), u.searchParams.get("order"));
        const offset = Number(u.searchParams.get("offset") ?? 0);
        const limit = u.searchParams.has("limit") ? Number(u.searchParams.get("limit")) : rows.length;
        rows = rows.slice(offset, offset + limit);
        return reply(project(rows, u.searchParams.get("select")));
      }
      if (method === "POST") {
        const body = (await req.json()) as Row | Row[];
        const conflictCols = u.searchParams.get("on_conflict")?.split(",") ?? specs.get(name)?.unique?.[0] ?? null;
        const upsertOn = prefer.includes("resolution=merge-duplicates") ? conflictCols : null;
        const ignoreDup = prefer.includes("resolution=ignore-duplicates");
        const inserted: Row[] = [];
        for (const r of Array.isArray(body) ? body : [body]) {
          // ON CONFLICT DO NOTHING: la fila existente no se toca y no se devuelve.
          if (ignoreDup && conflictCols && list.some((e) => conflictCols.every((c) => String(e[c]) === String(r[c])))) continue;
          inserted.push(insertRow(name, r, upsertOn));
        }
        return wantsRows ? reply(project(inserted, u.searchParams.get("select"))) : json(201, undefined);
      }
      if (method === "PATCH") {
        const patch = (await req.json()) as Row;
        const target = applyFilters(list, u.searchParams);
        for (const r of target) {
          const next = { ...r, ...patch };
          if (violates(name, next, r)) throw Object.assign(new Error("duplicate key"), { pg: { code: "23505", message: "duplicate key" } });
          Object.assign(r, patch);
        }
        return wantsRows ? reply(project(target, u.searchParams.get("select"))) : json(204, undefined);
      }
      if (method === "DELETE") {
        const target = new Set(applyFilters(list, u.searchParams));
        tables.set(name, list.filter((r) => !target.has(r)));
        if (wantsRows) return reply(project([...target], u.searchParams.get("select")));
        return json(204, undefined, prefer.includes("count=exact") ? { "content-range": `*/${target.size}` } : {});
      }
      return json(405, { message: `método no emulado: ${method}` });
    } catch (e) {
      const pg = (e as { pg?: { code: string; message: string } }).pg;
      if (pg) return json(409, { ...pg, details: null, hint: null });
      return json(500, { code: "FAKE", message: e instanceof Error ? e.message : String(e) });
    }
  }

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    if (!req.url.startsWith(url)) return realFetch(input, init);
    return handle(req);
  }) as typeof fetch;

  return {
    url,
    tables,
    requests,
    table(name, spec) {
      if (!tables.has(name)) tables.set(name, []);
      if (spec) specs.set(name, spec);
      missingTables.delete(name);
      return tables.get(name)!;
    },
    rows(name) {
      return tables.get(name) ?? [];
    },
    missing(name) {
      missingTables.add(name);
    },
    rpc(name, handler) {
      rpcs.set(name, handler);
    },
    user(token, id) {
      users.set(token, id);
    },
    uninstall() {
      globalThis.fetch = realFetch;
    },
  };
}
