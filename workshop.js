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
const LIST_COLS = "id,name,share_slug,updated_at,race:data->race->>name,cls:data->class,app:data->source->>app";
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
  ${list}
  <p class="meta"><button type="button" class="btn surface sm" data-act="logout">Выйти</button></p>`;
}

const WAY_ICONS = {
  tpl:   `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/></svg>`,
  build: `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>`,
  dice:  `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9" cy="9" r="1.2"/><circle cx="15" cy="15" r="1.2"/><circle cx="15" cy="9" r="1.2"/><circle cx="9" cy="15" r="1.2"/></svg>`,
  file:  `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 14l2 2 3-4"/></svg>`,
  blank: `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>`
};

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

function render(){
  app.innerHTML = `
    ${header()}
    ${error ? `<div class="alert" role="alert">${esc(error)}</div>` : ""}
    ${!session ? viewGuest() : ED.r ? viewEditor(ctx) : tableMode ? viewTable() : CR.mode === "templates" ? viewTemplates(ctx) : CR.mode === "build" ? viewBuild(ctx) : viewMaster()}
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
