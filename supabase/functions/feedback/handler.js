// Пересыльщик отзывов DnD Kids.
// Проверяет, что пишет вошедший мастер, и отправляет текст и скриншот
// в Discord (вебхук канала) и/или в Telegram (бот). В базе ничего не хранится.
//
// Настройки (Supabase → Edge Functions → Secrets), достаточно одного канала:
//   DISCORD_WEBHOOK_URL   ссылка вебхука канала Discord
//   TELEGRAM_BOT_TOKEN    токен бота от @BotFather
//   TELEGRAM_CHAT_ID      номер чата, куда бот пишет (твой личный чат с ботом)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Не чаще 5 отзывов за 10 минут от одного человека. Счётчик живёт в памяти функции,
// база не трогается; после перезапуска функции он обнуляется — для защиты от случайного спама хватает.
const recent = new Map();
function allowed(uid, now = Date.now()){
  const list = (recent.get(uid) || []).filter(t => now - t < 10 * 60 * 1000);
  if (list.length >= 5){ recent.set(uid, list); return false; }
  list.push(now); recent.set(uid, list);
  if (recent.size > 500) for (const [k, v] of recent) if (!v.some(t => now - t < 10 * 60 * 1000)) recent.delete(k);
  return true;
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
  const hook = env.DISCORD_WEBHOOK_URL, tg = env.TELEGRAM_BOT_TOKEN, chat = env.TELEGRAM_CHAT_ID;
  if (!hook && !(tg && chat)) return json({ error: "not-configured" }, 503);

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
  const head = `Отзыв из DnD Kids\nОт: ${who}${page ? `\nГде: ${page}` : ""}${device ? `\nУстройство: ${device}` : ""}`;

  // 3. не чаще пяти раз за десять минут
  if (!allowed(user.id)) return json({ error: "limit" }, 429);

  // 4. отправка
  let sent = 0; const fails = [];

  if (hook){
    const fd = new FormData();
    const content = cut(`**Отзыв из DnD Kids** от **${who}**${page ? `\nГде: ${page}` : ""}${device ? `\nУстройство: ${device}` : ""}\n\n${text || "(без текста, только скриншот)"}`, 2000);
    fd.append("payload_json", JSON.stringify({ username: "DnD Kids", content, allowed_mentions: { parse: [] } }));
    if (file) fd.append("files[0]", file, file.name || "screenshot.jpg");
    try { const r = await fetchImpl(hook, { method: "POST", body: fd }); if (r.ok) sent++; else fails.push(`discord ${r.status}`); }
    catch (e) { fails.push("discord network"); }
  }
  if (tg && chat){
    const api = `https://api.telegram.org/bot${tg}`;
    const body = `${head}\n\n${text || "(без текста, только скриншот)"}`;
    try {
      let ok = true;
      if (file){
        const fd = new FormData();
        fd.append("chat_id", chat);
        fd.append("caption", cut(body, 1024));
        fd.append("photo", file, file.name || "screenshot.jpg");
        ok = (await fetchImpl(`${api}/sendPhoto`, { method: "POST", body: fd })).ok;
        // подпись к фото короткая — длинный текст отдельным сообщением
        if (ok && body.length > 1024) ok = (await fetchImpl(`${api}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chat, text: cut(body, 4096) }) })).ok;
      } else {
        ok = (await fetchImpl(`${api}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chat, text: cut(body, 4096) }) })).ok;
      }
      if (ok) sent++; else fails.push("telegram");
    } catch (e) { fails.push("telegram network"); }
  }
  if (!sent) return json({ error: "send", fails }, 502);
  return json({ ok: true, sent });
}
