/* ============================================================
   Импорт персонажа из Long Story Short (LSS) — «сито».
   Всё работает в браузере мастера, в базу ничего не пишет.

   Слой 1. Разбор полей файла в наш формат.
   Слой 2. Пересчёт и сверка: всё, что выводится из характеристик,
           считаем сами и сравниваем с тем, что написал мастер.
   Слой 3. Словари и ключевые фразы: оружие, доспехи, языки,
           тип действия, сколько раз и когда возвращается.

   На выходе: персонаж в формате novice-sheet и список находок
   для экрана проверки (слой 4 — последнее слово за мастером).
   ============================================================ */

const ABIL = ["str", "dex", "con", "int", "wis", "cha"];
const ABIL_RU  = { str: "Сила", dex: "Ловкость", con: "Телосложение", int: "Интеллект", wis: "Мудрость", cha: "Харизма" };
const ABIL_DAT = { str: "Силе", dex: "Ловкости", con: "Телосложению", int: "Интеллекту", wis: "Мудрости", cha: "Харизме" };
const ABIL_GEN = { силы: "str", ловкости: "dex", телосложения: "con", интеллекта: "int", мудрости: "wis", харизмы: "cha" };
const SKILL_ID = { "sleight of hand": "sleight", "animal handling": "animal" };

const mod   = s => Math.floor(((+s || 10) - 10) / 2);
const sg    = n => (n < 0 ? "−" : "+") + Math.abs(n);
const norm  = s => String(s ?? "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
const cap   = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const pbFor = lvl => 2 + Math.floor((Math.max(1, lvl) - 1) / 4);
const num   = v => { const n = parseInt(String(v ?? "").replace(/[^\d-]/g, ""), 10); return Number.isFinite(n) ? n : null; };
const evalSum = expr => String(expr ?? "").match(/[+-]?\s*\d+/g)?.reduce((s, x) => s + parseInt(x.replace(/\s/g, ""), 10), 0) ?? 0;
const atWordStart = (t, stem) => { let i = t.indexOf(stem); while (i !== -1){ if (i === 0 || !/[а-яa-z]/.test(t[i - 1])) return true; i = t.indexOf(stem, i + 1); } return false; };
const findByStem = (list, text) => { const t = norm(text); return list.find(x => x.stems.some(s => atWordStart(t, s))) || null; };
const showDice = f => f.replace(/d/g, "к");

/* ---------- Слой 1: тексты LSS → абзацы ----------
   Текстовое поле бывает документом редактора (ProseMirror), HTML-строкой или просто строкой.
   Приводим к списку абзацев: [{ segs: [{ text, bold, italic }], li }] */
function toParas(field){
  const v = field?.value?.data ?? field?.value ?? field;
  if (v == null) return [];
  if (typeof v === "string"){
    if (!v.trim()) return [];
    return /<[a-z]/i.test(v) ? htmlToParas(v) : v.split(/\n+/).map(t => ({ segs: [{ text: t, bold: false }], li: false }));
  }
  if (typeof v === "object" && Array.isArray(v.content)){ const out = []; walk(v.content, out, false); return out; }
  return [];
}
function walk(nodes, out, li){
  for (const n of nodes || []){
    if (n.type === "paragraph" || n.type === "heading"){
      const segs = (n.content || []).filter(c => c.type === "text" || c.type === "hardBreak").map(c => ({
        text: c.type === "hardBreak" ? " " : c.text,
        bold: n.type === "heading" || (c.marks || []).some(m => m.type === "bold"),
        italic: (c.marks || []).some(m => m.type === "italic")
      }));
      out.push({ segs, li });
    } else if (n.type === "bulletList" || n.type === "orderedList"){
      for (const item of n.content || []) walk(item.content, out, true);
    } else if (n.content){
      walk(n.content, out, li);
    }
  }
}
const decode = s => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
function htmlToParas(html){
  return html.replace(/<br\s*\/?>/gi, "\n").split(/<\/?p[^>]*>|<\/?li[^>]*>/i).map(chunk => {
    const segs = [];
    const re = /<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>|([^<]+)|<[^>]+>/gi;
    let m;
    while ((m = re.exec(chunk))){
      if (m[2] != null) segs.push({ text: decode(m[2].replace(/<[^>]+>/g, "")), bold: true });
      else if (m[3] != null) segs.push({ text: decode(m[3]), bold: false });
    }
    return { segs, li: false };
  });
}
const paraText = p => p.segs.map(s => s.text).join("").replace(/\s+/g, " ").trim();
const isBoldStart = p => { const f = p?.segs.find(s => s.text.trim()); return !!(f && f.bold); };
const isSentence = t => t.length > 60 || /[.!?]\s|[.!?]$/.test(t);

/* Абзацы → блоки «название + описание».
   Понимает: жирный заголовок с текстом в той же строке или в следующих абзацах,
   «Название. Текст», «Название - текст», «Название:» на отдельной строке,
   заголовки групп вроде «Умения от расы:», списки, нумерацию «1 - …». */
function toBlocks(paras){
  const blocks = [];
  let cur = null, header = "";
  const close = () => { if (cur){ cur.desc = cur.desc.trim(); blocks.push(cur); cur = null; } };
  const open = (title, desc) => { close(); let t = title.replace(/[\s.:;,–—-]+$/, "").trim(); if (t.length > 3 && t === t.toUpperCase()) t = cap(t.toLowerCase()); cur = { title: t, desc: (desc || "").replace(/^[\s.:;,–—-]+/, ""), header }; };

  for (let i = 0; i < paras.length; i++){
    const p = paras[i], text = paraText(p);
    if (!text){ close(); continue; }
    if (/^[\d\s/.,:;+-]+$/.test(text)) continue;                       // «3/4» и прочий мусор
    if (p.segs.every(s => !s.text.trim() || s.italic) && /уров/.test(norm(text))) continue; // «1-й уровень, умение домена»

    if (isBoldStart(p)){
      let title = "", k = 0;
      while (k < p.segs.length && (p.segs[k].bold || !p.segs[k].text.trim())){ title += p.segs[k].text; k++; }
      title = title.replace(/\s+/g, " ").trim();
      const rest = p.segs.slice(k).map(s => s.text).join("").replace(/\s+/g, " ").trim();

      if (/^\d+\s*[-–—.)]?\s*$/.test(title) && cur){ cur.desc += "\n" + text; continue; }   // «1 - …» внутри описания
      if (!rest){
        const next = paras[i + 1], nextText = next ? paraText(next) : "";
        if (/:$/.test(title) && (!nextText || isBoldStart(next))){ close(); header = title.replace(/:$/, ""); continue; }
      }
      open(title, rest);
      continue;
    }

    if (cur){ cur.desc += "\n" + text; continue; }

    let m = text.match(/^(.{2,60}?)\s+[-–—]\s+(.+)$/);
    if (m){ open(m[1], m[2]); close(); continue; }
    m = text.match(/^([^.:!?]{3,70})[.:]\s+(.+)$/);
    if (m){ open(m[1], m[2]); continue; }
    const next = paras[i + 1], nextText = next ? paraText(next) : "";
    if (text.length <= 60 && !/[.!?]$/.test(text) && nextText && !isBoldStart(next) && isSentence(nextText)){ open(text, ""); continue; }
    open(text.length <= 70 ? text : text.split(/\s+/).slice(0, 5).join(" ") + "…", text.length <= 70 ? "" : text);
    if (text.length > 70) cur.untitled = true;
    close();
  }
  close();
  return blocks;
}

/* ---------- Слой 3: ключевые фразы ---------- */
function classify(text){
  const t = norm(text);
  const at = re => { const m = re.exec(t); return m ? m.index : Infinity; };
  const bonus = at(/бонусн[а-я]*\s+действи/);
  const reaction = at(/реакци(ей|ю|я|и)([^а-я]|$)/);
  let action = Infinity;
  for (const m of t.matchAll(/действием|в качестве действия|вместо атаки/g)){
    if (!/бонусн[а-я]*\s+$/.test(t.slice(Math.max(0, m.index - 12), m.index))){ action = m.index; break; }
  }
  const first = Math.min(bonus, reaction, action);
  if (first === Infinity) return { kind: "passive", guess: true };
  return { kind: first === bonus ? "bonus" : first === reaction ? "reaction" : "action", guess: false };
}

function parseUses(text, ctx){
  const t = norm(text);
  let recharge = null;
  if (/коротк[а-я]*\s+(или|либо)\s+(продолжительн|длинн|длительн)|коротк[а-я]*\s+отдых/.test(t)) recharge = "short";
  else if (/(продолжительн|длинн|длительн)[а-я]*\s+отдых|между длинными отдыхами/.test(t)) recharge = "long";
  if (!recharge || /исчеза/.test(t)) return null;
  let max = 1, sure = false;
  const m = t.match(/количеств[а-я]* раз,?\s+равн[а-я]*\s+(1\s*\+\s*)?(?:вашему\s+)?модификатор[а-я]*\s+(силы|ловкости|телосложения|интеллекта|мудрости|харизмы)/);
  if (m){ max = Math.max(1, mod(ctx.stats[ABIL_GEN[m[2]]]) + (m[1] ? 1 : 0)); sure = true; }
  else if (/количеств[а-я]* раз,?\s+равн[а-я]*\s+(?:вашему\s+)?бонусу мастерства/.test(t)){ max = ctx.pb; sure = true; }
  else {
    // «один раз на 2-м уровне, два раза на 6-м уровне» — берём строчку для текущего уровня
    const W = { один: 1, два: 2, три: 3, четыре: 4, пять: 5 };
    const byLevel = [...t.matchAll(/(один|два|три|четыре|пять|\d+)\s+раз[а]?\s+на\s+(\d+)-?[а-я]*\s+уровн/g)]
      .map(m => [W[m[1]] || +m[1], +m[2]]).filter(([, lv]) => lv <= ctx.level).sort((a, b) => b[1] - a[1]);
    const n = t.match(/(\d+)\s+раз/) || t.match(/(один|два|три|четыре|пять)\s+раз/);
    if (byLevel.length){ max = byLevel[0][0]; sure = true; }
    else if (n){ max = W[n[1]] || +n[1]; sure = true; }
    else if (/(^|[^а-я])раз (за|в|между)|один раз|не можете использовать (ее|его|это) снова|прежде чем (вы )?сможете (использовать|сделать)/.test(t)){ max = 1; sure = true; }
  }
  return { max, recharge, sure };
}

const HEAL_RE = /восстанавлива[а-я]*\s+(\d+\s*[кd]\s*\d+(?:\s*\+\s*\d+)?)\s+хит/;
const SOCIAL_RE = /темное зрение|язык|предыстори|звани|исследовател|просьбам|связи|приют|жаргон|странник|знаток|уход за|гостеприимств/;
const COMBAT_RE = /атак|урон|хит|спасброс|(^|[^а-я])кд([^а-я]|$)|(^|[^а-я])бо[йюя]([^а-я]|$)|оружи|реакци|сражени|враг|существ|крит|попадани/;
const ATTACK_RE = /попадани|урон|атак|досягаемост/;

/* ---------- главная функция ---------- */
export function importLSS(file, { kb, dict }){
  const findings = [];
  const add = (level, text, options) => findings.push({ level, text, options: options || null });

  // Внешняя обёртка LSS хранит сам лист строкой JSON в поле data
  let d = file?.data;
  if (typeof d === "string") d = JSON.parse(d);
  if (!d || d.jsonType !== "character") throw new Error("Это не персонаж из Long Story Short");
  const info = d.info || {}, v = d.vitality || {}, text = d.text || {};

  /* --- кто это --- */
  const name = String(d.name?.value || "").trim();
  const level = num(info.level?.value) || 1;
  const className = String(info.charClass?.value || "").trim();
  const subclass = String(info.charSubclass?.value || "").trim();
  const raceName = String(info.race?.value || "").trim();
  const bgName = String(info.background?.value || "").trim();
  const cls = findByStem(dict.classes, className);
  const race = findByStem(dict.races, raceName);
  const femEnd = /(ья|ка|ица|есса|иня)$/;

  const stats = {};
  for (const a of ABIL) stats[a] = num(d.stats?.[a]?.score) ?? 10;
  const ctx = { stats, pb: pbFor(level), level };

  const ch = {
    format: "novice-sheet/0.3",
    edition: file.edition === "2024" ? "5e-2024" : "5e-2014",
    name,
    pronoun: femEnd.test(norm(className)) || femEnd.test(norm(bgName)) ? "she" : "he",
    pitch: "",
    race: { id: "", name: raceName || "—" },
    class: { id: cls?.id || "", name: cap(className) || "—", level, subclass },
    background: { id: "", name: bgName, note: "" },
    abilities: stats,
    proficiencyBonus: ctx.pb,
    hp: { max: 1 },
    hitDice: { die: "1d8", count: level },
    ac: { value: 10, why: "" },
    speed: 30,
    saves: [], skills: [], expertise: [], skillMods: {}, saveMods: {},
    languages: [],
    features: [],
    equipment: [],
    source: { app: "lss", importedAt: new Date().toISOString().slice(0, 10) }
  };

  if (!name) add("error", "Нет имени персонажа. Впиши его в поле «Имя» выше.");
  if (!className) add("warn", "Не указан класс.");
  if (!raceName) add("warn", "Не указан вид (раса).");

  /* --- мастерство --- */
  const pbFile = num(d.proficiency);
  if (pbFile != null && pbFile !== ctx.pb){
    add("warn", `Бонус мастерства в файле ${sg(pbFile)}, а на ${level} уровне положено ${sg(ctx.pb)}.`, [
      { label: `Взять ${sg(ctx.pb)} по уровню`, apply: c => { c.proficiencyBonus = ctx.pb; } },
      { label: `Оставить ${sg(pbFile)}`, apply: c => { c.proficiencyBonus = pbFile; } }
    ]);
  } else add("ok", `Бонус мастерства ${sg(ctx.pb)} подходит к ${level} уровню.`);
  const pb = ch.proficiencyBonus;

  /* --- спасброски и навыки: владение — флажками, ручные поправки — отдельно --- */
  for (const a of ABIL){
    const s = d.saves?.[a] || {};
    if (s.isProf) ch.saves.push(a);
    const cm = num(s.customModifier);
    if (cm){ ch.saveMods[a] = cm; add("warn", `У спасброска ${ABIL_RU[a]} стоит ручная поправка ${sg(cm)}. Я её прибавил, проверь, что так и задумано.`); }
  }
  for (const [key, s] of Object.entries(d.skills || {})){
    const id = SKILL_ID[key] || key;
    const p = +s.isProf || 0;
    if (p >= 2) ch.expertise.push(id); else if (p >= 1) ch.skills.push(id);
    const cm = num(s.customModifier);
    const skillName = kb.skills.find(x => x.id === id)?.name || key;
    if (cm){ ch.skillMods[id] = cm; add("warn", `У навыка «${skillName}» ручная поправка ${sg(cm)}. Я её прибавил, проверь.`); }
  }
  add("ok", `Владение: ${ch.saves.length} спасброска и ${ch.skills.length + ch.expertise.length} навыков перенесены по отметкам.`);

  const initFile = num(v.initiative?.value);
  if (initFile != null && initFile !== mod(stats.dex)){
    ch.initiative = initFile;
    add("warn", `Инициатива в файле ${sg(initFile)}, а по Ловкости ${sg(mod(stats.dex))}. Бывает из-за черты или умения.`, [
      { label: `Оставить ${sg(initFile)}`, apply: c => { c.initiative = initFile; } },
      { label: `По Ловкости ${sg(mod(stats.dex))}`, apply: c => { delete c.initiative; } }
    ]);
  }
  const pp = num(d.skills?.perception?.customPassive);
  if (pp) ch.passivePerception = pp;

  /* --- скорость --- */
  const speed = num(v.speed?.value);
  if (!speed){
    const guess = race?.speed || 30;
    ch.speed = guess;
    add("warn", `Скорость не заполнена (0). Поставил ${guess} футов${race ? `, как у вида «${raceName}»` : ""}.`);
  } else {
    ch.speed = speed;
    if (race && race.speed !== speed) add("info", `Скорость ${speed} футов, обычно у вида «${raceName}» ${race.speed}. Может, это из-за умения.`);
  }

  /* --- хиты и кость хитов --- */
  const dieFile = String(v["hit-die"]?.value || "").match(/d(\d+)/i);
  const die = dieFile ? +dieFile[1] : cls?.hitDie || 8;
  if (!dieFile && !cls) add("warn", `Не понял, какая кость хитов у класса «${className}». Поставил к8.`);
  ch.hitDice = { die: "1d" + die, count: num(v["hp-dice-current"]?.value) || level };
  const hpMax = num(v["hp-max"]?.value) || 0;
  const conM = mod(stats.con);
  const minHP = die + (level - 1) + level * conM, maxHP = die * level + level * conM;
  const avgHP = die + (level - 1) * (die / 2 + 1) + level * conM;
  if (!hpMax){
    ch.hp.max = avgHP;
    add("warn", `Максимум хитов не заполнен. Посчитал по среднему: ${avgHP}.`);
  } else {
    ch.hp.max = hpMax;
    if (hpMax < minHP || hpMax > maxHP + 2 * level){
      add("warn", `Хиты ${hpMax} не укладываются в возможное для ${level} уровня (к${die}, Телосложение ${sg(conM)}): от ${minHP} до ${maxHP}. По среднему было бы ${avgHP}.`, [
        { label: `Оставить ${hpMax}`, apply: c => { c.hp.max = hpMax; } },
        { label: `Взять ${avgHP}`, apply: c => { c.hp.max = avgHP; } }
      ]);
    } else if (hpMax === avgHP) add("ok", `Хиты ${hpMax} сходятся с расчётом по кости к${die} и Телосложению.`);
    else add("ok", `Хиты ${hpMax} в пределах возможного (по среднему было бы ${avgHP}, наверное, бросали кубики).`);
  }

  /* --- снаряжение: собираем заранее, оно нужно для проверки КД --- */
  const items = [];
  const addItem = (nameRaw, note) => {
    const nm = cap(String(nameRaw).replace(/\s+/g, " ").replace(/[\s,;.]+$/, "").trim());
    if (!nm || nm.length < 2) return;
    if (items.some(x => norm(x.name) === norm(nm))) return;
    const arm = findByStem(dict.armor, nm);
    const it = { name: nm, note: note ? String(note).trim() : "" };
    if (arm?.stealthDisadvantage) it.stealthDisadvantage = true;
    if (arm) it.armor = arm.name;
    items.push(it);
  };
  const itemLine = line => {
    const t = String(line || "").replace(/\s+/g, " ").trim();
    if (!t) return;
    const one = t.match(/^(.{2,60}?)\s*(?::|\s[-–—])\s+(.+)$/);
    if (one){ addItem(one[1], one[2]); return; }
    for (const part of /[(]/.test(t) ? [t] : t.split(/\s*[,;]\s*/)) addItem(part, "");
  };
  const itemLines = paras => {
    for (let i = 0; i < paras.length; i++){
      const p = paras[i], t = paraText(p);
      if (!t) continue;
      if (isBoldStart(p)){
        let title = "", k = 0;
        while (k < p.segs.length && (p.segs[k].bold || !p.segs[k].text.trim())){ title += p.segs[k].text; k++; }
        const rest = p.segs.slice(k).map(x => x.text).join("").replace(/\s+/g, " ").trim();
        const next = paras[i + 1], nextText = next ? paraText(next) : "";
        if (!rest && nextText && !isBoldStart(next) && isSentence(nextText)){ addItem(title, firstSentence(nextText)); i++; continue; }
        if (rest){ addItem(title.replace(/[\s.:;–—-]+$/, ""), rest.replace(/^[\s.:;–—-]+/, "")); continue; }
        itemLine(title); continue;
      }
      itemLine(t);
    }
  };
  itemLines(toParas(text.equipment));

  /* --- КД: значение из файла, щит, бонусы; сверка с доспехом из снаряжения --- */
  let ac = num(v.ac?.value) || 10;
  const acParts = [`КД в файле ${ac}`];
  if (v.shield?.value){
    const sm = v.shield.mod == null || v.shield.mod === "" ? 2 : evalSum(v.shield.mod);
    if (sm){ ac += sm; acParts.push(`щит ${sg(sm)}`); }
  }
  for (const b of d.bonuses || []) if (b.target === "ac"){ const n = evalSum(b.expr); if (n){ ac += n; acParts.push(`${b.label || "бонус"} ${sg(n)}`); } }
  ch.ac = { value: ac, why: acParts.join(", ") };
  if (acParts.length > 1){
    add("warn", `КД ${ac}: ${acParts.join(" + ")}. Если щит или бонус уже входили в число из файла, верни как было.`, [
      { label: `Оставить ${ac}`, apply: c => { c.ac.value = ac; } },
      { label: `Только из файла: ${num(v.ac?.value) || 10}`, apply: c => { c.ac.value = num(v.ac?.value) || 10; c.ac.why = "КД из файла"; } }
    ]);
  }
  // Пересчёт из найденного доспеха делаем после разбора всех текстов (вещи бывают и в других полях)

  /* --- языки, сопротивления: поле «Владения» --- */
  const extraFeatures = [];
  for (const p of toParas(text.prof)){
    const t = paraText(p); if (!t) continue;
    const lm = t.match(/^(знание языков|языки)\s*:?\s*(.*)$/i);
    if (lm){ ch.languages.push(...splitList(lm[2])); continue; }
    const rm = t.match(/^(сопротивлени[а-я]*|иммунитет[а-я]*)( к)?\s*:\s*(.*)$/i);
    if (rm){ const what = rm[3].replace(/[\s,]+$/, ""); if (what && !/^нет([^а-я]|$)/i.test(what)) extraFeatures.push({ title: cap(rm[1]), desc: `${cap(rm[1])} к: ${what}.`, field: "prof" }); continue; }
    if (/^(доспехи|оружие|инструменты)/i.test(t)) continue;
    const words = splitList(t);
    if (words.length && words.every(w => dict.languages.some(l => norm(w).includes(l)))) ch.languages.push(...words);
  }
  ch.languages = [...new Set(ch.languages.map(cap))];
  if (!ch.languages.length) add("info", "Языки не нашёл. Если они есть, их можно дописать позже.");

  /* --- способности из всех текстовых полей --- */
  const FEATURE_FIELDS = ["traits", "features", "feats", "notes-1", "notes-2", "notes-3", "notes-4", "notes-5", "notes-6"];
  const SOURCE_BY_FIELD = { feats: "черта", items: "предмет", attacks: "атака" };
  const blocks = [];
  for (const f of FEATURE_FIELDS) for (const b of toBlocks(toParas(text[f]))) blocks.push({ ...b, field: f });
  // Поле «Атаки» мастера часто используют как мешок: атаки — в способности, остальное — в вещи
  for (const b of toBlocks(toParas(text.attacks))){
    if (ATTACK_RE.test(norm(b.title + " " + b.desc))) blocks.push({ ...b, field: "attacks" });
    else if (b.desc && !b.untitled) addItem(b.title, firstSentence(b.desc)); else itemLine(b.untitled ? b.desc : b.title);
  }
  // Магические предметы: в снаряжение; если описывают действие — ещё и в способности
  itemLines(toParas(text.items));
  for (const b of toBlocks(toParas(text.items))) if (b.desc && !b.untitled && !classify(b.desc).guess) blocks.push({ ...b, field: "items" });
  for (const e of extraFeatures) blocks.push(e);

  /* --- оружие из таблицы: разбор записи урона и сверка с расчётом --- */
  const weaponFeatures = [];
  let wi = 0;
  for (const w of d.weaponsList || []){
    const wName = String(w.name?.value || "").trim(), raw = String(w.dmg?.value || "").trim();
    if (!wName && !raw) continue;                                         // пустая строка таблицы
    if (!wName){ add("warn", `В таблице оружия строка без названия (урон «${raw}»). Пропустил.`); continue; }
    const dw = findByStem(dict.weapons, wName);
    const rawD = raw.replace(/(\d*)\s*[кkd]\s*(\d+)/gi, (_, n, s) => `${n || 1}d${s}`);
    const dice = rawD.match(/(\d+)d(\d+)/);
    const alt = rawD.match(/\((\d+d\d+)\)/);
    const token = rawD.match(/\[(str|dex|con|int|wis|cha)\]/i);
    const rest = rawD.replace(/\(\d+d\d+\)/g, "").replace(/\d+d\d+/, "").replace(/\[[a-z]+\]/gi, "");
    const flat = evalSum(rest.match(/[+-]\s*\d+/g)?.join("") || "");
    const ability = (w.ability || token?.[1] || (dw?.finesse ? (stats.dex > stats.str ? "dex" : "str") : dw?.ranged ? "dex" : "str")).toLowerCase();
    const am = mod(stats[ability]);
    const magic = +(wName.match(/\+(\d)\b/)?.[1] || 0);
    const atkBonus = (d.bonuses || []).filter(b => b.target === `weapon.${w.id}.attack`).reduce((s, b) => s + evalSum(b.expr), 0);
    const dmgBonus = (d.bonuses || []).filter(b => /^weapon\..+\.(dmg|damage)$/.test(b.target) && b.target.includes(w.id)).reduce((s, b) => s + evalSum(b.expr), 0);
    const prof = w.isProf !== false;
    const toHit = am + (prof ? pb : 0) + (atkBonus || magic);
    const diceStr = dice ? `${dice[1]}d${dice[2]}` : dw?.dmg || "1d4";
    const dmgFile = (token ? am : 0) + flat + dmgBonus;
    const dmgCalc = am + (atkBonus ? (flat || 0) : magic) + dmgBonus;
    const fmt = n => diceStr + (n ? (n > 0 ? "+" : "") + n : "");
    let dmgType = norm(w.dmgType?.value || "");
    if (!dmgType){ for (const [stem, t] of Object.entries(dict.damageTypes)) if (norm(raw).includes(stem)){ dmgType = t; break; } }
    if (!dmgType) dmgType = dw?.type || "";
    const id = "w" + (++wi);
    const feat = {
      id, kind: "action", scene: "combat", name: wName, source: "оружие",
      plain: "Атака оружием. Сначала бросок на попадание: назови число мастеру. Если попадание, бросай урон.",
      attack: { toHit, damage: fmt(token ? dmgFile : (flat || dmgBonus ? dmgFile : dmgCalc)), damageType: dmgType, melee: !dw?.ranged },
      why: `Попадание: ${ABIL_RU[ability]} ${sg(am)}${prof ? `, мастерство ${sg(pb)}` : ""}${atkBonus || magic ? `, магия ${sg(atkBonus || magic)}` : ""}.`
    };
    if (alt) feat.attack.alt = `${showDice(alt[1])} двумя руками`;
    else if (dw?.versatile) feat.attack.alt = `${showDice(dw.versatile)} двумя руками`;
    if (dw?.thrown) feat.attack.range = `метнуть: ${dw.thrown} футов`;
    if (dw?.ranged) feat.attack.range = `${dw.ranged} футов`;
    weaponFeatures.push(feat);

    // сверка попадания с тем, что вписал мастер
    const hitFile = num(w.modBonus?.value) || num(w.mod?.value) || 0;
    if (hitFile && hitFile !== toHit){
      add("warn", `${wName}: попадание в файле ${sg(hitFile)}, по расчёту ${sg(toHit)} (${ABIL_RU[ability]} ${sg(am)}, мастерство ${sg(prof ? pb : 0)}${atkBonus || magic ? `, магия ${sg(atkBonus || magic)}` : ""}).`, [
        { label: `Взять расчёт ${sg(toHit)}`, apply: c => { c.features.find(x => x.id === id).attack.toHit = toHit; } },
        { label: `Оставить ${sg(hitFile)}`, apply: c => { c.features.find(x => x.id === id).attack.toHit = hitFile; } }
      ]);
    }
    // сверка урона: мастер мог забыть модификатор или вписать не тот
    if (!token && !flat && !dmgBonus && dmgCalc){
      add("warn", `${wName}: урон записан как «${raw}», без модификатора. По расчёту ${showDice(fmt(dmgCalc))}. Поставил расчёт.`, [
        { label: `Оставить ${showDice(fmt(dmgCalc))}`, apply: c => { c.features.find(x => x.id === id).attack.damage = fmt(dmgCalc); } },
        { label: `Как в файле: ${showDice(diceStr)}`, apply: c => { c.features.find(x => x.id === id).attack.damage = diceStr; } }
      ]);
      feat.attack.damage = fmt(dmgCalc);
    } else if (!token && flat && flat !== dmgCalc && !atkBonus){
      add("warn", `${wName}: к урону прибавлено ${sg(flat)}, а по ${ABIL_DAT[ability]} выходит ${sg(dmgCalc)}.`, [
        { label: `Оставить ${showDice(fmt(flat))}`, apply: c => { c.features.find(x => x.id === id).attack.damage = fmt(flat); } },
        { label: `Взять расчёт ${showDice(fmt(dmgCalc))}`, apply: c => { c.features.find(x => x.id === id).attack.damage = fmt(dmgCalc); } }
      ]);
    }
    if (!dice && !dw) add("warn", `${wName}: не нашёл кубик урона ни в записи, ни в словаре. Поставил к4, поправь.`);
  }
  if (weaponFeatures.length) add("ok", `Оружие: ${weaponFeatures.length} шт., попадание и урон пересчитаны по характеристикам.`);

  /* --- блоки текста → способности --- */
  const seen = new Set(weaponFeatures.map(f => norm(f.name).replace(/[^а-яa-z0-9 ]/g, "")));
  let fi = 0;
  const features = [...weaponFeatures];
  for (const b of blocks){
    const key = norm(b.title).replace(/[^а-яa-z0-9 ]/g, "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const full = b.title + ". " + b.desc;
    const c = classify(full);
    if (b.field === "attacks" && c.guess){ c.kind = "action"; c.guess = false; }
    const uses = parseUses(b.desc, ctx);
    const heal = b.desc.match(HEAL_RE);
    const header = norm(b.header || "");
    const source = /рас/.test(header) ? "раса" : /класс|канал|стиль|домен/.test(header) ? "класс" : /черт/.test(header) ? "черта" : /предыстори/.test(header) ? "предыстория" : SOURCE_BY_FIELD[b.field] || "";
    const social = c.kind === "passive" && (SOCIAL_RE.test(norm(full)) || /предыстори/.test(header) || !COMBAT_RE.test(norm(b.desc)));
    const f = {
      id: "f" + (++fi), kind: c.kind, scene: social ? "social" : "combat", name: b.title, source,
      plain: b.desc.replace(/\n+/g, " ").trim(),
      guess: c.guess
    };
    if (uses){ f.uses = { max: uses.max, recharge: uses.recharge }; if (!uses.sure) f.usesGuess = true; }
    if (heal) f.heal = heal[1].replace(/\s+/g, "").replace(/к/g, "d");
    if (/^темное зрение/.test(norm(b.title))) f.scene = "social";
    features.push(f);
  }

  // Тёмное зрение по виду, если мастер не вписал его текстом
  const dvFile = num(v.darkvision?.value) || 0;
  const dv = dvFile || race?.darkvision || 0;
  if (dv && !features.some(f => /темное зрение/.test(norm(f.name)))){
    features.push({ id: "dv", kind: "passive", scene: "social", name: "Тёмное зрение", source: "вид", plain: `В темноте видишь на ${dv / 5} клеток, как в сумерках. Цвета не различаешь, всё в оттенках серого.` });
    add("info", `Добавил «Тёмное зрение» (${dv} футов): оно положено виду «${raceName}», а в листе его не было.`);
  }

  // Атака по возможности — у всех, кто бьёт в ближнем бою
  const melee = weaponFeatures.find(f => f.attack.melee);
  if (melee) features.push({ id: "opportunity", kind: "reaction", scene: "combat", name: "Атака по возможности", source: "любой герой", plain: "Враг выходит из соседней клетки — успеваешь ударить его вслед.", attackRef: melee.id });

  // Движение
  features.push({ id: "movement", kind: "movement", scene: "combat", name: "Скорость", source: "вид", plain: "Движение можно делить: шаг, удар, ещё пара шагов. Действие «Рывок» удваивает его на один ход." });

  // Заклинатель: ячейки переносим в лист, а сами заклинания мастер отмечает на экране проверки
  // (в файле LSS лежат только номера заклинаний из их справочника, без названий)
  const slotLevels = Object.entries(d.spells || {}).map(([k, s]) => [k.match(/^slots-(\d)$/)?.[1], num(s?.value)]).filter(([lv, n]) => lv && n > 0);
  const pact = Object.entries(d.spellsPact || {}).map(([k, s]) => num(s?.value)).filter(Boolean);
  if (pact.length) add("info", "Ячейки договора колдуна в файле есть, но пока не переносятся: проверь их на вкладке «Магия».");
  const prepared = (file.spells?.prepared || []).length;
  const CAST_AB = { bard: "cha", sorcerer: "cha", warlock: "cha", paladin: "cha", cleric: "wis", druid: "wis", ranger: "wis", wizard: "int", artificer: "int" };
  const baseAb = ["str", "dex", "con", "int", "wis", "cha"].includes(d.spellsInfo?.base?.value) ? d.spellsInfo.base.value : null;
  const castAb = baseAb || (cls && CAST_AB[cls.id]) || null;
  if (castAb && (prepared || slotLevels.length || cls?.caster)){
    const m = mod(stats[castAb]);
    ch.spellcasting = { ability: castAb, attack: pb + m, dc: 8 + pb + m, slots: Object.fromEntries(slotLevels), recharge: cls?.caster === "pact" ? "short" : "long", prepared: ["cleric", "druid", "wizard", "paladin"].includes(cls?.id), source: "класс" };
    ch.spells = [];
    add("warn", `Заклинатель: ${prepared ? `в LSS выбрано ${prepared} заклинаний, но в файле лежат только их номера, без названий. ` : ""}Ячейки перенёс. Отметь заклинания ниже, в разделе «Заклинания»: карточки и числа соберутся сами.`);
  } else if (prepared || slotLevels.length){
    add("info", `В файле есть заклинания (${prepared}), но не понятно, через какую характеристику герой колдует. Заклинания не перенесены.`);
  }

  ch.features = features;

  /* --- проверка способностей --- */
  const noDesc = features.filter(f => !f.plain && !f.attack && f.kind !== "movement");
  if (noDesc.length) add("warn", `Без описания: ${noDesc.map(f => `«${f.name}»`).join(", ")}. Игрок не поймёт, что это делает. Допиши описание или убери лишнее.`);
  const guessed = features.filter(f => f.guess);
  if (guessed.length) add("info", `${guessed.length} способностей без явного «действием / бонусным / реакцией» в тексте: отнёс их к «Работает само». Проверь в раскладке ниже.`);
  const usesGuess = features.filter(f => f.usesGuess);
  if (usesGuess.length) add("warn", `Не уверен, сколько раз можно использовать: ${usesGuess.map(f => `«${f.name}»`).join(", ")}. Поставил 1, проверь.`);
  const sure = features.filter(f => !f.guess && !f.attack && f.kind !== "movement");
  if (sure.length) add("ok", `Тип действия понятен из текста у ${sure.length} способностей.`);

  /* --- снаряжение: монеты и итог --- */
  const coins = d.coins || {};
  const coinStr = [["pp", "пм"], ["gp", "зм"], ["ep", "эм"], ["sp", "см"], ["cp", "мм"]].map(([k, l]) => num(coins[k]?.value) ? `${num(coins[k].value)} ${l}` : "").filter(Boolean).join(", ");
  if (coinStr) items.push({ name: "Кошель", note: coinStr });
  for (const a of d.attunementsList || []) if (a.value) addItem(a.value, "настроен");
  ch.equipment = items;

  // КД по доспеху из снаряжения: ловим «КД 10 при кольчуге и щите»
  const body = items.map(i => findByStem(dict.armor, i.name)).filter(a => a && a.kind !== "shield").sort((a, b) => b.base - a.base)[0];
  const hasShield = items.some(i => findByStem(dict.armor, i.name)?.kind === "shield");
  if (body){
    const dexM = mod(stats.dex);
    const calc = body.base + (body.kind === "light" ? dexM : body.kind === "medium" ? Math.min(2, dexM) : 0) + (hasShield ? 2 : 0);
    if (calc > ch.ac.value){
      add("warn", `КД ${ch.ac.value}, а в снаряжении ${body.name}${hasShield ? " и щит" : ""}: по доспеху выходит ${calc}. Похоже, КД не заполнен.`, [
        { label: `Взять ${calc}`, apply: c => { c.ac.value = calc; c.ac.why = `${body.name} ${body.base}${hasShield ? " и щит 2" : ""}`; } },
        { label: `Оставить ${ch.ac.value}`, apply: () => {} }
      ]);
    } else add("ok", `КД ${ch.ac.value} не ниже, чем даёт ${body.name}${hasShield ? " со щитом" : ""}.`);
  }
  if (items.length) add("ok", `Снаряжение: ${items.length} позиций, записи через запятую и столбиком разобраны.`);
  else add("info", "Снаряжение в файле не заполнено.");

  // Портрет: первая фраза из черт характера
  const persona = toParas(text.personality).map(paraText).join(" ");
  if (persona) ch.pitch = firstSentence(persona);
  if (bgName) ch.background.note = "";

  return { character: ch, findings };
}

function splitList(s){
  return String(s || "").split(/\s*(?:,|;|\sи\s)\s*/).map(x => x.replace(/[.\s]+$/, "").trim()).filter(x => x && x.length < 40);
}
function firstSentence(s){
  const t = String(s || "").replace(/\s+/g, " ").trim();
  const m = t.match(/^(.{10,160}?[.!?])(\s|$)/);
  return m ? m[1] : t.length > 160 ? t.slice(0, 157) + "…" : t;
}
