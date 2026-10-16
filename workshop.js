/* ============================================================
   Мастерская: вход мастера через Discord и список его персонажей.
   Данные лежат в Supabase, в таблице characters. Правила доступа
   в базе сами следят, чтобы мастер видел только своих персонажей.
   ============================================================ */
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm";
import { importLSS } from "/lss.js";
import { CR, viewTemplates, viewBuild, createHandlers, createInput, createChange } from "/create.js";
import { makeSpell } from "/builder.js";

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
      <a class="btn surface" href="/demo">Пример: воин</a>
      <a class="btn surface" href="/demo/nissa">Пример: волшебница</a>
    </div>
    <p class="meta">Входят только мастера. Игрокам аккаунт не нужен.</p>
  </section>
  <section class="steps">
    <div class="step card"><b>Войди через Discord</b><p>Это твоя мастерская: здесь живут все твои персонажи.</p></div>
    <div class="step card"><b>Создай персонажа</b><p>Из готового шаблона в один клик, с нуля в конструкторе, случайно или из файла Long Story Short.</p></div>
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
         ${(c.app ?? c.data?.source?.app) === "builder" ? `<button type="button" class="linkbtn" data-act="edit" data-id="${c.id}">Изменить</button>` : ""}
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
      <label class="way">${WAY_ICONS.file}<b>Из Long Story Short</b><span>Файл .json, проверка перед сохранением</span><input type="file" id="lssFile" accept=".json,application/json" hidden></label>
    </div>
  </section>
  ${list}
  <p class="meta"><button type="button" class="btn surface sm" data-act="logout">Выйти</button></p>`;
}

const WAY_ICONS = {
  tpl:   `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/></svg>`,
  build: `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>`,
  dice:  `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9" cy="9" r="1.2"/><circle cx="15" cy="15" r="1.2"/><circle cx="15" cy="9" r="1.2"/><circle cx="9" cy="15" r="1.2"/></svg>`,
  file:  `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 14l2 2 3-4"/></svg>`
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
  ${c.spellcasting ? reviewSpells() : ""}
  <section class="sec">
    <div class="sec-h"><h2>Снаряжение</h2><p>Нажми ×, чтобы убрать лишнее.</p></div>
    <div class="eqs">${c.equipment.map((e, i) => `<span class="eq card"><span><b>${esc(e.name)}</b>${e.note ? `<small>${esc(e.note)}</small>` : ""}</span><button type="button" data-act="eqDel" data-i="${i}" aria-label="Убрать ${esc(e.name)}">×</button></span>`).join("") || `<p class="meta">Пусто.</p>`}</div>
  </section>
  <div class="savebar">
    <button type="button" class="btn surface" data-act="cancelImport">Отмена</button>
    <button type="button" class="btn primary" id="saveImport" data-act="saveImport"${busy || nameMissing ? " disabled" : ""}>${nameMissing ? "Впиши имя" : "Сохранить персонажа"}</button>
  </div>`;
}

// Заклинания для импортированного героя: список популярных у его класса до доступного круга
function reviewSpells(){
  const c = review.char, S = review.spl.spells;
  const lists = review.spl.classes[c.class.id];
  const maxSlot = Math.max(0, ...Object.keys(c.spellcasting.slots || {}).map(Number));
  const upTo = Math.min(2, Math.max(1, maxSlot));
  const ids = l => lists ? (lists[String(l)] || []) : Object.keys(S).filter(id => S[id].level === l);
  const chip = id => `<button type="button" class="pk" data-act="rvSpell" data-v="${id}" aria-pressed="${review.spellIds.includes(id)}" title="${esc(S[id].plain.replace(/\[\[[a-z0-9-]+\|([^\]]+)\]\]/g, "$1").replace(/\{\{([^|]*)\|[^}]*\}\}/g, ""))}">${esc(S[id].name)}</button>`;
  const groups = [0, 1, 2].filter(l => l <= upTo).map(l => {
    const list = ids(l);
    return list.length ? `<p class="pick-l">${l ? `${l} круг` : "Заговоры"}</p><div class="pick">${list.map(chip).join("")}</div>` : "";
  }).join("");
  const slots = Object.entries(c.spellcasting.slots || {}).map(([l, n]) => `${n} × ${l} круг`).join(", ");
  return `<section class="sec">
    <div class="sec-h"><h2>Заклинания</h2><p>Отметь, что знает герой. В LSS выбраны заклинания, но в файле только их номера, поэтому отмечаем вручную. Ячейки из файла: ${slots || "нет"}. Атака заклинанием ${c.spellcasting.attack >= 0 ? "+" : ""}${c.spellcasting.attack}, сложность ${c.spellcasting.dc}.${maxSlot > 2 ? " Заклинаний 3 круга и выше в справочнике пока нет." : ""}</p></div>
    <div class="pick-h"><b>Выбрано</b><span class="cnt">${review.spellIds.length}</span></div>
    ${groups || `<p class="meta">Для этого класса списка нет.</p>`}
  </section>`;
}

async function startImport(file){
  try {
    const raw = JSON.parse(await file.text());
    const [kb, dict, spl] = await Promise.all(["/data/knowledge.json", "/data/dictionary.json", "/data/spells.json"].map(u => fetch(u).then(r => r.json())));
    const { character, findings } = importLSS(raw, { kb, dict });
    // по каждой находке с выбором сразу применяем первый вариант — это рекомендация
    for (const f of findings) if (f.options){ f.options[0].apply(character); f.chosen = 0; }
    review = { fileName: file.name, char: character, findings, spl, spellIds: [] };
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
  if (c.spellcasting){
    const m = c.spellcasting.attack - c.proficiencyBonus;
    const agon = c.features.some(f => /мучительн/i.test(f.name)) ? Math.floor((c.abilities.cha - 10) / 2) : 0;
    c.spells = review.spellIds.map(id => makeSpell(review.spl, id, { m, pb: c.proficiencyBonus, she: c.pronoun === "she", agonizing: agon })).filter(Boolean);
    if (!c.spells.length && !Object.keys(c.spellcasting.slots || {}).length){ delete c.spells; delete c.spellcasting; }
  }
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
  app.innerHTML = `
    ${header()}
    ${error ? `<div class="alert" role="alert">${esc(error)}</div>` : ""}
    ${!session ? viewGuest() : review ? viewReview() : tableMode ? viewTable() : CR.mode === "templates" ? viewTemplates(ctx) : CR.mode === "build" ? viewBuild(ctx) : viewMaster()}
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
  const { data, error: e } = await sb.from("characters").select("choices:data->source->choices").eq("id", id).single();
  if (e || !data?.choices){ console.error(e); toast("Не получилось открыть персонажа в конструкторе."); return null; }
  return data.choices;
}
const ctx = { esc, toast, render: () => render(), busy: () => busy, save: saveCharacter, loadChoices };

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
    const { data, error: e } = await sb.from("characters").select("name,data").eq("id", b.dataset.id).single();
    if (e || !data){ console.error(e); toast("Не получилось сделать копию."); return; }
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
  rvSpell: b => {
    const i = review.spellIds.indexOf(b.dataset.v);
    if (i >= 0) review.spellIds.splice(i, 1); else review.spellIds.push(b.dataset.v);
    render();
  },
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

Object.assign(H, createHandlers(ctx));

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
  if (createChange(e, ctx)) return;
  if (e.target.id === "lssFile" && e.target.files[0]) startImport(e.target.files[0]);
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
