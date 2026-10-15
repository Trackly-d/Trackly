/* Runs every test in this folder, one after another.
   Use:  node tests/run-all.mjs        (from the project folder, Node 18 or newer)
   Each test prints PASS or FAIL lines and ends with ALL PASSED or "N FAILED". */
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here).filter((f) => f.endsWith(".test.mjs")).sort();
let bad = 0;

for (const file of files) {
  const run = spawnSync(process.execPath, [join(here, file)], { encoding: "utf8" });
  const lines = (run.stdout + run.stderr).trim().split("\n");
  // A test can print an expected error message (for example the Worker test) after its result,
  // so we look for the result line and for any FAIL line, not just the last line.
  const passed = lines.find((l) => /^ALL PASSED/.test(l));
  const failures = lines.filter((l) => /^FAIL /.test(l) || /\d+ FAILED/.test(l));
  const ok = run.status === 0 && Boolean(passed) && failures.length === 0;
  if (!ok) bad += 1;
  console.log((ok ? "ok   " : "FAIL ") + file + "  " + (ok ? passed : (failures[0] || lines[lines.length - 1])));
}
console.log(bad ? bad + " test file(s) failed" : "All " + files.length + " test files passed");
process.exit(bad ? 1 : 0);
