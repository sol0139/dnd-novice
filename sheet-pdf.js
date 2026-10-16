/* ============================================================
   Красивый PDF листа персонажа: кнопка «Скачать PDF» в листе.
   Собирается прямо в браузере (jsPDF), шрифты сайта — Onest и Unbounded
   (лицензия SIL OFL, лежат в /vendor/fonts). Текст в файле настоящий,
   его можно выделять и искать. На бумаге есть клеточки для хитов,
   спасбросков от смерти, зарядов и ячеек — играть можно и без телефона.
   Лист отдаёт сюда готовую модель: все числа уже посчитаны.
   ============================================================ */
(function(){
"use strict";

const FONT_FILES = {
  "Onest-Regular": "/vendor/fonts/Onest-Regular.ttf",
  "Onest-SemiBold": "/vendor/fonts/Onest-SemiBold.ttf",
  "Unbounded-SemiBold": "/vendor/fonts/Unbounded-SemiBold.ttf"
};
let fontCache = null;
async function loadFonts(){
  if (fontCache) return fontCache;
  const list = await Promise.all(Object.entries(FONT_FILES).map(async ([name, url]) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`шрифт ${url}: ${r.status}`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return [name, btoa(bin)];
  }));
  return (fontCache = Object.fromEntries(list));
}
async function loadImage(url){
  try {
    const blob = await (await fetch(url)).blob();
    return await new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = () => ok(null); fr.readAsDataURL(blob); });
  } catch (e) { return null; }
}

/* ---------- цвета сайта ---------- */
const C = {
  ink: "#0D0D10", ink2: "#34353B", muted: "#74767F", faint: "#A3A5AD", line: "#E3E4E8",
  panel: "#F4F5F2", panel2: "#ECEEE9", white: "#FFFFFF",
  accent: "#2EB41B", accentInk: "#1F8A12", accentSoft: "#E5F5E1",
  action: "#3E63DD", bonus: "#C98200", reaction: "#D6409F", passive: "#8B8D98", social: "#0E9F8E", long: "#5E6A7A", danger: "#E5484D"
};
const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const sg = n => (n < 0 ? "−" : "+") + Math.abs(n);
const plural = (n, one, few, many) => { const t = n % 10, h = n % 100; return t === 1 && h !== 11 ? one : t >= 2 && t <= 4 && (h < 12 || h > 14) ? few : many; };
const RECHARGE = { long: "до длинного отдыха", short: "до короткого отдыха", turn: "за ход", day: "в день" };

async function download(M){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  const fonts = await loadFonts();
  for (const [name, b64] of Object.entries(fonts)){ doc.addFileToVFS(`${name}.ttf`, b64); doc.addFont(`${name}.ttf`, name, "normal"); }
  const logo = await loadImage("/icons/icon-192.png");

  const PW = doc.internal.pageSize.getWidth(), PH = doc.internal.pageSize.getHeight();
  const MX = 34, TOP = 34, BOTTOM = PH - 44, CW = PW - 2 * MX;
  const R = "Onest-Regular", B = "Onest-SemiBold", HEAD = "Unbounded-SemiBold";

  /* ---------- маленькие кисти ---------- */
  const fill = c => doc.setFillColor(...rgb(c));
  const stroke = c => doc.setDrawColor(...rgb(c));
  const ink = c => doc.setTextColor(...rgb(c));
  const font = (f, size) => { doc.setFont(f, "normal"); doc.setFontSize(size); };
  const put = (s, x, y, o = {}) => doc.text(String(s), x, y, { baseline: "top", ...o });
  const wrap = (s, w) => doc.splitTextToSize(String(s || ""), w);
  const width = s => doc.getTextWidth(String(s));
  const box = (x, y, w, h, r, color) => { fill(color); doc.roundedRect(x, y, w, h, r, r, "F"); };
  const frame = (x, y, w, h, r, color, lw = 0.8) => { stroke(color); doc.setLineWidth(lw); doc.roundedRect(x, y, w, h, r, r, "S"); };
  const dot = (x, y, r, color) => { fill(color); doc.circle(x, y, r, "F"); };
  const ring = (x, y, r, color, lw = 0.8) => { stroke(color); doc.setLineWidth(lw); doc.circle(x, y, r, "S"); };
  const square = (x, y, s, color = C.faint) => { stroke(color); doc.setLineWidth(0.8); doc.roundedRect(x, y, s, s, 1.6, 1.6, "S"); };
  const spaced = (s, x, y, cs = 0.6) => { doc.setCharSpace(cs); put(s, x, y); doc.setCharSpace(0); };
  // Подпись раздела: зелёная черта и заглавные буквы
  const label = (s, x, y, color = C.muted) => { font(B, 7.4); ink(color); spaced(s.toUpperCase(), x, y, 0.7); };
  const sectionTitle = (s, x, y, color = C.accent) => { box(x, y + 1.5, 3, 9, 1.5, color); font(HEAD, 10.5); ink(C.ink); put(s, x + 9, y); };

  // Строки с переносом: возвращает высоту блока
  const para = (s, x, y, w, f, size, color, lhK = 1.36, draw = true) => {
    font(f, size); const lines = wrap(s, w);
    if (draw){ ink(color); lines.forEach((l, i) => put(l, x, y + i * size * lhK)); }
    return lines.length * size * lhK;
  };

  let y = TOP;
  const newPage = () => { doc.addPage(); y = TOP; };

  /* ============================================================
     Страница 1: шапка
     ============================================================ */
  const qrSize = M.link && window.qrcode ? 74 : 0;
  if (logo) doc.addImage(logo, "PNG", MX, y, 20, 20);
  font(B, 8.6); ink(C.ink); put("DnD Kids", MX + 26, y + 2);
  font(R, 7.2); ink(C.muted); put("лист героя для тех, кто играет впервые", MX + 26, y + 12);
  if (M.adult){
    font(B, 8.6); const bx = MX + 26 + width("DnD Kids") + 6;
    font(B, 6.6); const bw = width("18+") + 8; box(bx, y + 1.4, bw, 10, 3, "#FDE7E8"); ink(C.danger); put("18+", bx + 4, y + 3.2);
  }

  if (qrSize){
    const qr = window.qrcode(0, "M"); qr.addData(M.link); qr.make();
    const n = qr.getModuleCount(), qx = PW - MX - qrSize, qy = TOP, cell = (qrSize - 8) / n;
    box(qx, qy, qrSize, qrSize, 8, C.white); frame(qx, qy, qrSize, qrSize, 8, C.line);
    fill(C.ink);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) doc.rect(qx + 4 + c * cell, qy + 4 + r * cell, cell + 0.15, cell + 0.15, "F");
    font(B, 6.8); ink(C.ink2); put("Живой лист", qx + qrSize / 2, qy + qrSize + 5, { align: "center" });
    font(R, 6.2); ink(C.muted); put("хиты и заряды считает сам", qx + qrSize / 2, qy + qrSize + 13, { align: "center" });
  }

  y += 32;
  const headW = CW - (qrSize ? qrSize + 18 : 0);
  font(HEAD, 25); ink(C.ink);
  const nameLines = wrap(M.name, headW).slice(0, 2);
  nameLines.forEach(l => { put(l, MX, y); y += 30; });
  font(B, 10.4); ink(C.ink2);
  put(M.raceLine + (M.subclass ? ` · ${M.subclass}` : ""), MX, y, { maxWidth: headW }); y += 15;
  if (M.pitch){ y += para(`«${M.pitch}»`, MX, y, headW, R, 9.8, C.ink2, 1.38) + 2; }
  if (M.background){ font(R, 8.4); ink(C.muted); put(M.background, MX, y, { maxWidth: headW }); y += 12; }
  y = Math.max(y, TOP + qrSize + 24) + 10;

  /* ---------- плитки главных чисел ---------- */
  const S = M.stats;
  const tiles = [
    { l: "Класс доспеха", v: String(S.ac), h: M.hints.ac },
    { l: "Хиты", v: String(S.hp), h: "максимум; сколько сейчас — в трекере ниже", hl: true },
    { l: "Инициатива", v: sg(S.init), h: M.hints.init },
    { l: "Скорость", v: `${S.squares} кл.`, h: `${S.feet} футов за ход` },
    { l: "Мастерство", v: sg(S.pb), h: "к знакомым атакам, навыкам и спасброскам" },
    { l: "Внимательность", v: String(S.pp), h: "пассивное Восприятие: мастер сверяет со спрятанным" }
  ];
  const tg = 7, tw = (CW - tg * (tiles.length - 1)) / tiles.length, th = 70;
  tiles.forEach((t, i) => {
    const x = MX + i * (tw + tg);
    box(x, y, tw, th, 9, t.hl ? C.accentSoft : C.panel);
    font(B, 6.4); ink(t.hl ? C.accentInk : C.muted); doc.setCharSpace(0.4); put(t.l.toUpperCase(), x + 8, y + 8, { maxWidth: tw - 12 }); doc.setCharSpace(0);
    font(HEAD, t.v.length > 5 ? 15 : 19); ink(t.hl ? C.accentInk : C.ink); put(t.v, x + 8, y + 20);
    para(t.h, x + 8, y + 45, tw - 14, R, 6.3, C.muted, 1.3);
  });
  y += th + 18;

  /* ============================================================
     Две колонки: характеристики и навыки | бой
     ============================================================ */
  const LW = 226, GAP = 16, RX = MX + LW + GAP, RW = CW - LW - GAP;
  let ly = y, ry = y;

  // --- характеристики
  sectionTitle("Характеристики", MX, ly); ly += 20;
  const aw = (LW - 2 * 6) / 3, ah = 60;
  M.abilities.forEach((a, i) => {
    const x = MX + (i % 3) * (aw + 6), yy = ly + Math.floor(i / 3) * (ah + 6);
    box(x, yy, aw, ah, 9, C.panel);
    font(B, 7); ink(C.muted); doc.setCharSpace(0.6); put(a.abbr, x + 8, yy + 8); doc.setCharSpace(0);
    font(R, 7.4); ink(C.faint); put(String(a.score), x + aw - 8, yy + 8, { align: "right" });
    font(HEAD, 18); ink(C.ink); put(sg(a.mod), x + 8, yy + 19);
    // спасбросок: точка — есть мастерство
    if (a.prof) dot(x + 11, yy + 49.5, 2.6, C.accent); else ring(x + 11, yy + 49.5, 2.4, C.faint);
    font(R, 7.2); ink(C.ink2); put(`спас ${sg(a.save)}`, x + 17, yy + 46);
  });
  ly += 2 * ah + 6 + 16;

  // --- навыки
  sectionTitle("Навыки", MX, ly); ly += 19;
  const rowH = 13.4;
  M.skills.forEach((s, i) => {
    const yy = ly + i * rowH;
    if (i % 2 === 0) box(MX - 2, yy - 2.5, LW + 4, rowH, 3, "#F8F9F7");
    const cx = MX + 6, cy = yy + 4.2;
    if (s.expert){ dot(cx, cy, 2.6, C.accent); ring(cx, cy, 4.3, C.accent, 0.9); }
    else if (s.prof) dot(cx, cy, 2.8, C.accent);
    else ring(cx, cy, 2.6, C.faint);
    font(s.prof || s.expert ? B : R, 8.4); ink(s.prof || s.expert ? C.ink : C.ink2); put(s.name, MX + 15, yy);
    const nw = width(s.name);
    font(R, 6.6); ink(C.faint); put(s.abbr, MX + 19 + nw, yy + 1.6);
    font(B, 8.6); ink(s.prof || s.expert ? C.ink : C.ink2); put(sg(s.bonus), MX + LW - 4, yy, { align: "right" });
  });
  ly += M.skills.length * rowH + 6;
  font(R, 6.6); ink(C.muted);
  dot(MX + 6, ly + 3.4, 2.4, C.accent); put("владеешь", MX + 12, ly);
  dot(MX + 64, ly + 3.4, 2.2, C.accent); ring(MX + 64, ly + 3.4, 3.8, C.accent, 0.8); put("эксперт: мастерство вдвойне", MX + 71, ly);
  ly += 14;

  // --- бой: трекер хитов
  sectionTitle("В бою", RX, ry); ry += 20;
  const hpH = 102;
  box(RX, ry, RW, hpH, 10, C.panel);
  label("Хиты сейчас", RX + 12, ry + 10);
  box(RX + 12, ry + 22, 84, 34, 7, C.white); frame(RX + 12, ry + 22, 84, 34, 7, C.line);
  font(HEAD, 13); ink(C.faint); put(`/ ${S.hp}`, RX + 104, ry + 31);
  label("Временные", RX + 160, ry + 10);
  box(RX + 160, ry + 22, 52, 34, 7, C.white); frame(RX + 160, ry + 22, 52, 34, 7, C.line);
  // кости хитов
  label("Кости хитов", RX + 12, ry + 66);
  font(B, 8.4); ink(C.ink2); put(`${S.hitDie} × ${S.hitDiceCount}`, RX + 12, ry + 78);
  for (let i = 0; i < Math.min(S.hitDiceCount, 10); i++) square(RX + 72 + i * 11, ry + 78, 8);
  // спасброски от смерти
  const dsx = RX + RW - 104;
  label("От смерти", dsx, ry + 66);
  font(R, 7); ink(C.muted); put("успех", dsx, ry + 78); put("провал", dsx, ry + 89);
  for (let i = 0; i < 3; i++){ ring(dsx + 44 + i * 12, ry + 81.5, 3.8, C.accentInk, 0.9); ring(dsx + 44 + i * 12, ry + 92.5, 3.8, C.danger, 0.9); }
  ry += hpH + 12;

  // --- атаки
  if (M.attacks.length){
    label("Атаки", RX, ry); ry += 12;
    const cH = RX + RW * 0.56, cD = RX + RW * 0.70;
    font(R, 6.6); ink(C.faint); put("попадание", cH, ry, { align: "center" }); put("урон", cD, ry);
    ry += 10;
    M.attacks.forEach(a => {
      const sub = [a.alt, a.range].filter(Boolean).join(" · ");
      font(B, 8.6); const nameL = wrap(a.name, RW * 0.5 - 14);
      font(R, 6.6); const subL = sub ? wrap(sub, RW * 0.5 - 14) : [];
      const h = Math.max(24, 8 + nameL.length * 11 + subL.length * 8.6 + 6);
      box(RX, ry, RW, h - 3, 7, C.panel);
      font(B, 8.6); ink(C.ink); nameL.forEach((l, i) => put(l, RX + 10, ry + 6 + i * 11));
      font(R, 6.6); ink(C.muted); subL.forEach((l, i) => put(l, RX + 10, ry + 7 + nameL.length * 11 + i * 8.6));
      font(HEAD, 10.5); ink(C.ink); put(sg(a.toHit), cH, ry + 6.5, { align: "center" });
      font(B, 9); ink(C.ink); put(a.damage, cD, ry + 6.5);
      font(R, 6.6); ink(C.muted); put(a.type, cD, ry + 17.5, { maxWidth: RX + RW - cD - 6 });
      ry += h;
    });
    ry += 6;
  }

  // --- магия
  if (M.spellcasting){
    const sc = M.spellcasting;
    const sh = 40 + (sc.slots.length ? 16 + sc.slots.length * 14 : 0);
    box(RX, ry, RW, sh, 10, C.panel);
    label("Магия", RX + 12, ry + 10);
    font(R, 7.2); ink(C.muted); put(`через ${sc.ability}`, RX + 46, ry + 9.6);
    font(R, 7.4); ink(C.muted); put("атака", RX + 12, ry + 24); put("сложность", RX + 92, ry + 24);
    font(HEAD, 12); ink(C.ink); put(sg(sc.attack), RX + 40, ry + 21); put(String(sc.dc), RX + 140, ry + 21);
    if (sc.slots.length){
      label(`Ячейки · вернутся после ${sc.recharge === "short" ? "короткого" : "длинного"} отдыха`, RX + 12, ry + 44);
      sc.slots.forEach(([lvl, n], i) => {
        const yy = ry + 58 + i * 14;
        font(B, 7.8); ink(C.ink2); put(`${lvl} круг`, RX + 12, yy);
        for (let k = 0; k < n; k++) ring(RX + 58 + k * 13, yy + 4, 4.2, C.accentInk, 0.9);
      });
    }
    ry += sh + 12;
  }

  // --- языки и инструменты
  if (M.languages || M.tools){
    label("Языки", RX, ry); ry += 11;
    ry += para(M.languages || "—", RX, ry, RW, R, 8.2, C.ink2) + 4;
    if (M.tools){ label("Инструменты", RX, ry); ry += 11; ry += para(M.tools, RX, ry, RW, R, 8.2, C.ink2) + 4; }
  }
  y = Math.max(ly, ry) + 8;

  // Заметки от руки: линейки на свободном месте первой страницы, иначе — в самом конце
  let notesDone = false;
  const notesBlock = (yy, maxLines) => {
    dot(MX + 4, yy + 6.5, 4, C.faint);
    font(HEAD, 11.5); ink(C.ink); put("Заметки", MX + 14, yy);
    const tw0 = width("Заметки");
    font(R, 7.6); ink(C.muted); put("имена, подсказки мастера, найденные вещи, долги", MX + 14 + tw0 + 10, yy + 3.4);
    yy += 20;
    if (M.notes){ const h = para(M.notes, MX, yy, CW, R, 8.4, C.ink2, 1.6); yy += h + 4; }
    stroke(C.line); doc.setLineWidth(0.7);
    for (let i = 0; i < maxLines && yy + 18 <= BOTTOM; i++){ yy += 18; doc.line(MX, yy, MX + CW, yy); }
    return yy;
  };
  if (BOTTOM - y >= 96){ notesBlock(y + 4, 30); notesDone = true; y = BOTTOM; }

  /* ============================================================
     Карточки в две колонки: способности и заклинания
     ============================================================ */
  const COLW = (CW - 12) / 2;
  let col = [y, y];
  const section = (title, note, color, firstH = 60) => {
    let yy = Math.max(col[0], col[1]);
    // заголовок без единой карточки под ним не оставляем: места должно хватить на шапку и первую карточку
    const headH = 6 + 17 + (note ? para(note, 0, 0, CW - 14, R, 7.6, C.muted, 1.3, false) + 2 : 0) + 4;
    if (yy + headH + firstH > BOTTOM){ newPage(); yy = TOP; }
    yy += 6;
    dot(MX + 4, yy + 6.5, 4, color);
    font(HEAD, 11.5); ink(C.ink); put(title, MX + 14, yy);
    yy += 17;
    if (note){ yy += para(note, MX + 14, yy, CW - 14, R, 7.6, C.muted, 1.3) + 2; }
    col = [yy + 4, yy + 4];
  };
  // Карточка: цветная полоска слева, имя, подпись, текст, числа, клеточки зарядов
  const PAD = 10, INNER = COLW - PAD * 2 - 4;
  const layout = c => {
    const pad = PAD, inner = INNER;
    const parts = [];
    font(B, 9.2); const nameL = wrap(c.name, inner - (c.right ? width(c.right) + 8 : 0));
    parts.push({ h: nameL.length * 11.6 });
    let metaL = []; if (c.meta){ font(R, 6.9); metaL = wrap(c.meta, inner); parts.push({ h: metaL.length * 8.8 + 1 }); }
    let textL = []; if (c.text){ font(R, 7.9); textL = wrap(c.text, inner); parts.push({ h: textL.length * 10.4 + 3 }); }
    let numL = []; if (c.nums && c.nums.length){ font(B, 7.8); numL = wrap(c.nums.join("  ·  "), inner); parts.push({ h: numL.length * 10 + 3 }); }
    const marks = c.marks || 0;
    const markRows = marks ? Math.ceil(marks / 14) : 0;
    if (marks) parts.push({ h: markRows * 11 + 3 });
    const h = pad + parts.reduce((s, p) => s + p.h, 0) + pad - 2;
    return { h, nameL, metaL, textL, numL, marks };
  };
  const card = (c, color, L = layout(c)) => {
    const pad = PAD, { h, nameL, metaL, textL, numL, marks } = L;
    // в какую колонку: где выше; не влезает — в другую; нигде — новая страница
    let ci = col[0] <= col[1] ? 0 : 1;
    if (col[ci] + h > BOTTOM){ ci = 1 - ci; if (col[ci] + h > BOTTOM){ newPage(); col = [TOP, TOP]; ci = 0; } }
    const x = MX + ci * (COLW + 12), y0 = col[ci];
    box(x, y0, COLW, h, 9, C.panel);
    box(x, y0 + 6, 3, h - 12, 1.5, color);
    let yy = y0 + pad;
    font(B, 9.2); ink(C.ink); nameL.forEach((l, i) => put(l, x + pad + 4, yy + i * 11.6));
    if (c.right){ font(R, 6.8); ink(C.muted); put(c.right, x + COLW - pad, yy + 1.4, { align: "right" }); }
    yy += nameL.length * 11.6;
    if (metaL.length){ font(R, 6.9); ink(color === C.passive ? C.muted : color); metaL.forEach((l, i) => put(l, x + pad + 4, yy + i * 8.8)); yy += metaL.length * 8.8 + 1; }
    if (textL.length){ yy += 2; font(R, 7.9); ink(C.ink2); textL.forEach((l, i) => put(l, x + pad + 4, yy + i * 10.4)); yy += textL.length * 10.4 + 1; }
    if (numL.length){ yy += 2; font(B, 7.8); ink(C.ink); numL.forEach((l, i) => put(l, x + pad + 4, yy + i * 10)); yy += numL.length * 10 + 1; }
    if (marks){
      yy += 3;
      for (let k = 0; k < marks; k++) square(x + pad + 4 + (k % 14) * 11, yy + Math.floor(k / 14) * 11, 7.6, color === C.passive ? C.faint : color);
      if (c.marksNote){ font(R, 6.6); ink(C.muted); put(c.marksNote, x + pad + 4 + Math.min(marks, 14) * 11 + 4, yy + 0.6); }
    }
    col[ci] = y0 + h + 8;
  };

  const kindColor = k => C[k] || C.passive;
  const featureCard = f => {
    const nums = [];
    if (f.attack) nums.push(`попадание ${sg(f.attack.toHit)}`, `урон ${f.attack.damage}${f.attack.type ? " " + f.attack.type : ""}`);
    if (f.save) nums.push(`спасбросок ${f.save.ab} Сл ${f.save.dc}`);
    if (f.dmg) nums.push(`урон ${f.dmg.dice}${f.dmg.type ? " " + f.dmg.type : ""}`);
    if (f.heal) nums.push(`лечит ${f.heal}`);
    const meta = [f.spend ? `тратит ${f.spend.cost > 1 ? f.spend.cost + " из " : ""}«${f.spend.name}»` : ""].filter(Boolean).join(" · ");
    const marks = f.uses && f.uses.max <= 28 ? f.uses.max : 0;
    return { name: f.name, right: f.source, meta, text: f.text, nums,
      marks, marksNote: f.uses ? `${RECHARGE[f.uses.recharge] || ""}${f.uses.max > 28 ? ` · запас ${f.uses.max}` : ""}`.trim() : "" };
  };

  const groups = [
    ["action", "Действие", M.kinds.action],
    ["bonus", "Бонусное действие", M.kinds.bonus],
    ["reaction", "Реакция", M.kinds.reaction],
    ["passive", "Работает само", M.kinds.passive],
    ["social", "Вне боя", "Умения для разговоров, дороги и привала."]
  ];
  const anyFeature = M.features.length;
  if (anyFeature){
    if (y + 120 > BOTTOM){ newPage(); col = [TOP, TOP]; }
    groups.forEach(([k, title, note]) => {
      const list = M.features.filter(f => f.group === k);
      if (!list.length) return;
      const cards = list.map(featureCard);
      section(title, note, kindColor(k), layout(cards[0]).h);
      cards.forEach(c => card(c, kindColor(k)));
    });
  }

  // --- заклинания по кругам
  if (M.spells.length){
    const CAST = { action: ["действие", C.action], bonus: ["бонусное", C.bonus], reaction: ["реакция", C.reaction], long: ["вне боя", C.long] };
    const levels = [...new Set(M.spells.map(s => s.level))].sort((a, b) => a - b);
    levels.forEach(l => {
      const slots = (M.spellcasting?.slots || []).find(([lv]) => lv === l);
      const cards = M.spells.filter(s => s.level === l).map(sp => {
        const [castName, castColor] = CAST[sp.kind] || CAST.action;
        const meta = [castName, sp.range, sp.dur, sp.conc ? "концентрация" : "", sp.ritual ? "ритуал" : "", sp.always ? "всегда подготовлено" : ""].filter(Boolean).join(" · ");
        const nums = [];
        if (sp.attack) nums.push(`попадание ${sg(sp.attack.toHit)}`, `урон ${sp.attack.damage}${sp.attack.type ? " " + sp.attack.type : ""}`);
        if (sp.save) nums.push(`спасбросок ${sp.save.ab} Сл ${sp.save.dc}`);
        if (sp.dmg) nums.push(`урон ${sp.dmg.dice}${sp.count ? ` × ${sp.count}` : ""}${sp.dmg.type ? " " + sp.dmg.type : ""}${sp.dmg.half ? ", при успехе половина" : ""}`);
        if (sp.heal) nums.push(`лечит ${sp.heal}`);
        return [{ name: sp.name, right: sp.source || "", meta, text: [sp.text, sp.upcast].filter(Boolean).join(" "), nums }, castColor];
      });
      section(l ? `Заклинания ${l} круга` : "Заговоры", l ? (slots ? `Ячеек ${l} круга: ${slots[1]}. Заклинание этого круга можно сотворить и ячейкой выше.` : "Ячеек этого круга пока нет — можно колдовать ячейкой выше.") : "Колдуются сколько угодно раз, ячейки не тратят.", C.accent, layout(cards[0][0]).h);
      cards.forEach(([c, color]) => card(c, color));
    });
  }

  // --- снаряжение и заметки
  if (M.equipment.length){
    section("Снаряжение", "", C.long, 40);
    const inner = COLW - 8;
    M.equipment.forEach(e => {
      font(B, 8.4); const nl = wrap(e.qty ? `${e.name} ×${e.qty}` : e.name, inner);
      font(R, 7.2); const tl = e.note ? wrap(e.note, inner) : [];
      const h = nl.length * 10.6 + tl.length * 9.2 + 9;
      let ci = col[0] <= col[1] ? 0 : 1;
      if (col[ci] + h > BOTTOM){ ci = 1 - ci; if (col[ci] + h > BOTTOM){ newPage(); col = [TOP, TOP]; ci = 0; } }
      const x = MX + ci * (COLW + 12), y0 = col[ci];
      font(B, 8.4); ink(C.ink); nl.forEach((l, i) => put(l, x + 4, y0 + i * 10.6));
      font(R, 7.2); ink(C.muted); tl.forEach((l, i) => put(l, x + 4, y0 + nl.length * 10.6 + i * 9.2));
      stroke(C.line); doc.setLineWidth(0.6); doc.line(x, y0 + h - 4, x + COLW, y0 + h - 4);
      col[ci] = y0 + h + 2;
    });
  }
  if (!notesDone){
    let yy = Math.max(col[0], col[1]) + 10;
    if (yy + 34 + 6 * 18 > BOTTOM){ newPage(); yy = TOP; }
    notesBlock(yy, 12);
  }

  /* ---------- подвал на каждой странице ---------- */
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++){
    doc.setPage(p);
    stroke(C.line); doc.setLineWidth(0.6); doc.line(MX, PH - 30, PW - MX, PH - 30);
    font(B, 7); ink(C.ink2); put(`${M.name} · DnD Kids`, MX, PH - 24, { maxWidth: CW - 60 });
    font(B, 7); ink(C.muted); put(`${p} / ${pages}`, PW - MX, PH - 24, { align: "right" });
    font(R, 6); ink(C.faint); put("Правила D&D 5e (2014). Часть материалов — SRD 5.1 © Wizards of the Coast, CC-BY-4.0.", MX, PH - 14);
  }

  doc.setProperties({ title: `${M.name} — лист героя`, subject: M.raceLine, creator: "DnD Kids", author: "DnD Kids" });
  const file = `${M.name.replace(/[\\/:*?"<>|]+/g, " ").trim() || "Герой"} — DnD Kids.pdf`;
  if (M.returnBlob) return doc.output("blob");
  doc.save(file);
  return file;
}

window.NovicePDF = { download };
})();
