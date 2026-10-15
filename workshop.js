/* ============================================================
   Мастерская: вход мастера через Discord и список его персонажей.
   Данные лежат в Supabase, в таблице characters. Правила доступа
   в базе сами следят, чтобы мастер видел только своих персонажей.
   ============================================================ */
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm";

const cfg = window.APP_CONFIG;
const sb = createClient(cfg.supabaseUrl, cfg.supabaseKey);
const app = document.getElementById("app");
const THEME_KEY = "novice-sheet:theme";

let session = null;     // кто вошёл (null — гость)
let chars = [];         // персонажи мастера
let loaded = false;     // список уже пришёл из базы
let confirmDel = null;  // id персонажа, которого спрашиваем «удалить?»
let busy = false;       // идёт запрос — кнопки на это время гаснут
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
  const d = c.data || {};
  const sub = [d.race?.name, d.class ? `${d.class.name} ${d.class.level} уровня` : ""].filter(Boolean).join(" · ");
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
    <p class="meta">Пока персонаж создаётся из шаблона: полуорк-воин 1 уровня. Импорт из LSS и конструктор — следующие шаги.</p>
  </form>
  ${list}
  <p class="meta"><button type="button" class="btn surface sm" data-act="logout">Выйти</button></p>`;
}

function render(){
  const keepName = document.getElementById("newName")?.value || "";
  app.innerHTML = `
    ${header()}
    ${error ? `<div class="alert" role="alert">${esc(error)}</div>` : ""}
    ${session ? viewMaster() : viewGuest()}
    <footer class="foot">Правила D&amp;D 5e (2014). Часть материалов взята из System Reference Document 5.1 © Wizards of the Coast LLC, лицензия CC-BY-4.0.</footer>`;
  const input = document.getElementById("newName");
  if (input) input.value = keepName;
}

/* ---------- работа с базой ---------- */
async function loadChars(){
  const { data, error: e } = await sb.from("characters")
    .select("id,name,share_slug,updated_at,data")
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
      .select("id,name,share_slug,updated_at,data")
      .single();
    if (e) throw e;
    chars.unshift(data);
    document.getElementById("newName").value = "";
    toast(`«${name}» готов. Нажми «Ссылка игроку», чтобы отправить его.`);
  } catch (e){
    console.error(e);
    toast("Не получилось создать персонажа. Попробуй ещё раз.");
  }
  busy = false; render();
}

/* ---------- кнопки ---------- */
const H = {
  login: async () => {
    busy = true; render();
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
