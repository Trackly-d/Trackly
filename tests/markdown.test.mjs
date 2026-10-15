import { parseMarkdown, stripMarkdown } from "../js/markdown.js";

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", name, ok ? "" : "got " + JSON.stringify(got) + " want " + JSON.stringify(want));
};

check("plain paragraph", parseMarkdown("Hello there"), [{ t: "p", c: [{ t: "text", v: "Hello there" }] }]);
check("bold and italic", parseMarkdown("a **b** and *c*")[0].c, [{ t: "text", v: "a " }, { t: "strong", v: "b" }, { t: "text", v: " and " }, { t: "em", v: "c" }]);
check("line break inside a paragraph", parseMarkdown("one\ntwo")[0].c.map((n) => n.t), ["text", "br", "text"]);
check("blank line starts a new paragraph", parseMarkdown("one\n\ntwo").length, 2);
check("bullet list with dash", parseMarkdown("- a\n- b")[0], { t: "ul", c: [{ t: "li", c: [{ t: "text", v: "a" }] }, { t: "li", c: [{ t: "text", v: "b" }] }] });
check("bullet list with star", parseMarkdown("* a\n* b")[0].t, "ul");
check("numbered list", parseMarkdown("1. a\n2. b")[0].t, "ol");
check("list then paragraph", parseMarkdown("- a\ntext").map((b) => b.t), ["ul", "p"]);
check("html stays plain text", parseMarkdown("<b>x</b><script>alert(1)</script>")[0].c, [{ t: "text", v: "<b>x</b><script>alert(1)</script>" }]);
check("link stays plain text", parseMarkdown("[a](http://x.com)")[0].c[0].v, "[a](http://x.com)");
check("image stays plain text", parseMarkdown("![a](http://x.com/a.png)")[0].c[0].t, "text");
check("lone star is text", parseMarkdown("2 * 3 = 6")[0].c, [{ t: "text", v: "2 * 3 = 6" }]);
check("unclosed bold is text", parseMarkdown("**oops")[0].c, [{ t: "text", v: "**oops" }]);
check("empty gives nothing", parseMarkdown("   \n  "), []);
check("null gives nothing", parseMarkdown(null), []);
check("very long text is cut", JSON.stringify(parseMarkdown("x".repeat(9000))).length < 5200, true);

check("strip: symbols and lists", stripMarkdown("**Bold** and *it*\n- one\n- two"), "Bold and it one two");
check("strip: line breaks become spaces", stripMarkdown("a\nb\n\nc"), "a b c");
check("strip: plain text unchanged", stripMarkdown("Focus on the cell membrane."), "Focus on the cell membrane.");
check("strip: empty", stripMarkdown(""), "");

console.log(failed ? failed + " FAILED" : "ALL PASSED");
process.exit(failed ? 1 : 0);
