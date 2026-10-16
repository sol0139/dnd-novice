/* ============================================================
   Столы: мастер собирает героев одной компании и видит их сводку.
   За стол садятся герои из мастерской мастера и герои игроков:
   игрок сам — по коду или ссылке /t/КОД, мастер — по ссылке на лист игрока.
   В базе лежат только связи «стол — герой» (game_tables, table_seats),
   а права проверяют правила базы и функции join_table, seat_by_link, get_table.
   ============================================================ */

export const TB = {
  list: null,       // мои столы: где я мастер и где сидят мои герои (null — ещё не пришли)
  roomId: null,     // открытый стол
  room: undefined,  // его содержимое: undefined — грузится, null — нет доступа
  invite: null,     // приглашение по коду: { code, state: "loading" | "ok" | "missing", p }
  pickHero: null,   // какого героя игрок выбрал в приглашении
  newName: "", codeVal: "", linkVal: "", renameVal: "",
  renaming: false, confirmDel: false, confirmSeat: null,
  busy: false
};

const JOIN_KEY = "novice-sheet:join";
const ABSENT_KEY = id => `novice-sheet:absent:${id}`;
const NAME_IDEAS = ["Таверна «Хромой грифон»", "Пятничный данж", "Отряд «Последний шанс»", "Кружок у камина",
  "Партия в библиотеке", "Вторник у Миши", "Гильдия опоздавших", "Экспедиция в Подземье"];
const NAME_IDEA = NAME_IDEAS[Math.floor(Math.random() * NAME_IDEAS.length)];

let C = null;   // общий контекст мастерской (esc, toast, render, sb, …)
const esc = s => C.esc(s);

/* ---------- коды и ссылки ---------- */
const clean = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
// Из «https://…/t/k7q-x2m», «k7q x2m» или «K7QX2M» достаём сам код
export const codeFrom = s => { const m = String(s || "").match(/\/t\/([A-Za-z0-9-]+)/); return clean(m ? m[1] : s); };
// Из ссылки на лист «https://…/c/abc123» или самого кусочка «abc123» — код листа
const slugFrom = s => { const t = String(s || "").trim(); const m = t.match(/\/c\/([A-Za-z0-9]+)/); return m ? m[1] : /^[A-Za-z0-9]{6,32}$/.test(t) ? t : ""; };
const fmtCode = c => (c ? `${c.slice(0, 3)} ${c.slice(3)}` : "");
const inviteLink = code => `${location.origin}/t/${code}`;
const plural = (n, one, few, many) => { const t = n % 10, h = n % 100; return t === 1 && h !== 11 ? one : t >= 2 && t <= 4 && (h < 12 || h > 14) ? few : many; };
const heroes = n => `${n} ${plural(n, "герой", "героя", "героев")}`;
// Понятные ошибки из базы (P0001) показываем как есть, остальные — общей фразой и в консоль
const errText = (e, fallback) => { if (e?.code === "P0001" && e.message) return e.message; console.error(e); return fallback; };

function readJoin(){ try { return localStorage.getItem(JOIN_KEY) || ""; } catch (e) { return ""; } }
function saveJoin(code){ try { code ? localStorage.setItem(JOIN_KEY, code) : localStorage.removeItem(JOIN_KEY); } catch (e) {} }

/* ---------- запуск ---------- */
export function initTables(ctx){
  C = ctx;
  // Ссылка-приглашение /t/КОД: запоминаем код (он переживёт вход через Discord) и чистим адрес
  const m = location.pathname.match(/^\/t\/([A-Za-z0-9-]{4,16})\/?$/);
  if (m){ saveJoin(codeFrom(m[1])); history.replaceState(null, "", "/"); }
  const code = readJoin();
  if (code) loadInvite(code);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && TB.roomId) fetchRoom(true); });
}

export async function loadTables(){
  const { data, error } = await C.sb.rpc("my_tables");
  if (error){ console.error(error); TB.list = TB.list || []; return; }
  TB.list = Array.isArray(data) ? data : [];
}
// На каких столах сидит мой герой — для карточки персонажа
export const tablesOf = id => (TB.list || []).filter(t => (t.heroes || []).some(h => h.id === id));

export async function loadInvite(code){
  code = clean(code);
  if (!code) return;
  saveJoin(code);
  TB.invite = { code, state: "loading" }; TB.pickHero = null; C.render();
  const { data, error } = await C.sb.rpc("table_preview", { code });
  if (TB.invite?.code !== code) return;
  if (error){ console.error(error); TB.invite = { code, state: "missing" }; }
  else TB.invite = data ? { code, state: "ok", p: data } : { code, state: "missing" };
  C.render();
}
function dropInvite(){ TB.invite = null; TB.pickHero = null; saveJoin(""); }

/* ---------- открытый стол ---------- */
let poll = null;
export function closeRoom(){ clearInterval(poll); poll = null; TB.roomId = null; TB.room = undefined; TB.renaming = false; TB.confirmDel = false; TB.confirmSeat = null; TB.linkVal = ""; }
async function openRoom(id){
  closeRoom();
  TB.roomId = id; C.render(); window.scrollTo({ top: 0 });
  await fetchRoom(false);
  // Пока мастер смотрит на стол, раз в 20 секунд проверяем, не сел ли кто-то по приглашению
  poll = setInterval(() => { if (TB.roomId && document.visibilityState === "visible") fetchRoom(true); }, 20000);
}
let deferred = false;
const typing = () => { const a = document.activeElement; return a && a.closest && a.closest("#app") && /^(INPUT|TEXTAREA)$/.test(a.tagName); };
async function fetchRoom(silent){
  const id = TB.roomId;
  if (!id) return;
  const { data, error } = await C.sb.rpc("get_table", { tbl: id });
  if (TB.roomId !== id) return;
  if (error){ console.error(error); if (!silent){ TB.room = null; C.render(); } return; }
  const before = TB.room;
  if (silent && before && JSON.stringify(before) === JSON.stringify(data) && !deferred) return;
  if (silent && before && data){
    const was = new Set((before.heroes || []).map(h => h.id));
    const fresh = (data.heroes || []).filter(h => !was.has(h.id));
    if (fresh.length) C.toast(fresh.length === 1
      ? `«${fresh[0].name}» теперь за столом${fresh[0].player ? ` — игрок ${fresh[0].player}` : ""}.`
      : `Новые герои за столом: ${fresh.map(h => `«${h.name}»`).join(", ")}.`);
  }
  TB.room = data;
  syncListFromRoom();
  // Не перерисовываем под пальцами: если мастер что-то печатает, обновим чуть позже
  if (silent && typing()){ deferred = true; return; }
  deferred = false;
  C.render();
}
// Список столов держим в согласии с открытым столом
function syncListFromRoom(){
  const r = TB.room;
  if (!r || !TB.list) return;
  const t = TB.list.find(x => x.id === r.id);
  const short = { id: r.id, name: r.name, isMaster: r.isMaster, code: r.code, master: r.master, heroes: (r.heroes || []).map(h => ({ id: h.id, name: h.name, mine: h.mine })) };
  if (t) Object.assign(t, short); else TB.list.unshift(short);
}

/* ---------- сводка: числа, которые мастер спрашивает чаще всего ---------- */
const ABBR = { str: "СИЛ", dex: "ЛОВ", con: "ТЕЛ", int: "ИНТ", wis: "МДР", cha: "ХАР" };
const md = s => Math.floor(((+s || 10) - 10) / 2);
const sgn = n => (n < 0 ? "−" : "+") + Math.abs(n);
function heroNumbers(h){
  const d = h.data || {};
  const pb = +d.proficiencyBonus || 2, A = d.abilities || {};
  const bonus = (id, ab) => md(A[ab]) + ((d.expertise || []).includes(id) ? 2 * pb : (d.skills || []).includes(id) ? pb : d.halfProf ? Math.floor(pb / 2) : 0);
  return {
    ...h, cls: d.class, race: d.race?.name, ac: d.ac?.value, hp: d.hp?.max, speed: d.speed,
    pp: d.passivePerception ?? 10 + bonus("perception", "wis"), pi: 10 + bonus("insight", "wis"), pinv: 10 + bonus("investigation", "int"),
    dc: d.spellcasting?.dc, atk: d.spellcasting?.attack, langs: d.languages || [], saves: d.saves || []
  };
}
function readAbsent(id){ try { return JSON.parse(localStorage.getItem(ABSENT_KEY(id))) || []; } catch (e) { return []; } }

/* ---------- круглый стол сверху: точка — герой, зелёные — твои ---------- */
function tableGlyph(list, size = 48){
  const n = list.length, c = size / 2, R = size / 2 - 5, r = n > 7 ? 3.4 : 4.2;
  const dots = list.map((h, i) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return `<circle cx="${(c + R * Math.cos(a)).toFixed(1)}" cy="${(c + R * Math.sin(a)).toFixed(1)}" r="${r}" class="${h.mine ? "mine" : ""}"/>`;
  }).join("");
  return `<svg class="tb-glyph" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="${c}" cy="${c}" r="${(R - r - 3).toFixed(1)}" class="top${n ? "" : " empty"}"/>${dots}</svg>`;
}

/* ============================================================
   Вкладка «Столы»
   ============================================================ */
export function viewTablesTab(){
  const list = TB.list;
  const items = !list ? `<p class="meta">Накрываем столы…</p>`
    : list.map(t => `<button type="button" class="tb-item card" data-act="tbOpen" data-id="${t.id}">
        ${tableGlyph(t.heroes || [])}
        <span class="tb-item-b">
          <b>${esc(t.name)}</b>
          <span class="tb-role">${t.isMaster ? "Ты мастер" : `Мастер — ${esc(t.master)}`} · ${(t.heroes || []).length ? heroes(t.heroes.length) : "пока никого"}</span>
          ${(t.heroes || []).length ? `<span class="tb-names">${t.heroes.map(h => `<i${h.mine ? ` class="mine"` : ""}>${esc(h.name)}</i>`).join("")}</span>` : ""}
        </span>
      </button>`).join("");
  const create = `<section class="new card">
    <h2>Новый стол</h2>
    <p class="meta">Стол собирает героев одной компании: твоих и тех, кого приведут игроки. Ты видишь их числа на одном экране.</p>
    <div class="new-row"><input id="tbName" maxlength="60" autocomplete="off" placeholder="${esc(NAME_IDEA)}" value="${esc(TB.newName)}" aria-label="Название стола"><button type="button" class="btn primary" data-act="tbCreate"${TB.busy ? " disabled" : ""}>Создать</button></div>
  </section>`;
  const join = `<section class="card tb-join">
    <h2>Позвали за стол?</h2>
    <p class="meta">Введи код из шести знаков, который дал мастер, или просто открой его ссылку.</p>
    <div class="new-row"><input id="tbCode" maxlength="40" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Например: K7Q X2M" value="${esc(TB.codeVal)}" aria-label="Код стола"><button type="button" class="btn neutral" data-act="tbFind">Найти</button></div>
  </section>`;
  if (!list) return `${items}${create}${join}`;
  return list.length ? `<div class="tb-list">${items}</div>${create}${join}` : `${create}${join}`;
}

/* ============================================================
   Приглашение: «тебя зовут за стол»
   ============================================================ */
export function viewInvite(guest){
  const iv = TB.invite;
  if (!iv) return "";
  if (iv.state === "loading") return `<section class="card tb-inv"><p class="meta">Ищем стол по коду ${esc(fmtCode(iv.code))}…</p></section>`;
  if (iv.state === "missing") return `<section class="card tb-inv">
    <p class="eyebrow">Приглашение за стол</p>
    <h2>Стол не нашёлся</h2>
    <p class="meta">По коду ${esc(fmtCode(iv.code))} стола нет. Может, мастер сменил код — попроси свежий.</p>
    <div class="char-acts"><button type="button" class="btn neutral sm" data-act="tbDropInvite">Понятно</button></div>
  </section>`;
  const p = iv.p;
  const head = `<p class="eyebrow">Приглашение за стол</p>
    <div class="tb-inv-h">${tableGlyph(Array.from({ length: Math.min(10, p.seats) }, () => ({})), 52)}<div><h2>${esc(p.name)}</h2>
    <p class="meta">Мастер — ${esc(p.master)} · ${p.seats ? `за столом ${heroes(p.seats)}` : "за столом пока пусто"}</p></div></div>`;
  if (guest) return `<section class="card tb-inv">${head}
    <p>Войди через Discord: там можно собрать своего героя и сесть за этот стол. Мастер сразу увидит тебя в сводке.</p>
    <div class="char-acts"><button type="button" class="btn discord" data-act="login">Войти через Discord</button></div>
  </section>`;
  if (p.isMaster) return `<section class="card tb-inv">${head}
    <p>Это твой стол — так его увидят игроки.</p>
    <div class="char-acts"><button type="button" class="btn primary sm" data-act="tbInviteOpen">Открыть стол</button><button type="button" class="btn neutral sm" data-act="tbDropInvite">Закрыть</button></div>
  </section>`;
  const mine = C.chars();
  const seated = new Set(p.seated || []);
  if (!mine.length) return `<section class="card tb-inv">${head}
    <p>Сначала нужен герой. Собери его ниже — из шаблона это один клик, — и приглашение будет ждать здесь.</p>
    <div class="char-acts"><button type="button" class="btn primary sm" data-act="tbToChars">Собрать героя</button><button type="button" class="btn neutral sm" data-act="tbDropInvite">Не сейчас</button></div>
  </section>`;
  const free = mine.filter(c => !seated.has(c.id));
  return `<section class="card tb-inv">${head}
    <div class="pick-l">${free.length ? "Кого посадишь?" : "Все твои герои уже за этим столом"}</div>
    <div class="pick">${mine.map(c => seated.has(c.id)
      ? `<span class="pk locked">${esc(c.name)} <small>уже тут</small></span>`
      : `<button type="button" class="pk" data-act="tbPickHero" data-id="${c.id}" aria-pressed="${TB.pickHero === c.id}">${esc(c.name)}</button>`).join("")}</div>
    <div class="char-acts">
      ${free.length ? `<button type="button" class="btn primary sm" data-act="tbJoin"${!TB.pickHero || TB.busy ? " disabled" : ""}>${TB.pickHero ? `Сесть за стол` : "Выбери героя"}</button>` : `<button type="button" class="btn primary sm" data-act="tbInviteOpen">Открыть стол</button>`}
      <button type="button" class="btn neutral sm" data-act="tbDropInvite">Не сейчас</button>
    </div>
  </section>`;
}

/* ============================================================
   Открытый стол
   ============================================================ */
export function viewRoom(){
  const back = `<p class="eyebrow"><button type="button" class="linkbtn" data-act="tbClose">← Столы</button></p>`;
  const r = TB.room;
  if (r === undefined) return `<section class="hero">${back}<p class="meta">Накрываем на стол…</p></section>`;
  if (r === null) return `<section class="hero">${back}<h1>Стол не найден</h1>
    <p class="lead">Его удалили, или за ним больше нет твоих героев.</p></section>`;
  const list = (r.heroes || []).map(heroNumbers);
  const absent = new Set(r.isMaster ? readAbsent(r.id) : []);
  const sel = list.filter(h => !absent.has(h.id));
  const low = sel.length ? sel.reduce((a, b) => (b.pp < a.pp ? b : a)) : null;
  const langs = [...new Set(sel.flatMap(h => h.langs))];
  const tile = (l, v) => `<span><small>${l}</small><b>${v ?? "—"}</b></span>`;

  const title = TB.renaming
    ? `<div class="new-row"><input id="tbRename" maxlength="60" value="${esc(TB.renameVal)}" aria-label="Название стола"><button type="button" class="btn primary" data-act="tbRenameSave">Сохранить</button></div>
       <button type="button" class="linkbtn muted tb-sm" data-act="tbRenameCancel">Отмена</button>`
    : `<div class="tb-head">${tableGlyph(list, 56)}<div><h1>${esc(r.name)}</h1>
       <p class="meta">${r.isMaster ? "Ты мастер" : `Мастер — ${esc(r.master)}`} · ${list.length ? heroes(list.length) : "пока никого"}${r.isMaster ? ` · <button type="button" class="linkbtn tb-sm" data-act="tbRename">переименовать</button>` : ""}</p></div></div>`;

  const invite = r.isMaster ? `<section class="card tb-call noprint">
    <h2>Позвать игроков</h2>
    <div class="tb-code" aria-label="Код стола: ${esc(r.code.split("").join(" "))}"><span>${esc(r.code.slice(0, 3))}</span><span>${esc(r.code.slice(3))}</span></div>
    <p class="meta">Отправь игроку ссылку или продиктуй код. Он войдёт через Discord, соберёт героя и сам сядет за стол — ты увидишь его здесь, страница обновляется сама.</p>
    <div class="char-link">${esc(inviteLink(r.code))}</div>
    <div class="char-acts">
      <button type="button" class="btn primary sm" data-act="tbCopyInvite">Скопировать приглашение</button>
      <button type="button" class="btn neutral sm" data-act="tbQR" aria-haspopup="dialog">QR-код</button>
    </div>
    <div class="char-more"><button type="button" class="linkbtn muted" data-act="tbRenew"${TB.busy ? " disabled" : ""}>Сменить код</button><span class="meta">старая ссылка перестанет работать</span></div>
  </section>` : "";

  const seatedIds = new Set(list.map(h => h.id));
  const free = C.chars().filter(c => !seatedIds.has(c.id));
  const seat = r.isMaster ? `<section class="card tb-seat noprint">
    <h2>Посадить героя</h2>
    <div class="pick-l">Из твоей мастерской</div>
    ${free.length ? `<div class="pick">${free.map(c => `<button type="button" class="pk" data-act="tbSeatMine" data-id="${c.id}"${TB.busy ? " disabled" : ""}><span aria-hidden="true">+</span> ${esc(c.name)}</button>`).join("")}</div>`
      : `<p class="meta">${C.chars().length ? "Все твои герои уже за столом." : "В мастерской пока пусто."}</p>`}
    <div class="pick-l">По ссылке игрока</div>
    <p class="meta">Игрок собрал героя сам? Попроси у него «Ссылку игроку» со своей карточки и вставь сюда.</p>
    <div class="new-row"><input id="tbLink" autocomplete="off" spellcheck="false" placeholder="${esc(location.origin)}/c/…" value="${esc(TB.linkVal)}" aria-label="Ссылка на лист игрока"><button type="button" class="btn neutral" data-act="tbSeatLink"${TB.busy ? " disabled" : ""}>Посадить</button></div>
  </section>` : "";

  const card = h => {
    const who = h.mine ? (r.isMaster ? "из твоей мастерской" : "твой герой") : h.player ? `игрок ${esc(h.player)}` : `от мастера`;
    const canDrop = r.isMaster || h.mine;
    const dropLabel = r.isMaster ? (h.mine ? "Убрать со стола" : "Убрать со стола") : "Встать из-за стола";
    const acts = TB.confirmSeat === h.id
      ? `<div class="confirm"><p>${r.isMaster && !h.mine ? `Убрать «${esc(h.name)}»? Вернуть героя сможет игрок по коду или ты по его ссылке.` : r.isMaster ? `Убрать «${esc(h.name)}» со стола? Сам герой останется в мастерской.` : `Увести «${esc(h.name)}» из-за стола? Вернуться можно будет по коду мастера.`}</p>
          <div class="char-acts"><button type="button" class="btn danger sm" data-act="tbUnseat" data-id="${h.id}"${TB.busy ? " disabled" : ""}>${r.isMaster ? "Убрать" : "Встать"}</button><button type="button" class="btn neutral sm" data-act="tbUnseatCancel">Отмена</button></div></div>`
      : `<div class="char-more noprint">${h.slug ? `<a class="linkbtn" href="/c/${esc(h.slug)}">Открыть лист</a>` : ""}${canDrop ? `<button type="button" class="linkbtn muted" data-act="tbUnseatAsk" data-id="${h.id}">${dropLabel}</button>` : ""}</div>`;
    return `<article class="card tbl-card${absent.has(h.id) ? " away" : ""}">
      <div class="tbl-h"><h3>${esc(h.name)}</h3><span class="src">${esc([h.race, h.cls ? `${h.cls.name} ${h.cls.level}` : ""].filter(Boolean).join(" · "))}</span></div>
      <p class="tb-who${h.mine ? " mine" : ""}">${who}</p>
      ${absent.has(h.id) ? `<p class="meta">Сегодня не играет — в сводку не попадает.</p>` : `<div class="tbl-tiles">${tile("КД", h.ac)}${tile("Хиты", h.hp)}${tile("Скорость", h.speed ? h.speed / 5 + " кл." : "—")}${tile("Пасс. Восприятие", h.pp)}${tile("Пасс. Проницат.", h.pi)}${tile("Пасс. Анализ", h.pinv)}${h.dc ? tile("Сл заклинаний", h.dc) + tile("Атака закл.", sgn(h.atk)) : ""}</div>
      <p class="meta">Спасброски с мастерством: ${h.saves.map(a => ABBR[a] || a).join(", ") || "—"}. Языки: ${esc(h.langs.join(", ") || "—")}.</p>`}
      ${acts}
    </article>`;
  };

  const summary = list.length ? `
    ${r.isMaster && list.length > 1 ? `<div class="pick-l">Кто сегодня играет</div><div class="pick noprint">${list.map(h => `<button type="button" class="pk" data-act="tbAbsent" data-id="${h.id}" aria-pressed="${!absent.has(h.id)}">${esc(h.name)}</button>`).join("")}</div>` : ""}
    ${sel.length ? `<section class="card tbl-sum">
      ${low ? `<p><b>Засаду заметит не каждый.</b> Самое низкое пассивное Восприятие — ${low.pp} (${esc(low.name)}). Спрятанное со Сл ${low.pp + 1} и выше этот герой не заметит, если не ищет специально.</p>` : ""}
      <p><b>Языки стола:</b> ${esc(langs.join(", ") || "—")}.</p>
    </section>` : `<p class="meta">Никто не отмечен.</p>`}
    <div class="tbl">${list.map(card).join("")}</div>`
    : `<div class="empty card">${r.isMaster ? "За столом пока никого. Позови игроков кодом или посади своих героев." : "За столом пока никого."}</div>`;

  const danger = r.isMaster ? (TB.confirmDel
    ? `<div class="confirm noprint"><p>Удалить стол «${esc(r.name)}»? Герои останутся у своих хозяев, исчезнет только стол и его код.</p>
        <div class="char-acts"><button type="button" class="btn danger sm" data-act="tbDelete"${TB.busy ? " disabled" : ""}>Удалить стол</button><button type="button" class="btn neutral sm" data-act="tbDelCancel">Отмена</button></div></div>`
    : `<div class="char-more noprint"><button type="button" class="linkbtn muted" data-act="tbDelAsk">Удалить стол</button></div>`) : "";

  return `<section class="hero tb-hero">${back}${title}</section>
    ${invite}${seat}
    ${list.length ? `<div class="list-h"><h2>Сводка стола</h2></div>` : ""}
    ${summary}
    ${danger}`;
}

/* ============================================================
   Кнопки и поля
   ============================================================ */
export function tablesInput(e){
  const id = e.target.id;
  if (id === "tbName"){ TB.newName = e.target.value; return true; }
  if (id === "tbCode"){ TB.codeVal = e.target.value; return true; }
  if (id === "tbLink"){ TB.linkVal = e.target.value; return true; }
  if (id === "tbRename"){ TB.renameVal = e.target.value; return true; }
  return false;
}
// Enter в поле — как кнопка рядом
export function tablesKey(e){
  if (e.key !== "Enter") return false;
  const map = { tbName: "tbCreate", tbCode: "tbFind", tbLink: "tbSeatLink", tbRename: "tbRenameSave" };
  const act = map[e.target.id];
  if (!act) return false;
  e.preventDefault(); H[act]?.();
  return true;
}
// Если стол обновился, пока мастер печатал, — дорисовываем, когда он закончит
export function tablesBlur(){ if (deferred) setTimeout(() => { if (!typing() && deferred){ deferred = false; C.render(); } }, 150); }

const busy = async (fn) => { if (TB.busy) return; TB.busy = true; C.render(); try { await fn(); } finally { TB.busy = false; C.render(); } };

const H = {
  tbOpen: b => openRoom(b.dataset.id),
  tbClose: () => { closeRoom(); C.render(); window.scrollTo({ top: 0 }); },
  tbCreate: () => busy(async () => {
    const name = (TB.newName.trim() || NAME_IDEA).slice(0, 60);
    const { data, error } = await C.sb.from("game_tables").insert({ name }).select("id,name,invite_code").single();
    if (error){ C.toast(errText(error, "Не получилось создать стол. Попробуй ещё раз.")); return; }
    TB.newName = "";
    TB.list = [{ id: data.id, name: data.name, isMaster: true, code: data.invite_code, master: C.nick(), heroes: [] }, ...(TB.list || [])];
    C.toast(`Стол «${data.name}» накрыт. Теперь позови игроков или посади своих героев.`);
    setTimeout(() => openRoom(data.id), 0);
  }),
  tbFind: () => {
    const code = codeFrom(TB.codeVal);
    if (code.length !== 6){ C.toast("В коде шесть знаков: буквы и цифры, например K7Q X2M."); return; }
    TB.codeVal = ""; loadInvite(code); window.scrollTo({ top: 0, behavior: "smooth" });
  },
  tbDropInvite: () => { dropInvite(); C.render(); },
  tbToChars: () => { C.setTab("chars"); C.render(); },
  tbPickHero: b => { TB.pickHero = TB.pickHero === b.dataset.id ? null : b.dataset.id; C.render(); },
  tbInviteOpen: async () => {
    const id = TB.invite?.p?.id;
    dropInvite();
    if (id) openRoom(id); else C.render();
  },
  tbJoin: () => busy(async () => {
    const iv = TB.invite, hero = TB.pickHero;
    if (!iv || !hero) return;
    const { data, error } = await C.sb.rpc("join_table", { code: iv.code, hero });
    if (error){ C.toast(errText(error, "Не получилось сесть за стол. Попробуй ещё раз.")); return; }
    const name = C.chars().find(c => c.id === hero)?.name || "Герой";
    dropInvite();
    C.toast(data.already ? `«${name}» уже сидит за этим столом.` : `«${name}» за столом «${data.name}». Мастер уже видит тебя.`);
    await loadTables();
    setTimeout(() => openRoom(data.id), 0);
  }),
  tbCopyInvite: async () => {
    const r = TB.room;
    const text = `Садись за мой стол «${r.name}» в DnD Kids: ${inviteLink(r.code)}\nИли открой ${location.host}, вкладка «Столы», и введи код ${fmtCode(r.code)}.`;
    try { await navigator.clipboard.writeText(text); C.toast("Приглашение скопировано. Вставь его в чат игры."); }
    catch (e) { C.toast(text); }
  },
  tbQR: () => { const r = TB.room; C.showQR({ title: r.name, link: inviteLink(r.code), note: `Игрок наводит камеру на код и попадает к приглашению. Код стола: ${fmtCode(r.code)}.`, copyAct: "tbCopyInvite" }); },
  tbRenew: () => busy(async () => {
    const { data, error } = await C.sb.rpc("renew_table_code", { tbl: TB.roomId });
    if (error || !data){ console.error(error); C.toast("Не получилось сменить код."); return; }
    TB.room.code = data; syncListFromRoom();
    C.toast(`Новый код: ${fmtCode(data)}. Старая ссылка больше не работает.`);
  }),
  tbRename: () => { TB.renaming = true; TB.renameVal = TB.room.name; C.render(); setTimeout(() => document.getElementById("tbRename")?.select(), 30); },
  tbRenameCancel: () => { TB.renaming = false; C.render(); },
  tbRenameSave: () => busy(async () => {
    const name = TB.renameVal.trim().slice(0, 60);
    if (!name){ C.toast("Без названия стол потеряется в списке."); return; }
    const { error } = await C.sb.from("game_tables").update({ name }).eq("id", TB.roomId);
    if (error){ console.error(error); C.toast("Не получилось переименовать."); return; }
    TB.room.name = name; TB.renaming = false; syncListFromRoom();
  }),
  tbSeatMine: b => busy(async () => {
    const id = b.dataset.id;
    const { error } = await C.sb.from("table_seats").insert({ table_id: TB.roomId, character_id: id });
    if (error && error.code !== "23505"){ C.toast(errText(error, "Не получилось посадить героя.")); return; }
    await fetchRoom(false);
  }),
  tbSeatLink: () => busy(async () => {
    const slug = slugFrom(TB.linkVal);
    if (!slug){ C.toast("Вставь ссылку на лист целиком — она выглядит как …/c/abc123."); return; }
    const { data, error } = await C.sb.rpc("seat_by_link", { tbl: TB.roomId, slug });
    if (error){ C.toast(errText(error, "Не получилось посадить героя по ссылке.")); return; }
    TB.linkVal = "";
    C.toast(data.already ? `«${data.name}» уже за столом.` : `«${data.name}» за столом.`);
    await fetchRoom(false);
  }),
  tbUnseatAsk: b => { TB.confirmSeat = b.dataset.id; C.render(); },
  tbUnseatCancel: () => { TB.confirmSeat = null; C.render(); },
  tbUnseat: b => busy(async () => {
    const id = b.dataset.id, r = TB.room;
    const { error } = await C.sb.from("table_seats").delete().eq("table_id", TB.roomId).eq("character_id", id);
    if (error){ console.error(error); C.toast("Не получилось. Попробуй ещё раз."); return; }
    TB.confirmSeat = null;
    const h = r.heroes.find(x => x.id === id);
    r.heroes = r.heroes.filter(x => x.id !== id);
    syncListFromRoom();
    // Игрок увёл последнего своего героя — стол ему больше не виден
    if (!r.isMaster && !r.heroes.some(x => x.mine)){
      TB.list = (TB.list || []).filter(t => t.id !== r.id);
      C.toast(`«${h?.name}» больше не за столом «${r.name}».`);
      closeRoom();
    }
  }),
  tbAbsent: b => {
    const id = TB.roomId, a = new Set(readAbsent(id));
    a.has(b.dataset.id) ? a.delete(b.dataset.id) : a.add(b.dataset.id);
    try { localStorage.setItem(ABSENT_KEY(id), JSON.stringify([...a])); } catch (e) {}
    C.render();
  },
  tbDelAsk: () => { TB.confirmDel = true; C.render(); },
  tbDelCancel: () => { TB.confirmDel = false; C.render(); },
  tbDelete: () => busy(async () => {
    const id = TB.roomId, name = TB.room?.name;
    const { error } = await C.sb.from("game_tables").delete().eq("id", id);
    if (error){ console.error(error); C.toast("Не получилось удалить стол."); return; }
    TB.list = (TB.list || []).filter(t => t.id !== id);
    try { localStorage.removeItem(ABSENT_KEY(id)); } catch (e) {}
    closeRoom(); window.scrollTo({ top: 0 });
    C.toast(`Стол «${name}» убран. Герои остались у хозяев.`);
  })
};
export const tablesHandlers = () => H;
