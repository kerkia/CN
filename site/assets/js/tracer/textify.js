// Text descriptions of controls (« Définitions en texte »), as Purple Pen's Textifier builds them (BSD licence,
// assets/tracer/LICENSE-PurplePen.txt): the main feature (column D) with its modifier (E), a crossing or junction (F)
// or « between » (G), its size (F), which of several (C), the flag's place (G) and other information (H), with the
// language's grammar (gender, plural, case) from the symbols' texts.

import { symbol, symbolText, symbolGender, modifiedCase } from "./symbols.js";

export function textifier(ev, lang = ev.lang || "fr") {
  const std = ev.descStandard || "2018";
  const custom = (s) => ev.customText?.[s?.id] || null;
  const T = (s, gender = "", nounCase = "") => symbolText(s, lang, { gender, nounCase, custom: custom(s) }) ?? "";
  const TP = (s, gender = "", nounCase = "") => symbolText(s, lang, { plural: true, gender, nounCase, custom: custom(s) }) ?? "";
  const G = (s) => symbolGender(s, lang, custom(s));
  const MC = (s) => modifiedCase(s, lang, custom(s));
  const sym = (id) => symbol(id, std);
  const fmt = (pattern, ...args) => String(pattern ?? "").replace(/\{(\d)\}/g, (m, k) => args[k] ?? "");
  const cap = (s) => (s ? s[0].toLocaleUpperCase(lang) + s.slice(1) : s);
  const symbolsOf = (c) => c.symbols.map((id) => (id && sym(id)) || null);
  const isDual = (S) => S[1] && S[2] && S[2].k === "D" && S[2].id !== S[1].id;
  const single = (s) => (["10.1", "10.2", "11.15"].includes(s.id) ? sym(`${s.id}single`) : s);

  function combine(combo, main, mainPlural, second) {
    if (second == null && mainPlural != null) {
      const s1 = single(combo);
      return { text: fmt(T(s1), main, mainPlural), plural: fmt(TP(s1), main, mainPlural), gender: G(s1) };
    }
    const other = second ?? main;
    return { text: fmt(T(combo), main, other), plural: fmt(TP(combo), main, other), gender: G(combo) };
  }
  function applyCase(s, cur) { const m = MC(s); return m || cur; }
  function nounCase(c, S) {
    let nc = "";
    if (S[5]) nc = applyCase(S[5], nc);
    if (S[4] && S[4].id !== "11.15") nc = applyCase(S[4], nc);
    if (S[0]) nc = applyCase(S[0], nc);
    if (c.colF) { const ctl = sizeText(c.colF, S).controller; if (ctl) nc = applyCase(ctl, nc); }
    if (S[4]?.id === "11.15") nc = applyCase(isDual(S) ? S[4] : single(S[4]), nc);
    if (S[3] && (S[3].id === "10.1" || S[3].id === "10.2")) nc = applyCase(isDual(S) ? S[3] : single(S[3]), nc);
    if (S[2]?.k === "E") nc = applyCase(S[2], nc);
    return nc;
  }
  function mainFeature(c, S) {
    if (!S[1]) return { text: "", gender: "" };
    const nc = nounCase(c, S);
    let main = T(S[1], "", nc), gender = G(S[1]), plural = TP(S[1], "", nc), second = null, combo = false;
    if (S[2]) {
      if (S[2].k === "D") { second = T(S[2], "", nc); if (second === main) second = null; }
      else if (S[2].k === "E") {
        main = fmt(T(S[2], gender), main);
        if (plural != null) plural = fmt(TP(S[2], gender), plural);
      }
    }
    if (S[3]) { const r = combine(S[3], main, plural, second); main = r.text; plural = r.plural; gender = r.gender; second = null; combo = true; }
    if (S[4]?.id === "11.15") { const r = combine(S[4], main, plural, second); main = r.text; plural = r.plural; gender = r.gender; combo = true; }
    if (!combo && second != null) { const r = combine(sym("basic_combo"), main, plural, second); main = r.text; gender = r.gender; }
    return { text: main, gender };
  }
  /** Column F's size as words: « 2m », « 2m de haut », « 2m par 4m »… (Textifier.GetTextFromSize). */
  function sizeText(size, S) {
    const firstDeep = !!S[1]?.depth, genderFirst = S[1] ? G(S[1]) : "";
    let secondDeep = firstDeep, genderSecond = "";
    if (S[2]?.k === "D") { secondDeep = !!S[2].depth; genderSecond = G(S[2]); }
    return fromSize(size, true, firstDeep, genderFirst, secondDeep, genderSecond);
  }
  function fromSize(size, deepOrHigh, firstDeep, gFirst, secondDeep, gSecond) {
    let combiner = null, controller = null, idx = size.indexOf("|");
    if (idx >= 0) combiner = sym("9.4");
    else if ((idx = size.indexOf("/")) >= 0) { combiner = sym(firstDeep ? "9.3deep" : "9.3high"); controller = combiner; deepOrHigh = false; }
    else if ((idx = size.indexOf("x")) >= 0) { combiner = sym("9.2"); controller = combiner; deepOrHigh = false; }
    if (combiner) {
      const a = fromSize(size.slice(0, idx), deepOrHigh, firstDeep, gFirst, firstDeep, gFirst);
      const b = fromSize(size.slice(idx + 1), deepOrHigh, secondDeep, gSecond, secondDeep, gSecond);
      if (!a.text || !b.text) return { text: size, controller: null };
      return { text: fmt(T(combiner, gFirst), a.text, b.text), controller: controller || a.controller };
    }
    let s = size.trim();
    if (s.endsWith("m")) s = s.slice(0, -1);
    const v = Number(s.replace(",", ".").trim());
    if (s.trim() === "" || !Number.isFinite(v)) return { text: size, controller: null };
    const t = `${String(v).replace(".", lang === "fr" ? "," : ".")}m`;
    if (deepOrHigh) { const hs = sym(firstDeep ? "9.1deep" : "9.1high"); return { text: fmt(T(hs, gFirst), t), controller: hs }; }
    return { text: t, controller: null };
  }
  function normal(c) {
    const S = symbolsOf(c);
    const m = mainFeature(c, S);
    let text = m.text;
    if (c.colF) text = `${text}, ${sizeText(c.colF, S).text}`;
    if (S[0]) text = fmt(T(S[0], m.gender), text);
    if (S[4] && S[4].id !== "11.15") text = fmt(T(S[4], m.gender), text);
    if (S[5]) text = `${text} (${T(S[5])})`;
    return text;
  }
  /** A directive's text (finish, marked route, crossing point…), the distance already with « m ». */
  function directive(id, distance = "") {
    const s = sym(id);
    if (!s) return "";
    return cap(fmt(symbolText(s, lang), distance ? `${distance} ` : ""));
  }
  /** A control's text description (its custom text if it has one). */
  function control(controlId, distance = "") {
    const c = ev.controls[controlId];
    if (!c) return "";
    if (c.descText) return c.descText;
    let text;
    if (c.kind === "normal") text = normal(c);
    else if (c.kind === "start" || c.kind === "map-exchange") text = `${T(sym("start"))}: ${normal(c)}`;
    else text = directive(c.symbols[0], distance);
    return cap(text);
  }
  return { control, directive, sizeText: (size, c) => sizeText(size, symbolsOf(c)).text };
}
