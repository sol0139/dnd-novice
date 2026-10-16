/* ============================================================
   Ручной редактор листа.
   Три входа:
   • импорт из Long Story Short — сначала сито (находки и исправления),
     потом можно поправить вообще всё;
   • правка уже сохранённого героя;
   • пустой лист — заполнить с нуля без файла.
   Всё живёт в браузере, в базу уходит только по кнопке «Сохранить».
   ============================================================ */
import { importLSS } from "/lss.js";
import { makeSpell, SKILL_NAMES, SKILL_AB, ABBR } from "/builder.js";

export const ED = { r: null };   // текущая правка или null

const AB = ["str", "dex", "con", "int", "wis", "cha"];
const AB_NAME = { str: "Сила", dex: "Ловкость", con: "Телосложение", int: "Интеллект", wis: "Мудрость", cha: "Харизма" };
const KIND_LABEL = { action: "Действие", bonus: "Бонус", reaction: "Реакция", passive: "Само", item: "Вещь" };
const mod = s => Math.floor(((+s || 10) - 10) / 2);
const sg = n => (n < 0 ? "−" : "+") + Math.abs(n);
const toRu = s => String(s ?? "").replace(/(\d*)d(\d+)/g, (_, n, x) => `${n}к${x}`);
const toDice = s => String(s ?? "").replace(/(\d*)\s*[кk]\s*(\d+)/gi, (_, n, x) => `${n || 1}d${x}`).replace(/\s+/g, "").replace(/−/g, "-");
const plain = s => String(s || "").replace(/\[\[[a-z0-9-]+\|([^\]]+)\]\]/g, "$1").replace(/\{\{([^|{}]*)\|[^{}]*\}\}/g, "$1");
const pbFor = lvl => 2 + Math.floor((Math.max(1, +lvl || 1) - 1) / 4);
const setPath = (obj, path, val) => { const ks = path.split("."); let o = obj; for (let i = 0; i < ks.length - 1; i++){ if (o[ks[i]] == null) o[ks[i]] = {}; o = o[ks[i]]; } o[ks[ks.length - 1]] = val; };
const delPath = (obj, path) => { const ks = path.split("."); let o = obj; for (let i = 0; i < ks.length - 1; i++){ o = o[ks[i]]; if (!o) return; } delete o[ks[ks.length - 1]]; };

let SPL = null;
const loadJSON = u => fetch(u).then(r => { if (!r.ok) throw new Error(u); return r.json(); });
async function spells(){ if (!SPL) SPL = await loadJSON("/data/spells.json"); return SPL; }

const MOVE = () => ({ id: "movement", kind: "movement", scene: "combat", name: "Скорость", source: "все",
  plain: "Движение можно делить: шаг, удар, ещё пара шагов. Действие «Рывок» удваивает его на один ход." });
const blankChar = () => ({
  format: "novice-sheet/0.3", edition: "5e-2014", name: "", pronoun: "he", pitch: "",
  race: { id: "", name: "" }, class: { id: "", name: "", level: 1 }, background: { id: "", name: "" },
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, proficiencyBonus: 2,
  hp: { max: 10 }, hitDice: { die: "1d8", count: 1 }, ac: { value: 10, why: "" }, speed: 30,
  saves: [], skills: [], expertise: [], languages: ["Общий"], features: [MOVE()], equipment: [],
  source: { app: "manual" }
});
// Чтобы в старых и импортированных листах были все поля, которые трогает редактор
function ensure(c){
  c.race = c.race || { id: "", name: "" }; c.class = c.class || { id: "", name: "", level: 1 };
  c.background = c.background || { id: "", name: "" };
  c.abilities = c.abilities || {}; AB.forEach(a => { c.abilities[a] = +c.abilities[a] || 10; });
  c.hp = c.hp || { max: 10 }; c.hitDice = c.hitDice || { die: "1d8", count: c.class.level || 1 };
  c.ac = c.ac || { value: 10, why: "" }; c.saves = c.saves || []; c.skills = c.skills || []; c.expertise = c.expertise || [];
  c.languages = c.languages || []; c.features = c.features || []; c.equipment = c.equipment || [];
  if (!c.features.some(f => f.kind === "movement")) c.features.push(MOVE());
  return c;
}

/* ---------- входы ---------- */
export async function startImport(file, ctx){
  try {
    const raw = JSON.parse(await file.text());
    const [kb, dict, spl] = await Promise.all([loadJSON("/data/knowledge.json"), loadJSON("/data/dictionary.json"), spells()]);
    const { character, findings } = importLSS(raw, { kb, dict });
    // по каждой находке с выбором сразу применяем первый вариант — это рекомендация
    for (const f of findings) if (f.options){ f.options[0].apply(character); f.chosen = 0; }
    ED.r = { mode: "import", fileName: file.name, char: ensure(character), findings, spl, allSpells: false, open: new Set(["who", "feats"]), n: 1 };
    ctx.setError("");
  } catch (e){
    console.error(e);
    ctx.setError("Не получилось разобрать файл. Нужен .json персонажа, выгруженный из Long Story Short.");
  }
  ctx.render(); window.scrollTo({ top: 0 });
}
export async function openBlank(ctx){
  const spl = await spells();
  ED.r = { mode: "blank", char: blankChar(), findings: [], spl, allSpells: true, open: new Set(["who", "nums"]), n: 1 };
  ctx.render(); window.scrollTo({ top: 0 });
}
export async function openEdit(id, ctx){
  const [row, spl] = await Promise.all([ctx.loadFull(id), spells()]);
  if (!row) return;
  ED.r = { mode: "edit", editId: id, char: ensure(JSON.parse(JSON.stringify(row.data))), findings: [], spl, allSpells: false, open: new Set(["who"]), n: 1 };
  ED.r.char.name = row.name || ED.r.char.name;
  ctx.render(); window.scrollTo({ top: 0 });
}

/* ---------- кусочки разметки ---------- */
const seg = (act, items, cur, extra = "") => items.map(([v, l]) =>
  `<button type="button" data-act="${act}" data-v="${v}"${extra} aria-pressed="${String(cur) === String(v)}">${l}</button>`).join("");
const fld = (label, path, val, o = {}) => `<label class="fld${o.wide ? " wide" : ""}"><span>${label}</span><input data-ebind="${path}"${o.type ? ` data-etype="${o.type}"` : ""}${o.type === "int" || o.type === "opt" ? ` type="number" inputmode="numeric"` : ""} value="${val ?? ""}"${o.ph ? ` placeholder="${o.ph}"` : ""}${o.max ? ` maxlength="${o.max}"` : ""}${o.id ? ` id="${o.id}"` : ""} autocomplete="off"></label>`;
function block(id, title, preview, body, esc){
  const open = ED.r.open.has(id);
  return `<details class="ed-sec card" data-sec="${id}"${open ? " open" : ""}>
    <summary><span class="ed-t">${title}</span>${preview ? `<span class="ed-p">${esc(preview)}</span>` : ""}<span class="chev" aria-hidden="true"></span></summary>
    <div class="ed-body">${body}</div>
  </details>`;
}

function findingRow(f, esc){
  const i = ED.r.findings.indexOf(f);
  return `<div class="fd ${f.level}"><span class="fd-dot" aria-hidden="true"></span><div class="fd-body"><p>${esc(f.text)}</p>
    ${f.options ? `<div class="fd-acts">${f.options.map((o, k) => `<button type="button" class="btn sm ${f.chosen === k ? "primary" : "neutral"}" data-act="edFix" data-f="${i}" data-o="${k}" aria-pressed="${f.chosen === k}">${esc(o.label)}</button>`).join("")}</div>` : ""}
  </div></div>`;
}

function featRow(f, i, esc){
  const kinds = ["action", "bonus", "reaction", "passive", "item"];
  const usesOn = !!f.uses;
  return `<article class="rvf card">
    <div class="rvf-h"><input class="rvf-title" data-ebind="features.${i}.name" value="${esc(f.name)}" placeholder="Название" aria-label="Название">
      ${f.guess && f.kind === "passive" ? `<span class="pill">догадка</span>` : ""}
      <button type="button" class="x" data-act="edDelFeat" data-i="${i}" aria-label="Удалить ${esc(f.name)}">×</button></div>
    <textarea class="rvf-ta" data-ebind="features.${i}.plain" rows="3" placeholder="Что делает — простыми словами">${esc(f.plain || "")}</textarea>
    <div class="seg" role="group" aria-label="Куда положить"><span class="seg-l">Куда</span>${kinds.map(k =>
      `<button type="button" data-act="edKind" data-i="${i}" data-v="${k}" aria-pressed="${f.kind === k}">${KIND_LABEL[k]}</button>`).join("")}</div>
    ${f.kind === "passive" ? `<div class="seg" role="group" aria-label="На какой вкладке"><span class="seg-l">Вкладка</span>${seg("edScene", [["combat", "В бою"], ["social", "Вне боя"]], f.scene === "social" ? "social" : "combat", ` data-i="${i}"`)}</div>` : ""}
    <div class="seg" role="group" aria-label="Тратится ли"><span class="seg-l">Запас</span>${seg("edUses", [["off", "Не тратится"], ["on", "Тратится"]], usesOn ? "on" : "off", ` data-i="${i}"`)}</div>
    ${usesOn ? `<div class="ed-inline">
      <label class="uses-fld">Раз <input type="number" min="1" max="20" data-ebind="features.${i}.uses.max" data-etype="int" value="${f.uses.max}"></label>
      <div class="seg" role="group" aria-label="Когда вернётся">${seg("edRecharge", [["short", "после короткого"], ["long", "после длинного"]], f.uses.recharge === "short" ? "short" : "long", ` data-i="${i}"`)}</div>
      ${f.usesGuess ? `<span class="pill">догадка</span>` : ""}
    </div>` : ""}
    <div class="ed-grid">
      ${fld("Лечит (если лечит)", `features.${i}.heal`, esc(toRu(f.heal || "")), { type: "dice", ph: "например 1к10+5" })}
      ${fld("Откуда", `features.${i}.source`, esc(f.source || ""), { ph: "класс, раса, предмет" })}
    </div>
  </article>`;
}

function attackRow(f, i, esc){
  const a = f.attack || {};
  return `<article class="rvf card">
    <div class="rvf-h"><input class="rvf-title" data-ebind="features.${i}.name" value="${esc(f.name)}" placeholder="Название атаки" aria-label="Название атаки">
      <button type="button" class="x" data-act="edDelFeat" data-i="${i}" aria-label="Удалить ${esc(f.name)}">×</button></div>
    <div class="wrow">
      <label class="fld"><span>Попадание</span><input type="number" data-ebind="features.${i}.attack.toHit" data-etype="int" value="${a.toHit ?? 0}"></label>
      <label class="fld"><span>Урон</span><input data-ebind="features.${i}.attack.damage" data-etype="dice" value="${esc(toRu(a.damage))}" placeholder="1к8+3"></label>
      <label class="fld"><span>Тип урона</span><input data-ebind="features.${i}.attack.damageType" value="${esc(a.damageType || "")}" placeholder="рубящий"></label>
    </div>
    <div class="seg" role="group" aria-label="Ближний или дальний бой"><span class="seg-l">Бой</span>${seg("edMelee", [["1", "Ближний"], ["0", "Дальний"]], a.melee === false ? "0" : "1", ` data-i="${i}"`)}</div>
    ${a.melee === false ? fld("Дальность", `features.${i}.attack.range`, esc(plain(a.range || "")), { ph: "до 16 клеток обычно, до 64 — с помехой" }) : ""}
    <div class="seg" role="group" aria-label="Чем атакуют"><span class="seg-l">Когда</span>${seg("edKind", [["action", "Действие"], ["bonus", "Бонус"], ["reaction", "Реакция"]], f.kind, ` data-i="${i}"`)}</div>
    ${f.why ? `<p class="meta">${esc(plain(f.why))}</p>` : ""}
  </article>`;
}

/* ---------- экран ---------- */
export function viewEditor(ctx){
  const { esc } = ctx, r = ED.r, c = r.char;
  const pb = +c.proficiencyBonus || 2;
  const nameMissing = !String(c.name || "").trim();
  const by = lv => r.findings.filter(f => f.level === lv);
  const errs = by("error"), warns = by("warn"), infos = by("info"), oks = by("ok");
  const fb = (title, list) => list.length ? `<section class="sec"><h2>${title}</h2><div class="card fds">${list.map(f => findingRow(f, esc)).join("")}</div></section>` : "";
  const list = pred => c.features.map((f, i) => [f, i]).filter(([f]) => pred(f));
  const feats = list(f => !f.attack && f.kind !== "movement" && !f.attackRef);
  const attacks = list(f => f.attack);
  const skillB = id => mod(c.abilities[SKILL_AB[id]]) + (c.expertise.includes(id) ? 2 * pb : c.skills.includes(id) ? pb : c.halfProf ? Math.floor(pb / 2) : 0) + ((c.skillMods || {})[id] || 0);

  const heads = {
    import: ["Импорт из Long Story Short", "Проверка и правка", `Файл ${esc((r.fileName || "").replace(/^[0-9a-f-]{8,}[-_]?\d*_*/i, "").replace(/_+/g, " ").trim() || r.fileName)}. Сначала — что нашло сито, ниже можно поправить вообще всё и добавить недостающее. В базу ничего не попадёт, пока не нажмёшь «Сохранить».`],
    edit:   ["Правка вручную", esc(c.name || "Герой"), "Меняй что угодно: числа, навыки, способности, атаки, заклинания и вещи. Ссылка у игрока останется прежней."],
    blank:  ["Пустой лист", "Новый лист вручную", "Для героя, которого нет ни в шаблонах, ни в LSS: впиши всё сам. Каждый раздел раскрывается тапом."]
  }[r.mode];

  /* Кто это */
  const who = `<div class="ed-grid">
      ${fld("Имя", "name", esc(c.name), { ph: "Имя героя", max: 80, id: "edName", wide: true })}
    </div>
    <div class="seg" role="group" aria-label="Как обращаться"><span class="seg-l">В подсказках</span>${seg("edPronoun", [["he", "Он"], ["she", "Она"]], c.pronoun === "she" ? "she" : "he")}</div>
    <label class="fld"><span>Одна фраза о герое</span><textarea class="rvf-ta" data-ebind="pitch" rows="2" placeholder="Например: держит щит и не умеет врать">${esc(c.pitch || "")}</textarea></label>
    <div class="ed-grid">
      ${fld("Раса", "race.name", esc(c.race.name), { ph: "Полуорк" })}
      ${fld("Класс", "class.name", esc(c.class.name), { ph: "Воин" })}
      ${fld("Уровень", "class.level", c.class.level, { type: "int" })}
      ${fld("Подкласс", "class.subclass", esc(c.class.subclass || ""), { ph: "необязательно" })}
      ${fld("Предыстория", "background.name", esc(c.background.name || ""), { ph: "Солдат" })}
      ${fld("Уточнение к ней", "background.note", esc(c.background.note || ""), { ph: "необязательно" })}
    </div>`;

  /* Числа */
  const nums = `<div class="abls">${AB.map(a => `<label class="abl card"><span class="abl-n">${ABBR[a]}</span>
      <input type="number" min="1" max="30" data-ebind="abilities.${a}" data-etype="int" value="${c.abilities[a]}" aria-label="${AB_NAME[a]}">
      <span class="abl-b">${AB_NAME[a]}</span><span class="abl-m">${sg(mod(c.abilities[a]))}</span></label>`).join("")}</div>
    <div class="ed-grid">
      <label class="fld wide"><span>Бонус мастерства</span><span class="fld-row"><input class="pb-in" type="number" data-ebind="proficiencyBonus" data-etype="int" value="${pb}"><button type="button" class="btn neutral sm" data-act="edPbAuto">Как положено на ${c.class.level} уровне: +${pbFor(c.class.level)}</button></span></label>
      ${fld("Хиты (максимум)", "hp.max", c.hp.max, { type: "int" })}
      <label class="fld"><span>Кость хитов</span><select data-ebind="hitDice.die">${["1d6", "1d8", "1d10", "1d12"].map(d => `<option value="${d}"${c.hitDice.die === d ? " selected" : ""}>${toRu(d)}</option>`).join("")}</select></label>
      ${fld("Сколько костей", "hitDice.count", c.hitDice.count, { type: "int" })}
      ${fld("КД", "ac.value", c.ac.value, { type: "int" })}
      ${fld("Откуда КД", "ac.why", esc(plain(c.ac.why || "")), { ph: "Кольчуга 16 и щит 2" })}
      ${fld("Скорость, футов", "speed", c.speed, { type: "int" })}
      ${fld("Инициатива", "initiative", c.initiative ?? "", { type: "opt", ph: `авто: ${sg(mod(c.abilities.dex))}` })}
      ${fld("Пассивное Восприятие", "passivePerception", c.passivePerception ?? "", { type: "opt", ph: `авто: ${10 + skillB("perception")}` })}
    </div>`;

  /* Спасброски и навыки */
  const skillsBody = `<p class="pick-l">Спасброски с мастерством</p>
    <div class="pick">${AB.map(a => `<button type="button" class="pk" data-act="edST" data-v="${a}" aria-pressed="${c.saves.includes(a)}">${AB_NAME[a]}</button>`).join("")}</div>
    <p class="pick-l">Навыки — тап: нет → владеет → эксперт</p>
    <div class="pick">${Object.keys(SKILL_NAMES).map(id => {
      const st = c.expertise.includes(id) ? "ex" : c.skills.includes(id) ? "on" : "off";
      return `<button type="button" class="pk sk-${st}" data-act="edSkill" data-v="${id}" aria-pressed="${st !== "off"}">${SKILL_NAMES[id]} <small>${sg(skillB(id))}${st === "ex" ? " · эксперт" : ""}</small></button>`;
    }).join("")}</div>
    <div class="seg" role="group" aria-label="Мастер на все руки"><span class="seg-l">Полмастерства</span>${seg("edHalf", [["0", "Нет"], ["1", "К остальным навыкам (бард)"]], c.halfProf ? "1" : "0")}</div>`;

  /* Языки и инструменты */
  const langs = `<div class="pick">${c.languages.map((l, i) => `<span class="pk locked tag">${esc(l)}<button type="button" class="tag-x" data-act="edLangDel" data-i="${i}" aria-label="Убрать ${esc(l)}">×</button></span>`).join("") || `<span class="meta">Пока ни одного.</span>`}</div>
    <div class="fld-row"><input id="edLangNew" placeholder="Язык, например Драконий" autocomplete="off"><button type="button" class="btn neutral sm" data-act="edLangAdd">Добавить</button></div>
    ${fld("Инструменты", "tools", esc(c.tools || ""), { ph: "воровские инструменты; лютня", wide: true })}`;

  /* Способности и атаки */
  const featBody = `${r.mode === "import" ? `<p class="meta">«Догадка» — в тексте не нашлось «действием», «бонусным» или «реакцией», проверь. «Вещь» уедет в снаряжение.</p>` : ""}
    ${feats.map(([f, i]) => featRow(f, i, esc)).join("") || `<p class="meta">Способностей пока нет.</p>`}
    <button type="button" class="addcond" data-act="edAddFeat">+ Способность</button>`;
  const atkBody = `${attacks.map(([f, i]) => attackRow(f, i, esc)).join("") || `<p class="meta">Атак пока нет.</p>`}
    <button type="button" class="addcond" data-act="edAddAtk">+ Атака</button>`;

  /* Заклинания */
  let magic;
  if (!c.spellcasting){
    magic = `<p class="meta">Герой не колдует. Если колдует — включи, и появятся ячейки, атака заклинанием и выбор заклинаний.</p>
      <button type="button" class="addcond" data-act="edMagicOn">+ Герой колдует</button>`;
  } else {
    const sc = c.spellcasting, S = r.spl.spells;
    const classList = r.spl.classes[c.class.id];
    const useAll = r.allSpells || !classList;
    const ids = l => useAll ? Object.keys(S).filter(id => S[id].level === l) : (classList[String(l)] || []);
    const have = new Set((c.spells || []).map(s => s.id));
    magic = `<div class="ed-grid">
        <label class="fld"><span>Колдует через</span><select data-ebind="spellcasting.ability" data-eafter="castab">${AB.map(a => `<option value="${a}"${sc.ability === a ? " selected" : ""}>${AB_NAME[a]}</option>`).join("")}</select></label>
        ${fld("Атака заклинанием", "spellcasting.attack", sc.attack, { type: "int" })}
        ${fld("Сложность спасброска", "spellcasting.dc", sc.dc, { type: "int" })}
      </div>
      <p class="pick-l">Ячейки по кругам</p>
      <div class="slot-ed">${[1, 2, 3, 4, 5].map(l => `<label class="fld"><span>${l} круг</span><input type="number" min="0" max="9" data-ebind="spellcasting.slots.${l}" data-etype="int" value="${(sc.slots || {})[l] || 0}"></label>`).join("")}</div>
      <div class="seg" role="group" aria-label="Когда возвращаются ячейки"><span class="seg-l">Вернутся</span>${seg("edSlotRecharge", [["long", "после длинного"], ["short", "после короткого (колдун)"]], sc.recharge === "short" ? "short" : "long")}</div>
      <p class="pick-l">Сейчас в листе (${have.size})</p>
      <div class="pick">${(c.spells || []).map((s, i) => `<span class="pk locked tag">${esc(s.name)}<button type="button" class="tag-x" data-act="edSpellDel" data-i="${i}" aria-label="Убрать ${esc(s.name)}">×</button></span>`).join("") || `<span class="meta">Пока ни одного.</span>`}</div>
      <div class="pick-h"><b>Добавить из справочника</b>${classList ? `<button type="button" class="linkbtn" data-act="edAllSpells">${useAll ? "Только список класса" : "Показать все 89"}</button>` : ""}</div>
      ${[0, 1, 2].map(l => { const ls = ids(l); return ls.length ? `<p class="pick-l">${l ? `${l} круг` : "Заговоры"}</p><div class="pick">${ls.map(id =>
        `<button type="button" class="pk" data-act="edSpell" data-v="${id}" aria-pressed="${have.has(id)}" title="${esc(plain(S[id].plain))}">${esc(S[id].name)}</button>`).join("")}</div>` : ""; }).join("")}
      <p class="meta">В справочнике заклинания до 2 круга. Числа новых заклинаний посчитаются по атаке и сложности выше при сохранении.</p>
      <button type="button" class="linkbtn muted" data-act="edMagicOff">Герой не колдует — убрать магию</button>`;
  }

  /* Снаряжение */
  const gear = `<div class="eqs">${c.equipment.map((e, i) => `<div class="eq-ed card">
      <div class="fld-row"><input data-ebind="equipment.${i}.name" value="${esc(e.name)}" placeholder="Предмет" aria-label="Предмет">
        <input class="qty" type="number" min="1" data-ebind="equipment.${i}.qty" data-etype="opt" value="${e.qty ?? ""}" placeholder="шт." aria-label="Сколько">
        <button type="button" class="x" data-act="edItemDel" data-i="${i}" aria-label="Убрать ${esc(e.name)}">×</button></div>
      <input class="note" data-ebind="equipment.${i}.note" value="${esc(plain(e.note || ""))}" placeholder="Заметка: урон, КД, что делает" aria-label="Заметка">
    </div>`).join("") || `<p class="meta">Пусто.</p>`}</div>
    <button type="button" class="addcond" data-act="edItemAdd">+ Предмет</button>`;

  const stats = `КД ${c.ac.value} · хиты ${c.hp.max} · ${c.speed} фт`;
  const skillsPreview = `${c.skills.length + c.expertise.filter(x => !c.skills.includes(x)).length} навыков, спасброски ${c.saves.map(a => ABBR[a]).join(" ") || "—"}`;
  const magicPreview = c.spellcasting ? `${(c.spells || []).length} заклинаний · Сл ${c.spellcasting.dc}` : "не колдует";
  const btnText = nameMissing ? "Впиши имя" : r.mode === "edit" ? "Сохранить изменения" : "Сохранить персонажа";
  return `
  <section class="hero">
    <p class="eyebrow"><button type="button" class="linkbtn" data-act="edCancel">← Мои персонажи</button> · ${heads[0]}</p>
    <h1>${heads[1]}</h1>
    <p class="meta">${heads[2]}</p>
  </section>
  ${r.mode === "import" ? `<div class="tally"><span class="tl ok">${oks.length} сошлось</span><span class="tl warn">${warns.length} проверить</span><span class="tl error">${errs.length} исправить</span></div>
    ${fb("Исправить", errs)}${fb("Проверить", warns)}${fb("На заметку", infos)}
    ${oks.length ? `<details class="card rv-ok"><summary>Что сошлось (${oks.length})</summary><ul>${oks.map(f => `<li>${esc(f.text)}</li>`).join("")}</ul></details>` : ""}
    <h2 class="ed-h">Ручная правка</h2>` : ""}
  <div class="ed">
    ${block("who", "Кто это", [c.race.name, c.class.name && `${c.class.name} ${c.class.level}`].filter(Boolean).join(" · "), who, esc)}
    ${block("nums", "Характеристики и числа", stats, nums, esc)}
    ${block("skills", "Спасброски и навыки", skillsPreview, skillsBody, esc)}
    ${block("feats", "Способности", `${feats.length}`, featBody, esc)}
    ${block("atk", "Атаки", `${attacks.length}`, atkBody, esc)}
    ${block("magic", "Заклинания", magicPreview, magic, esc)}
    ${block("langs", "Языки и инструменты", c.languages.join(", ") || "—", langs, esc)}
    ${block("gear", "Снаряжение", `${c.equipment.length} предметов`, gear, esc)}
  </div>
  <div class="savebar">
    <button type="button" class="btn surface" data-act="edCancel">Отмена</button>
    <button type="button" class="btn primary" id="edSave" data-act="edSave"${ctx.busy() || nameMissing ? " disabled" : ""}>${btnText}</button>
  </div>`;
}

/* ---------- кнопки ---------- */
export function editorHandlers(ctx){
  const C = () => ED.r.char;
  const F = b => C().features[+b.dataset.i];
  const re = () => ctx.render();
  const toggleIn = (arr, v) => { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); };
  return {
    edCancel: () => { ED.r = null; re(); window.scrollTo({ top: 0 }); },
    edFix: b => { const f = ED.r.findings[+b.dataset.f], o = +b.dataset.o; f.options[o].apply(C()); f.chosen = o; re(); },
    edPronoun: b => { C().pronoun = b.dataset.v; re(); },
    edPbAuto: () => { C().proficiencyBonus = pbFor(C().class.level); re(); },

    // способности и атаки
    edKind: b => { const f = F(b); f.kind = b.dataset.v; f.guess = false; if (f.kind !== "passive") f.scene = "combat"; re(); },
    edScene: b => { F(b).scene = b.dataset.v; re(); },
    edUses: b => { const f = F(b); if (b.dataset.v === "on") f.uses = f.uses || { max: 1, recharge: "long" }; else { delete f.uses; delete f.usesGuess; } re(); },
    edRecharge: b => { F(b).uses.recharge = b.dataset.v; re(); },
    edMelee: b => { const a = F(b).attack; a.melee = b.dataset.v === "1"; if (a.melee) delete a.range; re(); },
    edDelFeat: b => {
      const c = C(), f = c.features.splice(+b.dataset.i, 1)[0];
      // атака по возможности ссылалась на это оружие — переводим на другое ближнее или убираем
      const melee = c.features.find(y => y.attack && y.attack.melee !== false);
      c.features = c.features.filter(x => {
        if (x.attackRef !== f.id) return true;
        if (melee){ x.attackRef = melee.id; return true; }
        return false;
      });
      ctx.toast(`«${f.name || "Без названия"}» убрано.`); re();
    },
    edAddFeat: () => {
      C().features.push({ id: `own-${Date.now().toString(36)}-${ED.r.n++}`, kind: "action", scene: "combat", name: "", source: "мастер", plain: "" });
      ED.r.open.add("feats"); re();
    },
    edAddAtk: () => {
      const c = C(), pb = +c.proficiencyBonus || 2, m = mod(c.abilities.str);
      c.features.push({ id: `atk-${Date.now().toString(36)}-${ED.r.n++}`, kind: "action", scene: "combat", name: "", source: "оружие",
        plain: `Бьёшь врага в соседней [[square|клетке]]. Сначала бросок на попадание: назови число мастеру. ${c.pronoun === "she" ? "Попала" : "Попал"} — бросай урон.`,
        attack: { toHit: m + pb, damage: `1d6${m ? (m > 0 ? "+" : "") + m : ""}`, damageType: "", melee: true } });
      ED.r.open.add("atk"); re();
    },

    // спасброски и навыки
    edST: b => { toggleIn(C().saves, b.dataset.v); re(); },
    edSkill: b => {
      const c = C(), id = b.dataset.v;
      // нет → владеет → эксперт → нет
      if (c.expertise.includes(id)){ c.expertise = c.expertise.filter(x => x !== id); c.skills = c.skills.filter(x => x !== id); }
      else if (c.skills.includes(id)) c.expertise.push(id);
      else c.skills.push(id);
      re();
    },
    edHalf: b => { if (b.dataset.v === "1") C().halfProf = true; else delete C().halfProf; re(); },

    // языки
    edLangDel: b => { C().languages.splice(+b.dataset.i, 1); re(); },
    edLangAdd: () => {
      const el = document.getElementById("edLangNew"), v = (el && el.value || "").trim();
      if (!v) return;
      if (!C().languages.includes(v)) C().languages.push(v);
      ED.r.open.add("langs"); re();
      setTimeout(() => { const i = document.getElementById("edLangNew"); if (i) i.focus(); }, 0);
    },

    // снаряжение
    edItemAdd: () => { C().equipment.push({ name: "", note: "" }); ED.r.open.add("gear"); re(); },
    edItemDel: b => { C().equipment.splice(+b.dataset.i, 1); re(); },

    // магия
    edMagicOn: () => {
      const c = C(), pb = +c.proficiencyBonus || 2, ab = "cha";
      c.spellcasting = { ability: ab, attack: pb + mod(c.abilities[ab]), dc: 8 + pb + mod(c.abilities[ab]), slots: { 1: 2 }, recharge: "long", prepared: false, source: "класс" };
      c.spells = c.spells || [];
      ED.r.open.add("magic"); re();
    },
    edMagicOff: () => { delete C().spellcasting; delete C().spells; re(); },
    edSlotRecharge: b => { C().spellcasting.recharge = b.dataset.v; re(); },
    edAllSpells: () => { ED.r.allSpells = !ED.r.allSpells; re(); },
    edSpell: b => {
      const c = C(), id = b.dataset.v, list = c.spells || (c.spells = []);
      const i = list.findIndex(s => s.id === id);
      if (i >= 0) list.splice(i, 1);
      else { const S = ED.r.spl.spells[id]; list.push({ id, name: S.name, level: S.level, _new: true }); }
      re();
    },
    edSpellDel: b => { C().spells.splice(+b.dataset.i, 1); re(); },

    edSave: async () => { if (!ctx.busy()) await saveEditor(ctx); }
  };
}

/* Поля ввода: пишем в черновик сразу, без перерисовки */
export function editorInput(e, ctx){
  if (!ED.r) return false;
  const el = e.target.closest("[data-ebind]");
  if (!el) return false;
  const path = el.dataset.ebind, t = el.dataset.etype;
  if (t === "int"){ const v = parseInt(el.value, 10); if (!isNaN(v)) setPath(ED.r.char, path, v); }
  else if (t === "opt"){ const v = parseInt(el.value, 10); if (isNaN(v)) delPath(ED.r.char, path); else setPath(ED.r.char, path, v); }
  else setPath(ED.r.char, path, el.value);
  if (path === "name"){
    const btn = document.getElementById("edSave"), empty = !el.value.trim();
    if (btn){ btn.disabled = empty || ctx.busy(); btn.textContent = empty ? "Впиши имя" : ED.r.mode === "edit" ? "Сохранить изменения" : "Сохранить персонажа"; }
  }
  return true;
}
// Выпадающие списки меняют зависимые числа, поэтому после них — перерисовка
export function editorChange(e, ctx){
  if (!ED.r) return false;
  const el = e.target.closest("[data-ebind]");
  if (!el) return false;
  if (el.tagName === "SELECT"){
    if (el.dataset.eafter === "castab"){
      const c = ED.r.char, pb = +c.proficiencyBonus || 2, m = mod(c.abilities[c.spellcasting.ability]);
      c.spellcasting.attack = pb + m; c.spellcasting.dc = 8 + pb + m;
    }
    ctx.render();
  }
  return true;
}
// Какие разделы раскрыты — помним между перерисовками
export function editorToggle(e){
  const d = e.target;
  if (!ED.r || !d.matches || !d.matches("details.ed-sec")) return;
  if (d.open) ED.r.open.add(d.dataset.sec); else ED.r.open.delete(d.dataset.sec);
}
export function editorKey(e){
  if (ED.r && e.key === "Enter" && e.target.id === "edLangNew"){ e.preventDefault(); const b = document.querySelector("[data-act='edLangAdd']"); if (b) b.click(); }
}

/* ---------- сохранение ---------- */
async function saveEditor(ctx){
  const r = ED.r, c = JSON.parse(JSON.stringify(r.char));
  c.name = String(c.name || "").trim().slice(0, 80);
  if (!c.name) return;
  c.race.name = String(c.race.name || "").trim() || "—";
  c.class.name = String(c.class.name || "").trim() || "Искатель приключений";
  c.class.level = Math.max(1, Math.min(20, +c.class.level || 1));
  if (!String(c.class.subclass || "").trim()) delete c.class.subclass;
  if (!String(c.background.note || "").trim()) delete c.background.note;
  c.proficiencyBonus = Math.max(1, Math.min(10, +c.proficiencyBonus || 2));
  c.hp.max = Math.max(1, +c.hp.max || 1);
  c.hitDice.count = Math.max(1, +c.hitDice.count || c.class.level);
  c.ac.value = Math.max(1, +c.ac.value || 10);
  c.speed = Math.max(0, +c.speed || 0);
  if (!String(c.pitch || "").trim()) delete c.pitch;
  if (!String(c.tools || "").trim()) delete c.tools;
  c.expertise.forEach(x => { if (!c.skills.includes(x)) c.skills.push(x); });
  c.languages = c.languages.map(l => String(l).trim()).filter(Boolean);

  // способности: вещи — в снаряжение, пустые строки — прочь, кости в формат листа
  for (const f of c.features) if (f.kind === "item") c.equipment.push({ name: f.name || "Предмет", note: String(f.plain || "").slice(0, 160) });
  c.features = c.features.filter(f => f.kind !== "item" && (String(f.name || "").trim() || String(f.plain || "").trim() || f.kind === "movement"));
  for (const f of c.features){
    delete f.guess; delete f.usesGuess;
    if (!String(f.name || "").trim()) f.name = f.attack ? "Атака" : "Без названия";
    if (f.kind !== "passive") f.scene = "combat";
    if (f.uses) f.uses.max = Math.max(1, Math.min(20, +f.uses.max || 1));
    if (f.heal && String(f.heal).trim()) f.heal = toDice(f.heal); else delete f.heal;
    if (f.source !== undefined && !String(f.source).trim()) f.source = "мастер";
    if (f.attack){
      f.attack.toHit = +f.attack.toHit || 0;
      f.attack.damage = toDice(f.attack.damage) || "1d4";
      if (!String(f.attack.range || "").trim()) delete f.attack.range;
    }
  }
  const ids = new Set(c.features.map(f => f.id));
  c.features = c.features.filter(f => !f.attackRef || ids.has(f.attackRef));

  // снаряжение
  c.equipment = c.equipment.filter(e => String(e.name || "").trim()).map(e => {
    const out = { ...e, name: String(e.name).trim() };
    if (!(+out.qty > 1)) delete out.qty; else out.qty = +out.qty;
    if (!String(out.note || "").trim()) delete out.note;
    return out;
  });

  // заклинания: новые из справочника собираем по итоговой атаке и сложности
  if (c.spellcasting){
    const sc = c.spellcasting;
    sc.attack = +sc.attack || 0; sc.dc = +sc.dc || 10;
    sc.slots = Object.fromEntries(Object.entries(sc.slots || {}).map(([l, n]) => [l, Math.max(0, Math.min(9, +n || 0))]).filter(([, n]) => n > 0));
    const pb = c.proficiencyBonus, m = sc.attack - pb;
    const agon = c.features.some(f => /мучительн/i.test(f.name)) ? mod(c.abilities.cha) : 0;
    c.spells = (c.spells || []).map(s => s._new ? makeSpell(r.spl, s.id, { m, pb, she: c.pronoun === "she", agonizing: agon }) : s).filter(Boolean);
    if (!c.spells.length) delete c.spells;
    if (!c.spells && !Object.keys(sc.slots).length) delete c.spellcasting;
  }
  if (r.mode === "edit" && c.source && c.source.app === "builder") c.source = { ...c.source, manual: true };

  const ok = await ctx.save(c, r.mode === "edit" ? r.editId : null);
  if (ok){ ED.r = null; ctx.render(); window.scrollTo({ top: 0 }); }
}
