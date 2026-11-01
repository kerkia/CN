// « Nutrition »: an article's HTML cleaned by an allowlist before it is shown or saved (the server strips scripts too, but the
// browser is where it would run). Read in an inert document (DOMParser runs nothing, loads nothing), rebuilt element by
// element: unknown elements keep their text, unknown attributes go, links open apart, images only from the site's own
// /api/nutrition/img/ or https, styles keep their colour, background and alignment.

const TAGS = new Set(["p", "br", "h2", "h3", "h4", "strong", "b", "em", "i", "u", "s", "strike", "del", "sub", "sup", "mark", "small",
  "ul", "ol", "li", "blockquote", "pre", "code", "a", "img", "figure", "figcaption", "table", "thead", "tbody", "tfoot", "tr",
  "th", "td", "caption", "hr", "span", "div"]);
// dropped with everything inside them
const DROP = new Set(["script", "style", "iframe", "object", "embed", "form", "input", "button", "textarea", "select", "template",
  "noscript", "svg", "math", "link", "meta", "base", "head", "title"]);
const ATTRS = { a: ["href", "title"], img: ["src", "alt", "title", "width"], td: ["colspan", "rowspan"], th: ["colspan", "rowspan", "scope"],
  ol: ["start", "type"] };
const STYLE = { color: /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{3,20})$/i, "background-color": /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{3,20})$/i,
  "text-align": /^(left|right|center|justify|start|end)$/i };
const MAP = { b: "strong", i: "em", strike: "s", del: "s", h1: "h2" };

const safeHref = (h) => /^(https?:|mailto:|#)/i.test(h.trim()) ? h.trim() : null;
const safeSrc = (s) => /^(\/api\/nutrition\/img\/[a-z0-9]+\.(jpg|png|webp|gif)|https:\/\/[^\s"'<>]+)$/i.test(s.trim()) ? s.trim() : null;

function cleanStyle(v) {
  const out = [];
  for (const decl of String(v || "").split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const k = decl.slice(0, i).trim().toLowerCase(), val = decl.slice(i + 1).trim();
    if (STYLE[k]?.test(val)) out.push(`${k}: ${val}`);
  }
  return out.join("; ");
}

function copy(node, doc) {
  if (node.nodeType === 3) return doc.createTextNode(node.nodeValue);
  if (node.nodeType !== 1) return null;
  let tag = node.tagName.toLowerCase();
  if (DROP.has(tag)) return null;
  tag = MAP[tag] || (/^h[5-6]$/.test(tag) ? "h4" : tag);
  const kids = [...node.childNodes].map((c) => copy(c, doc)).filter(Boolean);
  if (!TAGS.has(tag)) {
    const f = doc.createDocumentFragment();
    kids.forEach((k) => f.appendChild(k));
    // a block left out (a <section>, a Word paragraph) keeps its line break
    if (!/^(section|article|header|footer|main|aside|nav|address|dl|dt|dd|center|font)$/.test(tag)) return f;
    const p = doc.createElement(tag === "font" ? "span" : "div");
    p.appendChild(f);
    return p;
  }
  const el = doc.createElement(tag);
  for (const a of ATTRS[tag] || []) {
    const v = node.getAttribute(a);
    if (v == null) continue;
    if (a === "href") { const h = safeHref(v); if (h) el.setAttribute("href", h); }
    else if (a === "src") { const s = safeSrc(v); if (s) el.setAttribute("src", s); }
    else if (a === "width") { if (/^\d{1,3}%?$/.test(v)) el.setAttribute("width", v); }
    else el.setAttribute(a, v.slice(0, 300));
  }
  if (tag === "img" && !el.getAttribute("src")) return null;
  if (tag === "a" && el.getAttribute("href") && !el.getAttribute("href").startsWith("#")) { el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener noreferrer"); }
  const st = cleanStyle(node.getAttribute("style"));
  // the alignment an older editor wrote as an attribute
  const align = node.getAttribute("align");
  const style = [st, align && STYLE["text-align"].test(align) ? `text-align: ${align}` : ""].filter(Boolean).join("; ");
  if (style) el.setAttribute("style", style);
  kids.forEach((k) => el.appendChild(k));
  return el;
}

/** The HTML kept of `html`, as a string. */
export function sanitize(html) {
  const src = new DOMParser().parseFromString(`<!doctype html><body>${String(html || "")}</body>`, "text/html");
  const out = document.implementation.createHTMLDocument("");
  const box = out.createElement("div");
  for (const c of [...src.body.childNodes]) { const k = copy(c, out); if (k) box.appendChild(k); }
  // the empty paragraphs an editor leaves around a list or a table (not those holding a line break: an empty line typed)
  box.querySelectorAll("p").forEach((p) => { if (!p.childNodes.length) p.remove(); });
  return box.innerHTML;
}

/** The plain text of an article's HTML (its words, a summary made of its first lines). */
export function plainText(html) {
  const d = new DOMParser().parseFromString(`<!doctype html><body>${String(html || "")}</body>`, "text/html");
  d.querySelectorAll("p, li, h2, h3, h4, blockquote, br, tr").forEach((e) => e.append(" "));
  return (d.body.textContent || "").replace(/\s+/g, " ").trim();
}
