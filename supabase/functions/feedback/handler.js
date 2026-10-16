// Пересыльщик отзывов DnD Kids.
// Проверяет, что пишет вошедший мастер, и сразу отправляет текст и скриншот
// в канал Discord через вебхук. Нигде не хранит: ни в базе, ни в файлах.
//
// Настройка (Supabase → Edge Functions → Secrets):
//   DISCORD_WEBHOOK_URL   ссылка вебхука канала Discord

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Не чаще 5 отзывов за 10 минут от одного человека. Счётчик живёт в памяти функции,
// база не трогается; после перезапуска функции он обнуляется — для защиты от случайного спама хватает.
// waitFor возвращает 0, если можно отправлять, иначе — сколько миллисекунд ждать до освобождения места.
const WINDOW = 10 * 60 * 1000, MAX = 5;
const recent = new Map();
function waitFor(uid, now = Date.now()){
  const list = (recent.get(uid) || []).filter(t => now - t < WINDOW);
  if (list.length >= MAX){ recent.set(uid, list); return list[0] + WINDOW - now; }
  list.push(now); recent.set(uid, list);
  if (recent.size > 500) for (const [k, v] of recent) if (!v.some(t => now - t < WINDOW)) recent.delete(k);
  return 0;
}

const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export async function handle(req, env, fetchImpl = fetch){
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  // 1. кто пишет: проверяем вход через сам Supabase
  const auth = req.headers.get("authorization") || "";
  const apikey = req.headers.get("apikey") || "";
  if (!/^Bearer\s+\S+/.test(auth)) return json({ error: "auth" }, 401);
  const ures = await fetchImpl(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: auth, apikey } });
  if (!ures.ok) return json({ error: "auth" }, 401);
  const user = await ures.json();
  const hook = env.DISCORD_WEBHOOK_URL;
  if (!hook) return json({ error: "not-configured" }, 503);

  // 2. что пишет
  let form;
  try { form = await req.formData(); } catch (e) { return json({ error: "form" }, 400); }
  const text = String(form.get("text") || "").trim().slice(0, 3000);
  const page = String(form.get("page") || "").slice(0, 200);
  const device = String(form.get("device") || "").slice(0, 200);
  const shot = form.get("screenshot");
  const file = shot && typeof shot === "object" && typeof shot.arrayBuffer === "function" && shot.size > 0 ? shot : null;
  if (!text && !file) return json({ error: "empty" }, 400);
  if (file && file.size > 4 * 1024 * 1024) return json({ error: "big" }, 413);
  if (file && !/^image\//.test(file.type || "image/jpeg")) return json({ error: "type" }, 415);

  const m = user.user_metadata || {};
  const who = m.custom_claims?.global_name || m.full_name || m.name || m.user_name || user.email || user.id;

  // 3. не чаще пяти раз за десять минут
  const wait = waitFor(user.id);
  if (wait) return json({ error: "limit", retryAfter: Math.ceil(wait / 1000) }, 429);

  // 4. отправка в канал Discord
  const fd = new FormData();
  const content = cut(`**Отзыв из DnD Kids** от **${who}**${page ? `\nГде: ${page}` : ""}${device ? `\nУстройство: ${device}` : ""}\n\n${text || "(без текста, только скриншот)"}`, 2000);
  fd.append("payload_json", JSON.stringify({ username: "DnD Kids", content, allowed_mentions: { parse: [] } }));
  if (file) fd.append("files[0]", file, file.name || "screenshot.jpg");
  try {
    const r = await fetchImpl(hook, { method: "POST", body: fd });
    if (!r.ok) return json({ error: "send", status: r.status }, 502);
  } catch (e) { return json({ error: "send" }, 502); }
  return json({ ok: true });
}
