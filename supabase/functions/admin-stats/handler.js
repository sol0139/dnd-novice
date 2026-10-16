// Статистика DnD Kids для страницы /dashboard. Видит её только владелец сайта.
// Вход по логину и паролю, которые лежат в секретах функции (Supabase → Edge Functions → Secrets):
//   ADMIN_LOGIN     логин для /dashboard
//   ADMIN_PASSWORD  пароль для /dashboard
// Пароль в код и в базу не попадает. После входа функция выдаёт подписанный пропуск на 12 часов,
// чтобы страница могла обновляться без повторного ввода. Сменишь пароль — старые пропуска перестанут работать.
// Данные читает секретным ключом проекта (он есть у функции по умолчанию) и отдаёт только нужное:
// имена из Discord, даты, счётчики. Почту и токены не отдаёт.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const enc = new TextEncoder();
const TTL = 12 * 60 * 60 * 1000;

/* ---------- подписи и сравнение без утечки по времени ---------- */
const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = s => atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
async function sha(s){ return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(String(s)))); }
function same(a, b){ if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; }
async function sign(env, msg){
  const key = await crypto.subtle.importKey("raw", enc.encode(`${env.ADMIN_LOGIN}\u0000${env.ADMIN_PASSWORD}\u0000dnd-kids-dashboard`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}
async function makeToken(env, now){
  const payload = b64u(enc.encode(JSON.stringify({ exp: now + TTL })));
  return { token: `${payload}.${await sign(env, payload)}`, exp: now + TTL };
}
async function checkToken(env, token, now){
  const [payload, sig] = String(token || "").split(".");
  if (!payload || !sig) return false;
  if (!same(await sha(sig), await sha(await sign(env, payload)))) return false;
  try { return JSON.parse(unb64u(payload)).exp > now; } catch (e) { return false; }
}

/* ---------- защита от подбора: 8 неверных попыток за 15 минут с одного адреса ---------- */
const WINDOW = 15 * 60 * 1000, MAX_FAILS = 8;
const fails = new Map();
function lockedFor(ip, now){
  const list = (fails.get(ip) || []).filter(t => now - t < WINDOW);
  fails.set(ip, list);
  return list.length >= MAX_FAILS ? list[0] + WINDOW - now : 0;
}
function fail(ip, now){
  const list = (fails.get(ip) || []).filter(t => now - t < WINDOW);
  list.push(now); fails.set(ip, list);
  if (fails.size > 1000) for (const [k, v] of fails) if (!v.some(t => now - t < WINDOW)) fails.delete(k);
}

/* ---------- чтение данных секретным ключом ---------- */
function secretKey(env){
  try { const k = JSON.parse(env.SUPABASE_SECRET_KEYS || "{}").default; if (k) return k; } catch (e) {}
  return env.SUPABASE_SERVICE_ROLE_KEY || "";
}
function headersFor(key){
  // Новые секретные ключи (sb_secret_…) идут только в apikey, старые JWT-ключи — ещё и в Authorization
  const h = { apikey: key };
  if (key.startsWith("eyJ")) h.Authorization = `Bearer ${key}`;
  return h;
}
async function getAll(fetchImpl, url, headers){
  const out = [];
  for (let from = 0; from < 50000; from += 1000){
    const r = await fetchImpl(`${url}${url.includes("?") ? "&" : "?"}limit=1000&offset=${from}`, { headers });
    if (!r.ok) throw new Error(`${url.split("?")[0]} ${r.status}`);
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}
async function getUsers(fetchImpl, base, headers){
  const out = [];
  for (let page = 1; page <= 50; page++){
    const r = await fetchImpl(`${base}/auth/v1/admin/users?page=${page}&per_page=500`, { headers });
    if (!r.ok) throw new Error(`users ${r.status}`);
    const users = (await r.json()).users || [];
    out.push(...users);
    if (users.length < 500) break;
  }
  return out;
}
const nickOf = u => {
  const m = u.user_metadata || {};
  return m.custom_claims?.global_name || m.full_name || m.name || m.user_name || "Без имени";
};

export async function collect(env, fetchImpl = fetch){
  const base = env.SUPABASE_URL, key = secretKey(env);
  if (!key) throw new Error("no secret key");
  const h = headersFor(key);
  const [users, chars, tables, seats] = await Promise.all([
    getUsers(fetchImpl, base, h),
    getAll(fetchImpl, `${base}/rest/v1/characters?select=id,name,owner_id,created_at,updated_at,race:data->race->>name,cls:data->class,app:data->source->>app,manual:data->source->>manual&order=created_at.asc`, h),
    getAll(fetchImpl, `${base}/rest/v1/game_tables?select=id,name,owner_id,created_at&order=created_at.asc`, h),
    getAll(fetchImpl, `${base}/rest/v1/table_seats?select=table_id,character_id,created_at`, h)
  ]);
  // Люди — по порядку прихода; дальше на них ссылаемся номером
  users.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const idx = new Map(users.map((u, i) => [u.id, i]));
  const heroOwner = new Map(chars.map(c => [c.id, c.owner_id]));
  const tableOwner = new Map(tables.map(t => [t.id, t.owner_id]));
  return {
    at: new Date().toISOString(),
    people: users.map(u => ({
      name: nickOf(u),
      avatar: (u.user_metadata || {}).avatar_url || null,
      provider: (u.app_metadata || {}).provider || null,
      created: u.created_at,
      lastSignIn: u.last_sign_in_at || null
    })),
    heroes: chars.map(c => ({
      name: c.name, owner: idx.has(c.owner_id) ? idx.get(c.owner_id) : -1,
      race: c.race || null, cls: c.cls?.name || null, level: +c.cls?.level || null, subclass: c.cls?.subclass || null,
      app: c.app === "builder" && (c.manual === "true" || c.manual === true) ? "builder-manual" : (c.app || null),
      created: c.created_at, updated: c.updated_at
    })),
    tables: tables.map(t => {
      const s = seats.filter(x => x.table_id === t.id);
      const owners = s.map(x => heroOwner.get(x.character_id));
      return { name: t.name, owner: idx.has(t.owner_id) ? idx.get(t.owner_id) : -1, created: t.created_at,
        heroes: s.length, fromPlayers: owners.filter(o => o && o !== t.owner_id).length,
        players: new Set(owners.filter(o => o && o !== t.owner_id)).size };
    }),
    seats: seats.map(x => ({
      table: tables.findIndex(t => t.id === x.table_id),
      owner: idx.has(heroOwner.get(x.character_id)) ? idx.get(heroOwner.get(x.character_id)) : -1,
      master: idx.has(tableOwner.get(x.table_id)) ? idx.get(tableOwner.get(x.table_id)) : -1,
      created: x.created_at
    }))
  };
}

export async function handle(req, env, fetchImpl = fetch, now = Date.now()){
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!env.ADMIN_LOGIN || !env.ADMIN_PASSWORD) return json({ error: "not-configured" }, 503);
  let body = {};
  try { body = await req.json(); } catch (e) { return json({ error: "form" }, 400); }

  let issued = null;
  if (body.token){
    if (!(await checkToken(env, body.token, now))) return json({ error: "expired" }, 401);
  } else {
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
    const wait = lockedFor(ip, now);
    if (wait) return json({ error: "limit", retryAfter: Math.ceil(wait / 1000) }, 429);
    const okLogin = same(await sha(body.login || ""), await sha(env.ADMIN_LOGIN));
    const okPass = same(await sha(body.password || ""), await sha(env.ADMIN_PASSWORD));
    if (!(okLogin && okPass)){
      fail(ip, now);
      await new Promise(r => setTimeout(r, 400));
      return json({ error: "wrong" }, 401);
    }
    issued = await makeToken(env, now);
  }
  try {
    const stats = await collect(env, fetchImpl);
    return json({ ok: true, ...(issued || {}), stats });
  } catch (e) {
    console.error(e);
    return json({ error: "read", detail: String(e.message || e).slice(0, 120) }, 502);
  }
}
