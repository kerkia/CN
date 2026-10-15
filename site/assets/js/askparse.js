// « IA »: the model's answer read from its text - the first JSON object, tolerant of the models' slips. Shared by the
// server (functions/_lib/ask.js, Workers AI) and the browser (pages/ask.js, a model reached with the user's own key).

/** The usual slips of a model writing JSON: raw line breaks and tabs inside strings, ' escapes, trailing commas. */
function lenient(x) {
  let out = "", inStr = false, esc = false;
  for (const c of x) {
    if (inStr) {
      if (esc) { out += c === "'" ? "'" : "\\" + c; esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') inStr = false;
      out += c === "\n" ? "\\n" : c === "\r" ? "" : c === "\t" ? "\\t" : c;
      continue;
    }
    if (c === '"') inStr = true;
    out += c;
  }
  return out.replace(/,\s*([}\]])/g, "$1");
}

/** The model's answer: the first JSON object in its text (some models think aloud first, or fence the JSON). */
export function parseAnswer(text) {
  const t = String(text || "").replace(/<think>[\s\S]*?<\/think>/g, "");
  for (let i = t.indexOf("{"); i >= 0; i = t.indexOf("{", i + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < t.length; j++) {
      const c = t[j];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        for (const fix of [(x) => x, lenient]) {
          try { const o = JSON.parse(fix(t.slice(i, j + 1))); if (o && typeof o === "object" && ("sql" in o || "explanation" in o)) return o; } catch (e) { /* next */ }
        }
        break;
      }
    }
  }
  // last resort: the fields one by one (a slip elsewhere in the object must not lose a good query)
  const field = (k) => {
    const m = new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(t);
    if (!m) return undefined;
    try { return JSON.parse(`"${m[1]}"`); } catch (e) { return undefined; }
  };
  const sql = field("sql");
  if (!sql) return null;
  return { sql, display: field("display") || "table", title: field("title") || "", explanation: field("explanation") || "" };
}
