/* ==========================================================
   TRACKLY safe markdown (pure logic, no browser, tested without one)
   Turns the student's notes into a small tree of plain objects. The page then builds real
   elements from the tree with textContent, so student text never goes into innerHTML.

   What is understood (nothing else): **bold**, *italic*, bullet lists (lines starting with "- " or "* "),
   numbered lists (lines starting with "1. "), blank lines between paragraphs, and line breaks.
   Links, images and HTML are NOT understood: they stay as plain text.

   Tree: block = { t: "p" | "ul" | "ol", c: [...] }; list items are { t: "li", c: [inline] }
         inline = { t: "text", v } | { t: "strong", v } | { t: "em", v } | { t: "br" }
   ========================================================== */

const MAX_CHARS = 5000;

function inline(line) {
  const out = [];
  const re = /\*\*([^*]+?)\*\*|\*([^*\s][^*]*?)\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push({ t: "text", v: line.slice(last, m.index) });
    out.push(m[1] !== undefined ? { t: "strong", v: m[1] } : { t: "em", v: m[2] });
    last = re.lastIndex;
  }
  if (last < line.length) out.push({ t: "text", v: line.slice(last) });
  return out;
}

function paragraph(lines) {
  const c = [];
  lines.forEach((line, i) => {
    if (i > 0) c.push({ t: "br" });
    c.push(...inline(line));
  });
  return { t: "p", c };
}

export function parseMarkdown(text) {
  const lines = String(text == null ? "" : text).slice(0, MAX_CHARS).replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let para = [];
  let list = null;

  const endPara = () => { if (para.length) blocks.push(paragraph(para)); para = []; };
  const endList = () => { if (list) blocks.push(list); list = null; };

  lines.forEach((raw) => {
    const line = raw.trimEnd();
    const bullet = /^\s{0,3}[-*]\s+(.*)$/.exec(line);
    const number = /^\s{0,3}\d{1,3}[.)]\s+(.*)$/.exec(line);

    if (!line.trim()) { endPara(); endList(); return; }
    if (bullet || number) {
      endPara();
      const kind = bullet ? "ul" : "ol";
      if (!list || list.t !== kind) { endList(); list = { t: kind, c: [] }; }
      list.c.push({ t: "li", c: inline((bullet || number)[1]) });
      return;
    }
    endList();
    para.push(line.trim());
  });
  endPara();
  endList();
  return blocks;
}

/* One line of plain text for list rows: no symbols, no line breaks */
export function stripMarkdown(text) {
  const flat = (nodes) => nodes.map((n) => {
    if (n.t === "br") return " ";
    if (n.t === "text" || n.t === "strong" || n.t === "em") return n.v;
    return flat(n.c || []);
  }).join("");
  const parts = parseMarkdown(text).map((block) => {
    if (block.t === "p") return flat(block.c);
    return block.c.map((li) => flat(li.c)).join(" ");
  });
  return parts.join(" ").replace(/\s+/g, " ").trim();
}