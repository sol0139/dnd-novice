/* ============================================================
   Мастерская: вход мастера через Discord и список его персонажей.
   Данные лежат в Supabase, в таблице characters. Правила доступа
   в базе сами следят, чтобы мастер видел только своих персонажей.
   ============================================================ */
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm";
import { CR, viewTemplates, viewBuild, createHandlers, createInput, createChange } from "/create.js";
import { ED, startImport, openBlank, openEdit, viewEditor, editorHandlers, editorInput, editorChange, editorToggle, editorKey } from "/editor.js";

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
const LIST_COLS = "id,name,share_slug,created_at,updated_at,race:data->race->>name,cls:data->class,app:data->source->>app";
let profileMode = false; // профиль мастера: статистика и выход
let tableMode = false;  // шпаргалка стола: ключевые числа всех героев на одном экране
let tableRows = null;
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
// Значок: кость к20 (Font Awesome Free, dice-d20, лицензия CC BY 4.0, fontawesome.com)
const BRAND = `<a class="brand" href="/"><span class="brand-mark"><svg viewBox="0 0 15 16" aria-hidden="true"><path d="M3.33594 6.72062L0.0375 11.5922C-0.05875 11.7484 0.040625 11.9516 0.222813 11.9716L6.73094 12.6613L3.33594 6.72062ZM0.231562 9.85719L2.58437 6.03375L0.189375 4.59688C0.105937 4.54688 0 4.60687 0 4.70406V9.79187C0 9.91781 0.165312 9.96469 0.231562 9.85719ZM0.570312 13.2375L6.64531 15.9769C6.81094 16.0534 7 15.9322 7 15.75V13.6978L0.639063 13.0009C0.5 12.9853 0.444375 13.1756 0.570312 13.2375ZM3.10844 5.18188L5.60625 0.715C5.74187 0.494375 5.49406 0.238437 5.26937 0.366875L0.556562 3.44844C0.479375 3.49906 0.481875 3.61281 0.560625 3.66031L3.10844 5.18188ZM7.5 5.5H10.9128L7.92594 0.238125C7.82813 0.079375 7.66406 0 7.5 0C7.33594 0 7.17187 0.079375 7.07406 0.238125L4.08719 5.5H7.5ZM14.8106 4.59688L12.4156 6.03406L14.7684 9.8575C14.8344 9.965 15 9.91812 15 9.79187V4.70406C15 4.60687 14.8941 4.54688 14.8106 4.59688ZM11.8916 5.18188L14.4394 3.66C14.5184 3.6125 14.5206 3.49875 14.4434 3.44812L9.73063 0.366875C9.50594 0.238437 9.25813 0.494375 9.39375 0.715L11.8916 5.18188ZM14.3609 13.0009L8 13.6975V15.7497C8 15.9322 8.18906 16.0531 8.35469 15.9766L14.4297 13.2372C14.5556 13.1756 14.5 12.9853 14.3609 13.0009ZM11.6641 6.72062L8.26937 12.6613L14.7775 11.9716C14.9597 11.9512 15.0591 11.7484 14.9628 11.5922L11.6641 6.72062ZM7.5 6.5H4.36156L7.5 11.9922L10.6384 6.5H7.5Z"/></svg></span>DnD Kids</a>`;

function header(){
  let me = "";
  if (session){
    const m = session.user.user_metadata || {};
    const nick = m.custom_claims?.global_name || m.full_name || m.name || m.user_name || "Мастер";
    me = `<button type="button" class="me" data-act="openProfile" aria-label="Профиль: ${esc(nick)}">${m.avatar_url ? `<img src="${esc(m.avatar_url)}" alt="">` : `<span class="ph"></span>`}<span>${esc(nick)}</span></button>`;
  }
  const fb = session ? `<button type="button" class="iconbtn" data-act="openFeedback" aria-label="Написать автору" title="Написать автору"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4.5 3.5V17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/><path d="M8 10h8M8 13h5"/></svg></button>` : "";
  return `<header class="top-row">${BRAND}<div class="top-btns">${me}${fb}${themeBtn()}</div></header>`;
}

function viewGuest(){
  return `
  <section class="hero">
    <h1>Лист героя для тех, кто играет впервые</h1>
    <p class="lead">Мастер собирает персонажа, игрок открывает его по ссылке. Способности разложены по ходу, каждое слово объяснено.</p>
    <div class="hero-btns">
      <button type="button" class="btn discord" data-act="login"${busy ? " disabled" : ""}>Войти через Discord</button>
      <a class="btn surface" href="/demo">Пример: воин</a>
      <a class="btn surface" href="/demo/nissa">Пример: волшебница</a>
    </div>
    <p class="meta">Входят только мастера. Игрокам аккаунт не нужен.</p>
  </section>
  <section class="steps">
    <div class="step card"><b>Войди через Discord</b><p>Это твоя мастерская: здесь живут все твои персонажи.</p></div>
    <div class="step card"><b>Создай персонажа</b><p>Из шаблона в один клик, в конструкторе, случайно, из файла Long Story Short или вручную на пустом листе.</p></div>
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
         <button type="button" class="btn neutral sm" data-act="qr" data-id="${c.id}" aria-haspopup="dialog">QR-код</button>
       </div>
       <div class="char-more">
         ${(c.app ?? c.data?.source?.app) === "builder"
           ? `<button type="button" class="linkbtn" data-act="edit" data-id="${c.id}">Изменить</button><button type="button" class="linkbtn" data-act="editManual" data-id="${c.id}">Вручную</button>`
           : `<button type="button" class="linkbtn" data-act="editManual" data-id="${c.id}">Изменить</button>`}
         <button type="button" class="linkbtn" data-act="dup" data-id="${c.id}"${busy ? " disabled" : ""}>Сделать копию</button>
         <button type="button" class="linkbtn muted" data-act="askDel" data-id="${c.id}">Удалить</button>
       </div>`;
  return `<article class="char card" data-name="${esc(String(c.name).toLowerCase())}">
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
      ? `<div class="list-h"><h2>Персонажи <span class="cnt">${chars.length}</span></h2>
           <div class="list-acts">
             <button type="button" class="btn surface sm" data-act="copyAll">Все ссылки</button>
             <button type="button" class="btn surface sm" data-act="openTable">Шпаргалка стола</button>
           </div></div>
         ${chars.length > 5 ? `<input class="search" id="charSearch" type="search" placeholder="Найти по имени" autocomplete="off">` : ""}
         <div class="chars">${chars.map(charCard).join("")}</div>`
      : `<div class="empty card">Здесь пока пусто. Создай первого персонажа, и игрок получит его по ссылке.</div>`;
  return `
  <section class="hero">
    <p class="eyebrow">Мастерская</p>
    <h1>Мои персонажи</h1>
  </section>
  <section class="new card">
    <h2>Новый персонаж</h2>
    <div class="ways">
      <button type="button" class="way" data-act="openTemplates">${WAY_ICONS.tpl}<b>Из шаблона</b><span>12 готовых героев, один клик</span></button>
      <button type="button" class="way" data-act="openBuild">${WAY_ICONS.build}<b>С нуля</b><span>Раса, класс и навыки по шагам</span></button>
      <button type="button" class="way" data-act="openRandom">${WAY_ICONS.dice}<b>Случайный</b><span>Бросок судьбы: герой целиком</span></button>
      <label class="way">${WAY_ICONS.file}<b>Из Long Story Short</b><span>Файл .json: сито, потом правь что угодно</span><input type="file" id="lssFile" accept=".json,application/json" hidden></label>
      <button type="button" class="way wide" data-act="openBlank">${WAY_ICONS.blank}<b>Вручную</b><span>Пустой лист: впиши всё сам, без правил и файлов</span></button>
    </div>
  </section>
  ${list}`;
}

const WAY_ICONS = {
  tpl:   `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/></svg>`,
  build: `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>`,
  dice:  `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9" cy="9" r="1.2"/><circle cx="15" cy="15" r="1.2"/><circle cx="15" cy="9" r="1.2"/><circle cx="9" cy="15" r="1.2"/></svg>`,
  file:  `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 14l2 2 3-4"/></svg>`,
  blank: `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>`
};

/* ---------- обратная связь ---------- */
// Текст и скриншот уходят в функцию feedback на Supabase, она сразу пересылает их автору в канал Discord.
// В базе ничего не хранится.
const FB_URL = `${cfg.supabaseUrl}/functions/v1/feedback`;
let fbShot = null;   // сжатый скриншот (Blob)
let fbDraft = "";    // недописанный текст живёт, пока окно закрыто, — пропадает только после отправки или «Отмены»

// Песочные часы для лимита «пять отзывов за десять минут». Сервер говорит, сколько ждать,
// браузер помнит момент, когда снова можно (переживает перезагрузку), и сам оживляет кнопку.
const FB_WAIT_KEY = "novice-sheet:fb-wait";
let fbWait = { until: 0, total: 0 }, fbTick = null, fbWasWaiting = false;
try { fbWait = { until: 0, total: 0, ...JSON.parse(localStorage.getItem(FB_WAIT_KEY) || "{}") }; } catch (e) {}
const fbLeft = () => Math.max(0, Math.ceil((fbWait.until - Date.now()) / 1000));
const mmss = sec => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
function setFbWait(sec){
  fbWait = { until: Date.now() + sec * 1000, total: sec };
  try { localStorage.setItem(FB_WAIT_KEY, JSON.stringify(fbWait)); } catch (e) {}
  fbWaitView();
}
function stopFbTick(){ clearInterval(fbTick); fbTick = null; }
function fbWaitView(){
  const box = document.getElementById("fbWait"), btn = document.getElementById("fbSend");
  if (!box || !btn || !document.getElementById("fbDlg")?.open){ stopFbTick(); return; }
  const left = fbLeft();
  if (!left){
    stopFbTick();
    if (fbWait.until){ fbWait = { until: 0, total: 0 }; try { localStorage.removeItem(FB_WAIT_KEY); } catch (e) {} }
    if (btn.dataset.waiting){ delete btn.dataset.waiting; btn.disabled = false; btn.textContent = "Отправить"; }
    if (fbWasWaiting){
      // песок кончился прямо на глазах — пару секунд показываем, что всё, можно
      fbWasWaiting = false;
      box.classList.add("ready");
      box.querySelector(".fb-wait-txt").textContent = "Песок кончился — можно отправлять.";
      box.querySelector(".fb-bar i").style.width = "0%";
      setTimeout(() => { if (box.isConnected && !fbLeft()){ box.hidden = true; box.classList.remove("ready"); } }, 2600);
    } else box.hidden = true;
    return;
  }
  fbWasWaiting = true;
  box.hidden = false; box.classList.remove("ready");
  box.querySelector(".fb-wait-txt").innerHTML = `Пять отзывов за десять минут — это предел. Следующий улетит через <b class="fb-clock">${mmss(left)}</b>, а писать можно уже сейчас.`;
  box.querySelector(".fb-bar i").style.width = `${Math.min(100, (left / Math.max(1, fbWait.total)) * 100)}%`;
  btn.disabled = true; btn.dataset.waiting = "1"; btn.textContent = `Через ${mmss(left)}`;
  if (!fbTick) fbTick = setInterval(fbWaitView, 1000);
}
function whereNow(){
  if (ED.r) return ED.r.mode === "import" ? "Импорт из LSS" : ED.r.mode === "blank" ? "Пустой лист" : "Ручная правка";
  if (profileMode) return "Профиль";
  if (tableMode) return "Шпаргалка стола";
  if (CR.mode === "templates") return "Шаблоны";
  if (CR.mode === "build") return CR.editId ? "Конструктор, правка" : "Конструктор";
  return "Мои персонажи";
}
function deviceNow(){
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  const br = /YaBrowser/.test(ua) ? "Яндекс" : /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return [os, br, `${window.innerWidth}×${window.innerHeight}`].filter(Boolean).join(", ");
}
// Скриншот ужимаем в браузере: до 1600 точек по длинной стороне, JPEG — обычно 150–400 КБ
async function shrink(file){
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
  return await new Promise(ok => c.toBlob(ok, "image/jpeg", 0.85));
}
function fbShotView(){
  const box = document.getElementById("fbShotBox");
  if (!box) return;
  if (fbShot){
    const url = URL.createObjectURL(fbShot);
    box.innerHTML = `<div class="fb-prev"><img src="${url}" alt="Скриншот"><button type="button" class="x" data-act="fbShotDel" aria-label="Убрать скриншот">×</button></div>`;
  } else {
    box.innerHTML = `<label class="addcond fb-add">Прикрепить скриншот<input type="file" id="fbFile" accept="image/*" hidden></label>
      <span class="meta">или вставь из буфера: Ctrl+V</span>`;
  }
}
async function takeShot(file){
  if (!file || !/^image\//.test(file.type)){ toast("Нужна картинка: PNG или JPG."); return; }
  try { fbShot = await shrink(file); } catch (e) { console.error(e); fbShot = file.size < 4e6 ? file : null; if (!fbShot) toast("Не получилось прочитать картинку."); }
  fbShotView();
}
function openFeedback(){
  let dlg = document.getElementById("fbDlg");
  if (!dlg){
    dlg = document.createElement("dialog"); dlg.id = "fbDlg"; dlg.className = "qr-dlg fb-dlg"; document.body.appendChild(dlg);
    dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); });
    // вставка скриншота из буфера обмена
    dlg.addEventListener("paste", e => {
      const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith("image/"));
      if (item){ e.preventDefault(); takeShot(item.getAsFile()); }
    });
    dlg.addEventListener("change", e => { if (e.target.id === "fbFile" && e.target.files[0]) takeShot(e.target.files[0]); });
    // закрыли окно — текст не выбрасываем, часы останавливаем
    dlg.addEventListener("close", () => { fbDraft = document.getElementById("fbText")?.value || ""; stopFbTick(); });
  }
  dlg.innerHTML = `<div class="qr-in">
    <h3>Написать автору</h3>
    <p class="meta">Что сломалось, что непонятно, чего не хватает — сообщение сразу придёт автору. К нему добавится, где ты сейчас: «${esc(whereNow())}».</p>
    <textarea class="fb-text" id="fbText" rows="5" maxlength="3000" placeholder="Например: в конструкторе не нажимается «Сохранить», когда выбран бард">${esc(fbDraft)}</textarea>
    <div class="fb-shot" id="fbShotBox"></div>
    <div class="fb-wait" id="fbWait" role="status" hidden>
      <p><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12M6 21h12M8 3v2.5a4 4 0 0 0 1.6 3.2L12 12l2.4-3.3A4 4 0 0 0 16 5.5V3M8 21v-2.5a4 4 0 0 1 1.6-3.2L12 12l2.4 3.3a4 4 0 0 1 1.6 3.2V21"/></svg><span class="fb-wait-txt"></span></p>
      <div class="fb-bar"><i></i></div>
    </div>
    <div class="char-acts"><button type="button" class="btn neutral sm" data-act="fbClose">Отмена</button><button type="button" class="btn primary sm" id="fbSend" data-act="fbSend">Отправить</button></div>
  </div>`;
  fbShotView();
  fbWasWaiting = false;
  try { dlg.showModal(); } catch (e) { dlg.setAttribute("open", ""); }
  fbWaitView();
  setTimeout(() => document.getElementById("fbText")?.focus(), 50);
}
async function sendFeedback(){
  const text = (document.getElementById("fbText")?.value || "").trim();
  if (fbLeft()) return;
  if (!text && !fbShot){ toast("Напиши пару слов или приложи скриншот."); return; }
  const btn = document.getElementById("fbSend");
  btn.disabled = true; btn.textContent = "Отправляем…";
  try {
    const { data } = await sb.auth.getSession();
    const token = data?.session?.access_token;
    if (!token){ toast("Войди заново, чтобы отправить отзыв."); return; }
    const fd = new FormData();
    fd.append("text", text); fd.append("page", whereNow()); fd.append("device", deviceNow());
    if (fbShot) fd.append("screenshot", fbShot, "screenshot.jpg");
    const r = await fetch(FB_URL, { method: "POST", headers: { Authorization: `Bearer ${token}`, apikey: cfg.supabaseKey }, body: fd });
    if (r.ok){ document.getElementById("fbText").value = ""; fbShot = null; document.getElementById("fbDlg").close(); toast("Спасибо! Сообщение улетело автору."); return; }
    const body = await r.json().catch(() => ({}));
    const err = body.error;
    if (err === "limit"){ setFbWait(Math.max(1, Math.min(600, Math.round(+body.retryAfter) || 600))); return; }
    toast({ "not-configured": "Отправка ещё не настроена. Автор скоро её подключит.",
      big: "Скриншот слишком большой.", auth: "Войди заново, чтобы отправить отзыв.", empty: "Напиши пару слов или приложи скриншот." }[err] || "Не получилось отправить. Попробуй ещё раз.");
  } catch (e){
    console.error(e); toast("Нет связи. Попробуй ещё раз чуть позже.");
  } finally {
    if (btn.isConnected && !btn.dataset.waiting){ btn.disabled = false; btn.textContent = "Отправить"; }
  }
}

/* ---------- профиль мастера ---------- */
const nickOf = () => { const m = session?.user?.user_metadata || {}; return m.custom_claims?.global_name || m.full_name || m.name || m.user_name || "Мастер"; };
const plural = (n, one, few, many) => { const t = n % 10, h = n % 100; return t === 1 && h !== 11 ? one : t >= 2 && t <= 4 && (h < 12 || h > 14) ? few : many; };
function viewProfile(){
  const m = session.user.user_metadata || {};
  const n = chars.length;
  const levels = chars.map(c => +(c.cls ?? c.data?.class)?.level || 0).filter(Boolean);
  const avg = levels.length ? (levels.reduce((a, b) => a + b, 0) / levels.length) : 0;
  const count = key => { const o = {}; chars.forEach(c => { const k = key(c); if (k) o[k] = (o[k] || 0) + 1; }); return Object.entries(o).sort((a, b) => b[1] - a[1]); };
  const byClass = count(c => (c.cls ?? c.data?.class)?.name);
  const byRace = count(c => c.race ?? c.data?.race?.name);
  const APP = { builder: "Конструктор и шаблоны", lss: "Long Story Short", manual: "Вручную" };
  const bySource = count(c => APP[c.app ?? c.data?.source?.app] || "Первые версии");
  const dates = chars.map(c => c.created_at).filter(Boolean).sort();
  const last = chars.map(c => c.updated_at).filter(Boolean).sort().pop();
  const since = session.user.created_at;
  const bars = (rows, total) => rows.length ? `<div class="bars">${rows.map(([k, v]) => `<div class="bar"><span>${esc(k)}</span><i style="--w:${Math.max(6, Math.round(v / total * 100))}%"></i><b>${v}</b></div>`).join("")}</div>` : `<p class="meta">Пока пусто.</p>`;
  const tile = (l, v, s) => `<div class="pf-tile card"><span>${l}</span><b>${v}</b>${s ? `<small>${s}</small>` : ""}</div>`;
  return `
  <section class="hero">
    <p class="eyebrow"><button type="button" class="linkbtn" data-act="closeProfile">← Мои персонажи</button></p>
    <div class="pf-who">
      ${m.avatar_url ? `<img src="${esc(m.avatar_url)}" alt="">` : `<span class="ph"></span>`}
      <div><h1>${esc(nickOf())}</h1><p class="meta">Вход через Discord${since ? ` · в мастерской с ${new Date(since).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}` : ""}</p></div>
    </div>
  </section>
  <div class="pf-tiles">
    ${tile("Персонажей", n, `${plural(n, "герой", "героя", "героев")} в мастерской`)}
    ${tile("Средний уровень", avg ? avg.toFixed(1).replace(".0", "").replace(".", ",") : "—", levels.length ? `от ${Math.min(...levels)} до ${Math.max(...levels)}` : "")}
    ${tile("Разных классов", byClass.length, byClass[0] && byClass[0][1] > 1 ? `чаще всего — ${esc(byClass[0][0].toLowerCase())}` : byClass.length ? "все разные" : "")}
    ${tile("Последняя правка", last ? when(last) : "—", dates[0] ? `первый герой — ${when(dates[0])}` : "")}
  </div>
  <section class="card pf-sec">
    <h2>Место в мастерской</h2>
    <div class="meter"><i style="--w:${Math.min(100, n)}%"></i></div>
    <p class="meta">${n} из 100 мест занято. Один герой весит около 6 КБ, бесплатной базы хватит с огромным запасом.</p>
  </section>
  <section class="card pf-sec"><h2>Классы</h2>${bars(byClass, n || 1)}</section>
  <section class="card pf-sec"><h2>Расы</h2>${bars(byRace, n || 1)}</section>
  <section class="card pf-sec"><h2>Откуда герои</h2>${bars(bySource, n || 1)}</section>
  <section class="card pf-sec">
    <h2>Написать автору</h2>
    <p class="meta">Нашёл ошибку, что-то непонятно или чего-то не хватает — напиши и приложи скриншот. Сообщение сразу придёт автору.</p>
    <button type="button" class="btn neutral" data-act="openFeedback">Написать</button>
  </section>
  <section class="pf-out">
    <button type="button" class="btn surface" data-act="logout">Выйти из аккаунта</button>
    <p class="meta">Персонажи останутся в базе, ссылки у игроков продолжат работать.</p>
  </section>`;
}

/* ---------- шпаргалка стола ---------- */
// Только нужные поля, без описаний способностей
const TABLE_COLS = "id,name,share_slug,cls:data->class,race:data->race->>name,ac:data->ac->>value,hp:data->hp->>max,speed:data->>speed,ab:data->abilities,skills:data->skills,ex:data->expertise,pb:data->>proficiencyBonus,pp:data->>passivePerception,half:data->>halfProf,sc:data->spellcasting,langs:data->languages,saves:data->saves";
const TABLE_KEY = "novice-sheet:table";
const ABBR = { str: "СИЛ", dex: "ЛОВ", con: "ТЕЛ", int: "ИНТ", wis: "МДР", cha: "ХАР" };
const md = s => Math.floor(((+s || 10) - 10) / 2);
const sgn = n => (n < 0 ? "−" : "+") + Math.abs(n);
function tableHero(r){
  const d = r.data || { class: r.cls, race: { name: r.race }, ac: { value: +r.ac }, hp: { max: +r.hp }, speed: +r.speed, abilities: r.ab || {},
    skills: r.skills || [], expertise: r.ex || [], proficiencyBonus: +r.pb || 2, passivePerception: r.pp != null ? +r.pp : null,
    halfProf: r.half === "true" || r.half === true, spellcasting: r.sc, languages: r.langs || [], saves: r.saves || [] };
  const pb = +d.proficiencyBonus || 2, A = d.abilities || {};
  const bonus = (id, ab) => md(A[ab]) + ((d.expertise || []).includes(id) ? 2 * pb : (d.skills || []).includes(id) ? pb : d.halfProf ? Math.floor(pb / 2) : 0);
  return {
    id: r.id, name: r.name, cls: d.class, race: d.race?.name, ac: d.ac?.value, hp: d.hp?.max, speed: d.speed,
    pp: d.passivePerception ?? 10 + bonus("perception", "wis"), pi: 10 + bonus("insight", "wis"), pinv: 10 + bonus("investigation", "int"),
    dc: d.spellcasting?.dc, atk: d.spellcasting?.attack, langs: d.languages || [], saves: d.saves || []
  };
}
function readTablePick(){ try { return JSON.parse(localStorage.getItem(TABLE_KEY)); } catch (e) { return null; } }
function viewTable(){
  if (!tableRows) return `<p class="meta">Собираем числа…</p>`;
  const heroes = tableRows.map(tableHero);
  const pick = readTablePick();
  const on = h => !pick || pick.includes(h.id);
  const sel = heroes.filter(on);
  const low = sel.length ? sel.reduce((a, b) => (b.pp < a.pp ? b : a)) : null;
  const langs = [...new Set(sel.flatMap(h => h.langs))];
  const tile = (l, v) => `<span><small>${l}</small><b>${v ?? "—"}</b></span>`;
  return `
  <section class="hero">
    <p class="eyebrow"><button type="button" class="linkbtn" data-act="closeTable">← Мои персонажи</button></p>
    <h1>Шпаргалка стола</h1>
    <p class="lead">Числа, которые мастер спрашивает чаще всего. Отметь, кто сегодня играет.</p>
  </section>
  <div class="pick">${heroes.map(h => `<button type="button" class="pk" data-act="tablePick" data-id="${h.id}" aria-pressed="${on(h)}">${esc(h.name)}</button>`).join("")}</div>
  ${sel.length ? `<section class="card tbl-sum">
    ${low ? `<p><b>Засаду заметит не каждый.</b> Самое низкое пассивное Восприятие — ${low.pp} (${esc(low.name)}). Спрятанное со Сл ${low.pp + 1} и выше этот герой не заметит, если не ищет специально.</p>` : ""}
    <p><b>Языки стола:</b> ${esc(langs.join(", ") || "—")}.</p>
  </section>` : `<p class="meta">Никто не отмечен.</p>`}
  <div class="tbl">${sel.map(h => `<article class="card tbl-card">
    <div class="tbl-h"><h3>${esc(h.name)}</h3><span class="src">${esc([h.race, h.cls ? `${h.cls.name} ${h.cls.level}` : ""].filter(Boolean).join(" · "))}</span></div>
    <div class="tbl-tiles">${tile("КД", h.ac)}${tile("Хиты", h.hp)}${tile("Скорость", h.speed ? h.speed / 5 + " кл." : "—")}${tile("Пасс. Восприятие", h.pp)}${tile("Пасс. Проницат.", h.pi)}${tile("Пасс. Анализ", h.pinv)}${h.dc ? tile("Сл заклинаний", h.dc) + tile("Атака закл.", sgn(h.atk)) : ""}</div>
    <p class="meta">Спасброски с мастерством: ${h.saves.map(a => ABBR[a] || a).join(", ") || "—"}. Языки: ${esc(h.langs.join(", ") || "—")}.</p>
  </article>`).join("")}</div>`;
}
async function openTable(){
  tableMode = true; tableRows = null; render(); window.scrollTo({ top: 0 });
  const { data, error: e } = await sb.from("characters").select(TABLE_COLS).order("name");
  if (e){ console.error(e); toast("Не получилось собрать шпаргалку."); tableMode = false; render(); return; }
  tableRows = data; render();
}

/* ---------- QR-код ссылки: библиотека грузится только когда нужна ---------- */
let qrLoading = null;
const loadQR = () => window.qrcode ? Promise.resolve() : (qrLoading = qrLoading || new Promise((ok, fail) => {
  const s = document.createElement("script"); s.src = "/vendor/qrcode.js"; s.onload = ok; s.onerror = fail; document.head.appendChild(s);
}));
async function showQR(c){
  try { await loadQR(); } catch (e) { toast("Не получилось нарисовать QR-код."); return; }
  const qr = window.qrcode(0, "M"); qr.addData(shareLink(c)); qr.make();
  let dlg = document.getElementById("qrDlg");
  if (!dlg){ dlg = document.createElement("dialog"); dlg.id = "qrDlg"; dlg.className = "qr-dlg"; document.body.appendChild(dlg);
    dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); }); }
  dlg.innerHTML = `<div class="qr-in">
    <h3>${esc(c.name)}</h3>
    <div class="qr-box">${qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true })}</div>
    <p class="meta">Игрок наводит камеру телефона на код и сразу попадает в свой лист.</p>
    <div class="char-acts"><button type="button" class="btn neutral sm" data-act="copy" data-id="${c.id}">Скопировать ссылку</button><button type="button" class="btn primary sm" data-act="qrClose">Готово</button></div>
  </div>`;
  try { dlg.showModal(); } catch (e) { dlg.setAttribute("open", ""); }
}

/* Внутренние экраны (шаблоны, конструктор, редактор, шпаргалка, профиль) — отдельный шаг истории,
   чтобы кнопка «назад» браузера и жест «назад» на телефоне возвращали к списку, а не уводили с сайта */
let historyStep = false;
const inSubview = () => !!(session && (ED.r || profileMode || tableMode || CR.mode));
function leaveSubviews(){ ED.r = null; profileMode = false; tableMode = false; tableRows = null; CR.mode = null; CR.draft = null; CR.editId = null; }
window.addEventListener("popstate", () => {
  if (!historyStep) return;
  historyStep = false;
  if (inSubview()){ leaveSubviews(); render(); window.scrollTo({ top: 0 }); }
});
function syncHistory(){
  if (inSubview() && !historyStep){ history.pushState({ sub: true }, ""); historyStep = true; }
  else if (!inSubview() && historyStep){ historyStep = false; history.back(); }
}

function render(){
  syncHistory();
  app.innerHTML = `
    ${header()}
    ${error ? `<div class="alert" role="alert">${esc(error)}</div>` : ""}
    ${!session ? viewGuest() : ED.r ? viewEditor(ctx) : profileMode ? viewProfile() : tableMode ? viewTable() : CR.mode === "templates" ? viewTemplates(ctx) : CR.mode === "build" ? viewBuild(ctx) : viewMaster()}
    <footer class="foot">Правила D&amp;D 5e (2014). Часть материалов взята из System Reference Document 5.1 © Wizards of the Coast LLC, лицензия CC-BY-4.0. Популярность заклинаний — по данным D&amp;D Beyond.</footer>`;
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

// Сохранить готовый лист: новый — вставкой, правку — обновлением той же строки (ссылка игрока не меняется)
async function saveCharacter(c, editId){
  const size = new TextEncoder().encode(JSON.stringify(c)).length;
  if (size > 150000){ toast("Персонаж слишком большой для бесплатной базы."); return false; }
  busy = true; render();
  const q = editId
    ? sb.from("characters").update({ name: c.name, data: c }).eq("id", editId)
    : sb.from("characters").insert({ name: c.name, data: c });
  const { data, error: e } = await q.select(LIST_COLS).single();
  busy = false;
  if (e){
    console.error(e);
    toast(/Слишком много/.test(e.message || "") ? e.message : "Не получилось сохранить. Попробуй ещё раз.");
    render(); return false;
  }
  chars = [data, ...chars.filter(x => x.id !== data.id)];
  toast(editId ? `«${c.name}» обновлён. Ссылка у игрока та же.` : `«${c.name}» готов: ${Math.max(1, Math.round(size / 1024))} КБ в базе. Нажми «Ссылка игроку».`);
  return true;
}
// Выбор мастера лежит внутри листа: достаём только его, без всего персонажа
async function loadChoices(id){
  const { data, error: e } = await sb.from("characters").select("choices:data->source->choices,manual:data->source->>manual").eq("id", id).single();
  if (e || !data?.choices){ console.error(e); toast("Не получилось открыть персонажа в конструкторе."); return null; }
  return { ...data.choices, _manual: data.manual === "true" || data.manual === true };
}
// Весь лист одной строкой — для копии и ручной правки
async function loadFull(id){
  const { data, error: e } = await sb.from("characters").select("name,data").eq("id", id).single();
  if (e || !data){ console.error(e); toast("Не получилось открыть персонажа."); return null; }
  return data;
}
const ctx = { esc, toast, render: () => render(), busy: () => busy, save: saveCharacter, loadChoices, loadFull,
  setError: msg => { error = msg; } };

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
  logout: async () => { profileMode = false; await sb.auth.signOut(); },
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
  qr: b => { const c = chars.find(x => x.id === b.dataset.id); if (c) showQR(c); },
  qrClose: () => { const d = document.getElementById("qrDlg"); if (d) d.close(); },
  copyAll: async () => {
    const text = chars.map(c => `${c.name} — ${shareLink(c)}`).join("\n");
    try { await navigator.clipboard.writeText(text); toast(`Ссылки скопированы: ${chars.length} шт. Вставь их в чат игры.`); }
    catch (e) { toast(text); }
  },
  dup: async b => {
    if (busy) return;
    const data = await loadFull(b.dataset.id);
    if (!data) return;
    const c = { ...data.data, name: `${data.name} (копия)`.slice(0, 80) };
    if (c.source?.choices) c.source = { ...c.source, choices: { ...c.source.choices, name: c.name } };
    await saveCharacter(c, null);
    render();
  },
  openTable: () => openTable(),
  openFeedback: () => openFeedback(),
  fbClose: () => { const t = document.getElementById("fbText"); if (t) t.value = ""; fbShot = null; document.getElementById("fbDlg")?.close(); },
  fbShotDel: () => { fbShot = null; fbShotView(); },
  fbSend: () => sendFeedback(),
  openProfile: () => { leaveSubviews(); profileMode = true; render(); window.scrollTo({ top: 0 }); },
  closeProfile: () => { profileMode = false; render(); window.scrollTo({ top: 0 }); },
  closeTable: () => { tableMode = false; tableRows = null; render(); window.scrollTo({ top: 0 }); },
  tablePick: b => {
    const all = tableRows.map(r => r.id);
    let pick = readTablePick() || all;
    pick = pick.includes(b.dataset.id) ? pick.filter(x => x !== b.dataset.id) : [...pick, b.dataset.id];
    try { localStorage.setItem(TABLE_KEY, JSON.stringify(pick)); } catch (e) {}
    render();
  },
  openBlank: () => openBlank(ctx),
  editManual: b => openEdit(b.dataset.id, ctx),
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

Object.assign(H, createHandlers(ctx), editorHandlers(ctx));

document.addEventListener("click", e => {
  const b = e.target.closest("[data-act]");
  if (b && H[b.dataset.act]) H[b.dataset.act](b);
});
document.addEventListener("input", e => {
  if (e.target.id === "charSearch"){
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll(".char").forEach(el => { el.hidden = !!q && !el.dataset.name.includes(q); });
    return;
  }
  if (createInput(e, ctx)) return;
  editorInput(e, ctx);
});
document.addEventListener("change", e => {
  if (e.target.id === "lssFile" && e.target.files[0]){ startImport(e.target.files[0], ctx); e.target.value = ""; return; }
  if (createChange(e, ctx)) return;
  editorChange(e, ctx);
});
// toggle не всплывает — слушаем на погружении
document.addEventListener("toggle", editorToggle, true);
document.addEventListener("keydown", editorKey);

/* ---------- запуск: Supabase сам сообщает, вошёл мастер или нет ---------- */
sb.auth.onAuthStateChange((event, s) => {
  const wasIn = !!session;
  session = s;
  busy = false;
  // Запросы к базе — вне этого обработчика (так советует Supabase), поэтому через setTimeout
  if (s && (!wasIn || !loaded)) { loaded = false; render(); setTimeout(loadChars, 0); }
  else if (!s) { chars = []; loaded = false; render(); }
});
