/* ============================================================
   Мастерская: вход мастера через Discord и список его персонажей.
   Данные лежат в Supabase, в таблице characters. Правила доступа
   в базе сами следят, чтобы мастер видел только своих персонажей.
   ============================================================ */
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm";
import { importLSS } from "/lss.js";

const cfg = window.APP_CONFIG;
const sb = createClient(cfg.supabaseUrl, cfg.supabaseKey);
const app = document.getElementById("app");
const THEME_KEY = "novice-sheet:theme";

let session = null;     // кто вошёл (null — гость)
let chars = [];         // персонажи мастера
let loaded = false;     // список уже пришёл из базы
let confirmDel = null;  // id персонажа, которого спрашиваем «удалить?»
let busy = false;       // идёт запрос — кнопки на это время гаснут
// Для списка не тянем лист целиком: только имя расы и класс. Бесплатный трафик Supabase — 5 ГБ в месяц.
const LIST_COLS = "id,name,share_slug,updated_at,race:data->race->>name,cls:data->class";
let review = null;      // импорт из LSS на проверке: живёт только в браузере, пока мастер не нажмёт «Сохранить»
let error = readAuthError();

/* ---------- помощники ---------- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const shareLink = c => `${location.origin}/c/${c.share_slug}`;
const when = iso => new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });

// Если вход через Discord не удался, Supabase возвращает причину прямо в адресе
function readAuthError(){
  const p = new URLSearchParams(location.hash.slice(1) || location.search);
  const msg = p.get("error_description");
  if (msg) history.replaceState(null, "", location.pathname);
  return msg ? `Не получилось войти: ${msg}` : "";
}

let toastTimer;
function toast(msg){
  document.getElementById("toast").textContent = msg;
  document.getElementById("toastWrap").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { document.getElementById("toastWrap").hidden = true; }, 4500);
}

/* ---------- тема ---------- */
const ICON_MOON = `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.2A8 8 0 1 1 9.8 4a6.4 6.4 0 0 0 10.2 10.2z"/></svg>`;
const ICON_SUN  = `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>`;
const effTheme = () => document.documentElement.getAttribute("data-theme")
  || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
const themeBtn = () => {
  const dark = effTheme() === "dark";
  return `<button type="button" class="iconbtn" data-act="theme" aria-label="${dark ? "Включить светлую тему" : "Включить тёмную тему"}">${dark ? ICON_SUN : ICON_MOON}</button>`;
};

/* ---------- разметка ---------- */
const BRAND = `<a class="brand" href="/"><span class="brand-mark"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7.5 4.3v9.4L12 21l-7.5-4.3V7.3z M12 3l-4.5 12h9z"/></svg></span>Чарник новичка</a>`;

function header(){
  let me = "";
  if (session){
    const m = session.user.user_metadata || {};
    const nick = m.custom_claims?.global_name || m.full_name || m.name || m.user_name || "Мастер";
    me = `<span class="me">${m.avatar_url ? `<img src="${esc(m.avatar_url)}" alt="">` : `<span class="ph"></span>`}<span>${esc(nick)}</span></span>`;
  }
  return `<header class="top-row">${BRAND}<div class="top-btns">${me}${themeBtn()}</div></header>`;
}

function viewGuest(){
  return `
  <section class="hero">
    <h1>Чарник для тех, кто играет впервые</h1>
    <p class="lead">Мастер собирает персонажа, игрок открывает его по ссылке. Способности разложены по ходу, каждое слово объяснено.</p>
    <div class="hero-btns">
      <button type="button" class="btn discord" data-act="login"${busy ? " disabled" : ""}>Войти через Discord</button>
      <a class="btn surface" href="/demo">Посмотреть пример</a>
    </div>
    <p class="meta">Входят только мастера. Игрокам аккаунт не нужен.</p>
  </section>
  <section class="steps">
    <div class="step card"><b>Войди через Discord</b><p>Это твоя мастерская: здесь живут все твои персонажи.</p></div>
    <div class="step card"><b>Создай персонажа</b><p>Пока из шаблона воина. Импорт из LSS и конструктор появятся следующими.</p></div>
    <div class="step card"><b>Отправь ссылку игроку</b><p>Он откроет лист с телефона, без регистрации.</p></div>
  </section>`;
}

function charCard(c){
  const race = c.race ?? c.data?.race?.name, cls = c.cls ?? c.data?.class;
  const sub = [race, cls ? `${cls.name} ${cls.level} уровня` : ""].filter(Boolean).join(" · ");
  const acts = confirmDel === c.id
    ? `<div class="confirm">
         <p>Удалить «${esc(c.name)}» навсегда? Ссылка у игрока перестанет работать.</p>
         <div class="char-acts">
           <button type="button" class="btn danger sm" data-act="del" data-id="${c.id}"${busy ? " disabled" : ""}>Удалить</button>
           <button type="button" class="btn neutral sm" data-act="cancelDel">Отмена</button>
         </div>
       </div>`
    : `<div class="char-acts">
         <a class="btn primary sm" href="/c/${esc(c.share_slug)}">Открыть</a>
         <button type="button" class="btn neutral sm" data-act="copy" data-id="${c.id}">Ссылка игроку</button>
         <button type="button" class="btn sm del" data-act="askDel" data-id="${c.id}">Удалить</button>
       </div>`;
  return `<article class="char card">
    <div class="char-h"><h3>${esc(c.name)}</h3><time datetime="${esc(c.updated_at)}">${when(c.updated_at)}</time></div>
    ${sub ? `<p class="char-sub">${esc(sub)}</p>` : ""}
    <div class="char-link">${esc(shareLink(c))}</div>
    ${acts}
  </article>`;
}

function viewMaster(){
  const list = !loaded
    ? `<p class="meta">Загружаем персонажей…</p>`
    : chars.length
      ? `<div class="chars">${chars.map(charCard).join("")}</div>`
      : `<div class="empty card">Здесь пока пусто. Создай первого персонажа, и игрок получит его по ссылке.</div>`;
  return `
  <section class="hero">
    <p class="eyebrow">Мастерская</p>
    <h1>Мои персонажи</h1>
  </section>
  <form class="new card" id="newForm">
    <h2>Новый персонаж</h2>
    <div class="new-row">
      <input id="newName" name="name" placeholder="Имя героя" maxlength="80" autocomplete="off" required>
      <button type="submit" class="btn primary"${busy ? " disabled" : ""}>Создать</button>
    </div>
    <p class="meta">Пока персонаж создаётся из шаблона: полуорк-воин 1 уровня.</p>
  </form>
  <section class="new card">
    <h2>Импорт из Long Story Short</h2>
    <p class="meta">Скачай персонажа из LSS файлом .json и выбери его здесь. Файл разбирается прямо в браузере, а перед сохранением ты увидишь, что нашлось и что стоит проверить.</p>
    <label class="btn neutral filebtn"><input type="file" id="lssFile" accept=".json,application/json" hidden>Выбрать файл .json</label>
  </section>
  ${list}
  <p class="meta"><button type="button" class="btn surface sm" data-act="logout">Выйти</button></p>`;
}

/* ---------- импорт: экран проверки ---------- */
const KIND_LABEL = { action: "Действие", bonus: "Бонус", reaction: "Реакция", passive: "Само", item: "Вещь", drop: "Убрать" };
const dice = s => String(s || "").replace(/d/g, "к");

function findingRow(f){
  const i = review.findings.indexOf(f);
  return `<div class="fd ${f.level}"><span class="fd-dot" aria-hidden="true"></span><div class="fd-body"><p>${esc(f.text)}</p>
    ${f.options ? `<div class="fd-acts">${f.options.map((o, k) => `<button type="button" class="btn sm ${f.chosen === k ? "primary" : "neutral"}" data-act="fix" data-f="${i}" data-o="${k}" aria-pressed="${f.chosen === k}">${esc(o.label)}</button>`).join("")}</div>` : ""}
  </div></div>`;
}
const findingsBlock = (title, list) => list.length
  ? `<section class="sec"><h2>${title}</h2><div class="card fds">${list.map(findingRow).join("")}</div></section>` : "";

function featRow(f, i){
  const kinds = ["action", "bonus", "reaction", "passive", "item", "drop"];
  const short = (f.plain || "").length > 170 ? f.plain.slice(0, 167) + "…" : f.plain;
  return `<article class="rvf card${f.kind === "drop" ? " dropped" : ""}">
    <div class="rvf-h"><input class="rvf-title" data-bind="features.${i}.name" value="${esc(f.name)}" aria-label="Название">
      ${f.guess && f.kind === "passive" ? `<span class="pill">догадка</span>` : ""}${f.source ? `<span class="src">${esc(f.source)}</span>` : ""}</div>
    ${short ? `<p class="rvf-d">${esc(short)}</p>` : `<textarea class="rvf-ta" data-bind="features.${i}.plain" rows="2" placeholder="Описания нет. Что делает — простыми словами"></textarea>`}
    ${(f.plain || "").length > 170 ? `<details class="rvf-more"><summary>Весь текст</summary><p>${esc(f.plain)}</p></details>` : ""}
    <div class="seg" role="group" aria-label="Куда положить"><span class="seg-l">Куда</span>${kinds.map(k =>
      `<button type="button" data-act="kind" data-i="${i}" data-k="${k}" aria-pressed="${f.kind === k}">${KIND_LABEL[k]}</button>`).join("")}</div>
    ${f.kind === "passive" ? `<div class="seg" role="group" aria-label="На какой вкладке"><span class="seg-l">Вкладка</span>
      <button type="button" data-act="scene" data-i="${i}" data-s="combat" aria-pressed="${f.scene !== "social"}">В бою</button>
      <button type="button" data-act="scene" data-i="${i}" data-s="social" aria-pressed="${f.scene === "social"}">Вне боя</button></div>` : ""}
    ${f.uses ? `<label class="uses-fld">Тратится <input type="number" min="1" max="20" data-bind="features.${i}.uses.max" value="${f.uses.max}"> раз, возвращается после ${f.uses.recharge === "short" ? "короткого" : "длинного"} отдыха${f.usesGuess ? ` <span class="pill">догадка</span>` : ""}</label>` : ""}
  </article>`;
}

function weaponRow(f, i){
  const a = f.attack, off = f.kind === "drop";
  return `<article class="rvf card${off ? " dropped" : ""}">
    <div class="rvf-h"><input class="rvf-title" data-bind="features.${i}.name" value="${esc(f.name)}" aria-label="Название оружия">
      <button type="button" class="btn sm neutral" data-act="kind" data-i="${i}" data-k="${off ? "action" : "drop"}">${off ? "Вернуть" : "Убрать"}</button></div>
    <div class="wrow">
      <label class="fld"><span>Попадание</span><input type="number" data-bind="features.${i}.attack.toHit" value="${a.toHit}"></label>
      <label class="fld"><span>Урон</span><input data-bind="features.${i}.attack.damage" value="${esc(dice(a.damage))}"></label>
      <label class="fld"><span>Тип урона</span><input data-bind="features.${i}.attack.damageType" value="${esc(a.damageType || "")}"></label>
    </div>
    <p class="meta">${esc(f.why || "")}</p>
  </article>`;
}

function viewReview(){
  const r = review, c = r.char;
  const by = lv => r.findings.filter(f => f.level === lv);
  const errs = by("error"), warns = by("warn"), infos = by("info"), oks = by("ok");
  const nameMissing = !c.name.trim();
  const list = pred => c.features.map((f, i) => [f, i]).filter(([f]) => pred(f));
  const feats = list(f => !f.attack && f.kind !== "movement" && f.id !== "opportunity" && !/^slots/.test(f.id));
  const weapons = list(f => f.attack);
  return `
  <section class="hero">
    <p class="eyebrow">Импорт из Long Story Short</p>
    <h1>Проверка перед сохранением</h1>
    <p class="meta">Файл ${esc(r.fileName.replace(/^[0-9a-f-]{8,}[-_]?\d*_*/i, "").replace(/_+/g, " ").trim() || r.fileName)}. Пока не нажмёшь «Сохранить», в базу ничего не попадает.</p>
  </section>
  <div class="tally">
    <span class="tl ok">${oks.length} сошлось</span>
    <span class="tl warn">${warns.length} проверить</span>
    <span class="tl error">${errs.length} исправить</span>
  </div>
  <section class="card rv-who">
    <label class="fld"><span>Имя</span><input id="rvName" data-bind="name" value="${esc(c.name)}" placeholder="Имя героя" maxlength="80"></label>
    <div class="seg" role="group" aria-label="Как к герою обращаться в подсказках">
      <button type="button" data-act="pronoun" data-v="he" aria-pressed="${c.pronoun !== "she"}">Он</button>
      <button type="button" data-act="pronoun" data-v="she" aria-pressed="${c.pronoun === "she"}">Она</button>
    </div>
    <p class="meta">${esc(c.race.name)} · ${esc(c.class.name)} ${c.class.level} уровня · КД ${c.ac.value} · хиты ${c.hp.max} · скорость ${c.speed} футов</p>
  </section>
  ${findingsBlock("Исправить", errs)}
  ${findingsBlock("Проверить", warns)}
  ${findingsBlock("На заметку", infos)}
  ${oks.length ? `<details class="card rv-ok"><summary>Что сошлось (${oks.length})</summary><ul>${oks.map(f => `<li>${esc(f.text)}</li>`).join("")}</ul></details>` : ""}
  <section class="sec">
    <div class="sec-h"><h2>Раскладка способностей</h2><p>Куда нажмёт игрок в свой ход. «Догадка» — в тексте не нашлось «действием», «бонусным» или «реакцией», проверь. Лишнее убери, вещи отправь в снаряжение.</p></div>
    ${feats.map(([f, i]) => featRow(f, i)).join("") || `<p class="meta">Способностей в файле не нашлось.</p>`}
  </section>
  ${weapons.length ? `<section class="sec"><div class="sec-h"><h2>Оружие</h2><p>Числа уже пересчитаны по характеристикам. Поправь, если у героя особый случай.</p></div>${weapons.map(([f, i]) => weaponRow(f, i)).join("")}</section>` : ""}
  <section class="sec">
    <div class="sec-h"><h2>Снаряжение</h2><p>Нажми ×, чтобы убрать лишнее.</p></div>
    <div class="eqs">${c.equipment.map((e, i) => `<span class="eq card"><span><b>${esc(e.name)}</b>${e.note ? `<small>${esc(e.note)}</small>` : ""}</span><button type="button" data-act="eqDel" data-i="${i}" aria-label="Убрать ${esc(e.name)}">×</button></span>`).join("") || `<p class="meta">Пусто.</p>`}</div>
  </section>
  <div class="savebar">
    <button type="button" class="btn surface" data-act="cancelImport">Отмена</button>
    <button type="button" class="btn primary" id="saveImport" data-act="saveImport"${busy || nameMissing ? " disabled" : ""}>${nameMissing ? "Впиши имя" : "Сохранить персонажа"}</button>
  </div>`;
}

async function startImport(file){
  try {
    const raw = JSON.parse(await file.text());
    const [kb, dict] = await Promise.all(["/data/knowledge.json", "/data/dictionary.json"].map(u => fetch(u).then(r => r.json())));
    const { character, findings } = importLSS(raw, { kb, dict });
    // по каждой находке с выбором сразу применяем первый вариант — это рекомендация
    for (const f of findings) if (f.options){ f.options[0].apply(character); f.chosen = 0; }
    review = { fileName: file.name, char: character, findings };
    error = "";
  } catch (e){
    console.error(e);
    error = "Не получилось разобрать файл. Нужен .json персонажа, выгруженный из Long Story Short.";
  }
  render();
  window.scrollTo({ top: 0 });
}

async function saveImport(){
  const c = JSON.parse(JSON.stringify(review.char));
  if (!c.name.trim()) return;
  // вещи — в снаряжение, убранное — прочь, служебные пометки — прочь
  for (const f of c.features) if (f.kind === "item") c.equipment.push({ name: f.name, note: (f.plain || "").slice(0, 160) });
  c.features = c.features.filter(f => f.kind !== "item" && f.kind !== "drop").map(({ guess, usesGuess, ...f }) => f);
  for (const f of c.features){
    if (f.kind !== "passive") f.scene = "combat";
    if (f.uses) f.uses.max = Math.max(1, Math.min(20, +f.uses.max || 1));
    if (f.attack) f.attack.damage = String(f.attack.damage || "").replace(/(\d*)\s*[кk]\s*(\d+)/gi, (_, n, s) => `${n || 1}d${s}`).replace(/\s+/g, "");
  }
  const ids = new Set(c.features.map(f => f.id));
  c.features = c.features.filter(f => !f.attackRef || ids.has(f.attackRef));
  const json = JSON.stringify(c);
  const size = new TextEncoder().encode(json).length;
  if (size > 150000){ toast("Персонаж слишком большой для бесплатной базы. Убери длинные описания и попробуй ещё раз."); return; }
  busy = true; render();
  const { data, error: e } = await sb.from("characters").insert({ name: c.name.trim(), data: c }).select(LIST_COLS).single();
  busy = false;
  if (e){ console.error(e); toast(/Слишком много/.test(e.message) ? e.message : "Не получилось сохранить. Попробуй ещё раз."); render(); return; }
  chars.unshift(data);
  review = null;
  render();
  window.scrollTo({ top: 0 });
  toast(`«${c.name}» сохранён: ${Math.max(1, Math.round(size / 1024))} КБ в базе.`);
}

const setPath = (obj, path, val) => { const ks = path.split("."); let o = obj; for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]]; o[ks[ks.length - 1]] = val; };

function render(){
  const keepName = document.getElementById("newName")?.value || "";
  app.innerHTML = `
    ${header()}
    ${error ? `<div class="alert" role="alert">${esc(error)}</div>` : ""}
    ${!session ? viewGuest() : review ? viewReview() : viewMaster()}
    <footer class="foot">Правила D&amp;D 5e (2014). Часть материалов взята из System Reference Document 5.1 © Wizards of the Coast LLC, лицензия CC-BY-4.0.</footer>`;
  const input = document.getElementById("newName");
  if (input) input.value = keepName;
}

/* ---------- работа с базой ---------- */
async function loadChars(){
  const { data, error: e } = await sb.from("characters")
    .select(LIST_COLS)
    .order("updated_at", { ascending: false });
  if (e){ error = "Не получилось загрузить персонажей. Обнови страницу."; console.error(e); }
  else { chars = data; error = ""; }
  loaded = true;
  render();
}

async function createChar(name){
  busy = true; render();
  try {
    const tpl = await (await fetch("/data/mirta.json")).json();
    tpl.name = name;
    const { data, error: e } = await sb.from("characters")
      .insert({ name, data: tpl })
      .select(LIST_COLS)
      .single();
    if (e) throw e;
    chars.unshift(data);
    document.getElementById("newName").value = "";
    toast(`«${name}» готов. Нажми «Ссылка игроку», чтобы отправить его.`);
  } catch (e){
    console.error(e);
    toast(/Слишком много/.test(e.message || "") ? e.message : "Не получилось создать персонажа. Попробуй ещё раз.");
  }
  busy = false; render();
}

/* ---------- кнопки ---------- */
const H = {
  login: async () => {
    busy = true; render();
    // Сначала спрашиваем Supabase, включён ли Discord: иначе мастер увидит сырую ошибку на чужой странице
    try {
      const r = await fetch(`${cfg.supabaseUrl}/auth/v1/settings`, { headers: { apikey: cfg.supabaseKey } });
      const settings = await r.json();
      if (!settings?.external?.discord){
        busy = false;
        error = "Вход через Discord пока выключен в Supabase. Владелец сайта должен включить его: Authentication → Sign In / Providers → Discord.";
        render();
        return;
      }
    } catch (e) { /* не получилось спросить — пробуем войти как есть */ }
    const { error: e } = await sb.auth.signInWithOAuth({
      provider: "discord",
      options: { redirectTo: location.origin + "/" }
    });
    if (e){ busy = false; error = `Не получилось открыть Discord: ${e.message}`; render(); }
  },
  logout: async () => { await sb.auth.signOut(); },
  theme: () => {
    const next = effTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    render();
  },
  copy: async b => {
    const c = chars.find(x => x.id === b.dataset.id);
    const link = shareLink(c);
    try { await navigator.clipboard.writeText(link); toast("Ссылка скопирована. Отправь её игроку."); }
    catch (e) { toast(link); }
  },
  askDel: b => { confirmDel = b.dataset.id; render(); },
  kind: b => {
    const f = review.char.features[+b.dataset.i];
    f.kind = b.dataset.k; f.guess = false;
    render();
  },
  scene: b => { review.char.features[+b.dataset.i].scene = b.dataset.s; render(); },
  pronoun: b => { review.char.pronoun = b.dataset.v; render(); },
  fix: b => {
    const f = review.findings[+b.dataset.f], o = +b.dataset.o;
    f.options[o].apply(review.char); f.chosen = o;
    render();
  },
  eqDel: b => { review.char.equipment.splice(+b.dataset.i, 1); render(); },
  cancelImport: () => { review = null; render(); window.scrollTo({ top: 0 }); },
  saveImport: () => { if (!busy) saveImport(); },
  cancelDel: () => { confirmDel = null; render(); },
  del: async b => {
    busy = true; render();
    const id = b.dataset.id;
    const { error: e } = await sb.from("characters").delete().eq("id", id);
    if (e){ console.error(e); toast("Не получилось удалить. Попробуй ещё раз."); }
    else { chars = chars.filter(c => c.id !== id); toast("Персонаж удалён."); }
    confirmDel = null; busy = false; render();
  }
};

document.addEventListener("click", e => {
  const b = e.target.closest("[data-act]");
  if (b && H[b.dataset.act]) H[b.dataset.act](b);
});
document.addEventListener("input", e => {
  const el = e.target.closest("[data-bind]");
  if (!el || !review) return;
  const val = el.type === "number" ? (parseInt(el.value, 10) || 0) : el.value;
  setPath(review.char, el.dataset.bind, val);
  if (el.dataset.bind === "name"){
    const btn = document.getElementById("saveImport"), empty = !el.value.trim();
    btn.disabled = empty || busy;
    btn.textContent = empty ? "Впиши имя" : "Сохранить персонажа";
  }
});
document.addEventListener("change", e => {
  if (e.target.id === "lssFile" && e.target.files[0]) startImport(e.target.files[0]);
});
document.addEventListener("submit", e => {
  if (e.target.id !== "newForm") return;
  e.preventDefault();
  const name = document.getElementById("newName").value.trim();
  if (name && !busy) createChar(name);
});

/* ---------- запуск: Supabase сам сообщает, вошёл мастер или нет ---------- */
sb.auth.onAuthStateChange((event, s) => {
  const wasIn = !!session;
  session = s;
  busy = false;
  // Запросы к базе — вне этого обработчика (так советует Supabase), поэтому через setTimeout
  if (s && (!wasIn || !loaded)) { loaded = false; render(); setTimeout(loadChars, 0); }
  else if (!s) { chars = []; loaded = false; render(); }
});
