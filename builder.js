/* ============================================================
   Конструктор: из выбора мастера собирает лист персонажа
   в формате novice-sheet. Ничего не хранит и никуда не ходит:
   на входе выбор + data/rules.json + data/spells.json,
   на выходе готовый персонаж.

   normalize(choices)  — достраивает выбор до полного и честного
                         (навыки, заклинания, характеристики)
   buildCharacter()    — считает все числа и раскладывает способности
   randomChoices()     — случайный герой одним нажатием
   ============================================================ */

const AB = ["str", "dex", "con", "int", "wis", "cha"];
const ABBR = { str: "СИЛ", dex: "ЛОВ", con: "ТЕЛ", int: "ИНТ", wis: "МДР", cha: "ХАР" };
const SKILL_AB = {
  athletics: "str", acrobatics: "dex", sleight: "dex", stealth: "dex", arcana: "int", history: "int",
  investigation: "int", nature: "int", religion: "int", animal: "wis", insight: "wis", medicine: "wis",
  perception: "wis", survival: "wis", deception: "cha", intimidation: "cha", performance: "cha", persuasion: "cha"
};
const ALL_SKILLS = Object.keys(SKILL_AB);
const SKILL_NAMES = {
  athletics: "Атлетика", acrobatics: "Акробатика", sleight: "Ловкость рук", stealth: "Скрытность", arcana: "Магия",
  history: "История", investigation: "Анализ", nature: "Природа", religion: "Религия", animal: "Уход за животными",
  insight: "Проницательность", medicine: "Медицина", perception: "Восприятие", survival: "Выживание",
  deception: "Обман", intimidation: "Запугивание", performance: "Выступление", persuasion: "Убеждение"
};
export { SKILL_NAMES, ABBR };

const SLOTS = {
  full: [{ 1: 2 }, { 1: 3 }, { 1: 4, 2: 2 }, { 1: 4, 2: 3 }],
  half: [{}, { 1: 2 }, { 1: 3 }, { 1: 3 }],
  pact: [{ 1: 1 }, { 1: 2 }, { 2: 2 }, { 2: 2 }]
};
const CAST_KIND = { action: "action", bonus: "bonus", reaction: "reaction", "1min": "long", "10min": "long", "1h": "long" };

/* ---------- мелочи ---------- */
const mod = s => Math.floor((s - 10) / 2);
const sg = n => (n < 0 ? "−" : "+") + Math.abs(n);
const uniq = a => [...new Set(a)];
const pickRand = (a, rnd = Math.random) => a[Math.floor(rnd() * a.length)];
const byId = (list, id) => list.find(x => x.id === id);
const dice = f => String(f).replace(/(\d*)d(\d+)/g, (_, n, s) => `${n || 1}к${s}`).replace(/\+-/g, "−").replace(/-/g, "−");
const withMod = (d, m) => m ? `${d}${m > 0 ? "+" : "-"}${Math.abs(m)}` : d;

/* Маленький калькулятор для формул из rules.json: числа, переменные, + − * /, скобки, max/min/floor/ceil */
const FN = { max: Math.max, min: Math.min, floor: Math.floor, ceil: Math.ceil };
export function evalExpr(src, vars){
  const s = String(src).replace(/\s+/g, "");
  let i = 0;
  const primary = () => {
    if (s[i] === "("){ i++; const v = add(); i++; return v; }
    if (s[i] === "-"){ i++; return -primary(); }
    const n = /^\d+(\.\d+)?/.exec(s.slice(i));
    if (n){ i += n[0].length; return +n[0]; }
    const id = /^[a-z_][a-z0-9_]*/i.exec(s.slice(i));
    if (id){
      i += id[0].length;
      if (s[i] === "(" && FN[id[0]]){
        i++; const args = [add()];
        while (s[i] === ","){ i++; args.push(add()); }
        i++; return FN[id[0]](...args);
      }
      if (!(id[0] in vars) || typeof vars[id[0]] !== "number") throw new Error(`Формула «${src}»: не знаю «${id[0]}»`);
      return vars[id[0]];
    }
    throw new Error(`Формула «${src}» не разобрана`);
  };
  const mul = () => { let v = primary(); while (s[i] === "*" || s[i] === "/"){ const op = s[i++], r = primary(); v = op === "*" ? v * r : v / r; } return v; };
  const add = () => { let v = mul(); while (s[i] === "+" || s[i] === "-"){ const op = s[i++], r = mul(); v = op === "+" ? v + r : v - r; } return v; };
  const v = add();
  if (i < s.length) throw new Error(`Формула «${src}» не разобрана`);
  return v;
}
/* Подставляет {формулы}, {строки} и {{женский|мужской}} в тексты */
function fill(text, ctx){
  if (text == null) return text;
  return String(text)
    .replace(/\{\{([^{}|]*)\|([^{}]*)\}\}/g, (_, f, m) => (ctx.she ? f : m))
    .replace(/\{([^{}]+)\}/g, (_, e) => {
      if (e in ctx.str) return ctx.str[e];
      if (e[0] === "+") return sg(evalExpr(e.slice(1), ctx.num));
      return String(Math.round(evalExpr(e[0] === "=" ? e.slice(1) : e, ctx.num)));
    });
}
const usesMax = (m, ctx) => Array.isArray(m) ? m[ctx.num.lvl - 1] : typeof m === "number" ? m : evalExpr(m, ctx.num);

/* ---------- что доступно при этом выборе ---------- */
function parts(rules, ch){
  const race = byId(rules.races, ch.race) || rules.races[0];
  const sub = race.subraces ? (byId(race.subraces, ch.subrace) || race.subraces[0]) : null;
  const cls = byId(rules.classes, ch.class) || rules.classes[0];
  const kit = byId(cls.kits, ch.kit) || cls.kits[0];
  const bg = byId(rules.backgrounds, ch.background) || rules.backgrounds[0];
  const lvl = Math.max(1, Math.min(4, +ch.level || 1));
  const subcl = cls.subclass && lvl >= cls.subclass.level ? cls.subclass : null;
  const needColor = !!(race.colors || (cls.subclass && cls.subclass.colors && subcl));
  const color = needColor ? (rules.dragonColors.find(c => c.id === ch.color) || rules.dragonColors[7]) : null;
  return { race, sub, cls, kit, bg, lvl, subcl, color };
}
const abilityOrder = (P) => P.kit.order || P.cls.order;

/* Заклинатель: сколько заговоров и заклинаний, до какого круга, что всегда подготовлено */
export function casterInfo(rules, spellsData, ch, abilities){
  const P = parts(rules, ch), c = P.cls.caster;
  if (!c || P.lvl < (c.from || 1)) return null;
  const slots = SLOTS[c.type][P.lvl - 1];
  const maxLevel = Math.max(0, ...Object.keys(slots).map(Number));
  const m = mod(abilities[c.ability]);
  let cantrips = c.cantrips ? c.cantrips[P.lvl - 1] : 0;
  if (P.subcl && P.subcl.bonusCantrip) cantrips += P.subcl.bonusCantrip;
  let count;
  if (c.known) count = c.known[P.lvl - 1];
  else if (c.type === "half") count = Math.max(1, m + Math.floor(P.lvl / 2));
  else count = Math.max(1, m + P.lvl);
  const always = [];
  if (P.subcl && P.subcl.spells) for (const [l, ids] of Object.entries(P.subcl.spells)) if (P.lvl >= +l) always.push(...ids);
  if (P.cls.id === "warlock" && P.lvl >= 3) always.push("find-familiar");
  const lists = spellsData.classes[P.cls.id] || {};
  const pool = lvlKey => uniq([...(lists[lvlKey] || []), ...((P.subcl && P.subcl.extraSpells && P.subcl.extraSpells[lvlKey]) || [])])
    .filter(id => !always.includes(id));
  const leveled = [];
  for (let l = 1; l <= maxLevel; l++) leveled.push(...pool(String(l)));
  return { ability: c.ability, type: c.type, prepared: c.prepared, slots, maxLevel, cantrips, count,
           always: uniq(always), cantripPool: pool("0"), leveledPool: leveled };
}

/* ---------- характеристики ---------- */
export function rollStats(rnd = Math.random){
  return Array.from({ length: 6 }, () => {
    const r = Array.from({ length: 4 }, () => 1 + Math.floor(rnd() * 6)).sort((a, b) => b - a);
    return r[0] + r[1] + r[2];
  }).sort((a, b) => b - a);
}
export function assignStats(values, order){
  const sorted = [...values].sort((a, b) => b - a), base = {};
  order.forEach((a, i) => { base[a] = sorted[i]; });
  return base;
}
// Бонусы расы и 4 уровня по отдельности, чтобы экран мог показать «13 + 2»
export function abilityBonuses(rules, ch){
  const P = parts(rules, ch), bonus = Object.fromEntries(AB.map(a => [a, 0]));
  const addAll = o => { for (const [a, v] of Object.entries(o || {})) bonus[a] += v; };
  addAll(P.race.asi); if (P.sub) addAll(P.sub.asi);
  const free = ch.asiFree || [];
  if (P.race.asiFree === 3){ if (free[0]) bonus[free[0]] += 2; if (free[1]) bonus[free[1]] += 1; }
  if (P.race.asiFree === 2){ free.slice(0, 2).forEach(a => { bonus[a] += 1; }); }
  const asi = Object.fromEntries(AB.map(a => [a, 0]));
  if (P.lvl >= 4) (ch.asi4 || []).slice(0, 2).forEach(a => { asi[a] += 1; });
  return { race: bonus, asi };
}
export function finalAbilities(rules, ch){
  const { race, asi } = abilityBonuses(rules, ch), out = {};
  AB.forEach(a => { out[a] = Math.min(20, (ch.base[a] || 10) + race[a] + asi[a]); });
  return out;
}

/* ---------- навыки ---------- */
export function skillInfo(rules, ch){
  const P = parts(rules, ch);
  const bgSkills = P.bg.skills;
  const raceSkills = P.race.skills || [];
  const fixed = uniq([...bgSkills, ...raceSkills]);
  // если предыстория и раса дали один и тот же навык, можно взять любой другой взамен
  const replace = bgSkills.length + raceSkills.length - fixed.length;
  const from = P.cls.skills.from === "any" ? ALL_SKILLS : P.cls.skills.from;
  return {
    fixed, from, choose: P.cls.skills.choose,
    raceChoose: (P.race.skillChoice || 0) + replace,
    bonusChoose: P.subcl && P.subcl.bonusSkills ? P.subcl.bonusSkills : 0,
    expertise: P.cls.expertise && P.lvl >= P.cls.expertise.level ? P.cls.expertise.count : 0
  };
}

/* ---------- достроить выбор до полного ---------- */
export function normalize(rules, spellsData, input, rnd = Math.random){
  const ch = JSON.parse(JSON.stringify(input || {}));
  if (!byId(rules.races, ch.race)) ch.race = rules.races[0].id;
  if (!byId(rules.classes, ch.class)) ch.class = "fighter";
  ch.level = Math.max(1, Math.min(4, +ch.level || 1));
  ch.pronoun = ch.pronoun === "she" ? "she" : "he";
  let P = parts(rules, ch);
  ch.subrace = P.sub ? P.sub.id : null;
  ch.kit = P.kit.id;
  ch.background = P.bg.id;
  if (P.color) ch.color = P.color.id;
  P = parts(rules, ch);

  // характеристики: стандартный набор под приоритеты класса, если мастер не вписал свои
  const order = abilityOrder(P);
  if (!ch.base || ch.baseAuto !== false) ch.base = assignStats(rules.standardArray, order), ch.baseAuto = true;
  AB.forEach(a => { ch.base[a] = Math.max(3, Math.min(20, +ch.base[a] || 10)); });
  // гибкие бонусы расы
  if (P.race.asiFree === 3){
    const f = (ch.asiFree || []).filter(a => AB.includes(a));
    if (f.length < 2 || f[0] === f[1]) ch.asiFree = [order[0], order[1]];
  } else if (P.race.asiFree === 2){
    const f = uniq((ch.asiFree || []).filter(a => AB.includes(a) && a !== "cha"));
    ch.asiFree = f.length >= 2 ? f.slice(0, 2) : order.filter(a => a !== "cha").slice(0, 2);
  } else delete ch.asiFree;
  // увеличение характеристик на 4 уровне: +2 к главной, а если упрёмся в 20 — +1 и +1
  if (ch.level >= 4){
    if (!ch.asi4 || ch.asi4.length !== 2 || !ch.asi4.every(a => AB.includes(a))){
      const pre = finalAbilities(rules, { ...ch, asi4: [] });
      ch.asi4 = pre[order[0]] <= 18 ? [order[0], order[0]] : [order[0], order[1]];
    }
  } else delete ch.asi4;

  // auto: пока мастер не трогал список руками, конструктор сам добирает недостающее
  const auto = ch.auto || {};
  const on = k => auto[k] !== false;

  // навыки
  const si = skillInfo(rules, ch);
  const prio = uniq([...(P.cls.skillOrder || []), ...rules.skillOrder]);
  const take = (pool, have, n, wanted, fillUp) => {
    const out = uniq((wanted || []).filter(s => pool.includes(s) && !have.includes(s)));
    if (fillUp) for (const s of prio) { if (out.length >= n) break; if (pool.includes(s) && !have.includes(s) && !out.includes(s)) out.push(s); }
    return out.slice(0, n);
  };
  ch.skills = take(si.from, si.fixed, si.choose, ch.skills, on("skills"));
  ch.raceSkills = si.raceChoose ? take(ALL_SKILLS, [...si.fixed, ...ch.skills], si.raceChoose, ch.raceSkills, on("skills")) : [];
  ch.bonusSkills = si.bonusChoose ? take(ALL_SKILLS, [...si.fixed, ...ch.skills, ...ch.raceSkills], si.bonusChoose, ch.bonusSkills, on("skills")) : [];
  const prof = uniq([...si.fixed, ...ch.skills, ...ch.raceSkills, ...ch.bonusSkills]);
  if (si.expertise){
    const pref = uniq([...(P.cls.expertise.prefer || []), ...(P.cls.skillOrder || []), ...prio]);
    const ex = uniq((ch.expertise || []).filter(s => prof.includes(s)));
    if (on("expertise")) for (const s of pref){ if (ex.length >= si.expertise) break; if (prof.includes(s) && !ex.includes(s)) ex.push(s); }
    ch.expertise = ex.slice(0, si.expertise);
  } else ch.expertise = [];

  // заклинания: сначала самые популярные у этого класса
  const ab = finalAbilities(rules, ch);
  const ci = casterInfo(rules, spellsData, ch, ab);
  if (ci){
    const pick = (pool, n, wanted, fillUp) => {
      const out = uniq((wanted || []).filter(id => pool.includes(id)));
      if (fillUp) for (const id of pool){ if (out.length >= n) break; if (!out.includes(id)) out.push(id); }
      return out.slice(0, n);
    };
    ch.cantrips = pick(ci.cantripPool, ci.cantrips, ch.cantrips, on("cantrips"));
    let wanted = (ch.spells || []).filter(id => ci.leveledPool.includes(id));
    if (!wanted.length && ci.maxLevel >= 2 && on("spells")){
      // по умолчанию часть заклинаний — второго круга
      const n2 = ci.type === "pact" ? Math.ceil(ci.count / 2) : ch.level >= 4 ? Math.ceil(ci.count * 0.4) : Math.floor(ci.count / 3);
      const l2 = ci.leveledPool.filter(id => spellsData.spells[id].level === 2).slice(0, n2);
      const l1 = ci.leveledPool.filter(id => spellsData.spells[id].level === 1).slice(0, ci.count - l2.length);
      wanted = [...l1, ...l2];
    }
    ch.spells = pick(ci.leveledPool, ci.count, wanted, on("spells"));
  } else { ch.cantrips = []; ch.spells = []; }

  // заговор расы
  const rc = (P.sub && P.sub.cantrip) || P.race.cantrip;
  if (rc && rc.pick){
    if (!rc.pick.includes(ch.raceCantrip)) ch.raceCantrip = rc.pick.find(id => !ch.cantrips.includes(id)) || rc.pick[0];
  } else delete ch.raceCantrip;

  // языки
  const langs = uniq([...P.race.languages]);
  const extra = (P.race.extraLanguages || 0) + ((P.sub && P.sub.extraLanguages) || 0) + (P.bg.languages || 0);
  const pool = rules.languages.filter(l => !langs.includes(l));
  const lw = uniq((ch.languages || []).filter(l => pool.includes(l)));
  if (on("languages")) for (const l of pool){ if (lw.length >= extra) break; if (!lw.includes(l)) lw.push(l); }
  ch.languages = lw.slice(0, extra);

  if (P.cls.id === "ranger"){
    if (!rules.enemies.includes(ch.enemy)) ch.enemy = rules.enemies[0];
    if (!rules.terrains.includes(ch.terrain)) ch.terrain = rules.terrains[0];
  }
  if (ch.name == null) ch.name = randomName(rules, ch.race, ch.pronoun, rnd);
  if (ch.pitch == null) ch.pitch = pickRand(rules.pitch[ch.class], rnd);
  return ch;
}

export function randomName(rules, race, pronoun, rnd = Math.random){
  const n = rules.names[race] || rules.names.human;
  return pickRand(n[pronoun === "she" ? "she" : "he"], rnd);
}

/* Случайный герой: раса, класс, снаряжение и предыстория под класс */
export function randomChoices(rules, spellsData, opts = {}, rnd = Math.random){
  const race = opts.race || pickRand(rules.races, rnd).id;
  const r = byId(rules.races, race);
  const cls = opts.class || pickRand(rules.classes, rnd).id;
  const c = byId(rules.classes, cls);
  const bgs = rnd() < 0.75 && rules.bgFor[cls] ? rules.bgFor[cls] : rules.backgrounds.map(b => b.id);
  const pronoun = opts.pronoun || (rnd() < 0.5 ? "she" : "he");
  return normalize(rules, spellsData, {
    race, subrace: r.subraces ? pickRand(r.subraces, rnd).id : null,
    color: pickRand(rules.dragonColors, rnd).id,
    class: cls, kit: pickRand(c.kits, rnd).id, level: opts.level || 1,
    background: pickRand(bgs, rnd), pronoun,
    enemy: pickRand(rules.enemies, rnd), terrain: pickRand(rules.terrains, rnd),
    name: randomName(rules, race, pronoun, rnd), pitch: pickRand(rules.pitch[cls], rnd)
  }, rnd);
}

/* ============================================================
   Сборка листа
   ============================================================ */
export function buildCharacter(rules, spellsData, input){
  const ch = normalize(rules, spellsData, input);
  const P = parts(rules, ch);
  const { race, sub, cls, kit, bg, lvl, subcl, color } = P;
  const abilities = finalAbilities(rules, ch);
  const M = Object.fromEntries(AB.map(a => [a, mod(abilities[a])]));
  const pb = 2;
  const she = ch.pronoun === "she";

  // переменные для формул и текстов
  const num = { lvl, pb, ...M };
  AB.forEach(a => { num["dc_" + a] = 8 + pb + M[a]; });
  const str = {};
  for (const [k, v] of Object.entries(cls.table || {})){
    const val = v[lvl - 1];
    if (typeof val === "number") num[k] = val; else str[k] = val;
  }
  AB.forEach(a => { str["dc_" + a] = String(8 + pb + M[a]); });
  if (color){
    str["dragon.name"] = color.name.toLowerCase();
    str["dragon.dmg"] = color.dmg;
    str["dragon.saveName"] = rules.abilityGen[color.save];
    str["dragon.shapeText"] = color.shape === "line" ? "линию длиной 6 клеток (5 на 30 футов)" : "конус на 3 клетки (15 футов)";
  }
  str.enemy = ch.enemy || ""; str.terrain = ch.terrain || "";
  str.expertise = (ch.expertise || []).map(s => SKILL_NAMES[s]).join(" и ");
  const ctx = { she, num, str };

  /* --- владения --- */
  const armorProf = new Set([...cls.armor, ...((subcl && subcl.armor) || []), ...((sub && sub.armor) || [])]);
  const weaponProf = new Set([...cls.weapons, ...(race.weapons || []), ...((sub && sub.weapons) || [])]);
  const profWith = w => weaponProf.has(rules.weapons[w].cat) || weaponProf.has(w);

  /* --- снаряжение из набора --- */
  const equipment = [];
  let bodyArmor = null, shield = false;
  for (const [id, qty] of kit.items){
    if (rules.weapons[id]){
      const w = rules.weapons[id];
      const props = [w.versatile ? `двумя руками ${dice(w.versatile)}` : "", w.thrown ? "можно метать" : "", w.twoHanded ? "двуручное" : "", w.finesse ? "фехтовальное" : ""].filter(Boolean);
      equipment.push({ name: w.name, ...(qty > 1 ? { qty } : {}), note: `Урон ${dice(w.dmg)}, ${w.type}${props.length ? "; " + props.join(", ") : ""}.` });
    } else if (rules.armor[id]){
      const a = rules.armor[id];
      if (a.kind === "shield"){ shield = true; equipment.push({ name: a.name, note: "+2 к [[ac|КД]]. Занимает руку." }); }
      else {
        bodyArmor = a;
        equipment.push({ name: a.name, note: `[[ac|КД]] ${a.base}${a.kind === "light" ? " + Ловкость" : a.kind === "medium" ? " + Ловкость (не больше +2)" : ""}.${a.stealthDisadvantage ? " Прятаться в нём — с [[advantage|помехой]]." : ""}`,
          ...(a.stealthDisadvantage ? { stealthDisadvantage: true } : {}) });
      }
    } else if (rules.gear[id]){
      const g = rules.gear[id];
      equipment.push({ name: g.name, ...(qty > 1 ? { qty } : {}), note: g.note });
    }
  }
  bg.gear.forEach(g => equipment.push({ name: g, note: `Из прошлого: ${bg.name.toLowerCase()}.` }));
  equipment.push({ name: "Кошель", note: `${bg.gold} [[gold|зм]].` });

  /* --- КД --- */
  const style = cls.styleLevel && lvl >= cls.styleLevel ? kit.style : null;
  let ac, why;
  const dexPart = bodyArmor ? (bodyArmor.kind === "light" ? M.dex : bodyArmor.kind === "medium" ? Math.min(2, M.dex) : 0) : M.dex;
  if (bodyArmor){
    ac = bodyArmor.base + dexPart; why = `${bodyArmor.name} ${bodyArmor.base}${dexPart ? `, Ловкость ${sg(dexPart)}` : ""}`;
    if (style === "defense"){ ac += 1; why += ", стиль Оборона +1"; }
  } else if (cls.unarmored){
    const extra = cls.unarmored[0];
    ac = 10 + M.dex + M[extra]; why = `Без доспеха: 10, Ловкость ${sg(M.dex)}, ${rules.abilityNames[extra]} ${sg(M[extra])}`;
  } else if (subcl && subcl.unarmoredBase){
    ac = subcl.unarmoredBase + M.dex; why = `Драконья чешуя ${subcl.unarmoredBase}, Ловкость ${sg(M.dex)}`;
  } else { ac = 10 + M.dex; why = `Без доспеха: 10, Ловкость ${sg(M.dex)}`; }
  if (shield && !(cls.unarmored && cls.unarmored[0] === "wis")){ ac += 2; why += ", щит +2"; }
  const knowsMageArmor = (ch.spells || []).includes("mage-armor");
  if (!bodyArmor && knowsMageArmor && 13 + M.dex > ac) why += `. С Доспехами мага будет ${13 + M.dex + (shield ? 2 : 0)}`;

  /* --- хиты --- */
  const avg = cls.hitDie / 2 + 1;
  const perLvl = ((sub && sub.hpPerLevel) || 0) + ((subcl && subcl.hpPerLevel) || 0);
  let hp = Math.max(1, cls.hitDie + M.con) + perLvl;
  for (let l = 2; l <= lvl; l++) hp += Math.max(1, avg + M.con) + perLvl;

  /* --- скорость --- */
  let speed = (sub && sub.speed) || race.speed;
  if (cls.id === "monk" && lvl >= 2 && !bodyArmor && !shield) speed += 10;

  /* --- навыки --- */
  const si = skillInfo(rules, ch);
  const skills = uniq([...si.fixed, ...ch.skills, ...ch.raceSkills, ...ch.bonusSkills]);

  /* --- атаки --- */
  const features = [];
  const isMonkWeapon = w => cls.martialArts && (w === "shortsword" || (rules.weapons[w].cat === "simple" && !rules.weapons[w].ranged && !rules.weapons[w].twoHanded && !rules.weapons[w].heavy));
  const attackFor = (wid, mode) => {
    const w = rules.weapons[wid];
    const ranged = !!w.ranged || mode === "throw";
    let a = w.ranged ? "dex" : w.finesse || isMonkWeapon(wid) ? (M.dex >= M.str ? "dex" : "str") : "str";
    const prof = profWith(wid);
    let toHit = M[a] + (prof ? pb : 0), dmgMod = M[a];
    const whyHit = [`${rules.abilityNames[a]} ${sg(M[a])}`]; if (prof) whyHit.push(`[[proficiency|мастерство]] +${pb}`);
    const whyDmg = [`${rules.abilityNames[a]} ${sg(M[a])}`];
    if (style === "archery" && w.ranged){ toHit += 2; whyHit.push("стиль Стрельба +2"); }
    if (style === "dueling" && !ranged && !w.twoHanded && mode !== "offhand"){ dmgMod += 2; whyDmg.push("стиль Дуэлянт +2"); }
    let base = w.dmg;
    if (mode === "offhand" && style !== "twoweapon") dmgMod = Math.min(0, dmgMod), whyDmg.length = 0, whyDmg.push("второй рукой без модификатора");
    const range = w.ranged ? w.ranged : mode === "throw" ? w.thrown : null;
    const attack = { toHit, damage: withMod(base, dmgMod), damageType: w.type, melee: !ranged };
    if (w.versatile && !shield && !ranged && mode !== "offhand") attack.alt = `${dice(withMod(w.versatile, dmgMod))} двумя руками`;
    if (range) attack.range = `до ${range[0] / 5} клеток обычно, до ${range[1] / 5} — с [[advantage|помехой]]`;
    return { attack, why: `Попадание: ${whyHit.join(", ")}. Урон: ${whyDmg.join(", ") || "—"}.` };
  };
  const nameFor = (wid, mode) => {
    const w = rules.weapons[wid];
    if (mode === "offhand") return `Второй рукой: ${w.name.toLowerCase()}`;
    if (w.ranged) return `Выстрел из ${w.gen || w.name.toLowerCase()}`;
    if (mode === "throw") return `Бросок: ${w.acc || w.name.toLowerCase()}`;
    return w.ins ? `Удар ${w.ins}` : w.name;
  };
  const plainFor = (wid, mode) => {
    const w = rules.weapons[wid];
    if (w.ranged) return "Стреляешь во врага на расстоянии. Сначала бросок на попадание: назови число мастеру. Попал{{а|}} — бросай урон.";
    if (mode === "throw") return "Метаешь оружие во врага на расстоянии. После боя его нужно подобрать.";
    if (mode === "offhand") return "Если в этот ход уже был удар лёгким оружием, бонусным действием бьёшь вторым.";
    return "Бьёшь врага в соседней [[square|клетке]]. Сначала бросок на попадание: назови число мастеру. Попал{{а|}} — бросай урон.";
  };
  let mainMelee = null;
  kit.attacks.forEach(({ w, throw: thr }) => {
    const mode = thr ? "throw" : null;
    const id = w + (thr ? "-throw" : "");
    if (features.some(f => f.id === id)) return;
    const { attack, why } = attackFor(w, mode);
    features.push({ id, kind: "action", scene: "combat", name: nameFor(w, mode), source: "оружие", plain: fill(plainFor(w, mode), ctx), attack, why: fill(why, ctx) });
    if (!mainMelee && attack.melee) mainMelee = id;
  });
  if (kit.offhand){
    const { attack, why } = attackFor(kit.offhand, "offhand");
    features.push({ id: "offhand", kind: "bonus", scene: "combat", name: nameFor(kit.offhand, "offhand"), source: "оружие", plain: plainFor(kit.offhand, "offhand"), attack, why });
  }
  // безоружный удар монаха и когти табакси
  if (cls.martialArts || race.claws){
    const a = cls.martialArts ? (M.dex >= M.str ? "dex" : "str") : "str";
    const die = race.claws ? "1d6" : "1d4";
    features.push({ id: "unarmed", kind: "action", scene: "combat", name: race.claws ? "Удар когтями" : "Безоружный удар",
      source: race.claws ? race.name.toLowerCase() : "монах",
      plain: race.claws ? "Когти всегда с тобой: бьёшь врага в соседней клетке." : "Кулак, локоть, колено. Монах бьёт ими не хуже, чем мечом.",
      attack: { toHit: M[a] + pb, damage: withMod(die, M[a]), damageType: race.claws ? "рубящий" : "дробящий", melee: true },
      why: `Попадание: ${rules.abilityNames[a]} ${sg(M[a])}, мастерство +${pb}. Урон: ${rules.abilityNames[a]} ${sg(M[a])}.` });
    if (!mainMelee) mainMelee = "unarmed";
  }

  /* --- способности: класс, подкласс, стиль, раса, предыстория --- */
  const mk = (f, source) => {
    const out = { id: f.id, kind: f.kind, scene: f.scene || "combat", name: fill(f.name, ctx), source, plain: fill(f.plain, ctx) };
    if (f.uses){
      const max = Math.max(0, Math.round(usesMax(f.uses.max, ctx)));
      if (max <= 0) return null;
      out.uses = { max: Math.min(20, max), recharge: f.uses.recharge };
    }
    if (f.heal) out.heal = fill(f.heal, ctx);
    if (f.spend) out.spend = { ...f.spend };
    if (f.trigger) out.trigger = f.trigger;
    if (f.grantsAction) out.grantsAction = true;
    if (f.save) out.save = { ab: f.save.ab, dc: 8 + pb + M[f.save.dc] };
    if (f.breath && color){
      out.save = { ab: color.save, dc: 8 + pb + M.con };
      out.dmg = { dice: "2d6", type: color.dmg, half: true };
    }
    if (f.attackRef === "main" && mainMelee) out.attackRef = mainMelee;
    else if (f.attackRef === "unarmed") out.attackRef = "unarmed";
    else if (f.attackRef === "main") return null;
    return out;
  };
  const clsName = cls.name.toLowerCase();
  cls.features.filter(f => (f.level || 1) <= lvl).forEach(f => { const x = mk(f, clsName); if (x) features.push(x); });
  if (style){ const x = mk(rules.styles[style], clsName); if (x) features.push(x); }
  if (subcl) subcl.features.filter(f => (f.level || 1) <= lvl).forEach(f => { const x = mk(f, subcl.name.toLowerCase()); if (x) features.push(x); });
  // атака по возможности и движение есть у всех
  if (mainMelee) features.push({ id: "opportunity", kind: "reaction", scene: "combat", name: "Атака по возможности", source: "любой герой",
    plain: "Враг выходит из соседней клетки — успеваешь ударить его вслед.", attackRef: mainMelee });
  const raceName = (sub ? sub.name : race.name);
  features.push({ id: "movement", kind: "movement", scene: "combat", name: "Скорость", source: raceName.toLowerCase(),
    plain: "Движение можно делить: шаг, удар, ещё пара шагов. Действие «Рывок» удваивает его на один ход." + (race.speedNote ? " " + race.speedNote : "") });
  const raceFeats = [...race.features, ...((sub && sub.features) || [])];
  const darkvisionFt = sub && sub.darkvision;
  raceFeats.filter(f => (f.level || 1) <= lvl).forEach(f => {
    let x = mk(f, raceName.toLowerCase());
    if (!x) return;
    if (x.id === "darkvision" && darkvisionFt) x.plain = `В темноте видишь на ${darkvisionFt / 5} клеток (${darkvisionFt} футов), как в сумерках. Цвета не различаешь, всё в оттенках серого.`;
    if (features.some(o => o.id === x.id)) x.id += "-race";
    features.push(x);
  });
  features.push({ id: "bg-feature", kind: "passive", scene: "social", name: bg.feature[0], source: bg.name.toLowerCase(), plain: bg.feature[1] });

  // одинаковые id недопустимы: лист ищет способности по ним
  const seen = new Set();
  features.forEach(f => { let id = f.id, n = 2; while (seen.has(id)) id = `${f.id}-${n++}`; f.id = id; seen.add(id); });

  /* --- заклинания --- */
  const spells = [];
  const spellEntry = (id, abil, extra = {}) => {
    const s = spellsData.spells[id];
    if (!s) return null;
    const m = M[abil], atk = pb + m, dc = 8 + pb + m;
    const e = { id, name: s.name, level: s.level, kind: CAST_KIND[s.cast] || "action", plain: fill(s.plain, ctx), range: s.range, dur: s.dur };
    if (s.conc) e.conc = true;
    if (s.ritual) e.ritual = true;
    if (s.count) e.count = s.count;
    if (s.upcast) e.upcast = s.upcast;
    let dmg = s.dmg;
    if (dmg && s.dmgMod) dmg = withMod(dmg, m);
    if (dmg && s.agonizing && cls.agonizing && lvl >= cls.agonizing) dmg = withMod(dmg, M.cha);
    if (s.attack) e.attack = { toHit: atk, damage: dmg, damageType: s.dtype, melee: s.attack === "melee" };
    else if (dmg) e.dmg = { dice: dmg, type: s.dtype, half: !!s.half };
    if (s.save) e.save = { ab: s.save, dc, half: !!s.half };
    if (s.sleep) e.sleep = s.sleep;
    if (s.heal){
      let h = s.healMod ? withMod(s.heal, m) : s.heal;
      if (subcl && subcl.healBonus && s.level >= 1){
        const b = 2 + s.level;
        h = h.replace(/([+-]\d+)?$/, x => { const v = (x ? +x : 0) + b; return v ? (v > 0 ? "+" : "-") + Math.abs(v) : ""; });
        e.healNote = `Ученик жизни: +${b} уже учтено.`;
      }
      e.heal = h;
    }
    return Object.assign(e, extra);
  };
  const ci = casterInfo(rules, spellsData, ch, abilities);
  let spellcasting = null;
  if (ci){
    const m = M[ci.ability];
    spellcasting = { ability: ci.ability, attack: pb + m, dc: 8 + pb + m, slots: ci.slots, recharge: ci.type === "pact" ? "short" : "long",
      prepared: !!ci.prepared, source: clsName };
    ch.cantrips.forEach(id => { const e = spellEntry(id, ci.ability); if (e) spells.push(e); });
    ci.always.forEach(id => { const e = spellEntry(id, ci.ability, { always: true }); if (e) spells.push(e); });
    ch.spells.forEach(id => { const e = spellEntry(id, ci.ability); if (e) spells.push(e); });
  }
  const rc = (sub && sub.cantrip) || race.cantrip;
  if (rc){
    const id = rc.fixed || ch.raceCantrip;
    if (id && !spells.some(s => s.id === id)){ const e = spellEntry(id, rc.ability, { source: raceName.toLowerCase() }); if (e) spells.push(e); }
  }

  /* --- языки --- */
  const languages = uniq([...race.languages, ...ch.languages, ...(subcl && subcl.colors ? ["Драконий"] : [])]);

  const character = {
    format: "novice-sheet/0.3", edition: "5e-2014",
    name: String(ch.name || "").trim().slice(0, 80) || "Безымянный герой", pronoun: ch.pronoun,
    ...(ch.pitch ? { pitch: ch.pitch } : {}),
    race: { id: sub ? sub.id : race.id, name: raceName + (color && race.colors ? ` (${color.name.toLowerCase()})` : "") },
    class: { id: cls.id, name: cls.name, level: lvl, ...(subcl ? { subclass: subcl.name } : {}) },
    background: { id: bg.id, name: bg.name },
    abilities, proficiencyBonus: pb,
    hp: { max: hp }, hitDice: { die: `1d${cls.hitDie}`, count: lvl },
    ac: { value: ac, why }, speed,
    saves: [...cls.saves], skills, expertise: [...ch.expertise],
    ...(cls.halfProf && lvl >= cls.halfProf ? { halfProf: true } : {}),
    languages, ...(bg.tools ? { tools: bg.tools } : {}), features, equipment,
    ...(spellcasting ? { spellcasting } : {}),
    ...(spells.length ? { spells } : {}),
    source: { app: "builder", choices: compactChoices(ch) }
  };
  return character;
}

// В базу вместе с листом кладём выбор мастера: так персонажа можно открыть в конструкторе и поправить
function compactChoices(ch){
  const keep = ["name", "pronoun", "pitch", "race", "subrace", "color", "class", "kit", "level", "background", "base", "baseAuto", "auto",
    "asiFree", "asi4", "skills", "raceSkills", "bonusSkills", "expertise", "cantrips", "spells", "raceCantrip", "languages", "enemy", "terrain"];
  const out = {};
  for (const k of keep) if (ch[k] != null && !(Array.isArray(ch[k]) && !ch[k].length)) out[k] = ch[k];
  return out;
}
