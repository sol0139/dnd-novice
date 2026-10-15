/* ============================================================
   Мастерская: новый персонаж без файлов.
   Три дороги: шаблон в один клик, конструктор с нуля и случайный герой.
   Все числа считает builder.js, здесь только экраны и кнопки.
   В базу уходит готовый лист плюс выбор мастера (чтобы потом поправить).
   ============================================================ */
import {
  normalize, buildCharacter, randomChoices, randomName, rollStats, assignStats,
  abilityBonuses, finalAbilities, skillInfo, casterInfo, raceCantripInfo, SKILL_NAMES
} from "/builder.js";

let R = null, SPL = null, TPL = null;   // rules.json, spells.json, templates.json
export async function loadCreateData(){
  if (R) return;
  [R, SPL, TPL] = await Promise.all(["/data/rules.json", "/data/spells.json", "/data/templates.json"]
    .map(u => fetch(u).then(r => { if (!r.ok) throw new Error(u); return r.json(); })));
}

// Состояние экранов создания. mode: null | "templates" | "build"
export const CR = { mode: null, draft: null, editId: null, tplLevel: 1, preview: null };

const AB = ["str", "dex", "con", "int", "wis", "cha"];
const ABBR = { str: "СИЛ", dex: "ЛОВ", con: "ТЕЛ", int: "ИНТ", wis: "МДР", cha: "ХАР" };
const sg = n => (n < 0 ? "−" : "+") + Math.abs(n);
const mod = s => Math.floor((s - 10) / 2);
const dice = f => String(f || "").replace(/(\d*)d(\d+)/g, (_, n, s) => `${n === "1" || !n ? "" : n}к${s}`).replace(/-/g, "−");
const byId = (l, id) => l.find(x => x.id === id);

/* ---------- кусочки ---------- */
const pk = (act, val, label, on, extra = "") =>
  `<button type="button" class="pk" data-act="${act}" data-v="${val}" aria-pressed="${!!on}"${extra}>${label}</button>`;
const counter = (n, max) => `<span class="cnt${n === max ? " full" : ""}">${n} из ${max}</span>`;
const sec = (title, note, body, id = "") =>
  `<section class="sec"${id ? ` id="${id}"` : ""}><div class="sec-h"><h2>${title}</h2>${note ? `<p>${note}</p>` : ""}</div>${body}</section>`;

/* ============================================================
   Шаблоны
   ============================================================ */
export function viewTemplates(ctx){
  const { esc } = ctx;
  const lv = CR.tplLevel;
  const cards = TPL.templates.map(t => {
    const c = buildCharacter(R, SPL, { ...t.choices, level: lv });
    return `<article class="tpl card">
      <div class="tpl-h"><h3>${esc(c.name)}</h3><span class="src">${esc(t.hint)}</span></div>
      <p class="char-sub">${esc(c.race.name)} · ${esc(c.class.name)}${c.class.subclass ? `, ${esc(c.class.subclass.toLowerCase())}` : ""}</p>
      <p class="tpl-pitch">${esc(c.pitch || "")}</p>
      <p class="tpl-stats"><span>КД <b>${c.ac.value}</b></span><span>Хиты <b>${c.hp.max}</b></span><span>Скорость <b>${c.speed / 5}</b> кл.</span>${c.spells ? `<span>Заклинаний <b>${c.spells.length}</b></span>` : ""}</p>
      <div class="char-acts">
        <button type="button" class="btn primary sm" data-act="tplCreate" data-id="${t.id}"${ctx.busy() ? " disabled" : ""}>Создать</button>
        <button type="button" class="btn neutral sm" data-act="tplTune" data-id="${t.id}">Настроить</button>
      </div>
    </article>`;
  }).join("");
  return `
  <section class="hero">
    <p class="eyebrow"><button type="button" class="linkbtn" data-act="crBack">← Мои персонажи</button></p>
    <h1>Шаблоны</h1>
    <p class="lead">Двенадцать готовых героев, по одному на класс. Выбери уровень и жми «Создать» — через секунду ссылку можно отправлять игроку.</p>
  </section>
  <div class="seg" role="group" aria-label="Уровень"><span class="seg-l">Уровень</span>${[1, 2, 3, 4].map(l => pk("tplLevel", l, String(l), l === lv)).join("")}</div>
  <div class="tpls">${cards}</div>`;
}

/* ============================================================
   Конструктор
   ============================================================ */
export function viewBuild(ctx){
  const { esc } = ctx;
  const d = CR.draft = normalize(R, SPL, CR.draft);
  const c = buildCharacter(R, SPL, d);
  CR.preview = c;
  const race = byId(R.races, d.race), cls = byId(R.classes, d.class), bg = byId(R.backgrounds, d.background);
  const sub = race.subraces ? byId(race.subraces, d.subrace) : null;
  const needColor = race.colors || (cls.subclass && cls.subclass.colors && d.level >= cls.subclass.level);
  const ab = finalAbilities(R, d), bon = abilityBonuses(R, d);
  const si = skillInfo(R, d);
  const ci = casterInfo(R, SPL, d, ab);
  const nameEmpty = !String(d.name || "").trim();

  /* --- кто это --- */
  const who = `<div class="card cr-box">
    <label class="fld"><span>Имя</span>
      <span class="fld-row"><input id="crName" data-cbind="name" value="${esc(d.name)}" placeholder="Имя героя" maxlength="80" autocomplete="off">
      <button type="button" class="btn neutral sm" data-act="crRandName" title="Другое имя">Другое</button></span></label>
    <div class="seg" role="group" aria-label="Как обращаться в подсказках"><span class="seg-l">В подсказках</span>${pk("crPronoun", "he", "Он", d.pronoun !== "she")}${pk("crPronoun", "she", "Она", d.pronoun === "she")}</div>
    <label class="fld"><span>Одна фраза о герое</span>
      <span class="fld-row"><input data-cbind="pitch" value="${esc(d.pitch || "")}" placeholder="Например: держит щит и не умеет врать" maxlength="160" autocomplete="off">
      <button type="button" class="btn neutral sm" data-act="crRandPitch">Другая</button></span></label>
  </div>`;

  /* --- раса --- */
  const raceBody = `<div class="pick">${R.races.map(r => pk("crRace", r.id, esc(r.name), r.id === d.race)).join("")}</div>
    <p class="meta">${esc(race.about || "")}</p>
    ${race.subraces ? `<div class="pick sub">${race.subraces.map(s => pk("crSub", s.id, esc(s.name), s.id === d.subrace)).join("")}</div>` : ""}
    ${needColor ? `<div class="pick sub"><span class="seg-l">Дракон</span>${R.dragonColors.map(col => pk("crColor", col.id, `${esc(col.name)} <small>${esc(col.dmg)}</small>`, col.id === d.color)).join("")}</div>` : ""}`;

  /* --- класс, уровень, снаряжение --- */
  const classBody = `<div class="pick">${R.classes.map(k => pk("crClass", k.id, esc(k.name), k.id === d.class)).join("")}</div>
    <p class="meta">${esc(cls.about || "")}${cls.subclass ? ` Подкласс: ${esc(cls.subclass.name.toLowerCase())}, с ${cls.subclass.level} уровня.` : ""}</p>
    <div class="seg" role="group" aria-label="Уровень"><span class="seg-l">Уровень</span>${[1, 2, 3, 4].map(l => pk("crLevel", l, String(l), l === d.level)).join("")}</div>
    <div class="pick sub"><span class="seg-l">Снаряжение</span>${cls.kits.map(k => pk("crKit", k.id, esc(k.name), k.id === d.kit)).join("")}</div>
    ${cls.id === "ranger" ? `<div class="pick sub"><span class="seg-l">Добыча</span>${R.enemies.map(e => pk("crEnemy", e, esc(e), e === d.enemy)).join("")}</div>
      <div class="pick sub"><span class="seg-l">Местность</span>${R.terrains.map(e => pk("crTerrain", e, esc(e), e === d.terrain)).join("")}</div>` : ""}`;

  /* --- предыстория --- */
  const bgBody = `<div class="pick">${R.backgrounds.map(b => pk("crBg", b.id, esc(b.name), b.id === d.background)).join("")}</div>
    <p class="meta">Навыки: ${bg.skills.map(s => SKILL_NAMES[s]).join(", ")}. ${esc(bg.feature[0])}: ${esc(bg.feature[1])}</p>`;

  /* --- характеристики --- */
  const cells = AB.map(a => {
    const plus = bon.race[a] + bon.asi[a];
    return `<label class="abl card">
      <span class="abl-n">${ABBR[a]}</span>
      <input type="number" min="3" max="20" data-abl="${a}" value="${d.base[a]}" aria-label="${R.abilityNames[a]}: значение до бонусов">
      <span class="abl-b">${plus ? `${sg(plus)} = ${ab[a]}` : `= ${ab[a]}`}</span>
      <span class="abl-m">${sg(mod(ab[a]))}</span>
    </label>`;
  }).join("");
  const sel = (act, i, cur, label, exclude = []) =>
    `<label class="mini-sel">${label}<select data-act-sel="${act}" data-i="${i}">${AB.filter(a => !exclude.includes(a)).map(a =>
      `<option value="${a}"${a === cur ? " selected" : ""}>${R.abilityNames[a]}</option>`).join("")}</select></label>`;
  let flex = "";
  if (race.asiFree === 3) flex = `<div class="sels">${sel("asiFree", 0, d.asiFree[0], "+2 к")}${sel("asiFree", 1, d.asiFree[1], "+1 к")}</div>`;
  if (race.asiFree === 2) flex = `<div class="sels">${sel("asiFree", 0, d.asiFree[0], "+1 к", ["cha"])}${sel("asiFree", 1, d.asiFree[1], "+1 к", ["cha"])}</div>`;
  const asi = d.level >= 4 ? `<div class="sels"><span class="seg-l">4 уровень</span>${sel("asi4", 0, d.asi4[0], "+1 к")}${sel("asi4", 1, d.asi4[1], "+1 к")}</div>` : "";
  const ablBody = `<div class="abls">${cells}</div>
    ${flex}${asi}
    <div class="char-acts">
      <button type="button" class="btn neutral sm" data-act="crStd">Стандартный набор</button>
      <button type="button" class="btn neutral sm" data-act="crRoll">Бросить 4к6</button>
    </div>
    <p class="meta">${d.baseAuto ? `Стандартный набор 15, 14, 13, 12, 10, 8 разложен под класс: главная характеристика — ${R.abilityNames[((cls.kits.find(k => k.id === d.kit) || {}).order || cls.order)[0]].toLowerCase()}.` : "Свои значения. «Стандартный набор» вернёт расклад по классу."} Бонусы расы${d.level >= 4 ? " и 4 уровня" : ""} прибавлены справа.</p>`;

  /* --- навыки --- */
  const prof = new Set([...si.fixed, ...d.skills, ...d.raceSkills, ...d.bonusSkills]);
  const skillChips = (list, chosen, act, max) => list.map(s => {
    const locked = si.fixed.includes(s);
    const on = locked || chosen.includes(s);
    const taken = !chosen.includes(s) && prof.has(s);
    return locked || taken ? `<span class="pk locked" title="Уже есть">${SKILL_NAMES[s]}</span>`
      : pk(act, s, SKILL_NAMES[s], on);
  }).join("");
  let skillBody = `<p class="meta">Уже есть: ${si.fixed.map(s => SKILL_NAMES[s]).join(", ") || "—"}.</p>
    <div class="pick-h"><b>От класса</b>${counter(d.skills.length, si.choose)}</div>
    <div class="pick">${skillChips(si.from, d.skills, "crSkill", si.choose)}</div>`;
  if (si.raceChoose) skillBody += `<div class="pick-h"><b>${race.skillChoice ? `От расы (${esc(race.name.toLowerCase())})` : "Взамен совпавшего"}</b>${counter(d.raceSkills.length, si.raceChoose)}</div>
    <div class="pick">${skillChips(Object.keys(SKILL_NAMES), d.raceSkills, "crRaceSkill", si.raceChoose)}</div>`;
  if (si.bonusChoose) skillBody += `<div class="pick-h"><b>От подкласса</b>${counter(d.bonusSkills.length, si.bonusChoose)}</div>
    <div class="pick">${skillChips(Object.keys(SKILL_NAMES), d.bonusSkills, "crBonusSkill", si.bonusChoose)}</div>`;
  if (si.expertise) skillBody += `<div class="pick-h"><b>Компетентность: мастерство вдвойне</b>${counter(d.expertise.length, si.expertise)}</div>
    <div class="pick">${[...prof].map(s => pk("crExpert", s, SKILL_NAMES[s], d.expertise.includes(s))).join("")}</div>`;

  /* --- заклинания --- */
  let spellSec = "";
  if (ci){
    const S = SPL.spells;
    const chip = (act, id, on) => pk(act, id, esc(S[id].name), on, ` title="${esc(S[id].plain.replace(/\[\[[a-z0-9-]+\|([^\]]+)\]\]/g, "$1"))}"`);
    let body = `<p class="meta">Списки начинаются с самых популярных у игроков. Наведи или задержи палец на названии, чтобы прочитать, что оно делает.</p>`;
    if (ci.cantrips) body += `<div class="pick-h"><b>Заговоры</b>${counter(d.cantrips.length, ci.cantrips)}</div>
      <div class="pick">${ci.cantripPool.map(id => chip("crCantrip", id, d.cantrips.includes(id))).join("")}</div>`;
    if (ci.always.length) body += `<div class="pick-h"><b>Всегда подготовлены</b></div>
      <div class="pick">${ci.always.map(id => `<span class="pk locked">${esc(S[id].name)}</span>`).join("")}</div>`;
    body += `<div class="pick-h"><b>${ci.prepared ? "Подготовленные" : "Известные"}${ci.maxLevel > 1 ? `, 1–${ci.maxLevel} круг` : ", 1 круг"}</b>${counter(d.spells.length, ci.count)}</div>`;
    for (let l = 1; l <= ci.maxLevel; l++){
      const ids = ci.leveledPool.filter(id => S[id].level === l);
      if (ids.length) body += `${ci.maxLevel > 1 ? `<p class="pick-l">${l} круг</p>` : ""}<div class="pick">${ids.map(id => chip("crSpell", id, d.spells.includes(id))).join("")}</div>`;
    }
    const slots = Object.entries(ci.slots).map(([l, n]) => `${n} × ${l} круг`).join(", ");
    spellSec = sec("Заклинания", `Ячейки на этом уровне: ${slots}${ci.type === "pact" ? ", возвращаются после короткого отдыха" : ""}.`, body, "cr-spells");
  }
  const rci = raceCantripInfo(R, SPL, d);
  if (rci && !rci.fixed){
    spellSec += sec("Заговор расы", `${esc(sub ? sub.name : race.name)} знает ещё один заговор, сверх заговоров класса.`,
      `<div class="pick">${rci.list.map(id => d.cantrips.includes(id) ? `<span class="pk locked">${esc(SPL.spells[id].name)}</span>` : pk("crRaceCantrip", id, esc(SPL.spells[id].name), d.raceCantrip === id)).join("")}</div>`);
  }

  /* --- языки --- */
  const extraN = (race.extraLanguages || 0) + ((sub && sub.extraLanguages) || 0) + (bg.languages || 0);
  const langSec = extraN ? sec("Языки", `Уже знает: ${race.languages.join(", ")}. Ещё ${extraN} на выбор.`,
    `<div class="pick-h"><b>Дополнительные</b>${counter(d.languages.length, extraN)}</div>
     <div class="pick">${R.languages.filter(l => !race.languages.includes(l)).map(l => pk("crLang", l, esc(l), d.languages.includes(l))).join("")}</div>`) : "";

  /* --- итог --- */
  const attacks = c.features.filter(f => f.attack);
  const sum = `<section class="card cr-sum">
    <div class="sum-h"><h3>${esc(c.name)}</h3><span class="src">${esc(c.race.name)} · ${esc(c.class.name)} ${c.class.level}</span></div>
    <div class="sum-tiles">
      <span><small>КД</small><b>${c.ac.value}</b></span><span><small>Хиты</small><b>${c.hp.max}</b></span>
      <span><small>Инициатива</small><b>${sg(mod(c.abilities.dex) + (c.halfProf ? 1 : 0))}</b></span><span><small>Скорость</small><b>${c.speed / 5} <small>кл.</small></b></span>
    </div>
    <p class="meta">${esc(c.ac.why)}.</p>
    ${attacks.length ? `<ul class="sum-list">${attacks.map(f => `<li><span>${esc(f.name)}</span><b>${sg(f.attack.toHit)} · ${dice(f.attack.damage)}</b></li>`).join("")}</ul>` : ""}
    <p class="meta">${c.features.length} способностей${c.spells ? `, ${c.spells.length} заклинаний` : ""}, ${c.equipment.length} предметов.</p>
    <button type="button" class="btn surface sm" data-act="crPreview">Посмотреть как игрок</button>
  </section>`;

  return `
  <section class="hero">
    <p class="eyebrow"><button type="button" class="linkbtn" data-act="crBack">← Мои персонажи</button></p>
    <h1>${CR.editId ? "Правка героя" : "Новый персонаж"}</h1>
    <p class="lead">Выбирай по порядку сверху вниз. Числа, навыки и заклинания конструктор подставляет сам, поправить можно всё.</p>
    <div class="hero-btns"><button type="button" class="btn neutral sm" data-act="crRandom">Случайный герой</button></div>
  </section>
  ${sec("Кто это", "", who)}
  ${sec("Раса", "", raceBody)}
  ${sec("Класс", "", classBody)}
  ${sec("Предыстория", "Кем герой был до приключений.", bgBody)}
  ${sec("Характеристики", "Число до бонусов можно вписать своё.", ablBody)}
  ${sec("Навыки", "", skillBody)}
  ${spellSec}
  ${langSec}
  ${sec("Что получилось", "", sum)}
  <div class="savebar">
    <button type="button" class="btn surface" data-act="crBack">Отмена</button>
    <button type="button" class="btn primary" id="crSave" data-act="crSave"${ctx.busy() || nameEmpty ? " disabled" : ""}>${nameEmpty ? "Впиши имя" : CR.editId ? "Сохранить изменения" : "Сохранить персонажа"}</button>
  </div>`;
}

/* ============================================================
   Кнопки
   ============================================================ */
// Переключатель в списке с лимитом: снял — освободил место; полный — просим сначала снять
function toggle(list, v, max, ctx, what){
  const i = list.indexOf(v);
  if (i >= 0){ list.splice(i, 1); return true; }
  if (list.length >= max){ ctx.toast(`Уже выбрано ${max}. Сначала сними ${what}.`); return false; }
  list.push(v); return true;
}
const auto = (k, v = false) => { CR.draft.auto = { ...(CR.draft.auto || {}), [k]: v }; };
// Смена расы, класса, уровня или предыстории: списки снова добираются автоматически
const structural = () => { CR.draft.auto = {}; };

export function createHandlers(ctx){
  const open = async (mode, draft) => {
    try { await loadCreateData(); }
    catch (e){ console.error(e); ctx.toast("Не получилось загрузить справочник. Обнови страницу."); return; }
    CR.mode = mode;
    if (draft) CR.draft = draft;
    ctx.render(); window.scrollTo({ top: 0 });
  };
  const d = () => CR.draft;
  return {
    openTemplates: () => open("templates"),
    openBuild: () => { CR.editId = null; return open("build", { level: 1, class: "fighter", race: "human", name: null, pitch: null }); },
    openRandom: async () => { await loadCreateData(); CR.editId = null; open("build", randomChoices(R, SPL, { level: 1 })); },
    crBack: () => { CR.mode = null; CR.draft = null; CR.editId = null; ctx.render(); window.scrollTo({ top: 0 }); },
    tplLevel: b => { CR.tplLevel = +b.dataset.v; ctx.render(); },
    tplTune: b => { const t = byId(TPL.templates, b.dataset.id); CR.editId = null; open("build", { ...t.choices, level: CR.tplLevel }); },
    tplCreate: async b => {
      const t = byId(TPL.templates, b.dataset.id);
      const c = buildCharacter(R, SPL, { ...t.choices, level: CR.tplLevel });
      const ok = await ctx.save(c, null);
      if (ok){ CR.mode = null; ctx.render(); window.scrollTo({ top: 0 }); }
    },
    crRandom: () => { CR.draft = randomChoices(R, SPL, { level: d().level }); ctx.render(); },
    crRandName: () => { d().name = randomName(R, d().race, d().pronoun); ctx.render(); },
    crRandPitch: () => { const p = R.pitch[d().class]; d().pitch = p[(p.indexOf(d().pitch) + 1) % p.length]; ctx.render(); },
    crPronoun: b => { d().pronoun = b.dataset.v; ctx.render(); },
    crRace: b => { if (d().race !== b.dataset.v){ d().race = b.dataset.v; d().subrace = null; d().asiFree = null; structural(); } ctx.render(); },
    crSub: b => { d().subrace = b.dataset.v; structural(); ctx.render(); },
    crColor: b => { d().color = b.dataset.v; ctx.render(); },
    crClass: b => {
      if (d().class !== b.dataset.v){
        d().class = b.dataset.v; d().kit = null; d().asi4 = null; d().cantrips = []; d().spells = []; d().skills = []; d().expertise = [];
        d().pitch = null; structural();
      }
      ctx.render();
    },
    crLevel: b => { d().level = +b.dataset.v; d().spells = []; structural(); ctx.render(); },
    crKit: b => { d().kit = b.dataset.v; ctx.render(); },
    crEnemy: b => { d().enemy = b.dataset.v; ctx.render(); },
    crTerrain: b => { d().terrain = b.dataset.v; ctx.render(); },
    crBg: b => { d().background = b.dataset.v; structural(); ctx.render(); },
    crStd: () => { d().baseAuto = true; ctx.render(); },
    crRoll: () => {
      const cls = byId(R.classes, d().class), kit = byId(cls.kits, d().kit) || cls.kits[0];
      d().base = assignStats(rollStats(), kit.order || cls.order); d().baseAuto = false;
      ctx.render(); ctx.toast(`Выпало: ${AB.map(a => d().base[a]).sort((x, y) => y - x).join(", ")}. Разложено под класс.`);
    },
    crSkill: b => { const si = skillInfo(R, d()); if (toggle(d().skills, b.dataset.v, si.choose, ctx, "один из навыков класса")) auto("skills"); ctx.render(); },
    crRaceSkill: b => { const si = skillInfo(R, d()); if (toggle(d().raceSkills, b.dataset.v, si.raceChoose, ctx, "один навык расы")) auto("skills"); ctx.render(); },
    crBonusSkill: b => { const si = skillInfo(R, d()); if (toggle(d().bonusSkills, b.dataset.v, si.bonusChoose, ctx, "один навык подкласса")) auto("skills"); ctx.render(); },
    crExpert: b => { const si = skillInfo(R, d()); if (toggle(d().expertise, b.dataset.v, si.expertise, ctx, "одну компетентность")) auto("expertise"); ctx.render(); },
    crCantrip: b => { const ci = casterInfo(R, SPL, d(), finalAbilities(R, d())); if (toggle(d().cantrips, b.dataset.v, ci.cantrips, ctx, "один заговор")) auto("cantrips"); ctx.render(); },
    crSpell: b => { const ci = casterInfo(R, SPL, d(), finalAbilities(R, d())); if (toggle(d().spells, b.dataset.v, ci.count, ctx, "одно заклинание")) auto("spells"); ctx.render(); },
    crRaceCantrip: b => { d().raceCantrip = b.dataset.v; ctx.render(); },
    crLang: b => {
      const race = byId(R.races, d().race), sub = race.subraces ? byId(race.subraces, d().subrace) : null, bg = byId(R.backgrounds, d().background);
      const n = (race.extraLanguages || 0) + ((sub && sub.extraLanguages) || 0) + (bg.languages || 0);
      if (toggle(d().languages, b.dataset.v, n, ctx, "один язык")) auto("languages");
      ctx.render();
    },
    crPreview: () => {
      try { localStorage.setItem("novice-sheet:preview", JSON.stringify(CR.preview)); } catch (e) {}
      window.open("/preview", "_blank");
    },
    crSave: async () => {
      const c = buildCharacter(R, SPL, d());
      const ok = await ctx.save(c, CR.editId);
      if (ok){ CR.mode = null; CR.draft = null; CR.editId = null; ctx.render(); window.scrollTo({ top: 0 }); }
    },
    // Открыть сохранённого персонажа обратно в конструкторе
    edit: async b => {
      const choices = await ctx.loadChoices(b.dataset.id);
      if (!choices) return;
      CR.editId = b.dataset.id;
      open("build", choices);
    }
  };
}

/* Поля ввода конструктора.
   Текст и числа пишутся в черновик сразу, без перерисовки: иначе страница
   перестроится посреди клика по соседней кнопке и клик потеряется. */
let pointerDown = false, renderAfterPointer = false;
document.addEventListener("pointerdown", () => { pointerDown = true; }, true);
document.addEventListener("pointerup", () => {
  pointerDown = false;
  if (renderAfterPointer){ renderAfterPointer = false; setTimeout(() => CR.ctx && CR.ctx.render(), 0); }
}, true);
const softRender = ctx => { CR.ctx = ctx; if (pointerDown) renderAfterPointer = true; else ctx.render(); };

export function createInput(e, ctx){
  if (CR.mode !== "build") return false;
  const el = e.target;
  if (el.dataset.cbind){
    CR.draft[el.dataset.cbind] = el.value;
    if (el.dataset.cbind === "name"){
      const btn = document.getElementById("crSave"), empty = !el.value.trim();
      if (btn){ btn.disabled = empty || ctx.busy(); btn.textContent = empty ? "Впиши имя" : CR.editId ? "Сохранить изменения" : "Сохранить персонажа"; }
      const h = document.querySelector(".cr-sum .sum-h h3");
      if (h) h.textContent = el.value.trim() || "Безымянный герой";
    }
    return true;
  }
  if (el.dataset.abl){
    const v = parseInt(el.value, 10);
    if (v >= 3 && v <= 20){ CR.draft.base = { ...CR.draft.base, [el.dataset.abl]: v }; CR.draft.baseAuto = false; }
    return true;
  }
  return false;
}
export function createChange(e, ctx){
  if (CR.mode !== "build") return false;
  const el = e.target;
  if (el.dataset.abl){ softRender(ctx); return true; }
  if (el.dataset.actSel){
    const k = el.dataset.actSel, i = +el.dataset.i;
    const arr = [...(CR.draft[k] || [])]; arr[i] = el.value;
    CR.draft[k] = arr;
    softRender(ctx); return true;
  }
  if (el.dataset.cbind) return true;
  return false;
}
